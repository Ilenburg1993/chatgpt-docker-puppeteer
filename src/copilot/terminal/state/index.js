// @ts-check

/** @typedef {import('./activity-state.js').TerminalActivitySnapshot} TerminalActivitySnapshot */
/** @typedef {import('./intent-state.js').TerminalIntentEntry} TerminalIntentEntry */
/** @typedef {import('./transcript-state.js').TerminalTranscriptTurn} TerminalTranscriptTurn */

export {
    clearTerminalActivityHistory,
    markTerminalActivityIdle,
    readTerminalActivityHistory,
    readTerminalActivitySnapshot,
    recordTerminalActivity,
    terminalActivityEmitter,
} from './activity-state.js';
export {
    TERMINAL_DISPLAY_PRESETS,
    TERMINAL_DISPLAY_TOGGLE_KEYS,
    applyTerminalBootDisplayPreset,
    applyTerminalDisplayPreset,
    isTerminalDisplayPresetName,
    isTerminalDisplayToggle,
    listTerminalDisplayPresets,
    listTerminalDisplayToggles,
    readTerminalDisplayPreset,
    readTerminalDisplayState,
    readTerminalInlineStatusPolicy,
    readTerminalPromptDisplayPolicy,
    resolveTerminalBootDisplayPreset,
    resolveTerminalDisplayPresetName,
    writeTerminalDisplayState,
    writeTerminalDisplayToggle,
} from './display-policy.js';
export { shouldConsumeTerminalPendingAnswerInput, tryAnswerTerminalPendingQuestionInput } from './pending-question-answer.js';
export {
    appendTerminalIntent,
    clearTerminalIntentHistory,
    normalizeTerminalIntentRisk,
    readLatestTerminalIntent,
    readTerminalIntentHistory,
    readTerminalIntentStats,
} from './intent-state.js';
export {
    buildTerminalPendingQuestionReplayKey,
    createTerminalPendingQuestionReplayState,
} from './pending-question-replay.js';
export { clearRateLimiters, registerClearRateLimiters, resetRateLimiterStateForTests } from './rate-limiter-state.js';
export {
    classifyTerminalSdkQuota,
    clearTerminalElicitation,
    clearTerminalPermission,
    clearTerminalPermissions,
    clearTerminalUserInputs,
    getTerminalElicitation,
    getTerminalPermission,
    listTerminalElicitations,
    listTerminalPermissionModeHistory,
    listTerminalPermissions,
    listTerminalUserInputs,
    pruneTerminalSdkInteractions,
    readTerminalElicitationSummary,
    readTerminalPermissionSummary,
    readTerminalUserInputSummary,
    recordTerminalUserInputAnswerEchoGuard,
    recordTerminalElicitationCompleted,
    recordTerminalElicitationPending,
    recordTerminalPermissionCompleted,
    recordTerminalPermissionModeChanged,
    recordTerminalPermissionRequested,
    recordTerminalUserInputCompleted,
    recordTerminalUserInputRequested,
    shouldSuppressTerminalAssistantMessageAsUserInputEcho,
    terminalPermissionModeSkipsSdkPrompts,
} from './sdk-interactions.js';
export {
    clearTerminalPromptHookEvents,
    listTerminalPromptHookEvents,
    readTerminalPromptHookSummary,
    recordTerminalPromptHookSubmitted,
} from './sdk-hook-events.js';
export { createToolCallRegistry } from './tool-call-registry.js';
export {
    clearTerminalToolLifecycleDiagnostics,
    readTerminalToolLifecycleProjection,
    recordTerminalToolLifecycleDiagnostic,
} from './tool-lifecycle-state.js';
export {
    TERMINAL_TIME_DISPLAY_MODES,
    formatTerminalElapsedDuration,
    formatTerminalIsoTimestamp,
    formatTerminalIsoTimestampSeconds,
    formatTerminalRelativeAge,
    formatTerminalTimeLabel,
    resolveTerminalTimeDisplayMode,
} from './time-format.js';
export { buildTerminalTaskThinkingId, formatTerminalThinkingRef } from './thinking-labels.js';
export {
    beginTerminalTurnTrace,
    clearTerminalTurnTraceState,
    completeTerminalTurnToolCall,
    completeTerminalTurnTrace,
    readTerminalTurnTraceProjection,
    recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity,
    recordTerminalTurnUserInputActivity,
} from './turn-trace-state.js';
export {
    appendTerminalTranscriptTurn,
    clearTerminalTranscriptTurns,
    readTerminalTranscriptStats,
    readTerminalTranscriptTurns,
} from './transcript-state.js';
export {
    clearTerminalStreamDiagnosticsForTests,
    readTerminalStreamDiagnosticsProjection,
    recordTerminalFinalReconciliationDiagnostic,
    recordTerminalStreamDeltaDiagnostic,
} from './stream-diagnostics-state.js';
export {
    flushTerminalSseEventArchive,
    readTerminalSseEventArchiveState,
    readTerminalSseEventArchiveTail,
    recordTerminalSseEventArchive,
    resetTerminalSseEventArchiveForTests,
} from './sse-event-archive.js';
export {
    TERMINAL_DETAIL_LEVELS,
    getTerminalDetailLevel,
    isTerminalDetailLevel,
    listTerminalDetailLevels,
    readTerminalUiPreferences,
    setTerminalDetailLevel,
} from './ui-preferences.js';
export {
    getTerminalThemeName,
    isTerminalThemeName,
    listTerminalThemeProfiles,
    setTerminalThemeName,
    terminalActionChip,
    terminalThemeBadge,
    terminalThemeDivider,
    terminalThemeDuration,
    terminalThemeHeadline,
    terminalThemeJoin,
    terminalThemeRow,
    terminalThemeStatus,
    terminalThemeText,
} from './ui-theme.js';
