// @ts-check
/**
 * Barrel interno de filesystem baixo para infra.
 *
 * @module copilot/infra/io/fs
 */

export { appendFileUnlocked } from './append.js';
export { copyFileUnlocked } from './copy.js';
export {
    copyFileLocked,
    deleteFileLocked,
    moveFileLocked,
    patchTextLocked,
    removePathLocked,
} from './locked-mutations.js';
export { appendTextLocked, createOrReplaceFileAtomic, mkdirPathLocked, writeFileAtomic } from './locked-writes.js';
export { mkdirPathUnlocked } from './mkdir.js';
export { moveFileUnlocked } from './move.js';
export { readBytesFileSnapshot } from './read-bytes.js';
export { readTextLineChunks, readTextLineChunksStream } from './read-chunks.js';
export { readTextLinesSnapshot } from './read-lines.js';
export { readBytes, readLines, readText, readTextChunks, readTextChunksStream, statPath } from './read-services.js';
export { readTextFileSnapshot } from './read-text.js';
export { deleteFileUnlocked, removePathUnlocked } from './remove.js';
export { readBinaryMutationSnapshot } from './snapshot.js';
export { statPathSnapshot } from './stat.js';
export { normalizeWritePayload, toWriteBuffer, writeAtomicFileUnlocked } from './write-atomic.js';
