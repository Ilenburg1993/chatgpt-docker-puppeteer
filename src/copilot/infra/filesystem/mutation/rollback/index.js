// @ts-check
/** @module copilot/infra/filesystem/mutation/rollback */

export {
    assertDestinationWritable,
    buildRollbackSnapshot,
    discardRollbackSidecar,
    isUnpublishedSnapshotConflict,
    readMutationSnapshot,
    readOptionalMutationSnapshot,
} from './support.js';
