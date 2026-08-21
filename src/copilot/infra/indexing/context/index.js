// @ts-check
/** @module copilot/infra/indexing/context */

/** @typedef {import('./scope/types.js').ScopeDeclareOptions} ScopeDeclareOptions */
/** @typedef {import('./scope/types.js').ScopeStats} ScopeStats */

export {
    createPrefetchSessionRegistry,
    warmCacheForPaths,
    warmFromDirectory,
    warmReadThroughContext,
    warmRecentPaths,
    warmTextSnapshotsForPaths,
} from './prefetch/index.js';
export { createWorkspaceScopeRuntime, readScopeRuntimeRegistrySnapshot } from './scope/index.js';
