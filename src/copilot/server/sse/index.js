// @ts-check
/**
 * Barrel — SSE (Server-Sent Events) — canônico no server.
 *
 * Onda 3.6: este é o barrel canônico. O `api/sse/index.js` é re-export de compatibilidade.
 *
 * @module copilot/server/sse
 */

export { EventFanout, eventFanout } from './fanout.js';
export { SseReplayBuffer } from './replay-buffer.js';
export { getSseClients, getSseCriticalClients, getTerminalReplayBuffer } from './state.js';
export {
    createEventFilter,
    createSseWriter,
    sanitizeSseEvent, SseConnectionTracker, standardizeSsePayload
} from './utils.js';
