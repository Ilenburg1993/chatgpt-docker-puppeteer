// @ts-check
/** @module copilot/infra/indexing/context/prefetch */

/** @typedef {import('./types.js').PrefetchOptions} PrefetchOptions */
/** @typedef {import('./types.js').SessionScopeStats} SessionScopeStats */

export { warmCacheForPaths, warmRecentPaths, warmTextSnapshotsForPaths } from './cache-warm.js';
export { warmFromDirectory } from './directory.js';
export { warmReadThroughContext } from './read-through.js';
export { createPrefetchSessionRegistry } from './registry.js';
