// @ts-check
/** Canonical repository patch target-group contracts. */

/** @typedef {'file-and-directory' | 'file' | 'none'} RepositoryPatchDurability */
/** @typedef {'target-baseline' | 'none'} RepositoryPatchExpectedHashMode */
/**
 * @typedef {object} RepositoryPatchTargetEntry
 * @property {number} index
 * @property {Record<string, unknown>} operation
 */
/**
 * @typedef {object} RepositoryPatchTarget
 * @property {string} path
 * @property {RepositoryPatchExpectedHashMode} expectedHashMode
 * @property {string} [expectedHash]
 * @property {RepositoryPatchDurability} [durability]
 * @property {RepositoryPatchTargetEntry[]} entries
 */

export {};
