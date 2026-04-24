// @ts-check
/**
 * Barrel — SSE (Server-Sent Events) — infraestrutura compartilhada.
 *
 * Movido de `server/sse/` para `infra/sse/` — este módulo é usado por server/routes/ e terminal/, portanto pertence à
 * camada infra.
 *
 * @module copilot/infra/sse
 */

export { EventFanout, eventFanout } from './fanout.js';
export { SseReplayBuffer } from './replay-buffer.js';
export { getSseClients, getSseCriticalClients, getTerminalReplayBuffer } from './state.js';
export { SseClientPool } from './stream-hub.js';
export {
    SseConnectionTracker,
    createEventFilter,
    createSseWriter,
    sanitizeSseEvent,
    standardizeSsePayload,
} from './utils.js';
