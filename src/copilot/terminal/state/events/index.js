// @ts-check

export {
    clearTerminalBufferedAssistantMessages,
    readTerminalBufferedAssistantMessages,
    recordTerminalBufferedAssistantMessage,
    takeLatestTerminalBufferedAssistantMessage,
} from '../assistant-message-buffer-state.js';
export { markTerminalActivityIdle, recordTerminalActivity, terminalActivityEmitter } from '../activity-state.js';
export {
    beginTerminalTurnMaterialization,
    clearTerminalTurnMaterialization,
    completeTerminalTurnMaterialization,
    getTerminalAssistantMessageMaterializationDecision,
    readTerminalTurnAssistantMessages,
    readTerminalTurnMaterialization,
    recordTerminalTurnAssistantMessage,
    recordTerminalTurnDelta,
    shouldSuppressTerminalAssistantMessageAsMaterializedTurn,
    shouldSuppressTerminalTaskDeltaAsMaterializedDialog,
    takeLatestTerminalTurnAssistantMessage,
} from '../turn-materialization-state.js';
export {
    appendTerminalIntent,
    clearTerminalIntentHistory,
    normalizeTerminalIntentRisk,
    readLatestTerminalIntent,
    readTerminalIntentHistory,
    readTerminalIntentStats,
} from '../intent-state.js';
export { createTerminalPendingQuestionReplayState } from '../pending-question-replay.js';
export {
    recordTerminalElicitationCompleted,
    recordTerminalElicitationPending,
    recordTerminalPermissionCompleted,
    recordTerminalPermissionModeChanged,
    recordTerminalPermissionRequested,
    recordTerminalUserInputAnswerEchoGuard,
    recordTerminalUserInputCompleted,
    recordTerminalUserInputRequested,
    shouldSuppressTerminalAssistantMessageAsUserInputEcho,
} from '../sdk-interactions.js';
export { recordTerminalPromptHookSubmitted } from '../sdk-hook-events.js';
export { buildTerminalTaskThinkingId, formatTerminalThinkingRef } from '../thinking-labels.js';
export { formatTerminalTimeLabel } from '../time-format.js';
export { createToolCallRegistry } from '../tool-call-registry.js';
export { recordTerminalToolLifecycleDiagnostic } from '../tool-lifecycle-state.js';
export {
    appendTerminalTranscriptTurn,
    clearTerminalTranscriptTurns,
    readTerminalTranscriptStats,
    readTerminalTranscriptTurns,
} from '../transcript-state.js';
export {
    recordTerminalFinalReconciliationDiagnostic,
    recordTerminalStreamDeltaDiagnostic,
} from '../stream-diagnostics-state.js';
export {
    flushTerminalSseEventArchive,
    readTerminalSseEventArchiveState,
    readTerminalSseEventArchiveTail,
    recordTerminalSseEventArchive,
} from '../sse-event-archive.js';
export {
    beginTerminalTurnTrace,
    completeTerminalTurnToolCall,
    completeTerminalTurnTrace,
    recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity,
    recordTerminalTurnUserInputActivity,
    reviseRecentTerminalTurnTraceStatus,
} from '../turn-trace-state.js';
export { readTerminalTurnCorrelation, withTerminalTurnCorrelation } from '../turn-correlation-state.js';
export { getTerminalDetailLevel } from '../ui-preferences.js';
export {
    terminalActionChip,
    terminalThemeBadge,
    terminalThemeDivider,
    terminalThemeDuration,
    terminalThemeHeadline,
    terminalThemeJoin,
    terminalThemeRow,
    terminalThemeStatus,
    terminalThemeText,
} from '../ui-theme.js';
