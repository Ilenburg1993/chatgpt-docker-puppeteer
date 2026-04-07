// @ts-check
/**
 * src/copilot/agent/session/event-handlers/index.js — barrel para handlers de eventos SDK.
 *
 * @module copilot/agent/session/event-handlers
 */

export { KNOWN_SDK_EVENTS, wireCatchAll } from './catch-all.js';
export { wireCompactionEvents } from './compaction.js';
export { wireModeAndToolEvents } from './mode-and-tools.js';
export { wireSdkResponseEvents } from './sdk-responses.js';
export { wireStreamingEvents } from './streaming.js';
export { wireSystemNotificationEvents } from './system-notifications.js';
export { wireTokenBudgetEvents } from './token-budget.js';
export { wireUsageEvent } from './usage.js';
