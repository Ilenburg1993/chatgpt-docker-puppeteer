// @ts-check
/**
 * @module copilot/agent/agent-runtime-surface
 * @file Superficie interna usada pelo root `always-alive`.
 *
 *   O root do agent e a API publica compatível continuam em `always-alive.js`; este modulo concentra os adaptadores
 *   semanticos que esse root precisa para delegar lifecycle, dialog, messaging, status, SDK e registry sem importar
 *   cada subsistema diretamente.
 */

export {
    ensureDialogLoopAttached as dialogEnsureAttached,
    dialogRecoverInputChannel,
    dialogResume,
    dialogStart,
    dialogStop,
} from './dialog/controllers/agent-dialog-controller.js';
export { ensureAgentEventBusBridge, resetAgentEventBusBridgeWiring } from './event-bridge-wiring.js';
export { getAgentHealthSnapshot as healthSnapshot } from './health-check.js';
export { agentStart, agentStop, agentTryReconnect } from './lifecycle/agent-lifecycle.js';
export {
    answerPendingQuestion as msgAnswer,
    processQueue as msgProcessQueue,
    sendMessage as msgSend,
    sendMessageDialogBoot as msgSendBoot,
    steerMessage as msgSteer,
} from './messaging/agent-messaging.js';
export { METRICS_STORE } from './ports/metrics-port.js';
export { registerAgentRuntime, unregisterAgentRuntime } from './runtime-registry.js';
export { listenerDiagnostics as stateDiagnostics, getStatusSnapshot as stateSnapshot } from './state/agent-state.js';

export {
    dispatchAgentDialogTurn,
    isAgentDialogLoopPaused,
    pauseAgentDialogLoop,
    readAgentDialogLastPrInfo,
    readAgentDialogPrMetrics,
} from './facades/agent-dialog-runtime.js';
export {
    getModel,
    getReasoningEffort,
    listAvailableModels,
    setModel,
    setReasoningEffort,
} from './facades/agent-model-config.js';
export {
    getRuntimeHandoffManager,
    readRuntimeContextFactoryCapabilities,
    readRuntimeControlState,
    readRuntimeInteractionState,
    readRuntimePermissionCapability,
    readRuntimePermissionMode,
    readRuntimeToolRegistry,
    readRuntimeToolRegistryEntries,
    setRuntimePermissionMode,
} from './facades/agent-runtime-controls.js';
export { clearAgentRuntimePendingQuestionShadow, readAgentRuntimeSessionId } from './facades/agent-runtime-state.js';
export {
    compactSdkSession,
    confirmSdkSessionUi,
    createSdkWorkspaceFile,
    deselectSdkAgent,
    execSdkShell,
    getCurrentSdkAgent,
    getForegroundSdkSessionId,
    getLastSdkSessionId,
    getPendingSdkElicitation,
    getSdkAuthStatus,
    getSdkHandles,
    getSdkQuota,
    getSdkResourceSnapshot,
    getSdkSessionCapabilities,
    getSdkStatus,
    handleSdkPendingCommand,
    handleSdkPendingPermission,
    handleSdkPendingToolCall,
    inputSdkSessionUi,
    isSdkSessionUiElicitationAvailable,
    killSdkShell,
    listPendingSdkElicitations,
    listSdkAgents,
    listSdkBuiltInTools,
    listSdkModels,
    listSdkSessions,
    listSdkWorkspaceFiles,
    pingSdk,
    readSdkWorkspaceFile,
    reloadSdkAgents,
    requestSdkElicitation,
    resolvePendingSdkElicitation,
    selectSdkAgent,
    selectSdkSessionUi,
    setForegroundSdkSessionId,
} from './facades/agent-sdk-access.js';
export {
    deleteSdkPlan,
    getSdkSessionMode,
    readSdkPlan,
    setSdkSessionMode,
    updateSdkPlan,
} from './facades/agent-sdk-session.js';
export {
    abortCurrentMessage,
    getSessionMessages,
    pingDialogWatchdog,
    sessionLog,
} from './facades/agent-session-ops.js';
export { listWebhooks, registerWebhook, unregisterWebhook } from './facades/agent-webhook-ops.js';
