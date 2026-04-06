// @ts-check
/**
 * Barrel de exportação do módulo `src/copilot/agent/`.
 *
 * Centraliza os pontos de acesso públicos do agente, evitando importações com caminhos profundos em outros módulos do
 * sistema.
 *
 * @module copilot/agent
 */

export {} from './types.js'; // re-exporta os typedefs: IAlwaysAliveAgent, AgentStatus, etc.
export { AlwaysAliveAgent, alwaysAliveAgent, getAgent } from './always-alive.js';
export { DialogLoopManager } from './dialog-loop-manager.js';
export { wireDialogLoopEvents } from './dialog-loop-wirer.js';
export { DialogProtocol } from './dialog-protocol.js';
export {
    buildTurnResolutionListeners,
    dispatchTurnToHost,
    emitTurnStart,
    executeTurnImpl,
    waitForRestartAndReply,
} from './dialog-turn-executor.js';
export { DialogWatchdog } from './dialog-watchdog.js';
export { AGENT_EVENTS } from './events.js';
export { MessageQueue } from './message-queue.js';
export { PermissionController } from './permission-controller.js';
export { tryReconnect } from './reconnect-policy.js';
export { wireSessionEvents } from './session-event-wirer.js';
export {
    buildHookSystemContext,
    buildHookSystemContextSafe,
    initOrResumeSession,
    setBackgroundCompactionThreshold,
} from './session-initializer.js';
export { clearState, readState, writeState, writeStateAsync } from './state-io.js';
export { buildStatusSnapshot } from './status-snapshot.js';
export { executeTask } from './task-executor.js';
export { buildAuditingPermissionHandler, isHighRiskTool, logToolAudit } from './tool-audit-logger.js';
export { bootstrapTools, configureHookTools, setHub, setPermissionAgent, setSessionRpc } from './tools-bootstrap.js';
export { WebhookManager } from './webhook-manager.js';
