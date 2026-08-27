// @ts-check
/**
 * Repository patch execution operations.
 *
 * Owns exact patch target authorization, same-file atomic groups, hash preconditions and bounded cross-target
 * execution. Wire adapters provide validated records; schemas, audit and response presentation remain outside.
 *
 * @module copilot/mcp/workspace/repository/patch/operations
 */

import { runBoundedOperationBatch } from '#copilot/infra/public/concurrency/bulk';
import { clearRepoReadFileResultCacheForResolvedPath } from '#copilot/mcp/public/workspace/repository/read-cache';
import {
    buildRepositoryPatchNextAction,
    buildRepositoryPatchRecoveryRecipe,
    classifyRepositoryPatchFailure,
    readRepositoryPatchErrorDetails,
} from './failure-semantics.js';
import { createRepositoryPatchResultValidationOption } from './result-validation.js';

const MAX_REPOSITORY_PATCH_TARGETS = 64;

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepositoryPatchWorkspace */
/** @typedef {RepositoryPatchWorkspace['io']} RepositoryPatchIo */
/** @typedef {Readonly<{
 * workspace: RepositoryPatchWorkspace;
 * io: RepositoryPatchIo;
 * config: import('#copilot/mcp/public/workspace/repository/patch/config').McpRepositoryPatchConfig;
 * signal?: AbortSignal;
 * }>} RepositoryPatchRuntime */

/**
 * @param {RepositoryPatchWorkspace} workspace
 * @param {import('#copilot/mcp/public/workspace/repository/patch/config').McpRepositoryPatchConfig} config
 * @param {AbortSignal | undefined} signal
 * @returns {RepositoryPatchRuntime}
 */
function createRepositoryPatchRuntime(workspace, config, signal) {
    return Object.freeze({ workspace, io: workspace.io, config, ...(signal ? { signal } : {}) });
}

/** @param {RepositoryPatchRuntime} runtime */
function throwIfRepositoryPatchAborted(runtime) {
    runtime.signal?.throwIfAborted();
}

/** @param {number | undefined} requested */
function resolveRepositoryPatchTargetLimit(requested) {
    if (requested === undefined) return MAX_REPOSITORY_PATCH_TARGETS;
    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_REPOSITORY_PATCH_TARGETS) {
        throw new TypeError(`Repository patch maxTargets must be an integer in 1..${MAX_REPOSITORY_PATCH_TARGETS}.`);
    }
    return requested;
}

/**
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Parameters<RepositoryPatchIo['patchTextLocked']>[1]} options
 */
function patchResolvedTarget(/** @type {RepositoryPatchRuntime} */ runtime, resolved, options) {
    const executionOptions = { ...options, ...(runtime.signal ? { signal: runtime.signal } : {}) };
    return resolved.validatedWritePath
        ? runtime.io.patchTextLockedValidated(resolved.validatedWritePath, executionOptions)
        : runtime.io.patchTextLocked(resolved.resolved, executionOptions);
}

/**
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Parameters<RepositoryPatchIo['patchTextBatchLocked']>[1]} options
 */
function patchResolvedTargetBatch(/** @type {RepositoryPatchRuntime} */ runtime, resolved, options) {
    const executionOptions = { ...options, ...(runtime.signal ? { signal: runtime.signal } : {}) };
    return resolved.validatedWritePath
        ? runtime.io.patchTextBatchLockedValidated(resolved.validatedWritePath, executionOptions)
        : runtime.io.patchTextBatchLocked(resolved.resolved, executionOptions);
}

/** @param {unknown} value @returns {{ durability: import('#copilot/infra/public/policy').IoDurabilityMode } | {}} */
function durabilityOption(value) {
    return value === 'file-and-directory' || value === 'file' || value === 'none' ? { durability: value } : {};
}

/** @param {unknown} value @returns {number | undefined} */
function optionalInteger(value) {
    return Number.isInteger(value) ? /** @type {number} */ (value) : undefined;
}

/**
 * @param {boolean | undefined} include
 * @param {{ diff: string; truncated: boolean; lines: number; contextLines: number; bytes?: number }} diff
 */
function maybeDiffPreview(include, diff) {
    return include === true
        ? {
              diffPreview: diff.diff,
              diffPreviewTruncated: diff.truncated,
              diffPreviewLines: diff.lines,
              ...(typeof diff.bytes === 'number' ? { diffPreviewBytes: diff.bytes } : {}),
              diffContextLines: diff.contextLines,
          }
        : {
              diffPreviewSuppressed: true,
              diffPreviewAvailable: diff.lines > 0,
              diffPreviewLines: diff.lines,
              ...(typeof diff.bytes === 'number' ? { diffPreviewBytes: diff.bytes } : {}),
              diffContextLines: diff.contextLines,
          };
}

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function recordOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/** @param {unknown} value */
function isSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

/** @param {unknown} error */
function readPatchFailureCode(error) {
    return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
}

/**
 * Consume only the exact B1 retry-safe recipe shape. This is intentionally stricter than the generic recipe contract:
 * B2 never dispatches arbitrary tools and never reconstructs selector semantics.
 *
 * @param {unknown} recoveryRecipe
 * @param {Record<string, unknown>} operation
 * @param {boolean} dryRun
 * @param {Record<string, unknown>} details
 */
function readExactPatchSelfRepairArgs(recoveryRecipe, operation, dryRun, details) {
    const recipe = recordOrNull(recoveryRecipe);
    if (
        !recipe ||
        recipe['version'] !== 1 ||
        recipe['disposition'] !== 'retry-safe' ||
        recipe['scope'] !== 'target' ||
        recipe['reasonCode'] !== 'patch-exact-anchor-same-snapshot'
    ) {
        return null;
    }
    const invocation = recordOrNull(recipe['retryInvocation']);
    const args = recordOrNull(invocation?.['args']);
    if (!invocation || invocation['tool'] !== 'repo_apply_patch' || !args) return null;
    if (args['path'] !== operation['path'] || args['new_string'] !== operation['new_string']) return null;
    if (args['dryRun'] !== dryRun) return null;
    if (typeof args['old_string'] !== 'string' || args['old_string'].length === 0) return null;
    if (typeof args['new_string'] !== 'string') return null;
    if (!isSha256(args['expectedHash']) || args['expectedHash'] !== details['currentHash']) return null;
    if (
        'replace_all' in args ||
        'expected_occurrences' in args ||
        'occurrence_index' in args ||
        operation['expectedHash'] !== undefined ||
        operation['replace_all'] === true ||
        operation['expected_occurrences'] !== undefined ||
        operation['occurrence_index'] !== undefined
    ) {
        return null;
    }
    return args;
}

/**
 * Attempt at most one hash-bound exact self-repair. A second resource lock is intentionally reacquired; the recipe's
 * same-snapshot hash becomes the expectedHash precondition, so any intervening mutation fails closed as EEXPECTEDHASH.
 *
 * @param {RepositoryPatchRuntime} runtime
 * @param {{ resolved: string; relative: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Record<string, unknown>} operation
 * @param {number} index
 * @param {boolean} dryRun
 * @param {Record<string, unknown>} details
 * @param {unknown} recoveryRecipe
 */
async function attemptExactPatchSelfRepair(runtime, resolved, operation, index, dryRun, details, recoveryRecipe) {
    if (!runtime.config.exactSelfRepairEnabled || runtime.config.exactSelfRepairMaxAttempts !== 1) return null;
    const args = readExactPatchSelfRepairArgs(recoveryRecipe, operation, dryRun, details);
    if (!args) return null;
    const retryOperation = {
        path: args['path'],
        old_string: args['old_string'],
        new_string: args['new_string'],
        expectedHash: args['expectedHash'],
        ...(args['allowNoop'] === true ? { allowNoop: true } : {}),
        ...(Number.isInteger(args['diffContextLines']) ? { diffContextLines: args['diffContextLines'] } : {}),
        ...(Number.isInteger(args['maxDiffLines']) ? { maxDiffLines: args['maxDiffLines'] } : {}),
        ...(args['includeDiffPreview'] === true ? { includeDiffPreview: true } : {}),
        ...(!dryRun && typeof args['durability'] === 'string' ? { durability: args['durability'] } : {}),
    };
    try {
        const patch = await patchResolvedTarget(runtime, resolved, {
            oldString: /** @type {string} */ (args['old_string']),
            newString: /** @type {string} */ (args['new_string']),
            expectedHash: /** @type {string} */ (args['expectedHash']),
            dryRun,
            allowNoop: args['allowNoop'] === true,
            diffContextLines: optionalInteger(args['diffContextLines']) ?? 3,
            maxDiffLines: optionalInteger(args['maxDiffLines']) ?? 160,
            computeDiff: args['includeDiffPreview'] === true,
            ...createRepositoryPatchResultValidationOption(resolved.relative),
            ...(!dryRun ? durabilityOption(args['durability']) : {}),
            advisoryLimits: {
                tool: typeof operation['__toolName'] === 'string' ? operation['__toolName'] : 'repo_apply_patch_batch',
                index,
                exactSelfRepair: true,
                exactSelfRepairAttempt: 1,
                exactSelfRepairReasonCode: 'patch-exact-anchor-same-snapshot',
                expectedHash: args['expectedHash'],
                dryRun,
            },
        });
        return {
            attempted: /** @type {const} */ (true),
            succeeded: /** @type {const} */ (true),
            patch,
            retryOperation,
            reasonCode: 'patch-exact-anchor-same-snapshot',
        };
    } catch (error) {
        return {
            attempted: /** @type {const} */ (true),
            succeeded: /** @type {const} */ (false),
            error,
            retryOperation,
            reasonCode: 'patch-exact-anchor-same-snapshot',
        };
    }
}

/** @param {{ attempted: true; succeeded: boolean; reasonCode: string; error?: unknown }} repair */
function projectExactPatchSelfRepair(repair) {
    const failureCode = repair.succeeded ? undefined : readPatchFailureCode(repair.error);
    return {
        attempted: true,
        succeeded: repair.succeeded,
        failedClosed: repair.succeeded !== true,
        attemptCount: 1,
        reasonCode: repair.reasonCode,
        ...(failureCode ? { failureCode } : {}),
    };
}

/**
 * @param {Record<string, unknown>} operation
 * @param {number} index
 * @param {boolean} dryRun
 * @param {string} relativePath
 */
function buildIndependentPatchAttemptOptions(operation, index, dryRun, relativePath) {
    return {
        oldString: String(operation['old_string'] ?? ''),
        newString: String(operation['new_string'] ?? ''),
        replaceAll: operation['replace_all'] === true,
        ...(optionalInteger(operation['expected_occurrences']) !== undefined
            ? { expectedOccurrences: /** @type {number} */ (optionalInteger(operation['expected_occurrences'])) }
            : {}),
        ...(optionalInteger(operation['occurrence_index']) !== undefined
            ? { occurrenceIndex: /** @type {number} */ (optionalInteger(operation['occurrence_index'])) }
            : {}),
        dryRun,
        ...(!dryRun ? { captureRollback: false } : {}),
        allowNoop: operation['allowNoop'] === true,
        diffContextLines: optionalInteger(operation['diffContextLines']) ?? 3,
        maxDiffLines: optionalInteger(operation['maxDiffLines']) ?? 160,
        computeDiff: operation['includeDiffPreview'] === true,
        ...createRepositoryPatchResultValidationOption(relativePath),
        ...(!dryRun ? durabilityOption(operation['durability']) : {}),
        advisoryLimits: {
            tool:
                typeof operation['__toolName'] === 'string'
                    ? operation['__toolName']
                    : dryRun
                      ? 'repo_patch_batch_plan'
                      : 'repo_apply_patch_batch',
            index,
            oldStringChars: String(operation['old_string'] ?? '').length,
            newStringChars: String(operation['new_string'] ?? '').length,
            replaceAll: operation['replace_all'] === true,
            occurrenceIndex: operation['occurrence_index'] ?? null,
            expectedHash: operation['expectedHash'] ?? null,
            dryRun,
        },
    };
}

/**
 * Execute one independent exact target and, only when B1 declares the failure retry-safe, perform one hash-bound local
 * retry. Failure projection always describes the final attempt; the original recipe is retained only when no local
 * retry was attempted.
 *
 * @param {RepositoryPatchRuntime} runtime
 * @param {{ resolved: string; relative: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Record<string, unknown>} operation
 * @param {number} index
 * @param {boolean} dryRun
 */
async function executeIndependentPatchTarget(runtime, resolved, operation, index, dryRun) {
    try {
        return {
            success: /** @type {const} */ (true),
            patch: await patchResolvedTarget(
                runtime,
                resolved,
                buildIndependentPatchAttemptOptions(operation, index, dryRun, resolved.relative),
            ),
            exactSelfRepair: null,
        };
    } catch (initialError) {
        const initialCode = readPatchFailureCode(initialError);
        const initialDetails = readRepositoryPatchErrorDetails(initialError);
        const initialRecipe = buildRepositoryPatchRecoveryRecipe(initialCode, initialDetails, operation, {
            dryRun,
            failureScope: 'target',
        });
        const repair = await attemptExactPatchSelfRepair(
            runtime,
            resolved,
            operation,
            index,
            dryRun,
            initialDetails,
            initialRecipe,
        );
        if (repair?.succeeded === true) {
            return {
                success: /** @type {const} */ (true),
                patch: repair.patch,
                exactSelfRepair: projectExactPatchSelfRepair(repair),
            };
        }
        const finalError = repair?.error ?? initialError;
        const finalOperation = repair?.retryOperation ?? operation;
        const code = readPatchFailureCode(finalError);
        const details = readRepositoryPatchErrorDetails(finalError);
        const semantics = classifyRepositoryPatchFailure(code, details, 'target');
        const recoveryRecipe = repair
            ? buildRepositoryPatchRecoveryRecipe(code, details, finalOperation, {
                  dryRun,
                  failureScope: 'target',
              })
            : initialRecipe;
        return {
            success: /** @type {const} */ (false),
            error: finalError instanceof Error ? finalError.message : String(finalError),
            code,
            details,
            semantics,
            recoveryRecipe,
            nextAction: buildRepositoryPatchNextAction(code, details),
            exactSelfRepair: repair ? projectExactPatchSelfRepair(repair) : null,
        };
    }
}

/**
 * Project workspace path-resolution failures through the same stable semantics used by patch-engine failures.
 *
 * @param {number} index
 * @param {unknown} requestedPath
 * @param {{ reason: string; code: string }} resolved
 */
function buildPatchPathResolutionFailure(index, requestedPath, resolved) {
    const details = { pathResolution: true };
    return {
        index,
        success: false,
        path: requestedPath ?? null,
        error: resolved.reason,
        code: resolved.code,
        ...classifyRepositoryPatchFailure(resolved.code, details, 'target'),
        details,
        nextAction: buildRepositoryPatchNextAction(resolved.code, details),
    };
}

/**
 * @param {Record<string, unknown>} operation
 * @param {number} index
 * @returns {Promise<Record<string, unknown>>}
 */
async function planPatchBatchOperation(/** @type {RepositoryPatchRuntime} */ runtime, operation, index) {
    const resolved = await runtime.workspace.resolveWritePath(String(operation['path'] ?? ''), {
        issueMutableCapability: true,
    });
    if (!resolved.ok) return buildPatchPathResolutionFailure(index, operation['path'], resolved);
    if (operation['replace_all'] === true && operation['occurrence_index'] !== undefined) {
        return {
            index,
            success: false,
            path: resolved.relative,
            error: 'Use replace_all ou occurrence_index, nao ambos na mesma operacao.',
            code: 'ERR_PATCH_CONFLICTING_MODE',
        };
    }
    const outcome = await executeIndependentPatchTarget(runtime, resolved, operation, index, true);
    if (!outcome.success) {
        return {
            index,
            success: false,
            path: resolved.relative,
            error: outcome.error,
            code: outcome.code,
            ...outcome.semantics,
            ...(Object.keys(outcome.details).length > 0 ? { details: outcome.details } : {}),
            ...(outcome.recoveryRecipe ? { recoveryRecipe: outcome.recoveryRecipe } : {}),
            ...(outcome.exactSelfRepair ? { exactSelfRepair: outcome.exactSelfRepair } : {}),
            nextAction: outcome.nextAction,
        };
    }
    const patch = outcome.patch;
    return {
        index,
        success: true,
        path: resolved.relative,
        dryRun: true,
        occurrences: patch.occurrences,
        replacedOccurrences: patch.replacedOccurrences,
        previousBytes: patch.previousBytes,
        projectedBytes: patch.projectedBytes,
        byteDelta: patch.byteDelta,
        firstMatchLine: patch.firstMatchLine,
        lastMatchLine: patch.lastMatchLine,
        lineDelta: patch.lineDelta,
        occurrenceIndex: patch.occurrenceIndex,
        previousHash: patch.previousHash,
        projectedHash: patch.contentHash,
        noop: patch.noop,
        ...(outcome.exactSelfRepair ? { exactSelfRepair: outcome.exactSelfRepair } : {}),
        io: {
            operation: patch.io.operation,
            targetKind: patch.io.targetKind,
            bytesWritten: patch.io.bytesWritten,
            durationMs: patch.io.durationMs,
            engine: patch.io.engine,
            traceId: patch.io.traceId ?? null,
        },
        ...maybeDiffPreview(operation['includeDiffPreview'] === true, {
            diff: patch.diffPreview,
            truncated: patch.diffPreviewTruncated,
            lines: patch.diffPreviewLines,
            bytes: patch.diffPreviewBytes,
            contextLines: patch.diffContextLines,
        }),
    };
}

/**
 * @param {Record<string, unknown>} operation
 * @param {number} index
 * @returns {Promise<Record<string, unknown>>}
 */
async function applyPatchBatchOperation(/** @type {RepositoryPatchRuntime} */ runtime, operation, index) {
    const resolved = await runtime.workspace.resolveWritePath(String(operation['path'] ?? ''), {
        issueMutableCapability: true,
    });
    if (!resolved.ok) return buildPatchPathResolutionFailure(index, operation['path'], resolved);
    const outcome = await executeIndependentPatchTarget(runtime, resolved, operation, index, false);
    if (!outcome.success) {
        return {
            index,
            success: false,
            path: resolved.relative,
            error: outcome.error,
            code: outcome.code,
            ...outcome.semantics,
            ...(Object.keys(outcome.details).length > 0 ? { details: outcome.details } : {}),
            ...(outcome.recoveryRecipe ? { recoveryRecipe: outcome.recoveryRecipe } : {}),
            ...(outcome.exactSelfRepair ? { exactSelfRepair: outcome.exactSelfRepair } : {}),
            nextAction: outcome.nextAction,
        };
    }
    const patch = outcome.patch;
    clearRepoReadFileResultCacheForResolvedPath(resolved.resolved);
    return {
        index,
        success: true,
        path: resolved.relative,
        dryRun: false,
        occurrences: patch.occurrences,
        replacedOccurrences: patch.replacedOccurrences,
        previousBytes: patch.previousBytes,
        projectedBytes: patch.projectedBytes,
        bytesWritten: patch.bytesWritten,
        byteDelta: patch.byteDelta,
        firstMatchLine: patch.firstMatchLine,
        lastMatchLine: patch.lastMatchLine,
        lineDelta: patch.lineDelta,
        occurrenceIndex: patch.occurrenceIndex,
        previousHash: patch.previousHash,
        contentHash: patch.contentHash,
        noop: patch.noop,
        traceId: patch.io.traceId ?? null,
        ...(outcome.exactSelfRepair ? { exactSelfRepair: outcome.exactSelfRepair } : {}),
        io: {
            operation: patch.io.operation,
            targetKind: patch.io.targetKind,
            bytesWritten: patch.io.bytesWritten,
            durationMs: patch.io.durationMs,
            engine: patch.io.engine,
            traceId: patch.io.traceId ?? null,
        },
        ...maybeDiffPreview(operation['includeDiffPreview'] === true, {
            diff: patch.diffPreview,
            truncated: patch.diffPreviewTruncated,
            lines: patch.diffPreviewLines,
            bytes: patch.diffPreviewBytes,
            contextLines: patch.diffContextLines,
        }),
    };
}

/**
 * Convert one target-relative wire operation to the canonical locked batch operation shape. Baseline hash ownership is
 * exclusively target-scoped and therefore never appears inside a relative operation.
 *
 * @param {Record<string, unknown>} operation
 */
function toLockedPatchBatchOperation(operation) {
    return {
        oldString: String(operation['old_string'] ?? ''),
        newString: String(operation['new_string'] ?? ''),
        replaceAll: operation['replace_all'] === true,
        ...(optionalInteger(operation['expected_occurrences']) !== undefined
            ? { expectedOccurrences: /** @type {number} */ (optionalInteger(operation['expected_occurrences'])) }
            : {}),
        ...(optionalInteger(operation['occurrence_index']) !== undefined
            ? { occurrenceIndex: /** @type {number} */ (optionalInteger(operation['occurrence_index'])) }
            : {}),
        ...(typeof operation['expectedHash'] === 'string' && operation['expectedHash']
            ? { expectedHash: operation['expectedHash'] }
            : {}),
        allowNoop: operation['allowNoop'] === true,
        diffContextLines: optionalInteger(operation['diffContextLines']) ?? 3,
        maxDiffLines: optionalInteger(operation['maxDiffLines']) ?? 160,
        computeDiff: operation['includeDiffPreview'] === true,
    };
}

/**
 * Materialize target-owned fields only at the point where the existing independent single-patch engine needs its flat
 * operation contract. This is projection, not grouping/inference: path/hash/durability already belong to the target.
 *
 * @param {import('./contracts.js').RepositoryPatchTarget} target
 * @param {Record<string, unknown>} operation
 */
function materializeTargetOperation(target, operation) {
    return {
        ...operation,
        path: target.path,
        ...(target.expectedHash ? { expectedHash: target.expectedHash } : {}),
        ...(target.durability ? { durability: target.durability } : {}),
    };
}

/**
 * Execute one explicit repository patch target. Same-target operations are sequential and atomic in one
 * patchTextBatchLocked cycle; a single operation continues to use the B2 independent-target path so bounded exact
 * self-repair remains available without duplicating that policy.
 *
 * @param {RepositoryPatchRuntime} runtime
 * @param {import('./contracts.js').RepositoryPatchTarget} target
 * @param {boolean} dryRun
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function runPatchTarget(runtime, target, dryRun) {
    throwIfRepositoryPatchAborted(runtime);
    if (target.entries.length === 1) {
        const entry = /** @type {import('./contracts.js').RepositoryPatchTargetEntry} */ (target.entries[0]);
        const operation = materializeTargetOperation(target, entry.operation);
        const row = dryRun
            ? await planPatchBatchOperation(runtime, operation, entry.index)
            : await applyPatchBatchOperation(runtime, operation, entry.index);
        return [{ ...row, expectedHashMode: target.expectedHashMode }];
    }

    const resolved = await runtime.workspace.resolveWritePath(target.path, { issueMutableCapability: true });
    if (!resolved.ok) {
        return target.entries.map((entry) => buildPatchPathResolutionFailure(entry.index, target.path, resolved));
    }
    const conflicting = target.entries.find(
        ({ operation }) => operation['replace_all'] === true && operation['occurrence_index'] !== undefined,
    );
    if (conflicting) {
        return target.entries.map((entry) => ({
            index: entry.index,
            success: false,
            path: resolved.relative,
            error: 'Same-file patch group aborted because one operation mixes replace_all and occurrence_index.',
            code: entry.index === conflicting.index ? 'ERR_PATCH_CONFLICTING_MODE' : 'ERR_PATCH_BATCH_GROUP_ABORTED',
            groupedSameFile: true,
            expectedHashMode: target.expectedHashMode,
        }));
    }

    const baselineExpectedHash = target.expectedHashMode === 'target-baseline' ? target.expectedHash : undefined;
    try {
        const patch = await patchResolvedTargetBatch(runtime, resolved, {
            operations: target.entries.map((entry) => toLockedPatchBatchOperation(entry.operation)),
            ...(baselineExpectedHash ? { baselineExpectedHash } : {}),
            dryRun,
            captureRollback: false,
            ...createRepositoryPatchResultValidationOption(resolved.relative),
            ...durabilityOption(target.durability),
            advisoryLimits: {
                tool: dryRun ? 'repo_patch_batch_plan' : 'repo_apply_patch_batch',
                groupedSameFile: true,
                operationCount: target.entries.length,
            },
        });
        if (!dryRun) clearRepoReadFileResultCacheForResolvedPath(resolved.resolved);
        return target.entries.map((entry, groupIndex) => {
            const operationResult = /** @type {Record<string, unknown>} */ (patch.operations[groupIndex] ?? {});
            const includeDiffPreview = entry.operation['includeDiffPreview'] === true;
            return {
                index: entry.index,
                success: true,
                path: resolved.relative,
                dryRun,
                occurrences: operationResult['occurrences'],
                replacedOccurrences: operationResult['replacedOccurrences'],
                previousBytes: operationResult['previousBytes'],
                projectedBytes: operationResult['projectedBytes'],
                ...(dryRun
                    ? { projectedHash: operationResult['contentHash'] }
                    : {
                          bytesWritten: groupIndex === target.entries.length - 1 ? patch.bytesWritten : 0,
                          batchBytesWritten: patch.bytesWritten,
                          contentHash: operationResult['contentHash'],
                          traceId: patch.io.traceId ?? null,
                      }),
                byteDelta: operationResult['byteDelta'],
                firstMatchLine: operationResult['firstMatchLine'],
                lastMatchLine: operationResult['lastMatchLine'],
                lineDelta: operationResult['lineDelta'],
                occurrenceIndex: operationResult['occurrenceIndex'],
                previousHash: operationResult['previousHash'],
                noop: operationResult['noop'],
                groupedSameFile: true,
                expectedHashMode: target.expectedHashMode,
                ...maybeDiffPreview(includeDiffPreview, {
                    diff: String(operationResult['diffPreview'] ?? ''),
                    truncated: operationResult['diffPreviewTruncated'] === true,
                    lines: Number(operationResult['diffPreviewLines'] ?? 0),
                    bytes: Number(operationResult['diffPreviewBytes'] ?? 0),
                    contextLines: Number(operationResult['diffContextLines'] ?? 3),
                }),
            };
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorRecord = /** @type {Record<string, unknown>} */ (error && typeof error === 'object' ? error : {});
        const originalCode = typeof errorRecord['code'] === 'string' ? errorRecord['code'] : undefined;
        const failedGroupOperationIndex = Number.isInteger(errorRecord['operationIndex'])
            ? Number(errorRecord['operationIndex'])
            : null;
        const failedEntry =
            failedGroupOperationIndex !== null && failedGroupOperationIndex >= 0
                ? target.entries[failedGroupOperationIndex]
                : undefined;
        const failedOperationIndex = failedEntry?.index ?? null;
        const completedOperationCount = Number.isInteger(errorRecord['completedOperationCount'])
            ? Number(errorRecord['completedOperationCount'])
            : null;
        const failurePhase = typeof errorRecord['failurePhase'] === 'string' ? errorRecord['failurePhase'] : null;
        const details = readRepositoryPatchErrorDetails(error);
        const failedMaterializedOperation = failedEntry
            ? materializeTargetOperation(target, failedEntry.operation)
            : null;
        const groupRecoveryRecipe = failedMaterializedOperation
            ? buildRepositoryPatchRecoveryRecipe(originalCode, details, failedMaterializedOperation, {
                  dryRun,
                  failureScope: 'dependency-group',
              })
            : null;
        return target.entries.map((entry, groupIndex) => {
            const causal = failedGroupOperationIndex === null || groupIndex === failedGroupOperationIndex;
            const rowCode = causal ? originalCode : 'ERR_PATCH_BATCH_GROUP_ABORTED';
            const semantics = classifyRepositoryPatchFailure(rowCode, causal ? details : {}, 'dependency-group');
            return {
                index: entry.index,
                success: false,
                path: resolved.relative,
                error: causal ? message : 'Same-file patch group aborted because another operation failed.',
                code: rowCode,
                ...semantics,
                ...(causal || originalCode === undefined ? {} : { originalCode }),
                groupedSameFile: true,
                groupAborted: true,
                expectedHashMode: target.expectedHashMode,
                failedOperationIndex,
                failedGroupOperationIndex,
                completedOperationCount,
                failurePhase,
                causalFailure: causal,
                ...(causal && Object.keys(details).length > 0 ? { details } : {}),
                ...(causal && groupRecoveryRecipe ? { recoveryRecipe: groupRecoveryRecipe } : {}),
                ...(causal ? { nextAction: buildRepositoryPatchNextAction(originalCode, details) } : {}),
            };
        });
    }
}

/**
 * Execute explicit independent targets through the shared bounded scheduler. No path regrouping occurs here: target
 * identity, baseline hash and durability were already canonicalized at the MCP boundary.
 *
 * @param {RepositoryPatchRuntime} runtime
 * @param {import('./contracts.js').RepositoryPatchTarget[]} targets
 * @param {boolean} dryRun
 * @param {{ failureMode?: 'best-effort' | 'fail-fast'; concurrency?: number; maxTargets?: number; signal?: AbortSignal }} [options]
 */
async function runPatchTargetGroups(runtime, targets, dryRun, options = {}) {
    const execution = await runBoundedOperationBatch(
        targets,
        async (target) => {
            const rows = await runPatchTarget(runtime, target, dryRun);
            return { path: target.path, success: rows.every((row) => row['success'] === true), rows };
        },
        {
            concurrency: options.concurrency ?? 1,
            failureMode: options.failureMode ?? 'best-effort',
            maxItems: resolveRepositoryPatchTargetLimit(options.maxTargets),
            isFailure: (target) => target.success !== true,
        },
    );

    /** @type {Record<string, unknown>[]} */
    const rows = [];
    for (const executionRow of execution.results) {
        const target = targets[executionRow.index];
        if (!target) continue;
        if (executionRow.status === 'skipped') {
            for (const entry of target.entries) {
                rows.push({
                    index: entry.index,
                    success: false,
                    skipped: true,
                    path: target.path,
                    code: 'ERR_PATCH_BATCH_SKIPPED',
                    reason: executionRow.reason,
                });
            }
            continue;
        }
        if (executionRow.status === 'succeeded') {
            rows.push(...executionRow.value.rows);
            continue;
        }
        if ('value' in executionRow && executionRow.value) {
            rows.push(...executionRow.value.rows);
            continue;
        }
        for (const entry of target.entries) {
            rows.push({
                index: entry.index,
                success: false,
                path: target.path,
                code: executionRow.code ?? 'ERR_PATCH_BATCH_TARGET_EXECUTION',
                error: executionRow.error ?? 'Patch target execution failed.',
            });
        }
    }
    return {
        operations: rows.sort((left, right) => Number(left['index'] ?? 0) - Number(right['index'] ?? 0)),
        execution,
    };
}

/**
 * Execute repository patch target groups using one explicit workspace capability.
 *
 * @param {RepositoryPatchWorkspace} workspace
 * @param {import('./contracts.js').RepositoryPatchTarget[]} targets
 * @param {boolean} dryRun
 * @param {{
 *     failureMode?: 'best-effort' | 'fail-fast';
 *     concurrency?: number;
 *     maxTargets?: number;
 *     repositoryPatchConfig: import('#copilot/mcp/public/workspace/repository/patch/config').McpRepositoryPatchConfig;
 *     signal?: AbortSignal;
 * }} options
 */
export function runRepositoryPatchTargetGroups(workspace, targets, dryRun, options) {
    if (!workspace) throw new TypeError('Repository patch execution requires a workspace capability.');
    if (!options?.repositoryPatchConfig) {
        throw new TypeError('Repository patch execution requires a repository patch config projection.');
    }
    resolveRepositoryPatchTargetLimit(options.maxTargets);
    return runPatchTargetGroups(
        createRepositoryPatchRuntime(workspace, options.repositoryPatchConfig, options.signal),
        targets,
        dryRun,
        options,
    );
}
