// @ts-check
/**
 * Barrel — SSE (Server-Sent Events) utilities.
 *
 * @module copilot/api/sse
 * @deprecated Onda 3.6 → 4.5 — Re-export de compatibilidade. Use `src/copilot/server/sse/` diretamente. Zero
 *   consumidores diretos após Onda 4.5. Remover na Onda 5.0.
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
