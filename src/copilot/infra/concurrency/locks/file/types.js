// @ts-check
/** JSDoc-only contracts for the optional multiprocess resource lock. */

/** @typedef {'none' | 'file' | 'file-and-directory'} IoDurabilityMode */
/** @typedef {'off' | 'high-risk' | 'mutations' | 'all'} FileResourceLockProfile */
/**
 * @typedef {object} FileResourceLockMetadata
 * @property {1} schemaVersion
 * @property {string} token
 * @property {number} pid
 * @property {string} hostname
 * @property {string} resourceKey
 * @property {string} resourceHash
 * @property {string | null} operation
 * @property {string | null} target
 * @property {string} startedAt
 * @property {number} startedAtMs
 */
/**
 * @typedef {object} FileResourceLockLease
 * @property {string} resourceKey
 * @property {string} lockPath
 * @property {string} token
 * @property {number} waitMs
 * @property {boolean} staleRecovered
 * @property {() => Promise<void>} release
 */
/**
 * @typedef {{
 *     metadata: FileResourceLockMetadata | null;
 *     dev: number | null;
 *     ino: number | null;
 *     mtimeMs: number | null;
 *     size: number | null;
 * }} FileResourceLockObservation
 */
export {};
