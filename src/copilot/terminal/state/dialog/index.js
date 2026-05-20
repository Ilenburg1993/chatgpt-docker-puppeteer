// @ts-check

export { markTerminalActivityIdle, readTerminalActivitySnapshot, recordTerminalActivity } from '../activity-state.js';
export { readTerminalPromptDisplayPolicy } from '../display-policy.js';
export { readLatestTerminalIntent } from '../intent-state.js';
export { recordTerminalStreamDeltaDiagnostic } from '../stream-diagnostics-state.js';
export { formatTerminalThinkingRef } from '../thinking-labels.js';
export { readTerminalTurnCorrelation } from '../turn-correlation-state.js';
export { readTerminalTurnMaterialization } from '../turn-materialization-state.js';
export { getTerminalDetailLevel } from '../ui-preferences.js';
export { terminalThemeText } from '../ui-theme.js';
