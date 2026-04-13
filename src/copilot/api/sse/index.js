// @ts-check
/**
 * Barrel — SSE (Server-Sent Events) utilities.
 *
 * @deprecated Onda 3.6 — Re-export de compatibilidade. Use `src/copilot/server/sse/` diretamente.
 *   Remover na Onda 3.9.
 *
 * @module copilot/api/sse
 * @see EventBus
 */

export { EventFanout, eventFanout } from '../../server/sse/fanout.js';
export { SseReplayBuffer } from '../../server/sse/replay-buffer.js';
export {
    SseConnectionTracker,
    createEventFilter,
    createSseWriter,
    sanitizeSseEvent,
    standardizeSsePayload,
} from '../../server/sse/utils.js';
