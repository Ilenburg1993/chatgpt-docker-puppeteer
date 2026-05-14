// @ts-check
/**
 * src/copilot/agent/infra/index.js — sub-barrel do subsistema Infra (queue, tools, webhooks, snapshots).
 *
 * @module copilot/agent/infra
 * @see EventBus
 */

export { buildAuditingPermissionHandler, isHighRiskTool, logToolAudit } from '#copilot/audit';
export { checkResolvedIp, isPrivateIp, validateWebhookUrl } from '#copilot/core';
export { WebhookManager } from '../../infra/webhooks.js';
export { executeTask } from '../messaging/agent-messaging.js';
export {
    PermissionController,
    bootstrapAgentTools as bootstrapTools,
    buildStatusSnapshot,
    configureHookTools,
    setExperimentalSession,
    setHub,
    setPermissionAgent,
    setSessionRpc,
} from '../ports/index.js';
export { HandoffManager } from './handoff-manager.js';
export { MessageQueue } from './message-queue.js';
/**
 * @typedef {import('./handoff-manager.js').HandoffRequest} HandoffRequest
 *
 * @typedef {import('./handoff-manager.js').HandoffResult} HandoffResult
 */
