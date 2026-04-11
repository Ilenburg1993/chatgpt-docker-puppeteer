// @ts-check
/**
 * src/copilot/observability/collectors/index.js
 *
 * Barrel para os handler groups do EventCollector.
 *
 * @module copilot/observability/collectors
 * @see EventBus
 */

export { attachAssistantHandlers, quotaState } from './assistant-handlers.js';
export { attachInteractionHandlers } from './interaction-handlers.js';
export { attachSessionHandlers, injectRecordCompaction } from './session-handlers.js';
export { attachToolHandlers } from './tool-handlers.js';
