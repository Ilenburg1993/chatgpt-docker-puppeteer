// @ts-check
/**
 * Barrel interno de filesystem baixo para infra.
 *
 * @module copilot/infra/io/fs
 */

export { readTextFileSnapshot } from './read-text.js';
export { normalizeWritePayload, toWriteBuffer, writeAtomicFileUnlocked } from './write-atomic.js';
