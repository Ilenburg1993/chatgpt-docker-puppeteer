// @ts-check
/**
 * src/copilot/agent/infra/index.js — sub-barrel do subsistema Infra (queue, tools, webhooks, snapshots).
 *
 * @module copilot/agent/infra
 * @see EventBus
 */

export { buildAuditingPermissionHandler, isHighRiskTool, logToolAudit } from '#copilot/audit';
export { executeTask } from '../messaging/agent-messaging.js';
export { PermissionController } from '../ports/permission-port.js';
export { buildStatusSnapshot } from '../ports/snapshot-port.js';
export {
    bootstrapAgentTools as bootstrapTools,
    configureHookTools,
    setExperimentalSession,
    setHub,
    setPermissionAgent,
    setSessionRpc,
} from '../ports/tool-port.js';
export { HandoffManager } from './handoff-manager.js';
export { MessageQueue } from './message-queue.js';
export { WebhookManager } from './webhook-manager.js';
/**
 * @typedef {import('./handoff-manager.js').HandoffRequest} HandoffRequest
 *
 * @typedef {import('./handoff-manager.js').HandoffResult} HandoffResult
 */
