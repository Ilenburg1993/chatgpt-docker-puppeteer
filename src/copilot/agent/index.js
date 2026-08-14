// @ts-check
/**
 * src/copilot/agent/index.js — [L4] Core agent: AlwaysAlive, session, dialog.
 *
 * Barrel de exportação do módulo `src/copilot/agent/`. Centraliza os pontos de acesso públicos do agente.
 *
 * ### API pública (para uso externo)
 *
 * | Export             | Tipo      | Descrição                                  |
 * | ------------------ | --------- | ------------------------------------------ |
 * | `alwaysAliveAgent` | Singleton | Instância principal do agente AlwaysAlive  |
 * | `getAgent()`       | Function  | Accessor para o agente (lazy)              |
 * | `resetAgent()`     | Function  | Reinicia a instância lazy (testes/runtime) |
 * | `AlwaysAliveAgent` | Class     | Classe do agente (uso interno/testes)      |
 *
 * ### Subsistemas re-exportados
 *
 * - `dialog/` — DialogLoopManager, turn execution, backpressure, watchdog
 * - `infra/` — tools bootstrap, webhook, permission, task executor, handoff
 * - `lifecycle/` — bootstrap, connection, reconnect, state persistence
 * - `messaging/` — agent messaging facade
 * - `session/` — session initializer, event wiring, keepalive, rotation, cleanup
 * - `state/` — agent state management
 *
 * @module copilot/agent
 * @see EventBus
 */

// ── Raiz ─────────────────────────────────────────────────────
export {
    AGENT_EVENTS,
    DIALOG_LOOP_EVENTS,
    HIGH_FREQUENCY_EVENTS,
    PR_CONSUMING_EVENTS,
} from '../events/agent-events.js';
export { alwaysAliveAgent, getAgent, resetAgent } from './always-alive-singleton.js';
export { AlwaysAliveAgent } from './runtime/always-alive/index.js';
export { classifyAgentError } from './error-policy.js';
export {
    DEFAULT_AGENT_RUNTIME_ID,
    clearAgentRuntimeRegistry,
    getAgentRuntimeProfileId,
    getDefaultAgentRuntimeId,
    getDefaultRegisteredAgentRuntime,
    getRegisteredAgentRuntime,
    hasAgentRuntime,
    listAgentRuntimes,
    registerAgentRuntime,
    setDefaultAgentRuntimeId,
    unregisterAgentRuntime,
} from './runtime/registry/index.js';
export {} from './types.js'; // re-exporta os typedefs: IAlwaysAliveAgent, AgentStatus, etc.

// ── Subsistemas ──────────────────────────────────────────────
export { AgentContext } from './context/index.js';
export {
    DIALOG_MODULE_LAYOUT,
    DialogCompactionPolicy,
    DialogLoopManager,
    DialogLoopStateMachine,
    DialogProtocol,
    DialogWatchdog,
    DialogWatchdogSupervisor,
    WATCHDOG_THRESHOLDS,
    buildTurnResolutionListeners,
    dispatchTurnToHost,
    emitTurnStart,
    executeTurnImpl,
    getDialogModuleDescriptor,
    getDialogModuleRole,
    handleUserInputRequest,
    listDialogModulesByRole,
    selectDialogResumeStrategy,
    waitForRestartAndReply,
    wireDialogLoopEvents,
} from './dialog/index.js';
export {
    abortRuntimeCurrentMessage,
    answerRuntimePendingQuestion,
    clearRuntimePendingQuestionShadow,
    clearRuntimeSdkSessionOwnership,
    confirmSdkSessionUi,
    createAgentSdkClient,
    createRuntimeSnapshot,
    deleteAgentSdkPlan,
    ensureAgentSdkClientStarted,
    getPendingSdkElicitation,
    getRuntimeHandoffHistory,
    getRuntimeHandoffManager,
    getSdkSessionCapabilities,
    inputSdkSessionUi,
    isSdkSessionUiElicitationAvailable,
    listAgentRuntimeWebhooks,
    listPendingSdkElicitations,
    listRuntimeSnapshots,
    listSdkCatalogModels,
    loadRuntimeSnapshot,
    offRuntimeEvent,
    onRuntimeEvent,
    onceRuntimeEvent,
    pauseRuntimeDialogLoop,
    persistAgentRuntimePendingQuestionState,
    readAgentHealthInputSnapshot,
    readAgentRuntimeCapabilities,
    readAgentRuntimeHealthSnapshot,
    readAgentRuntimeSdkResourceSnapshot,
    readAgentRuntimeStatusSnapshot,
    readAgentRuntimeStatusValue,
    readAgentRuntimeTodoSummaries,
    readAgentRuntimeToolEntries,
    readAgentRuntimeTools,
    readAgentSdkPlan,
    readAgentSdkSessionMode,
    readRuntimeAutoModelPolicy,
    readRuntimeControlState,
    readRuntimeGovernanceState,
    readRuntimeInteractionState,
    readRuntimeModelSelection,
    readRuntimePermissionMode,
    readRuntimePrBudgetSnapshot,
    readRuntimeUsageBudgetSnapshot,
    readSdkModelMetadata,
    readSdkModelStats,
    recoverAgentDialogInputChannel,
    registerAgentRuntimeWebhook,
    resolvePendingSdkElicitation,
    resumeRuntimeDialogLoop,
    saveRuntimeSnapshot,
    selectSdkSessionUi,
    sendAgentDialogTurn,
    sendAgentSdkSession,
    setAgentSdkSessionMode,
    setRuntimeBackgroundCompactionThreshold,
    setRuntimeModel,
    setRuntimeReasoningEffort,
    startAgentDialogLoop,
    startRuntime,
    steerRuntimeMessage,
    stopAgentDialogLoopAuthorized,
    syncRuntimeSdkSessionOwnership,
    unregisterAgentRuntimeWebhook,
    updateAgentSdkPlan,
} from './facades/index.js';
export { getAgentHealthSnapshot } from './health-check.js';
export {
    HandoffManager,
    MessageQueue,
    PermissionController,
    WebhookManager,
    bootstrapTools,
    buildAuditingPermissionHandler,
    buildStatusSnapshot,
    checkResolvedIp,
    configureHookTools,
    executeTask,
    isHighRiskTool,
    isPrivateIp,
    logToolAudit,
    setExperimentalSession,
    setHub,
    setPermissionAgent,
    setSessionRpc,
    validateWebhookUrl,
} from './infra/index.js';
export {
    LIFECYCLE_MODULE_LAYOUT,
    clearState,
    clearStateAsync,
    discoverRuntimePlugins,
    drainStateWrites,
    getLifecycleModuleDescriptor,
    getLifecycleModuleRole,
    listLifecycleModulesByRole,
    persistState,
    readState,
    readStateAsync,
    registerRuntimeAgentEventHost,
    registerRuntimeIpcHost,
    registerRuntimeProcessSignals,
    registerRuntimeShutdownHost,
    tryReconnect,
    writeState,
    writeStateAsync,
} from './lifecycle/index.js';
export {
    answerPendingQuestion,
    enqueueTask,
    executeTask as executeAgentMessagingTask,
    processQueue,
    sendMessage,
    sendMessageDialogBoot,
    steerMessage,
} from './messaging/index.js';
export {
    SESSION_MODULE_LAYOUT,
    SessionKeepalive,
    SessionMessagesCache,
    buildHookSystemContext,
    buildHookSystemContextSafe,
    cleanupStaleSessions,
    clearActiveSdkSessionOwnership,
    createSnapshot,
    getSessionModuleDescriptor,
    getSessionModuleRole,
    initOrResumeSession,
    listSessionModulesByRole,
    listSnapshotsAsync,
    loadSnapshotAsync,
    performBootWiring,
    saveSnapshotAsync,
    setBackgroundCompactionThreshold,
    shouldRotateSession,
    syncActiveSessionOwnership,
    syncSdkHistory,
    wireSessionEvents,
} from './session/index.js';
export { getStatusSnapshot, listenerDiagnostics } from './state/index.js';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
export { ALWAYS_ALIVE_AGENT } from './di-tokens.js';
