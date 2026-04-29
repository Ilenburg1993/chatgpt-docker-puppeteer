// @ts-check
/**
 * @module copilot/agent/facades
 * @file Barrel canônico das façades públicas do runtime do agent.
 *
 *   `agent/index.js` continua sendo o ponto compatível amplo, mas a lista de façades modernas passa por este arquivo para
 *   facilitar governança de exports e futuras migrações para runtime façade/queries.
 */

export {
    dispatchAgentDialogTurn,
    isAgentDialogLoopPaused,
    pauseAgentDialogLoop,
    readAgentDialogLastPrInfo,
    readAgentDialogPrMetrics,
    recoverAgentDialogInputChannel,
    sendAgentDialogTurn,
    startAgentDialogLoop,
    stopAgentDialogLoopAuthorized,
} from './agent-dialog-runtime.js';
export {
    getModel,
    getReasoningEffort,
    listAvailableModels,
    listSdkCatalogModels,
    readRuntimeModelSelection,
    readSdkModelMetadata,
    readSdkModelStats,
    setModel,
    setReasoningEffort,
    setRuntimeModel,
    setRuntimeReasoningEffort,
} from './agent-model-config.js';
export { readAgentRuntimeCapabilities } from './agent-runtime-capabilities.js';
export {
    abortRuntimeCurrentMessage,
    answerRuntimePendingQuestion,
    clearRuntimePendingQuestionShadow,
    createRuntimeSnapshot,
    getRuntimeHandoffHistory,
    getRuntimeHandoffManager,
    listRuntimeSnapshots,
    loadRuntimeSnapshot,
    offRuntimeEvent,
    onRuntimeEvent,
    onceRuntimeEvent,
    pauseRuntimeDialogLoop,
    readRuntimeContextFactoryCapabilities,
    readRuntimeControlState,
    readRuntimeGovernanceState,
    readRuntimeInteractionState,
    readRuntimePermissionCapability,
    readRuntimePermissionMode,
    readRuntimePrBudgetSnapshot,
    readRuntimeToolRegistry,
    readRuntimeToolRegistryEntries,
    resumeRuntimeDialogLoop,
    saveRuntimeSnapshot,
    setRuntimeBackgroundCompactionThreshold,
    setRuntimePermissionMode,
    startRuntime,
} from './agent-runtime-controls.js';
export { readAgentRuntimeEventBridgeSources, wireAgentRuntimeEventBusBridge } from './agent-runtime-event-bridge.js';
export { clearRuntimeSdkSessionOwnership, syncRuntimeSdkSessionOwnership } from './agent-runtime-ownership.js';
export {
    clearAgentRuntimePendingQuestionShadow,
    markAgentRuntimeDialogPausedForRecovery,
    persistAgentRuntimeGracefulShutdownState,
    persistAgentRuntimePendingQuestionState,
    persistAgentRuntimePrConsumptionSnapshot,
    readAgentRuntimeSessionId,
    resetAgentRuntimeGracefulShutdownFlag,
    restoreAgentRuntimePersistentBootState,
    saveAgentRuntimeShutdownSnapshot,
    shouldReapAgentRuntimePendingQuestionShadow,
    shouldScheduleAgentRuntimeDialogBootRecovery,
} from './agent-runtime-state.js';
export {
    readAgentRuntimeHealthSnapshot,
    readAgentRuntimeSdkResourceSnapshot,
    readAgentRuntimeStatusSnapshot,
    readAgentRuntimeStatusValue,
} from './agent-runtime-status.js';
export { readAgentRuntimeTodoSummaries } from './agent-runtime-todos.js';
export { readAgentRuntimeToolEntries, readAgentRuntimeTools } from './agent-runtime-tools.js';
export {
    listAgentRuntimeWebhooks,
    registerAgentRuntimeWebhook,
    unregisterAgentRuntimeWebhook,
} from './agent-runtime-webhooks.js';
export {
    attachAgentSdkBootLifecycleBridge,
    checkAgentSdkAuthStatus,
    compactSdkSession,
    confirmSdkSessionUi,
    createAgentSdkClient,
    createAgentSdkToolsRegistry,
    createSdkWorkspaceFile,
    deselectSdkAgent,
    disconnectAgentSdkSession,
    ensureAgentSdkClientStarted,
    execSdkShell,
    getAgentSdkToolsConfig,
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
    pingAgentSdkClient,
    pingSdk,
    raceAgentSdkEvents,
    readAgentSdkModelRegistryEntry,
    readSdkWorkspaceFile,
    reloadSdkAgents,
    requestSdkElicitation,
    resolvePendingSdkElicitation,
    selectSdkAgent,
    selectSdkSessionUi,
    setForegroundSdkSessionId,
    startAgentSdkBootQuotaBridge,
    stopAgentSdkClient,
} from './agent-sdk-access.js';
export {
    canReadAgentSdkSessionMessages,
    onAgentSdkSessionEvent,
    onAllAgentSdkSessionEvents,
    readAgentSdkSessionMessages,
    sendAgentSdkSession,
    sendAgentSdkSessionAndWait,
    waitForAgentSdkEvent,
} from './agent-sdk-runtime.js';
export {
    deleteAgentSdkPlan,
    deleteSdkPlan,
    getSdkSessionMode,
    readAgentSdkPlan,
    readAgentSdkSessionMode,
    readSdkPlan,
    setAgentSdkSessionMode,
    setSdkSessionMode,
    updateAgentSdkPlan,
    updateSdkPlan,
} from './agent-sdk-session.js';
export { abortCurrentMessage, getSessionMessages, pingDialogWatchdog, sessionLog } from './agent-session-ops.js';
export { listWebhooks, registerWebhook, unregisterWebhook } from './agent-webhook-ops.js';
