// @ts-check
/** Exact public membrane for repository write domain operations. */

export { executeRepoFileBatchWorkflow } from '../file-batch/workflow.js';
export {
    applyBatchFileOperation,
    resolveFileBatchApplyMode,
    runFileBatchPreflight,
} from '../file-batch/runtime.js';
export { runRepoWritePatchTargetGroups } from '../patch/runtime.js';
export { executeRepoPatchBatchWorkflow, resolveRepoPatchPostValidationPolicy } from '../patch-batch/workflow.js';
export {
    MAX_POST_PATCH_VALIDATORS,
    POST_PATCH_VALIDATOR_NAMES,
    normalizePostPatchValidationRequests,
    runPostPatchValidations,
} from '../post-validation/runtime.js';
export {
    buildQuarantineId,
    listQuarantineMetadata,
    quarantineIdSchema,
    quarantineResolvedFile,
    readQuarantineMetadata,
    resolveQuarantinePaths,
    restoreQuarantinedFile,
    sha256File,
    writeQuarantineMetadataDefault,
} from '../quarantine/runtime.js';
export {
    executeRepositoryCreateFile,
    executeRepositoryMoveFile,
    executeRepositoryQuarantineFile,
    executeRepositoryRemoveFile,
    executeRepositoryRestoreQuarantinedFile,
    executeRepositoryWriteFile,
    inspectRepositoryQuarantinedFile,
    listRepositoryQuarantine,
} from '../single-file/runtime.js';
export {
    createRepoWriteRuntime,
    createResolvedTarget,
    durabilityOption,
    moveResolvedTargets,
    patchResolvedTarget,
    pathExists,
    regularFileExists,
    repoWriteStat,
    throwIfRepoWriteAborted,
    writeResolvedTarget,
} from '../runtime.js';

/** @typedef {import('../contracts.js').RepoWriteRuntime} RepoWriteRuntime */
/** @typedef {import('../contracts.js').RepoWriteQuarantineMetadataInterceptor} RepoWriteQuarantineMetadataInterceptor */
/** @typedef {import('../contracts.js').RepoWriteQuarantineMetadataWriter} RepoWriteQuarantineMetadataWriter */
/** @typedef {import('../contracts.js').QuarantineMetadata} QuarantineMetadata */
