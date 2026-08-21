// @ts-check
/** @module copilot/infra/filesystem/invalidation */

export {
    flushIoInvalidationQueue,
    getIoInvalidationBusStats,
    getRecentIoInvalidation,
    normalizeIoInvalidationEvent,
    publishIoInvalidation,
    registerIoInvalidationHook,
} from './bus/index.js';
export { invalidateIoCoherencePath, invalidateIoCoherenceSubtree } from './coherence.js';
export {
    createCrossProcessInvalidationJournal,
    readCrossProcessInvalidationConfig,
    readCrossProcessInvalidationReplay,
} from './cross-process/index.js';
export {
    getIoExternalWatchStats,
    readIoExternalWatchConfig,
    startIoExternalWatch,
    stopIoExternalWatch,
} from './external-watch/index.js';
export { watchPath } from './watch/index.js';
