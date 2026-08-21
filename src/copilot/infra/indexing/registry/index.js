// @ts-check
/** @module copilot/infra/indexing/registry */
export {
    createIndexAutoRefreshDomain,
    executeIoIndexPathRefresh,
    filterIoIndexRefreshDomainPaths,
    isIndexRefreshDomainCandidate,
} from './core/index.js';
export { DEFAULT_INDEX_EXTENSIONS } from './extensions/index.js';
export { createIoIndexRegistryRuntime, readIoIndexRuntimeConfig } from './instance/index.js';
