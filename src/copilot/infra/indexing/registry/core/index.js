// @ts-check
/** @module copilot/infra/indexing/registry/core */
export {
    createIndexAutoRefreshDomain,
    filterIoIndexRefreshDomainPaths,
    isIndexRefreshDomainCandidate,
} from './domain.js';
export { executeIoIndexPathRefresh } from './refresh-paths.js';
