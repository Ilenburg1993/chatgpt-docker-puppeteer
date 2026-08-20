// @ts-check
/**
 * Barrel interno de filesystem baixo para infra.
 *
 * @module copilot/infra/io/fs
 */

export { withIoResourceLock } from '../../io-locks.js';
export { openDetachedAppendSinkUnlocked } from './append-sink.js';
export { appendFileUnlocked } from './append.js';
export {
    getIoCapacityPreflightConfiguration,
    preflightIoCapacity,
    resetIoCapacityPreflightCacheForTest,
} from './capacity-preflight.js';
export { copyFileUnlocked } from './copy.js';
export {
    copyFileLocked,
    deleteFileLocked,
    moveFileLocked,
    patchTextBatchLocked,
    patchTextLocked,
    removePathLocked,
} from './locked-mutations.js';
export {
    appendTextLocked,
    chmodFileLocked,
    createOrReplaceFileAtomic,
    mkdirPathLocked,
    openDetachedAppendSinkLocked,
    writeFileAtomic,
} from './locked-writes.js';
export { chmodFileUnlocked } from './metadata.js';
export { mkdirPathUnlocked } from './mkdir.js';
export { moveFileUnlocked } from './move.js';
export { writeFileAtomicPortable } from './portable-atomic.js';
export { readBytesFileRangeSnapshot, readBytesFileSnapshot } from './read-bytes.js';
export {
    getByteLineIndexStats,
    invalidateByteLineIndexPath,
    invalidateByteLineIndexSubtree,
    readTextLineChunks,
    readTextLineChunksStream,
    resetByteLineIndexCacheForTest,
} from './read-chunks.js';
export { readTextLinesSnapshot } from './read-lines.js';
export {
    getIoReadHashStats,
    listDirectoryNamesFresh,
    lstatPath,
    readBytes,
    readBytesFresh,
    readBytesRangeFresh,
    readLines,
    readText,
    readTextChunks,
    readTextChunksStream,
    readTextFresh,
    resetIoReadHashStatsForTest,
    statPath,
} from './read-services.js';
export { readTextFileSnapshot } from './read-text.js';
export { assertRecursiveRemovalConfirmed, deleteFileUnlocked, removePathUnlocked } from './remove.js';
export {
    cleanupExpiredRollbackSidecars,
    cleanupRollbackSidecars,
    createRollbackSidecarWriter,
    getIoRollbackPolicy,
    getRollbackSidecarDirectory,
    getRollbackSidecarMaxBytes,
    getRollbackSidecarMaxEntries,
    getRollbackSidecarTtlMs,
    isIoRollbackEnabled,
    listRollbackSidecars,
    persistRollbackSidecar,
    readVerifiedRollbackSidecar,
    shouldCaptureIoRollback,
} from './rollback-sidecar.js';
export { readBinaryMutationSnapshot } from './snapshot.js';
export { lstatPathSnapshot, statPathSnapshot } from './stat.js';
export { normalizeWritePayload, toWriteBuffer, writeAtomicFileUnlocked } from './write-atomic.js';

export { watchPath } from './watch.js';
