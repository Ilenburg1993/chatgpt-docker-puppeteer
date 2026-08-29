// @ts-check
/** Neutral attached-child supervision. @module copilot/infra/process/supervision */

export {
    DEFAULT_PROCESS_TERMINATION_GRACE_MS,
    INFRA_PROCESS_SUPERVISION_VERSION,
    createAttachedChildProcessSupervisor,
    signalProcessTree,
    signalProcessTreeDetailed,
} from './runtime.js';
