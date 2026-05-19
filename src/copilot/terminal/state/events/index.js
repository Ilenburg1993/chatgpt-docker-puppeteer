// @ts-check

export {
    clearTerminalBufferedAssistantMessages,
    readTerminalBufferedAssistantMessages,
    recordTerminalBufferedAssistantMessage,
    takeLatestTerminalBufferedAssistantMessage,
} from '../assistant-message-buffer-state.js';
export { markTerminalActivityIdle, recordTerminalActivity, terminalActivityEmitter } from '../activity-state.js';
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
    recordTerminalUserInputCompleted,
    recordTerminalUserInputRequested,
} from '../sdk-interactions.js';
export { recordTerminalPromptHookSubmitted } from '../sdk-hook-events.js';
export { buildTerminalTaskThinkingId, formatTerminalThinkingRef } from '../thinking-labels.js';
export { createToolCallRegistry } from '../tool-call-registry.js';
export {
    appendTerminalTranscriptTurn,
    clearTerminalTranscriptTurns,
    readTerminalTranscriptStats,
    readTerminalTranscriptTurns,
} from '../transcript-state.js';
export {
    beginTerminalTurnTrace,
    completeTerminalTurnToolCall,
    completeTerminalTurnTrace,
    recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity,
    recordTerminalTurnUserInputActivity,
} from '../turn-trace-state.js';
export { getTerminalDetailLevel } from '../ui-preferences.js';
export { terminalActionChip, terminalThemeBadge, terminalThemeText } from '../ui-theme.js';
