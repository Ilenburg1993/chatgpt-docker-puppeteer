// @ts-check
/**
 * src/copilot/agent/dialog/index.js — sub-barrel do subsistema Dialog Loop.
 *
 * @module copilot/agent/dialog
 */

export { DialogLoopManager, wireDialogLoopEvents } from './loop-manager.js';
export { DialogProtocol } from './protocol.js';
export {
    buildTurnResolutionListeners,
    dispatchTurnToHost,
    emitTurnStart,
    executeTurnImpl,
    waitForRestartAndReply,
} from './turn-executor.js';
export { DialogWatchdog, WATCHDOG_THRESHOLDS } from './watchdog.js';
