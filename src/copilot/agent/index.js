// @ts-check
/**
 * Barrel de exportação do módulo `src/copilot/agent/`.
 *
 * Centraliza os pontos de acesso públicos do agente, evitando importações com caminhos profundos em outros módulos do
 * sistema.
 *
 * @module copilot/agent
 */

export { AlwaysAliveAgent, alwaysAliveAgent, getAgent } from './always-alive.js';
export {
    DialogLoopManager,
    DialogProtocol,
    DialogWatchdog,
    WATCHDOG_THRESHOLDS,
    buildTurnResolutionListeners,
    dispatchTurnToHost,
    emitTurnStart,
    executeTurnImpl,
    waitForRestartAndReply,
    wireDialogLoopEvents,
} from './dialog/index.js';
export { AGENT_EVENTS } from './events.js';
export { MessageQueue } from './infra/message-queue.js';
export { PermissionController } from './infra/permission-controller.js';
export { buildStatusSnapshot } from './infra/status-snapshot.js';
export { executeTask } from './infra/task-executor.js';
export { buildAuditingPermissionHandler, isHighRiskTool, logToolAudit } from './infra/tool-audit-logger.js';
export {
    bootstrapTools,
    configureHookTools,
    setHub,
    setPermissionAgent,
    setSessionRpc,
} from './infra/tools-bootstrap.js';
export { WebhookManager } from './infra/webhook-manager.js';
export { tryReconnect } from './lifecycle/reconnect-policy.js';
export { clearState, readState, writeState, writeStateAsync } from './lifecycle/state-io.js';
export {
    SessionKeepalive,
    buildHookSystemContext,
    buildHookSystemContextSafe,
    cleanupStaleSessions,
    createSnapshot,
    initOrResumeSession,
    listSnapshots,
    loadLatestSnapshot,
    loadSnapshot,
    saveSnapshot,
    setBackgroundCompactionThreshold,
    shouldRotateSession,
    wireSessionEvents,
} from './session/index.js';
export {} from './types.js'; // re-exporta os typedefs: IAlwaysAliveAgent, AgentStatus, etc.
