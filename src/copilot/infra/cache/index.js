// @ts-check
/** @module copilot/infra/cache */
/** @typedef {import('./memory/contracts/index.js').IoCacheEntry} IoCacheEntry */
/** @typedef {import('./memory/contracts/index.js').IoCacheStats} IoCacheStats */
export { makeBytesKey, makeTextKey, normalizeIoCacheKey } from './keys/index.js';
export { createIoL2CacheRuntime, createIoL2SqliteCache, getIoL2CacheConfiguration, isIoL2Cache } from './l2/index.js';
export { createIoL1CacheRuntime } from './memory/index.js';
export { aggregateIoCacheTierStats, buildIoCacheTierPlan } from './tiering/index.js';
