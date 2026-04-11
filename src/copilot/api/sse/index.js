// @ts-check
/**
 * Barrel — SSE (Server-Sent Events) utilities.
 *
 * @module copilot/api/sse
 * @see EventBus
 */

export { EventFanout, eventFanout } from './fanout.js';
export { SseReplayBuffer } from './replay-buffer.js';
export {
    SseConnectionTracker,
    createEventFilter,
    createSseWriter,
    sanitizeSseEvent,
    standardizeSsePayload,
} from './utils.js';
