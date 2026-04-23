// @ts-check
/**
 * @module copilot/agent/facades
 * @file Barrel canônico das façades públicas do runtime do agent.
 *
 *   `agent/index.js` continua sendo o ponto compatível amplo, mas a lista de façades modernas passa por este arquivo para
 *   facilitar governança de exports e futuras migrações para runtime façade/queries.
 */

export { sendAgentDialogTurn, startAgentDialogLoop, stopAgentDialogLoopAuthorized } from './agent-dialog-runtime.js';
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
    readRuntimeControlState,
    readRuntimeInteractionState,
    readRuntimePrBudgetSnapshot,
    resumeRuntimeDialogLoop,
    saveRuntimeSnapshot,
    setRuntimeBackgroundCompactionThreshold,
    startRuntime,
} from './agent-runtime-controls.js';
export { clearRuntimeSdkSessionOwnership, syncRuntimeSdkSessionOwnership } from './agent-runtime-ownership.js';
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
    deleteSdkPlan,
    deselectSdkAgent,
    getCurrentSdkAgent,
    getForegroundSdkSessionId,
    getLastSdkSessionId,
    getSdkAuthStatus,
    getSdkHandles,
    getSdkResourceSnapshot,
    getSdkSessionMode,
    getSdkStatus,
    listSdkAgents,
    listSdkSessions,
    pingSdk,
    readSdkPlan,
    reloadSdkAgents,
    selectSdkAgent,
    setForegroundSdkSessionId,
    setSdkSessionMode,
    updateSdkPlan,
} from './agent-sdk-access.js';
export {
    deleteAgentSdkPlan,
    readAgentSdkPlan,
    readAgentSdkSessionMode,
    setAgentSdkSessionMode,
    updateAgentSdkPlan,
} from './agent-sdk-session.js';
export { abortCurrentMessage, getSessionMessages, pingDialogWatchdog, sessionLog } from './agent-session-ops.js';
export { listWebhooks, registerWebhook, unregisterWebhook } from './agent-webhook-ops.js';
