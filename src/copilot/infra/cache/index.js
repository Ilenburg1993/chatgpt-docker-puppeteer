// @ts-check
/** @module copilot/infra/cache */

/** @typedef {import('./memory/cache-types.js').IoCacheEntry} IoCacheEntry */
/** @typedef {import('./memory/cache-types.js').IoCacheStats} IoCacheStats */

export {
    createIoL2SqliteCache,
    getIoL2Cache,
    getIoL2CacheConfiguration,
    getIoL2CacheHealth,
    getIoL2CacheStats,
    isIoL2Cache,
} from './l2/index.js';
export {
    getIoCacheStats,
    getIoL1Cache,
    getVerifiedIoL1Entry,
    invalidateIoCachePath,
    invalidateIoCacheSubtree,
    makeBytesKey,
    makeTextKey,
    normalizeIoCacheKey,
} from './memory/index.js';
export { aggregateIoCacheTierStats, buildIoCacheTierPlan } from './tiering.js';
