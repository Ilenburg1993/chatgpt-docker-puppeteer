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
    clearTerminalHistory,
    forgetTerminalMemoryProjection,
    listTerminalSnapshotsProjection,
    loadTerminalSnapshotProjection,
    readTerminalActivityProjection,
    readTerminalContextProjection,
    readTerminalCountProjection,
    readTerminalDbHistoryProjection,
    readTerminalDbSessionsProjection,
    readTerminalDiagnoseProjection,
    readTerminalDisplayProjection,
    readTerminalHistoryProjection,
    readTerminalResumeListProjection,
    readTerminalResumeProjection,
    recallTerminalMemoriesProjection,
    rememberTerminalMemoryProjection,
    requestTerminalCompactionProjection,
    saveTerminalSnapshotProjection,
    searchTerminalTurnsProjection,
} from './projections/now.js';

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
    clearTerminalHistoryFeed,
    createTerminalHubSession,
    createTerminalSnapshot,
    deleteTerminalHubMemory,
    deleteTerminalSdkPlan,
    getTerminalSdkSessionMode,
    initTerminalConversationHub,
    isTerminalHubReady,
    listTerminalSnapshots,
    loadTerminalSnapshot,
    notifyTerminalHubTurn,
    pauseTerminalDialogLoop,
    pingTerminalDialogWatchdog,
    readTerminalDialogStreamMeta,
    readTerminalHandoffHistory,
    readTerminalHistoryFeed,
    readTerminalHubMemories,
    readTerminalHubOrchestrator,
    readTerminalHubSession,
    readTerminalHubSessions,
    readTerminalHubStore,
    readTerminalHubTurn,
    readTerminalHubTurns,
    readTerminalRuntimeState,
    readTerminalSdkPlan,
    readTerminalSessionBinding,
    readTerminalTurnCount,
    resumeTerminalDialogLoop,
    runTerminalDialogTurn,
    saveTerminalSnapshot,
    searchTerminalHubTurns,
    seedTerminalHistoryFeed,
    setTerminalSdkSessionMode,
    startTerminalDialogMode,
    stopTerminalAgentRuntime,
    stopTerminalDialogMode,
    storeTerminalHubMemory,
    updateTerminalSdkPlan,
    writeTerminalHubSystemTurn,
} from './llm-b-runtime.js';
