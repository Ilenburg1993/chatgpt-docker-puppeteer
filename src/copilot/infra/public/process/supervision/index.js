// @ts-check
/** Public runtime surface for neutral attached-child supervision. */

export {
    DEFAULT_PROCESS_TERMINATION_GRACE_MS,
    INFRA_PROCESS_SUPERVISION_VERSION,
    createAttachedChildProcessSupervisor,
    signalProcessTree,
    signalProcessTreeDetailed,
} from '../../../process/supervision/index.js';
