// @ts-check
/**
 * @module copilot/agent/webhook-manager
 * @file WebhookManager — gerencia webhooks de notificação de eventos do agente.
 *
 *   Encapsula o registro, remoção e disparo de webhooks HTTP(S), extraído de `always-alive.js` para facilitar testes e
 *   reuso isolado.
 */

import { log } from '#core/logger';

/**
 * Timeout (ms) para cada requisição HTTP de webhook. Evita que webhooks lentos bloqueiem o ciclo.
 *
 * @type {number}
 */
const WEBHOOK_TIMEOUT_MS = Number(process.env['WEBHOOK_TIMEOUT_MS']) || 5_000;

/**
 * Máximo de webhooks simultâneos que podem ser registrados.
 *
 * @type {number}
 */
const MAX_WEBHOOKS = Number(process.env['MAX_WEBHOOKS']) || 50;

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
        const allowPrivate = process.env['WEBHOOK_ALLOW_PRIVATE_HOSTS'] === 'true';
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
     * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
     * @returns {WebhookEntry} Entrada registrada
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
                // G2-ARCH-06: usar fetch (Node 18+) em vez de http/https nativos — mais limpo e testável
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
                try {
                    await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body,
                        signal: controller.signal,
                    });
                } catch (/** @type {any} */ e) {
                    log('WARN', `[WebhookManager] ${id} falhou ao notificar ${url}: ${e.message}`);
                } finally {
                    clearTimeout(timeoutId);
                }
            }),
        );
    }
}
