// @ts-check
/**
 * src/copilot/agent/dialog/index.js — sub-barrel do subsistema Dialog Loop.
 *
 * @module copilot/agent/dialog
 * @see EventBus
 */

export { DialogProtocol } from '../../dialog/protocol.js';
export { DialogCompactionPolicy } from './compaction-policy.js';
export { DialogCostLedger } from './cost-ledger.js';
export { DialogLoopManager, wireDialogLoopEvents } from './loop-manager.js';
export { selectDialogResumeStrategy } from './resume-policy.js';
export { DialogLoopStateMachine } from './state-machine.js';
export {
    buildTurnResolutionListeners,
    dispatchTurnToHost,
    emitTurnStart,
    executeTurnImpl,
    waitForRestartAndReply,
} from './turn-executor.js';
export { handleUserInputRequest } from './user-input-handler.js';
export { DialogWatchdogSupervisor } from './watchdog-supervisor.js';
export { DialogWatchdog, WATCHDOG_THRESHOLDS } from './watchdog.js';
