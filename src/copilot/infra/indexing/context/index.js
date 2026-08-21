// @ts-check
/** @module copilot/infra/indexing/context */

/** @typedef {import('./scope/index.js').ScopeDeclareOptions} ScopeDeclareOptions */
/** @typedef {import('./scope/index.js').ScopeStats} ScopeStats */

export {
    endSessionScope,
    getSessionScopeStats,
    listSessionScopes,
    startSessionScope,
    warmCacheForPaths,
    warmFromDirectory,
    warmReadThroughContext,
    warmRecentPaths,
    warmTextSnapshotsForPaths,
} from './prefetch/index.js';
export {
    closeScope,
    declareScope,
    findSymbol,
    getScopeContext,
    getScopeStats,
    getScopeSymbolIndex,
    invalidateScopePath,
    listScopes,
    refreshScope,
} from './scope/index.js';
