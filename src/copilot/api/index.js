// @ts-check
/**
 * src/copilot/api/index.js
 *
 * Barrel exports do módulo de API HTTP.
 *
 * @module copilot/api
 */

// Express routers (SDK API)
export { default as sdkApiRouter } from './express/index.js';

// HTTP Bridge
export { default as httpBridge } from './bridge/index.js';

// SSE utilities
export { eventFanout } from './sse/fanout.js';
export { SseReplayBuffer } from './sse/replay-buffer.js';
export { SseConnectionTracker, createEventFilter, createSseWriter, standardizeSsePayload } from './sse/utils.js';
