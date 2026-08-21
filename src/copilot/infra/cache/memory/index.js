// @ts-check
/** @module copilot/infra/cache/memory */

/** @typedef {import('./cache-types.js').IoCacheEntry} IoCacheEntry */

export {
    getIoCacheStats,
    getIoL1Cache,
    getVerifiedIoL1Entry,
    invalidateIoCachePath,
    invalidateIoCacheSubtree,
} from './cache.js';
export { makeBytesKey, makeTextKey, normalizeIoCacheKey } from './keys.js';
