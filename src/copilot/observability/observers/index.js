// @ts-check
/**
 * src/copilot/observability/observers/index.js
 *
 * Barrel para os handler groups do AgentEventObserver.
 *
 * @module copilot/observability/observers
 * @see EventBus
 */

export { attachDialogTaskHandlers } from './dialog-task-handlers.js';
export { EMITTER_TO_BUS_TYPE } from './event-name-map.js';
export { attachSessionAgentHandlers } from './session-agent-handlers.js';
