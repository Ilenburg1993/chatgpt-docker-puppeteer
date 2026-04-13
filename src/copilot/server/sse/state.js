// @ts-check
/**
 * src/copilot/server/sse/state.js
 *
 * Estado SSE canônico do servidor copilot.
 *
 * Onda 4.4 — L64.5: implementação própria sem re-export de `terminal/state.js`.
 * Elimina a inversão de camada server → terminal identificada na PARTE-25C.
 *
 * - `_serverSseClients` / `_serverSseCriticalClients`: Sets de clientes do servidor
 *   (distintos dos Sets raw do terminal em `terminal/state.js`)
 * - `_serverReplayBuffer`: buffer de replay dedicado ao endpoint /events do servidor
 *   (o `createSseWriter` escreve nele automaticamente via replayBuffer.push())
 *
 * @module copilot/server/sse/state
 */

import { SseReplayBuffer } from './replay-buffer.js';

/** @type {Set<import('node:http').ServerResponse>} */
const _serverSseClients = new Set();

/** @type {Set<import('node:http').ServerResponse>} */
const _serverSseCriticalClients = new Set();

/** Buffer de replay SSE dedicado ao servidor — preenchido pelo createSseWriter. */
const _serverReplayBuffer = new SseReplayBuffer();

/**
 * Retorna o Set de clientes SSE do servidor (endpoint GET /events).
 *
 * @returns {Set<import('node:http').ServerResponse>}
 */
export function getSseClients() {
    return _serverSseClients;
}

/**
 * Retorna o Set de clientes SSE críticos do servidor (endpoint GET /events/critical).
 *
 * @returns {Set<import('node:http').ServerResponse>}
 */
export function getSseCriticalClients() {
    return _serverSseCriticalClients;
}

/**
 * Retorna o buffer de replay SSE do servidor.
 *
 * Nota: na camada server, este buffer é gerenciado pelo createSseWriter (server/sse/utils.js),
 * que chama replayBuffer.push() automaticamente a cada evento enviado.
 *
 * @returns {SseReplayBuffer}
 */
export function getTerminalReplayBuffer() {
    return _serverReplayBuffer;
}
