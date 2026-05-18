// @ts-check
/**
 * @module copilot/infra/webhooks
 * @file WebhookManager — gerencia webhooks de notificação de eventos do agente.
 *
 *   Encapsula o registro, remoção e disparo de webhooks HTTP(S), extraído de `always-alive.js` para facilitar testes e
 *   reuso isolado.
 * @see EventBus
 */

import { WEBHOOK_ALLOW_PRIVATE_HOSTS } from '#copilot/config';
import { MAX_WEBHOOKS, WEBHOOK_MAX_RETRIES, WEBHOOK_RETRY_BASE_MS, WEBHOOK_TIMEOUT_MS } from '#copilot/config/agent';
import { ConfigError, checkResolvedIp, toError, validateWebhookUrl } from '#copilot/core';
import { log } from '#copilot/observability';

/**
 * @param {number} timeoutMs
 * @returns {{ signal: AbortSignal; cleanup: () => void }}
 */
function createTimeoutSignal(timeoutMs) {
    const abortSignalCtor = /** @type {{ timeout?: (ms: number) => AbortSignal }} */ (AbortSignal);
    if (typeof abortSignalCtor.timeout === 'function') {
        return { signal: abortSignalCtor.timeout(Math.max(0, timeoutMs)), cleanup: () => {} };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
    timeoutId.unref?.();
    return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timeoutId),
    };
}

/**
 * @typedef {{ id: string; url: string }} WebhookEntry
 */

/**
 * Gerencia webhooks de notificação de eventos.
 *
 * Exemplo de uso:
 *
 * ```js
 * const wm = new WebhookManager();
 * const { id } = wm.register('https://meu-servidor/hook');
 * await wm.emit('session.start', { sessionId: 'abc' });
 * wm.unregister(id);
 * ```
 */
export class WebhookManager {
    /** @type {Map<string, string>} Map de id → URL */
    #urls = new Map();

    /**
     * Valida se uma URL de webhook é segura — delega para url-validator.js.
     *
     * @param {string} url
     * @throws {ConfigError} Se a URL for inválida ou insegura
     */
    static #validateUrl(url) {
        validateWebhookUrl(url);
    }

    /**
     * Registra uma URL de webhook.
     *
     * @example
     *     const wm = new WebhookManager();
     *     const { id } = wm.register('https://hooks.example.com/notify');
     *
     * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
     * @returns {WebhookEntry} Entrada registrada
     * @throws {ConfigError} Se a URL for inválida/insegura ou o limite de webhooks for atingido
     */
    register(url) {
        WebhookManager.#validateUrl(url);
        if (this.#urls.size >= MAX_WEBHOOKS) {
            throw new ConfigError(`[WebhookManager] Limite de ${MAX_WEBHOOKS} webhooks atingido.`);
        }
        const id = `wh_${Date.now()}_${globalThis.crypto.randomUUID().slice(-8)}`;
        this.#urls.set(id, url);
        log('INFO', `[WebhookManager] Registrado: ${id} → ${url}`);
        return { id, url };
    }

    /**
     * Remove um webhook previamente registrado.
     *
     * @param {string} id - ID do webhook a remover
     * @returns {boolean} true se removido, false se não encontrado
     */
    unregister(id) {
        const removed = this.#urls.delete(id);
        if (removed) log('INFO', `[WebhookManager] Removido: ${id}`);
        return removed;
    }

    /**
     * Lista todos os webhooks registrados.
     *
     * @returns {WebhookEntry[]}
     */
    list() {
        return [...this.#urls.entries()].map(([id, url]) => ({ id, url }));
    }

    /**
     * G2-SEC-06: sanitiza o payload do webhook removendo campos potencialmente sensíveis.
     *
     * Campos removidos: content (mensagens), answer (respostas), token*, session*, key*, secret*, password* Para
     * eventos de alto volume como `task.delta`, o payload é omitido completamente (campo `redacted: true`).
     *
     * @param {string} event
     * @param {object} payload
     * @returns {object}
     */
    static #sanitizePayload(event, payload) {
        // Para eventos de streaming, omitir payload completo para evitar exfiltração de conteúdo
        if (event === 'task.delta' || event === 'task.reasoning') {
            return { redacted: true };
        }
        if (!payload || typeof payload !== 'object') return payload;
        /** @type {Record<string, unknown>} */
        const sanitized = {};
        for (const [key, value] of Object.entries(payload)) {
            const lk = key.toLowerCase();
            // Remover campos com nomes suspeitos
            if (
                lk.includes('token') ||
                lk.includes('secret') ||
                lk.includes('password') ||
                lk.includes('key') ||
                lk.includes('auth') ||
                lk === 'content' ||
                lk === 'answer' ||
                lk === 'message'
            ) {
                sanitized[key] = '[redacted]';
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    /**
     * SEC-AGENT-005: Verifica DNS rebinding — delega para url-validator.js.
     *
     * @param {string} hostname
     * @returns {Promise<void>}
     * @throws {Error} Se o IP resolvido for privado/loopback
     */
    static async #checkResolvedIp(hostname) {
        await checkResolvedIp(hostname);
    }

    /**
     * Emite um evento para todas as URLs registradas via HTTP POST.
     *
     * Falhas individuais são logadas mas não propagadas (allSettled).
     *
     * @param {string} event - Nome do evento (ex: 'session.start')
     * @param {object} payload - Dados do evento
     * @returns {Promise<void>}
     */
    async emit(event, payload) {
        if (this.#urls.size === 0) return;

        const body = JSON.stringify({
            event,
            payload: WebhookManager.#sanitizePayload(event, payload),
            timestamp: Date.now(),
        });

        await Promise.allSettled(
            [...this.#urls.entries()].map(async ([id, url]) => {
                // SEC-AGENT-005: verificar IP resolvido para mitigar DNS rebinding
                if (!WEBHOOK_ALLOW_PRIVATE_HOSTS) {
                    try {
                        const hostname = new URL(url).hostname;
                        await WebhookManager.#checkResolvedIp(hostname);
                    } catch (e) {
                        log('WARN', `[WebhookManager] ${id} bloqueado (DNS rebinding): ${toError(e).message}`);
                        return;
                    }
                }
                // GAP-ROUTE-002: retry com exponential backoff para falhas retriable
                await WebhookManager.#deliverWithRetry(id, url, body, WEBHOOK_MAX_RETRIES);
            }),
        );
    }

    /**
     * Entrega uma requisição de webhook com retry exponential backoff. Retries ocorrem apenas para erros retriable:
     * 5xx, timeout, network error. 4xx são considerados erros permanentes e não são retriados.
     *
     * @param {string} id - Identificador do webhook
     * @param {string} url - URL de destino
     * @param {string} body - JSON body a enviar
     * @param {number} maxRetries - Número máximo de retries
     * @returns {Promise<void>}
     */
    static async #deliverWithRetry(id, url, body, maxRetries) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                // Exponential backoff: 500ms, 1000ms, 2000ms...
                const delay = WEBHOOK_RETRY_BASE_MS * 2 ** (attempt - 1);
                await new Promise((r) => {
                    const timer = setTimeout(r, delay);
                    timer.unref?.();
                });
            }

            const timeoutHandle = createTimeoutSignal(WEBHOOK_TIMEOUT_MS);
            try {
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    signal: timeoutHandle.signal,
                });
                if (resp.ok) return; // sucesso

                // 4xx = erro permanente, não retriar
                if (resp.status >= 400 && resp.status < 500) {
                    log('WARN', `[WebhookManager] ${id} HTTP ${resp.status} de ${url} (permanente, sem retry)`);
                    return;
                }
                // 5xx = retriable
                if (attempt < maxRetries) {
                    log(
                        'DEBUG',
                        `[WebhookManager] ${id} HTTP ${resp.status} de ${url} — retry ${attempt + 1}/${maxRetries}`,
                    );
                } else {
                    log('WARN', `[WebhookManager] ${id} HTTP ${resp.status} de ${url} após ${maxRetries} retries`);
                }
            } catch (e) {
                const reason = toError(e).name === 'AbortError' ? 'timeout' : 'network';
                if (attempt < maxRetries) {
                    log('DEBUG', `[WebhookManager] ${id} ${reason} — retry ${attempt + 1}/${maxRetries}`);
                } else {
                    log(
                        'WARN',
                        `[WebhookManager] ${id} falhou (${reason}) ao notificar ${url} após ${maxRetries} retries: ${toError(e).message}`,
                    );
                }
            } finally {
                timeoutHandle.cleanup();
            }
        }
    }
}
