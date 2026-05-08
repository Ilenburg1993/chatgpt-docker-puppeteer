// @ts-check
/**
 * src/copilot/infra/sse/state.js
 *
 * Estado SSE canônico (movido de server/sse/ para infra/sse/ — infraestrutura compartilhada).
 *
 * Onda 4.4 — L64.5: implementação própria de estado SSE. Elimina a inversão de camada server → terminal identificada na
 * PARTE-25C.
 *
 * - `_serverSseClients` / `_serverSseCriticalClients`: Sets de clientes do servidor
 * - `_serverReplayBuffer`: buffer de replay dedicado ao endpoint /events do servidor (o `createSseWriter` escreve nele
 *   automaticamente via replayBuffer.push())
 *
 * @module copilot/infra/sse/state
 */

import { SseReplayBuffer } from './replay-buffer.js';

/** @type {Set<import('node:http').ServerResponse>} */
const _serverSseClients = new Set();

/** @type {Set<import('node:http').ServerResponse>} */
const _serverSseCriticalClients = new Set();

/** Buffer de replay SSE dedicado ao servidor — preenchido pelo createSseWriter. (lazy init) */
/** @type {SseReplayBuffer | null} */
let _serverReplayBuffer = null;

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
 * Retorna o buffer de replay SSE do servidor (lazy-initialized para evitar TDZ em ciclos de import).
 *
 * Nota: na camada server, este buffer é gerenciado pelo createSseWriter (infra/sse/utils.js), que chama
 * replayBuffer.push() automaticamente a cada evento enviado.
 *
 * @returns {SseReplayBuffer}
 */
export function getTerminalReplayBuffer() {
    if (!_serverReplayBuffer) {
        _serverReplayBuffer = new SseReplayBuffer();
    }
    return _serverReplayBuffer;
}
