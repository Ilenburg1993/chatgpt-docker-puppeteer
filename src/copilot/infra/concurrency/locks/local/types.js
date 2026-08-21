// @ts-check
/** JSDoc-only contracts for process-local resource locks. */

/**
 * @typedef {object} IoResourceLockLease
 * @property {string} key
 * @property {number} waitMs
 * @property {boolean} fileLockEnabled
 * @property {string | null} fileLockPath
 * @property {boolean} staleFileLockRecovered
 * @property {<T>(operation: () => Promise<T>) => Promise<T>} run
 * @property {() => void} release
 * @property {() => Promise<void>} releaseAsync
 */
/**
 * @typedef {object} IoResourceLocksLease
 * @property {string[]} keys
 * @property {number} waitMs
 * @property {<T>(operation: () => Promise<T>) => Promise<T>} run
 * @property {() => void} release
 * @property {() => Promise<void>} releaseAsync
 */
export {};
