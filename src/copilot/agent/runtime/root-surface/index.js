// @ts-check
/**
 * src/copilot/agent/runtime/root-surface/index.js
 *
 * Barrel interno da fachada viva `AlwaysAliveAgent`.
 *
 * Este arquivo é deliberadamente um barrel puro: ele nomeia as capacidades internas que a classe `AlwaysAliveAgent`
 * precisa para delegar lifecycle, dialog, messaging, SDK, state e governance sem importar subsistemas profundos
 * diretamente da raiz.
 *
 * @module copilot/agent/runtime/root-surface
 */

export {
    ensureDialogLoopAttached as dialogEnsureAttached,
    dialogRecoverInputChannel,
    dialogResume,
    dialogStart,
    dialogStop,
} from '../../dialog/controllers/agent-dialog-controller.js';
export { getAgentHealthSnapshot as healthSnapshot } from '../../health-check.js';
export { agentStart, agentStop, agentTryReconnect } from '../../lifecycle/orchestrators/agent-lifecycle.js';
export {
    answerPendingQuestion as msgAnswer,
    processQueue as msgProcessQueue,
    sendMessage as msgSend,
    sendMessageDialogBoot as msgSendBoot,
    steerMessage as msgSteer,
} from '../../messaging/agent-messaging.js';
export { METRICS_STORE } from '../../ports/index.js';
export {
    listenerDiagnostics as stateDiagnostics,
    getStatusSnapshot as stateSnapshot,
} from '../../state/agent-state.js';

export {
    dispatchAgentDialogTurn,
    dispatchAgentDialogTurnDetailed,
    isAgentDialogLoopPaused,
    pauseAgentDialogLoop,
    readAgentDialogLastPrInfo,
    readAgentDialogPrMetrics,
} from '../../facades/agent-dialog-runtime.js';
export {
    getModel,
    getReasoningEffort,
    listAvailableModels,
    setModel,
    setReasoningEffort,
} from '../../facades/agent-model-config.js';
export {
    getRuntimeHandoffManager,
    readRuntimeContextFactoryCapabilities,
    readRuntimeControlState,
    readRuntimeInteractionState,
    readRuntimePermissionCapability,
    readRuntimePermissionMode,
    readRuntimePermissionPolicySnapshot,
    readRuntimeToolRegistry,
    readRuntimeToolRegistryEntries,
    readRuntimeToolSessionContext,
    setRuntimePermissionMode,
} from '../../facades/agent-runtime-controls.js';
export {
    clearAgentRuntimePendingQuestionShadow,
    readAgentRuntimeSessionId,
} from '../../facades/agent-runtime-state.js';
export {
    deleteSdkPlan,
    getSdkSessionMode,
    readSdkPlan,
    setSdkSessionMode,
    updateSdkPlan,
} from '../../facades/agent-sdk-session.js';
export {
    abortCurrentMessage,
    getSessionMessages,
    pingDialogWatchdog,
    sessionLog,
} from '../../facades/agent-session-ops.js';
export { listWebhooks, registerWebhook, unregisterWebhook } from '../../facades/agent-webhook-ops.js';
export {
    compactSdkSession,
    confirmSdkSessionUi,
    createSdkWorkspaceFile,
    deleteSdkSession,
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
    getSdkUsageMetrics,
    handleSdkPendingCommand,
    handleSdkPendingPermission,
    handleSdkPendingToolCall,
    inputSdkSessionUi,
    isSdkSessionUiElicitationAvailable,
    killSdkShell,
    listPendingSdkElicitations,
    listPendingSdkPermissions,
    listSdkAgents,
    listSdkBuiltInTools,
    listSdkModels,
    listSdkSessions,
    listSdkSkills,
    listSdkWorkspaceFiles,
    loginSdkMcpOauth,
    pingSdk,
    readSdkSkillsGovernance,
    readSdkWorkspaceFile,
    reloadSdkAgents,
    requestSdkElicitation,
    resetSdkSessionApprovals,
    resolvePendingSdkElicitation,
    selectSdkAgent,
    selectSdkSessionUi,
    setForegroundSdkSessionId,
    setSdkDisabledSkills,
} from '../../facades/index.js';
