// @ts-check

/** @typedef {import('./activity-state.js').TerminalActivitySnapshot} TerminalActivitySnapshot */

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
    readTerminalPromptDisplayPolicy,
    resolveTerminalBootDisplayPreset,
    resolveTerminalDisplayPresetName,
    writeTerminalDisplayState,
    writeTerminalDisplayToggle,
} from './display-policy.js';
export { tryAnswerTerminalPendingQuestionInput } from './pending-question-answer.js';
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
    recordTerminalElicitationCompleted,
    recordTerminalElicitationPending,
    recordTerminalPermissionCompleted,
    recordTerminalPermissionModeChanged,
    recordTerminalPermissionRequested,
    recordTerminalUserInputCompleted,
    recordTerminalUserInputRequested,
} from './sdk-interactions.js';
export { createToolCallRegistry } from './tool-call-registry.js';
export {
    beginTerminalTurnTrace,
    clearTerminalTurnTraceState,
    completeTerminalTurnToolCall,
    completeTerminalTurnTrace,
    readTerminalTurnTraceProjection,
    recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity,
} from './turn-trace-state.js';
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
    terminalThemeText,
} from './ui-theme.js';
