// @ts-check
/**
 * src/copilot/presentation/realtime/sse/state.js
 *
 * Estado SSE canônico compartilhado entre as bordas server e terminal sob ownership de presentation/realtime.
 *
 * Onda 4.4 — L64.5: implementação própria de estado SSE. Elimina a inversão de camada server → terminal identificada na
 * PARTE-25C.
 *
 * - `_serverSseClients` / `_serverSseCriticalClients`: Sets legados de clientes raw do terminal.
 * - `_serverReplayBuffer`: buffer de replay compartilhado do stream global. O dono canônico da gravação é
 *   `terminal/dialog/sse.broadcastSse()`, que atribui um ID uma única vez e o propaga via fanout para os pools
 *   Express.
 *
 * @module copilot/presentation/realtime/sse/state
 */

import { SseReplayBuffer } from './replay-buffer.js';

/** @type {Set<import('node:http').ServerResponse>} */
const _serverSseClients = new Set();

/** @type {Set<import('node:http').ServerResponse>} */
const _serverSseCriticalClients = new Set();

/** Buffer de replay SSE global do terminal — preenchido uma vez por broadcast canônico. (lazy init) */
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
 * Nota: eventos emitidos por `terminal/dialog/sse.broadcastSse()` já chegam ao fanout com ID de replay atribuído. O
 * router Express reutiliza esse ID para entregar `/events` sem regravar o replay global. Outros publishers sem ID ainda
 * podem ser gravados pelo `SseClientPool`, preservando compatibilidade.
 *
 * @returns {SseReplayBuffer}
 */
export function getTerminalReplayBuffer() {
    if (!_serverReplayBuffer) {
        _serverReplayBuffer = new SseReplayBuffer();
    }
    return _serverReplayBuffer;
}
