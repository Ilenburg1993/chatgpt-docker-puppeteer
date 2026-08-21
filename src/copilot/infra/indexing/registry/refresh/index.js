// @ts-check
/** @module copilot/infra/indexing/registry/refresh */

/** @typedef {import('./domain.js').IndexAutoRefreshDomain} IndexAutoRefreshDomain */

export {
    createIndexAutoRefreshDomain,
    filterIoIndexRefreshDomainPaths,
    isIndexRefreshDomainCandidate,
    readIoIndexAutoRefreshConfig,
} from './domain.js';
export { executeIoIndexPathRefresh } from './paths.js';
export {
    adoptIoIndexAutoRefreshDomain,
    flushIoIndexAutoRefresh,
    getIoIndexAutoRefreshStats,
    reconcileIoIndexAutoRefreshDomain,
    refreshIoIndexPathsScheduled,
    requestIoIndexAutoRefreshDrain,
    scheduleIoIndexAutoRefresh,
} from './scheduler.js';
