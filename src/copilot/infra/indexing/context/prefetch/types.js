// @ts-check
/** Shared JSDoc contracts for context prefetch. */

/**
 * @typedef {object} PrefetchOptions
 * @property {number} [concurrency=8] Default is `8`
 * @property {boolean} [textMode=true] Default is `true`
 * @property {boolean} [silent=true] Default is `true`
 * @property {boolean} [captureTextSnapshots=false] Retorna snapshots textuais efêmeros para encadear parser/index sem
 *   reread. Default is `false`
 * @property {boolean} [cacheBytes=true] Quando captureTextSnapshots=true, também prima a entrada bytes. Default: true.
 *   Default is `true`
 * @property {AbortSignal} [signal]
 * @property {{l1:ReturnType<typeof import('../../../cache/memory/index.js').createIoL1CacheRuntime>}} [cacheRuntime]
 */

/**
 * @typedef {object} SessionScopeStats
 * @property {string} sessionId
 * @property {number} preloaded
 * @property {number} failed
 * @property {number} skipped
 * @property {number} durationMs
 * @property {number} pathCount
 * @property {boolean} active
 * @property {'opening' | 'ready' | 'degraded' | 'closing' | 'closed'} state
 */

/**
 * @typedef {object} _SessionScope
 * @property {string} sessionId
 * @property {string[]} paths
 * @property {number} preloaded
 * @property {number} failed
 * @property {number} skipped
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {boolean} active
 * @property {'opening' | 'ready' | 'degraded' | 'closing' | 'closed'} state
 */

export {};
