// @ts-check
/** JSDoc-only contracts for the SQLite L2 cache. */
/** @typedef {'bytes' | 'text' | 'json'} IoL2Kind */
/**
 * @typedef {object} IoL2CacheRow
 * @property {string} key
 * @property {string} path
 * @property {IoL2Kind} kind
 * @property {Buffer} payload
 * @property {BufferEncoding | null} [encoding]
 * @property {number} sizeBytes
 * @property {number} createdAtMs
 * @property {number} expiresAtMs
 * @property {number | null} [mtimeMs]
 * @property {number | null} [ctimeMs]
 * @property {string | null} [metaJson]
 * @property {number} lastAccessedMs
 */
export {};
