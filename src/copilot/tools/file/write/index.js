// @ts-check
/**
 * Barrel interno das file write tools.
 *
 * @module copilot/tools/file/write
 */

export { patchFileTool } from './patch-file.js';
export {
    ADVISORY_PATCH_SEGMENT_CHARS,
    ADVISORY_WRITE_CONTENT_BYTES,
    buildMutationChangeSet,
    completeAndAuditMutation,
    failAndAuditMutation,
    mutationFailureResult,
    pathFailureResult,
} from './mutation-helpers.js';
export { PATCH_FEEDBACK_FIX } from './patch-feedback.js';
export { rollbackFileChangesTool, rollbackSidecarsStatusTool } from './rollback-tools.js';
