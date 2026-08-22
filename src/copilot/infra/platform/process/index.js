// @ts-check
/** @module copilot/infra/platform/process */
export { resolveExecutable } from './executable/index.js';
export {
    DEFAULT_LINUX_PROCESS_CMDLINE_MAX_BYTES,
    MAX_LINUX_PROCESS_CMDLINE_MAX_BYTES,
    readLinuxProcessArgv,
    readProcessResourceSnapshot,
} from './introspection/index.js';
