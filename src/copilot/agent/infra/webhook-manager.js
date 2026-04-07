// @ts-check
/**
 * @module copilot/agent/infra/webhook-manager
 * @file WebhookManager — gerencia webhooks de notificação de eventos do agente.
 *
 *   Encapsula o registro, remoção e disparo de webhooks HTTP(S), extraído de `always-alive.js` para facilitar testes e
 *   reuso isolado.
 */

import { log } from '#copilot/observability/logger';
import { WEBHOOK_ALLOW_PRIVATE_HOSTS } from '#copilot/config/env';
import dns from 'node:dns/promises';
import { MAX_WEBHOOKS, WEBHOOK_MAX_RETRIES, WEBHOOK_TIMEOUT_MS } from '../config.js';

/**
 * Delay base (ms) para backoff exponencial entre retries de webhook.
 *
 * @type {number}
 */
const WEBHOOK_RETRY_BASE_MS = 500;

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
     * Valida se uma URL de webhook é segura (protocolo HTTP/HTTPS, sem IPs privados/loopback exceto quando
     * explicitamente permitido via WEBHOOK_ALLOW_PRIVATE_HOSTS=true).
     *
     * G2-SEC-01: prevenção de SSRF básica — bloqueia acesso a RFC-1918 e loopback.
     *
     * @param {string} url
     * @throws {Error} Se a URL for inválida ou insegura
     */
    static #validateUrl(url) {
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            throw new Error(`[WebhookManager] URL inválida: ${url}`);
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`[WebhookManager] Protocolo não permitido: ${parsed.protocol}. Use http ou https.`);
        }
        const allowPrivate = WEBHOOK_ALLOW_PRIVATE_HOSTS;
        if (!allowPrivate) {
            const hostname = parsed.hostname;
            // Bloquear loopback, localhost, e ranges RFC-1918
            if (
                hostname === 'localhost' ||
                hostname === '0.0.0.0' ||
                /^127\./.test(hostname) ||
                /^::1$/.test(hostname) ||
                /^10\./.test(hostname) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
                /^192\.168\./.test(hostname) ||
                /^169\.254\./.test(hostname) // link-local
            ) {
                throw new Error(
                    `[WebhookManager] Host privado/loopback bloqueado por segurança: ${hostname}. Use WEBHOOK_ALLOW_PRIVATE_HOSTS=true para permitir em dev.`,
                );
            }
        }
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
     * @throws {Error} Se a URL for inválida/insegura ou o limite de webhooks for atingido
     */
    register(url) {
        WebhookManager.#validateUrl(url);
        if (this.#urls.size >= MAX_WEBHOOKS) {
            throw new Error(`[WebhookManager] Limite de ${MAX_WEBHOOKS} webhooks atingido.`);
        }
        const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
     * SEC-AGENT-005: Verifica se o IP resolvido para um hostname é privado/loopback. Mitiga DNS rebinding — atacante
     * usa hostname público que resolve para IP interno.
     *
     * @param {string} hostname
     * @returns {Promise<void>}
     * @throws {Error} Se o IP resolvido for privado/loopback
     */
    static async #checkResolvedIp(hostname) {
        let address;
        try {
            const result = await dns.lookup(hostname, { family: 4 });
            address = result.address;
        } catch {
            // IPv6 fallback
            try {
                const result = await dns.lookup(hostname, { family: 6 });
                address = result.address;
            } catch {
                return; // Não conseguiu resolver — deixa o fetch falhar naturalmente
            }
        }
        const isPrivate =
            address === '127.0.0.1' ||
            address === '0.0.0.0' ||
            /^127\./.test(address) ||
            /^::1$/.test(address) ||
            /^10\./.test(address) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
            /^192\.168\./.test(address) ||
            /^169\.254\./.test(address) ||
            /^fe80:/i.test(address) || // link-local IPv6
            /^f[cd]/i.test(address) || // ULA IPv6 (fc00::/7 → fc/fd prefixes)
            /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(address); // IPv4-mapped
        if (isPrivate) {
            throw new Error(
                `[WebhookManager] DNS rebinding bloqueado: ${hostname} resolveu para IP privado ${address}.`,
            );
        }
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
                    } catch (/** @type {any} */ e) {
                        log('WARN', `[WebhookManager] ${id} bloqueado (DNS rebinding): ${e.message}`);
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
                await new Promise((r) => setTimeout(r, delay));
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
            try {
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    signal: controller.signal,
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
            } catch (/** @type {any} */ e) {
                const reason = e.name === 'AbortError' ? 'timeout' : 'network';
                if (attempt < maxRetries) {
                    log('DEBUG', `[WebhookManager] ${id} ${reason} — retry ${attempt + 1}/${maxRetries}`);
                } else {
                    log(
                        'WARN',
                        `[WebhookManager] ${id} falhou (${reason}) ao notificar ${url} após ${maxRetries} retries: ${e.message}`,
                    );
                }
            } finally {
                clearTimeout(timeoutId);
            }
        }
    }
}
