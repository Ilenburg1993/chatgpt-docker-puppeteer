// @ts-check
/**
 * Barrel interno de filesystem baixo para infra.
 *
 * @module copilot/infra/io/fs
 */

export { appendFileUnlocked } from './append.js';
export { copyFileUnlocked } from './copy.js';
export { mkdirPathUnlocked } from './mkdir.js';
export { moveFileUnlocked } from './move.js';
export { readBytesFileSnapshot } from './read-bytes.js';
export { readTextFileSnapshot } from './read-text.js';
export { deleteFileUnlocked, removePathUnlocked } from './remove.js';
export { statPathSnapshot } from './stat.js';
export { normalizeWritePayload, toWriteBuffer, writeAtomicFileUnlocked } from './write-atomic.js';
