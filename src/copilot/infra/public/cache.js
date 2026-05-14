// @ts-check
/**
 * Facade pública de cache de I/O.
 *
 * @module copilot/infra/public/cache
 */

export {
    getIoCacheStats,
    getIoL1Cache,
    getVerifiedIoL1Entry,
    invalidateIoCachePath,
    invalidateIoCacheSubtree,
    makeBytesKey,
    makeTextKey,
    normalizeIoCacheKey,
} from '../io-cache.js';

export { getIoL2CacheHealth, getIoL2CacheStats } from '../io-cache-l2-registry.js';
export { aggregateIoCacheTierStats, buildIoCacheTierPlan } from '../io-cache-tiering.js';
