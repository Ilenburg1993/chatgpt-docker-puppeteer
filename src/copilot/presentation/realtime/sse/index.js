// @ts-check
/**
 * Barrel — SSE (Server-Sent Events) compartilhado entre bordas.
 *
 * Ownership canônico: `presentation/realtime`, pois server e terminal consomem a mesma representação de transporte
 * sem tornar o subsistema técnico global de infra dependente de semântica HTTP/Express.
 *
 * @module copilot/presentation/realtime/sse
 */

export { SSE_REPLAY_EVENT_ID_FIELD, attachSseReplayEventId, detachSseReplayEventId } from './envelope.js';
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
