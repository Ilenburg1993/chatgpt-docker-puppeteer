// @ts-check
/** @module copilot/infra/filesystem/write/atomic */

/** @typedef {import('./types.js').AtomicWriteOptions} AtomicWriteOptions */
/** @typedef {import('./types.js').AtomicWriteResult} AtomicWriteResult */

export { createOrReplaceFileAtomic, writeFileAtomic } from './locked.js';
export { writeFileAtomicPortable } from './portable.js';
export { writeAtomicFileUnlocked } from './unlocked.js';
