// @ts-check
/**
 * src/copilot/agent/session/event-handlers/index.js — barrel para handlers de eventos SDK.
 *
 * @module copilot/agent/session/event-handlers
 * @see EventBus
 */

export { KNOWN_SDK_EVENTS, wireCatchAll } from './catch-all.js';
export { wireCompactionEvents } from './compaction.js';
export { wireInteractionEvents } from './interaction-events.js';
export { wireMcpEvents } from './mcp-events.js';
export { wireModeAndToolEvents } from './mode-and-tools.js';
export { wireSdkResponseEvents } from './sdk-responses.js';
export { wireSessionLifecycleEvents } from './session-lifecycle.js';
export { wireStreamingEvents } from './streaming.js';
export { wireSystemNotificationEvents } from './system-notifications.js';
export { wireTokenBudgetEvents } from './token-budget.js';
export { wireToolLifecycleEvents } from './tool-lifecycle.js';
export { wireUsageEvent } from './usage.js';
