// @ts-check
/**
 * src/copilot/agent/infra/index.js — sub-barrel do subsistema Infra (queue, tools, webhooks, snapshots).
 *
 * @module copilot/agent/infra
 * @see EventBus
 */

export { buildAuditingPermissionHandler, isHighRiskTool, logToolAudit } from '#copilot/audit';
export { checkResolvedIp, isPrivateIp, validateWebhookUrl } from '#copilot/core';
export { PermissionController } from '../../hooks/permission-controller.js';
export { WebhookManager } from '../../infra/webhooks.js';
export { buildStatusSnapshot } from '../../observability/snapshots.js';
export {
    bootstrapTools,
    configureHookTools,
    setExperimentalSession,
    setHub,
    setPermissionAgent,
    setSessionRpc,
} from '../../tools/bootstrap.js';
export { HandoffManager } from './handoff-manager.js';
export { MessageQueue } from './message-queue.js';
export { executeTask } from './task-executor.js';
