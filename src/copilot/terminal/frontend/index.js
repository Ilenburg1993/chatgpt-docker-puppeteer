// @ts-check

export {
    formatTerminalRuntimeTopology,
    normalizeContextWindowProjection,
    normalizeTerminalModelBillingProjection,
    readTerminalRuntimeBase,
} from './projections/shared.js';

export { readTerminalStatusProjection } from './projections/status.js';

export {
    answerPendingTerminalQuestion,
    clearPendingTerminalQuestionShadow,
    forgetTerminalMemoryProjection,
    listTerminalSnapshotsProjection,
    loadTerminalSnapshotProjection,
    readTerminalActivityProjection,
    readTerminalCountProjection,
    readTerminalDbSessionsProjection,
    readTerminalDiagnoseProjection,
    readTerminalDisplayProjection,
    readTerminalResumeListProjection,
    readTerminalResumeProjection,
    recallTerminalMemoriesProjection,
    rememberTerminalMemoryProjection,
    saveTerminalSnapshotProjection,
    searchTerminalTurnsProjection,
} from './projections/now.js';

export {
    clearTerminalHistory,
    readTerminalContextProjection,
    readTerminalDbHistoryProjection,
    readTerminalHistoryProjection,
    readTerminalTimelineProjection,
    readTerminalTimelineSyncTelemetry,
    requestTerminalCompactionProjection,
} from './projections/timeline.js';

export {
    listTerminalAvailableModelsProjection,
    readTerminalConfigProjection,
    readTerminalModelStatsProjection,
    setTerminalModelProjection,
    setTerminalReasoningProjection,
} from './projections/config.js';

export {
    readTerminalErrorsProjection,
    readTerminalMetricsProjection,
    readTerminalToolStatsProjection,
} from './projections/metrics.js';

export { readTerminalUsageNowProjection } from './projections/usage.js';

export {
    deleteTerminalPlanProjection,
    readTerminalPlanProjection,
    setTerminalPlanModeProjection,
    updateTerminalPlanProjection,
} from './projections/sdk-session.js';

export {
    deleteTerminalSdkPlanProjection,
    readTerminalSdkSessionProjection,
    setTerminalSdkModeProjection,
    updateTerminalSdkPlanProjection,
} from './sdk-session-projection.js';

export {
    attachTerminalHubSocketIO,
    canSearchTerminalHubTurns,
    createTerminalHubSession,
    deleteTerminalHubMemory,
    initTerminalConversationHub,
    isTerminalHubReady,
    notifyTerminalHubTurn,
    readTerminalHubMemories,
    readTerminalHubOrchestrator,
    readTerminalHubSession,
    readTerminalHubSessions,
    readTerminalHubStore,
    readTerminalHubTurn,
    readTerminalHubTurns,
    searchTerminalHubTurns,
    storeTerminalHubMemory,
    writeTerminalHubSystemTurn,
    writeTerminalHubTimelineTurn,
} from './gateways/hub.js';

export { runTerminalDialogTurn, startTerminalDialogMode, stopTerminalDialogMode } from './gateways/dialog.js';

export {
    abortTerminalCurrentMessage,
    answerTerminalPendingQuestion,
    clearTerminalPendingQuestionShadow,
    createTerminalSnapshot,
    listTerminalSnapshots,
    loadTerminalSnapshot,
    offTerminalAgentRuntimeEvent,
    onTerminalAgentRuntimeEvent,
    onceTerminalAgentRuntimeEvent,
    pauseTerminalDialogLoop,
    pingTerminalDialogWatchdog,
    readTerminalAgentRuntimeEventHost,
    readTerminalDialogStreamMeta,
    readTerminalHandoffHistory,
    readTerminalRuntimeControlState,
    readTerminalRuntimeState,
    readTerminalSessionBinding,
    resumeTerminalDialogLoop,
    saveTerminalSnapshot,
    startTerminalAgentRuntime,
    stopTerminalAgentRuntime,
} from './gateways/agent-runtime.js';

export {
    compactTerminalSdkSession,
    confirmTerminalSdkSessionUi,
    createTerminalSdkWorkspaceFile,
    deleteTerminalSdkPlan,
    getTerminalSdkPendingElicitation,
    getTerminalSdkQuota,
    getTerminalSdkSessionCapabilities,
    getTerminalSdkSessionMode,
    inputTerminalSdkSessionUi,
    isTerminalSdkSessionUiElicitationAvailable,
    listTerminalSdkModels,
    listTerminalSdkPendingElicitations,
    listTerminalSdkTools,
    listTerminalSdkWorkspaceFiles,
    readTerminalSdkPlan,
    readTerminalSdkWorkspaceFile,
    requestTerminalSdkElicitation,
    resolveTerminalSdkPendingElicitation,
    selectTerminalSdkSessionUi,
    setTerminalSdkSessionMode,
    updateTerminalSdkPlan,
} from './gateways/sdk-session.js';
