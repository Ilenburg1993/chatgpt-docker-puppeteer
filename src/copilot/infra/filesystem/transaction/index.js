// @ts-check
/**
 * Low-level transactional filesystem primitives shared by write and mutation orchestration.
 *
 * This capability never imports `filesystem/write` or `filesystem/mutation`; those layers depend on it in one direction.
 *
 * @module copilot/infra/filesystem/transaction
 */

/** @typedef {import('./rollback/index.js').IoRollbackSidecar} IoRollbackSidecar */

export { preflightIoCapacity, readIoCapacityPreflightConfig } from './capacity-preflight.js';
export { mkdirPathUnlocked } from './directory/index.js';
export { runFileHandleOperation } from './file-handle-lifecycle.js';
export { emitMutationPhase } from './phases/index.js';
export {
    cleanupExpiredRollbackSidecars,
    cleanupRollbackSidecars,
    createDefaultIoRollbackPolicy,
    createRollbackSidecarWriter,
    listRollbackSidecars,
    persistRollbackSidecar,
    readIoRollbackPolicy,
    readVerifiedRollbackSidecar,
} from './rollback/index.js';
export { readBinaryMutationSnapshot } from './snapshot.js';
export {
    cleanupStaleSiblingTemps,
    createSiblingTempPath,
    parseSiblingTempEntry,
    prepareSiblingTempPath,
} from './temp-path.js';
