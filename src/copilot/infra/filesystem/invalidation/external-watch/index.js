// @ts-check
/** @module copilot/infra/filesystem/invalidation/external-watch */

export { readIoExternalWatchConfig } from './config.js';
export {
    flushIoExternalWatchHints,
    getIoExternalWatchStats,
    startIoExternalWatch,
    stopIoExternalWatch,
} from './runtime.js';
