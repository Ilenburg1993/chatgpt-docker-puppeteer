// @ts-check
/** Exact public membrane for repository patch semantics. */

export {
    buildRepositoryPatchNextAction,
    classifyRepositoryPatchFailure,
    compactRepositoryPatchFailureRows,
    readRepositoryPatchErrorDetails,
    summarizeRepositoryPatchFailures,
} from '../failure-semantics.js';
export { createRepositoryPatchResultValidationOption } from '../result-validation.js';
export { runRepositoryPatchTargetGroups } from '../operations.js';
