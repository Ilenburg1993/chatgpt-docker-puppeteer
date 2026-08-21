// @ts-check
/**
 * Public presentation boundary for realtime transport primitives shared by server and terminal.
 *
 * @module copilot/presentation/realtime
 */

export {
    EventFanout,
    SSE_REPLAY_EVENT_ID_FIELD,
    SseClientPool,
    SseConnectionTracker,
    SseReplayBuffer,
    attachSseReplayEventId,
    createEventFilter,
    createSseWriter,
    detachSseReplayEventId,
    eventFanout,
    getSseClients,
    getSseCriticalClients,
    getTerminalReplayBuffer,
    sanitizeSseEvent,
    standardizeSsePayload,
} from './sse/index.js';
