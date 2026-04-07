// @ts-check
/**
 * src/copilot/observability/collectors/index.js
 *
 * Barrel para os handler groups do EventCollector.
 *
 * @module copilot/observability/collectors
 */

export { attachToolHandlers } from './tool-handlers.js';
export { attachSessionHandlers, injectRecordCompaction } from './session-handlers.js';
export { attachAssistantHandlers, quotaState } from './assistant-handlers.js';
export { attachInteractionHandlers } from './interaction-handlers.js';
