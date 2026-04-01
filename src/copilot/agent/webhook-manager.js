// @ts-check
/**
 * @module copilot/agent/webhook-manager
 * @file WebhookManager — gerencia webhooks de notificação de eventos do agente.
 *
 *   Encapsula o registro, remoção e disparo de webhooks HTTP(S), extraído de `always-alive.js` para facilitar testes e
 *   reuso isolado.
 */

import { log } from '#core/logger';
import http from 'node:http';
import https from 'node:https';

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
     * Registra uma URL de webhook.
     *
     * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
     * @returns {WebhookEntry} Entrada registrada
     */
    register(url) {
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

        const body = JSON.stringify({ event, payload, timestamp: Date.now() });

        await Promise.allSettled(
            [...this.#urls.entries()].map(async ([id, url]) => {
                try {
                    const parsed = new URL(url);
                    const lib = parsed.protocol === 'https:' ? https : http;
                    await new Promise((resolve, reject) => {
                        const req = lib.request(
                            url,
                            { method: 'POST', headers: { 'Content-Type': 'application/json' } },
                            (res) => {
                                res.resume();
                                res.on('end', resolve);
                            },
                        );
                        req.on('error', reject);
                        req.end(body);
                    });
                } catch (/** @type {any} */ e) {
                    log('WARN', `[WebhookManager] ${id} falhou ao notificar ${url}: ${e.message}`);
                }
            }),
        );
    }
}
