// @ts-check
/** Patch-batch execution state machine independent from MCP result presentation. */

import {
    captureRepositorySourceBarrier,
    verifyRepositorySourceBarrier,
} from '#copilot/mcp/public/workspace/repository/integrity';
import { summarizeRepositoryPatchFailures } from '#copilot/mcp/public/workspace/repository/patch';
import { runRepoWritePatchTargetGroups } from '../patch/runtime.js';
import { runPostPatchValidations } from '../post-validation/runtime.js';

/** @typedef {import('../contracts.js').RepoWriteRuntime} RepoWriteRuntime */
/** @typedef {ReturnType<typeof import('../post-validation/runtime.js').normalizePostPatchValidationRequests>} PostValidationRequests */

/**
 * @typedef {{
 *     applyMode?: 'global-preflight' | 'per-target-fast';
 *     failureMode?: 'best-effort' | 'fail-fast';
 *     targetConcurrency?: number;
 *     targetCount: number;
 *     defaultPlanConcurrency: number;
 *     defaultFastConcurrency: number;
 *     postValidationRequests: PostValidationRequests;
 *     postValidateOnPartial?: boolean;
 *     validationConfig: import('#copilot/mcp/public/validation').McpValidationProcessConfig | null;
 * }} RepoPatchBatchWorkflowOptions
 */

/**
 * @param {PostValidationRequests} requests
 */
function emptyPostValidation(requests) {
    return {
        requestedCount: requests.length,
        ran: false,
        skipped: false,
        skippedReason: /** @type {string | null} */ (null),
        allPassed: /** @type {boolean | null} */ (null),
        failedCount: 0,
        durationMs: 0,
        results: /** @type {Record<string, unknown>[]} */ ([]),
        sourceBarrier: /** @type {Record<string, unknown> | null} */ (null),
    };
}

/**
 * Resolve whether post-validation adds information after patch execution.
 * A complete failure has no mutated state to validate and must never start validator work merely because
 * postValidateOnPartial=true was requested.
 *
 * @param {number} requestedCount
 * @param {number} succeededCount
 * @param {boolean} patchFullyApplied
 * @param {boolean | undefined} postValidateOnPartial
 */
export function resolveRepoPatchPostValidationPolicy(
    requestedCount,
    succeededCount,
    patchFullyApplied,
    postValidateOnPartial,
) {
    if (requestedCount === 0) return Object.freeze({ action: /** @type {const} */ ('none'), reason: null });
    if (patchFullyApplied) return Object.freeze({ action: /** @type {const} */ ('run'), reason: null });
    if (succeededCount === 0) {
        return Object.freeze({ action: /** @type {const} */ ('skip'), reason: 'patch-not-applied' });
    }
    if (postValidateOnPartial === true) {
        return Object.freeze({ action: /** @type {const} */ ('run'), reason: null });
    }
    return Object.freeze({ action: /** @type {const} */ ('skip'), reason: 'partial-patch-apply' });
}

/**
 * Execute one patch-batch workflow while preserving explicit preflight/apply/post-validation phases.
 * Presentation choices such as compact rows, echoed preflight details and text remain in the wire adapter.
 *
 * @param {RepoWriteRuntime} runtime
 * @param {Record<string, unknown>[]} operations
 * @param {boolean} dryRun
 * @param {RepoPatchBatchWorkflowOptions} options
 */
export async function executeRepoPatchBatchWorkflow(runtime, operations, dryRun, options) {
    const effectiveApplyMode = options.applyMode ?? 'per-target-fast';
    const effectiveFailureMode =
        options.failureMode ?? (effectiveApplyMode === 'per-target-fast' ? 'best-effort' : 'fail-fast');
    const effectiveConcurrency =
        options.targetConcurrency ?? (effectiveApplyMode === 'per-target-fast' ? options.defaultFastConcurrency : 1);

    if (dryRun) {
        const run = await runRepoWritePatchTargetGroups(runtime, operations, true, {
            failureMode: 'best-effort',
            concurrency: options.targetConcurrency ?? options.defaultPlanConcurrency,
        });
        const failed = run.operations.filter((operation) => operation['success'] !== true);
        return {
            kind: /** @type {const} */ ('dry-run'),
            effectiveApplyMode,
            effectiveFailureMode,
            effectiveConcurrency,
            run,
            failed,
            failureSummary: summarizeRepositoryPatchFailures(failed),
            postValidation: {
                requestedCount: options.postValidationRequests.length,
                ran: false,
                skipped: options.postValidationRequests.length > 0,
                skippedReason:
                    options.postValidationRequests.length > 0 ? 'dry-run-does-not-start-validator-jobs' : null,
                validators: options.postValidationRequests.map((request) => request.validator),
            },
        };
    }

    const singleTargetAtomicPreflightElision = effectiveApplyMode === 'global-preflight' && options.targetCount === 1;
    const directFastPreflightElision = effectiveApplyMode === 'per-target-fast';
    const preflightElided = singleTargetAtomicPreflightElision || directFastPreflightElision;
    const preflightElisionReason = directFastPreflightElision
        ? 'per-target-fast-direct-atomic-apply'
        : singleTargetAtomicPreflightElision
          ? 'single-target-atomic-compute-before-write'
          : null;

    let preflight = null;
    if (effectiveApplyMode === 'global-preflight' && !singleTargetAtomicPreflightElision) {
        preflight = await runRepoWritePatchTargetGroups(runtime, operations, true, {
            failureMode: 'best-effort',
            concurrency: options.targetConcurrency ?? options.defaultPlanConcurrency,
        });
        const failedPreflight = preflight.operations.filter((operation) => operation['success'] !== true);
        if (failedPreflight.length > 0) {
            return {
                kind: /** @type {const} */ ('preflight-blocked'),
                effectiveApplyMode,
                effectiveFailureMode,
                effectiveConcurrency,
                preflight,
                failedPreflight,
                failureSummary: summarizeRepositoryPatchFailures(failedPreflight),
                preflightElided,
                preflightElisionReason,
            };
        }
    }

    const applyRun = await runRepoWritePatchTargetGroups(runtime, operations, false, {
        failureMode: effectiveFailureMode,
        concurrency: effectiveConcurrency,
    });
    const applied = applyRun.operations;
    const succeeded = applied.filter((operation) => operation['success'] === true);
    const skipped = applied.filter((operation) => operation['skipped'] === true);
    const failedApply = applied.filter((operation) => operation['success'] !== true && operation['skipped'] !== true);
    const partial = succeeded.length > 0 && (failedApply.length > 0 || skipped.length > 0);
    const failureSummary = summarizeRepositoryPatchFailures(failedApply);
    const patchFullyApplied = failedApply.length === 0 && skipped.length === 0;

    let postValidation = emptyPostValidation(options.postValidationRequests);
    const postValidationPolicy = resolveRepoPatchPostValidationPolicy(
        options.postValidationRequests.length,
        succeeded.length,
        patchFullyApplied,
        options.postValidateOnPartial,
    );
    if (postValidationPolicy.action === 'skip') {
        postValidation = { ...postValidation, skipped: true, skippedReason: postValidationPolicy.reason };
    } else if (postValidationPolicy.action === 'run') {
        if (!options.validationConfig) {
            throw new TypeError('Post-validation requires a validation process config projection.');
        }
        const barrierPaths = [
            ...new Set(
                succeeded
                    .map((operation) => operation['path'])
                    .filter(/** @returns {value is string} */ (value) => typeof value === 'string' && value.length > 0),
            ),
        ];
        const sourceBarrier =
            barrierPaths.length > 0 ? await captureRepositorySourceBarrier(runtime.workspace, barrierPaths) : null;
        postValidation = {
            ...(await runPostPatchValidations(options.postValidationRequests, runtime, options.validationConfig)),
            sourceBarrier: null,
        };
        if (sourceBarrier) {
            try {
                const verified = await verifyRepositorySourceBarrier(runtime.workspace, sourceBarrier, {
                    audit: runtime.audit,
                });
                postValidation = {
                    ...postValidation,
                    sourceBarrier: {
                        capturedFingerprint: sourceBarrier.fingerprint,
                        verifiedFingerprint: verified.currentFingerprint,
                        entryCount: sourceBarrier.entryCount,
                        passed: true,
                    },
                };
            } catch (error) {
                const candidate = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (error);
                postValidation = {
                    ...postValidation,
                    allPassed: false,
                    sourceBarrier: {
                        capturedFingerprint: sourceBarrier.fingerprint,
                        entryCount: sourceBarrier.entryCount,
                        passed: false,
                        code: candidate.code ?? 'ERR_SOURCE_DRIFT',
                        error: candidate.message,
                        details: candidate.details ?? null,
                    },
                };
            }
        }
    }

    return {
        kind: /** @type {const} */ ('applied'),
        effectiveApplyMode,
        effectiveFailureMode,
        effectiveConcurrency,
        preflight,
        preflightElided,
        preflightElisionReason,
        applyRun,
        applied,
        succeeded,
        skipped,
        failedApply,
        partial,
        failureSummary,
        patchFullyApplied,
        postValidation,
    };
}
