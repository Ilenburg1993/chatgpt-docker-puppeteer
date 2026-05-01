// @ts-check
/**
 * @file Shim de compatibilidade — llm-b-runtime.
 *
 *   Todas as implementações foram migradas para `gateways/`.
 *   Este arquivo existe apenas para não quebrar importadores legados.
 *   Prefira importar diretamente de `./gateways/<gateway>.js`.
 *
 * @deprecated Use `./gateways/<gateway>.js` diretamente.
 */

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

export {
    clearTerminalHistoryFeed,
    readTerminalHistoryFeed,
    readTerminalTurnCount,
    runTerminalDialogTurn,
    seedTerminalHistoryFeed,
    startTerminalDialogMode,
    stopTerminalDialogMode,
} from './gateways/dialog.js';

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
} from './gateways/hub.js';
