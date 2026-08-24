// @ts-check
/** Public membrane for neutral MCP child-process supervision. */

export {
    DEFAULT_PROCESS_TERMINATION_GRACE_MS,
    MCP_PROCESS_SUPERVISION_VERSION,
    createAttachedChildProcessSupervisor,
    signalProcessTree,
    signalProcessTreeDetailed,
} from '../runtime.js';
