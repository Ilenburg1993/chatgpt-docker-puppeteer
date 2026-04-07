/**
 * Barrel — SSE (Server-Sent Events) utilities.
 *
 * @module copilot/api/sse
 */

export { EventFanout, eventFanout } from './fanout.js';
export { SseReplayBuffer } from './replay-buffer.js';
export {
    createEventFilter,
    createSseWriter,
    sanitizeSseEvent,
    SseConnectionTracker,
    standardizeSsePayload,
} from './utils.js';
