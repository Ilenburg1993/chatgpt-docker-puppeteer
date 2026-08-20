// @ts-check
/**
 * Barrel público do submódulo `dialog` do terminal.
 *
 * @module copilot/terminal/dialog
 */

export { presentByokTurnFailure } from './byok-turn-error-presentation.js';
export { ensureDialogLoop, getTurnQueueDepth, sendTurn } from './dialog-runtime.js';
export {
    buildTerminalEmptyOutputDiagnosis,
    classifyTerminalEmptyOutput,
    hasTerminalPendingHumanInputOutcome,
} from './empty-output-diagnosis.js';
export { drainPendingNotifications, getPersistenceFailureCount } from './engine-persistence.js';
export {
    BOOT_PROMPT,
    PROMPT_USER,
    PROMPT_WAITING,
    SEPARATOR,
    TURN_TIMEOUT_MS,
    beginTerminalRenderLock,
    buildUserPrompt,
    buildWaitingPrompt,
    cancelScheduledTerminalPromptRedraw,
    clearInlineStatus,
    clearReservedInlineStatus,
    deferTerminalIdlePromptRedraw,
    endTerminalRenderLock,
    isTerminalRenderLocked,
    parkTerminalPromptForContinuation,
    printExchange,
    println,
    printlnBlock,
    readTerminalExclusiveTtyReadiness,
    resetStatusRowState,
    scheduleTerminalPromptRedraw,
    suppressInlineStatusForSubmit,
    withTerminalExclusiveTty,
    writeInlineStatus,
} from './output.js';
export { CRITICAL_EVENTS, broadcastSse, nextSseEventId } from './sse.js';
export {
    createDeltaCallback,
    createDisplayState,
    renderStreamingFooter,
    sanitizeTerminalRenderText,
} from './turn-display.js';
