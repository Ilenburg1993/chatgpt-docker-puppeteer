// @ts-check
/**
 * Barrel público do submódulo `dialog` do terminal.
 *
 * @module copilot/terminal/dialog
 */

export { drainPendingNotifications, getPersistenceFailureCount } from './engine-persistence.js';
export { ensureDialogLoop, getTurnQueueDepth, sendTurn } from './dialog-runtime.js';
export {
    BOOT_PROMPT,
    beginTerminalRenderLock,
    buildUserPrompt,
    buildWaitingPrompt,
    clearInlineStatus,
    endTerminalRenderLock,
    isTerminalRenderLocked,
    printExchange,
    println,
    printlnBlock,
    PROMPT_USER,
    PROMPT_WAITING,
    resetStatusRowState,
    scheduleTerminalPromptRedraw,
    SEPARATOR,
    TURN_TIMEOUT_MS,
    writeInlineStatus,
} from './output.js';
export { broadcastSse, CRITICAL_EVENTS, nextSseEventId } from './sse.js';
export { createDeltaCallback, createDisplayState, renderStreamingFooter } from './turn-display.js';
