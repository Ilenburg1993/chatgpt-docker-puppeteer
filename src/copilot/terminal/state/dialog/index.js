// @ts-check

export { markTerminalActivityIdle, readTerminalActivitySnapshot, recordTerminalActivity } from '../activity-state.js';
export { readTerminalPromptDisplayPolicy } from '../display-policy.js';
export { readLatestTerminalIntent } from '../intent-state.js';
export {
    renderTerminalPendingQuestionKindLabel,
    renderTerminalPendingQuestionPromptTag,
} from '../pending-question-labels.js';
export { recordTerminalStreamDeltaDiagnostic } from '../stream-diagnostics-state.js';
export { formatTerminalThinkingRef } from '../thinking-labels.js';
export { readTerminalTurnCorrelation, withTerminalTurnCorrelation } from '../turn-correlation-state.js';
export { readTerminalTurnMaterialization } from '../turn-materialization-state.js';
export {
    formatTerminalIsoTimestamp,
    formatTerminalIsoTimestampSeconds,
    formatTerminalTimeLabel,
    formatTerminalTimeParts,
    formatTerminalTimestamp,
} from '../time-format.js';
export { getTerminalDetailLevel } from '../ui-preferences.js';
export {
    terminalThemeDivider,
    terminalThemeDuration,
    terminalThemeHeadline,
    terminalThemeJoin,
    terminalThemeRow,
    terminalThemeText,
} from '../ui-theme.js';
