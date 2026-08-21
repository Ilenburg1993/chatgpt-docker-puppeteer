// @ts-check
/** @module copilot/infra/filesystem/write */

export {
    appendFileUnlocked,
    appendTextLocked,
    openDetachedAppendSinkLocked,
    openDetachedAppendSinkUnlocked,
} from './append/index.js';
export {
    createOrReplaceFileAtomic,
    writeAtomicFileUnlocked,
    writeFileAtomic,
    writeFileAtomicPortable,
} from './atomic/index.js';
export { copyFileUnlocked } from './copy.js';
export { mkdirPathLocked } from './directory/index.js';
export { chmodFileLocked, chmodFileUnlocked } from './metadata/index.js';
export { moveFileUnlocked } from './move/index.js';
export { normalizeWritePayload, toWriteBuffer } from './payload/index.js';
export { assertRecursiveRemovalConfirmed, deleteFileUnlocked, removePathUnlocked } from './remove.js';
