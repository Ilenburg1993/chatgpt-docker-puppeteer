// @ts-check
/**
 * src/copilot/agent/infra/index.js — sub-barrel do subsistema Infra (queue, tools, webhooks, snapshots).
 *
 * @module copilot/agent/infra
 */

export { buildAuditingPermissionHandler, isHighRiskTool, logToolAudit } from '#copilot/audit';
export { HandoffManager } from './handoff-manager.js';
export { MessageQueue } from './message-queue.js';
export { PermissionController } from './permission-controller.js';
export { buildStatusSnapshot } from './status-snapshot.js';
export { executeTask } from './task-executor.js';
export { bootstrapTools, configureHookTools, setHub, setPermissionAgent, setSessionRpc } from './tools-bootstrap.js';
export { checkResolvedIp, isPrivateIp, validateWebhookUrl } from '#copilot/core';
export { WebhookManager } from './webhook-manager.js';
