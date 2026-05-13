// @ts-check
/**
 * src/copilot/agent/dialog/index.js — sub-barrel do subsistema Dialog Loop.
 *
 * @module copilot/agent/dialog
 * @see EventBus
 */

export { DialogProtocol } from '#copilot/dialog';
export {
    buildTurnResolutionListeners,
    dispatchTurnToHost,
    emitTurnStart,
    executeTurnImpl,
    waitForRestartAndReply,
} from './executors/turn-executor.js';
export {
    DIALOG_MODULE_LAYOUT,
    getDialogModuleDescriptor,
    getDialogModuleRole,
    listDialogModulesByRole,
} from './module-map.js';
export { DialogLoopManager, wireDialogLoopEvents } from './orchestrators/loop-manager.js';
export { DialogCompactionPolicy } from './policies/compaction-policy.js';
export { selectDialogResumeStrategy } from './policies/resume-policy.js';
export { DialogCostLedger } from './state/cost-ledger.js';
export { DialogLoopStateMachine } from './state/state-machine.js';
export { DialogWatchdogSupervisor } from './watchdogs/watchdog-supervisor.js';
export { DialogWatchdog, WATCHDOG_THRESHOLDS } from './watchdogs/watchdog.js';
export { handleUserInputRequest } from './wiring/user-input-handler.js';
