// @ts-check
/** Exact public membrane for repository patch semantics. */

export {
    buildRepositoryPatchNextAction,
    buildRepositoryPatchRecoveryRecipe,
    classifyRepositoryPatchFailure,
    compactRepositoryPatchFailureRows,
    readRepositoryPatchErrorDetails,
    summarizeRepositoryPatchFailures,
} from '../failure-semantics.js';
export { createRepositoryPatchResultValidationOption } from '../result-validation.js';
export { runRepositoryPatchTargetGroups } from '../operations.js';

/** @typedef {import('../contracts.js').RepositoryPatchDurability} RepositoryPatchDurability */
/** @typedef {import('../contracts.js').RepositoryPatchExpectedHashMode} RepositoryPatchExpectedHashMode */
/** @typedef {import('../contracts.js').RepositoryPatchTargetEntry} RepositoryPatchTargetEntry */
/** @typedef {import('../contracts.js').RepositoryPatchTarget} RepositoryPatchTarget */
