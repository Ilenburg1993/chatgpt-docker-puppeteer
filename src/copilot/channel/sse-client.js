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

import { utf8ByteLength } from '#copilot/infra/public/platform/buffer';
import { log } from '#copilot/observability';
import { logSwallowed } from '#copilot/observability/swallowed';
import http from 'node:http';

export const MAX_SSE_PENDING_EVENT_BYTES = 1024 * 1024;

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
 * @param {{ maxPendingBytes?: number }} [options]
 */
export function createSseBlockDecoder(options = {}) {
    const maxPendingBytes =
        Number.isInteger(options.maxPendingBytes) && Number(options.maxPendingBytes) > 0
            ? Math.min(MAX_SSE_PENDING_EVENT_BYTES, Number(options.maxPendingBytes))
            : MAX_SSE_PENDING_EVENT_BYTES;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';

    return {
        /**
         * @param {Buffer | Uint8Array} chunk
         * @returns {string[]}
         */
        push(chunk) {
            buffer += decoder.decode(chunk, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/u);
            buffer = blocks.pop() ?? '';
            if (utf8ByteLength(buffer, 'SSE pending event') > maxPendingBytes) {
                throw new Error(`SSE pending event exceeds ${maxPendingBytes} bytes.`);
            }
            return blocks;
        },
        /**
         * @returns {string}
         */
        finish() {
            buffer += decoder.decode();
            if (utf8ByteLength(buffer, 'SSE pending event') > maxPendingBytes) {
                throw new Error(`SSE pending event exceeds ${maxPendingBytes} bytes.`);
            }
            return buffer;
        },
    };
}

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
    const REQUEST_TIMEOUT_MS = 15_000;
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
                const statusCode = res.statusCode ?? 0;
                const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
                if (statusCode < 200 || statusCode >= 300 || !contentType.includes('text/event-stream')) {
                    log(
                        'WARN',
                        `[inject] SSE resposta invalida (${path}) status=${statusCode} content-type=${contentType || 'n/a'}`,
                    );
                    res.resume();
                    if (!destroyed) scheduleReconnect();
                    return;
                }
                reconnectMs = 1_000;
                const blockDecoder = createSseBlockDecoder();
                res.on('data', (/** @type {Buffer} */ chunk) => {
                    let blocks;
                    try {
                        blocks = blockDecoder.push(chunk);
                    } catch (error) {
                        log(
                            'WARN',
                            `[inject] SSE frame inválido (${path}): ${error instanceof Error ? error.message : String(error)}`,
                        );
                        res.destroy(error instanceof Error ? error : new Error(String(error)));
                        return;
                    }

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
                res.on('end', () => {
                    try {
                        blockDecoder.finish();
                    } catch (error) {
                        logSwallowed(error, 'channel.sseClient.finishDecoder');
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

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`SSE connect timeout after ${REQUEST_TIMEOUT_MS}ms`));
        });
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
        reconnectTimer.unref?.();
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
