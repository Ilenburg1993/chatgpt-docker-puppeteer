// @ts-check
/**
 * src/copilot/channel/sse-client.js
 *
 * Cliente SSE (Server-Sent Events) com reconexão automática e backoff exponencial. Extraído de inject.js (F105) para
 * reduzir complexidade.
 *
 * @module copilot/channel/sse-client
 * @see EventBus
 */

import { log } from '#copilot/observability';
import http from 'node:http';
import { logSwallowed } from '../core/error-handlers.js';

/**
 * @typedef {Object} SseEvent
 * @property {string} type
 * @property {Record<string, unknown>} data
 */

/**
 * @callback SseHandler
 * @param {SseEvent} event
 * @returns {void}
 */

/**
 * Conecta ao endpoint SSE e entrega eventos ao callback. MR-09: reconecta automaticamente com backoff exponencial
 * quando a conexão cai. PHASE-10: rastreia Last-Event-ID para replay na reconexão.
 *
 * @param {string} path - Path do endpoint, ex: '/events' ou '/events?level=critical'
 * @param {number} port
 * @param {SseHandler} onEvent
 * @returns {{ unsubscribe: () => void }}
 */
export function subscribeSse(path, port, onEvent) {
    let destroyed = false;
    let reconnectMs = 1_000;
    const MAX_RECONNECT_MS = 30_000;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let reconnectTimer = null;
    /** @type {ReturnType<typeof http.request> | null} */
    let currentReq = null;
    /** @type {string} */
    let lastEventId = '';

    function connect() {
        if (destroyed) return;

        /** @type {Record<string, string>} */
        const headers = { Accept: 'text/event-stream' };
        if (lastEventId) headers['Last-Event-ID'] = lastEventId;

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method: 'GET',
                headers,
            },
            (res) => {
                reconnectMs = 1_000;
                let buf = '';
                const MAX_BUF_BYTES = 256 * 1024;
                res.on('data', (/** @type {Buffer} */ chunk) => {
                    const chunkStr = chunk.toString();
                    if (buf.length + chunkStr.length > MAX_BUF_BYTES) {
                        buf = '';
                        return;
                    }
                    buf += chunkStr;
                    const blocks = buf.split(/\r?\n\r?\n/);
                    buf = blocks.pop() ?? '';

                    for (const block of blocks) {
                        if (!block.trim()) continue;
                        let currentEvent = '';
                        let currentId = '';
                        const dataLines = /** @type {string[]} */ ([]);
                        for (const line of block.split(/\r?\n/)) {
                            if (line.startsWith('event:')) {
                                currentEvent = line.slice(6).trim();
                            } else if (line.startsWith('data:')) {
                                dataLines.push(line.slice(5).trimStart());
                            } else if (line.startsWith('id:')) {
                                currentId = line.slice(3).trim();
                            }
                        }
                        if (currentId) lastEventId = currentId;
                        if (dataLines.length > 0) {
                            try {
                                const data = JSON.parse(dataLines.join('\n'));
                                onEvent({ type: currentEvent || 'message', data });
                            } catch (e) {
                                logSwallowed(e, 'channel.sseClient.parseJson');
                            }
                        }
                    }
                });
                res.on('close', () => {
                    if (!destroyed) scheduleReconnect();
                });
                res.on('error', () => {
                    if (!destroyed) scheduleReconnect();
                });
            },
        );
        currentReq = req;

        req.on('error', () => {
            if (!destroyed) scheduleReconnect();
        });
        req.end();
    }

    function scheduleReconnect() {
        if (destroyed || reconnectTimer !== null) return;
        log('DEBUG', `[inject] SSE desconectado (${path}) — reconectando em ${reconnectMs}ms`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, reconnectMs);
        reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
    }

    connect();

    return {
        unsubscribe() {
            if (!destroyed) {
                destroyed = true;
                if (reconnectTimer !== null) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                currentReq?.destroy();
                currentReq = null;
            }
        },
    };
}
