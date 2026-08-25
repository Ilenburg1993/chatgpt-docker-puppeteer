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
    classifyRepositoryPatchFailure,
    readRepositoryPatchErrorDetails,
} from './failure-semantics.js';
import { createRepositoryPatchResultValidationOption } from './result-validation.js';

const MAX_REPOSITORY_PATCH_TARGETS = 64;

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepositoryPatchWorkspace */
/** @typedef {RepositoryPatchWorkspace['io']} RepositoryPatchIo */
/** @typedef {Readonly<{workspace: RepositoryPatchWorkspace; io: RepositoryPatchIo; signal?: AbortSignal}>} RepositoryPatchRuntime */

/** @param {RepositoryPatchWorkspace} workspace @param {AbortSignal | undefined} signal @returns {RepositoryPatchRuntime} */
function createRepositoryPatchRuntime(workspace, signal) {
    return Object.freeze({ workspace, io: workspace.io, ...(signal ? { signal } : {}) });
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

/**
 * @param {Record<string, unknown>} operation
 * @param {number} index
 * @returns {Promise<Record<string, unknown>>}
 */
async function planPatchBatchOperation(/** @type {RepositoryPatchRuntime} */ runtime, operation, index) {
    const resolved = await runtime.workspace.resolveWritePath(String(operation['path'] ?? ''), {
        issueMutableCapability: true,
    });
    if (!resolved.ok)
        return { index, success: false, path: operation['path'] ?? null, error: resolved.reason, code: resolved.code };
    if (operation['replace_all'] === true && operation['occurrence_index'] !== undefined) {
        return {
            index,
            success: false,
            path: resolved.relative,
            error: 'Use replace_all ou occurrence_index, nao ambos na mesma operacao.',
            code: 'ERR_PATCH_CONFLICTING_MODE',
        };
    }
    try {
        const patch = await patchResolvedTarget(runtime, resolved, {
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
            dryRun: true,
            allowNoop: operation['allowNoop'] === true,
            diffContextLines: optionalInteger(operation['diffContextLines']) ?? 3,
            maxDiffLines: optionalInteger(operation['maxDiffLines']) ?? 160,
            computeDiff: operation['includeDiffPreview'] === true,
            ...createRepositoryPatchResultValidationOption(resolved.relative),
            advisoryLimits: {
                tool: typeof operation['__toolName'] === 'string' ? operation['__toolName'] : 'repo_patch_batch_plan',
                index,
                oldStringChars: String(operation['old_string'] ?? '').length,
                newStringChars: String(operation['new_string'] ?? '').length,
                replaceAll: operation['replace_all'] === true,
                occurrenceIndex: operation['occurrence_index'] ?? null,
                expectedHash: operation['expectedHash'] ?? null,
                dryRun: true,
            },
        });
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
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const details = readRepositoryPatchErrorDetails(error);
        const semantics = classifyRepositoryPatchFailure(code, details, 'target');
        return {
            index,
            success: false,
            path: resolved.relative,
            error: error instanceof Error ? error.message : String(error),
            code,
            ...semantics,
            ...(Object.keys(details).length > 0 ? { details } : {}),
            nextAction: buildRepositoryPatchNextAction(code, details),
        };
    }
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
    if (!resolved.ok)
        return { index, success: false, path: operation['path'] ?? null, error: resolved.reason, code: resolved.code };
    try {
        const patch = await patchResolvedTarget(runtime, resolved, {
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
            dryRun: false,
            captureRollback: false,
            allowNoop: operation['allowNoop'] === true,
            diffContextLines: optionalInteger(operation['diffContextLines']) ?? 3,
            maxDiffLines: optionalInteger(operation['maxDiffLines']) ?? 160,
            computeDiff: operation['includeDiffPreview'] === true,
            ...createRepositoryPatchResultValidationOption(resolved.relative),
            ...durabilityOption(operation['durability']),
            advisoryLimits: {
                tool: typeof operation['__toolName'] === 'string' ? operation['__toolName'] : 'repo_apply_patch_batch',
                index,
                oldStringChars: String(operation['old_string'] ?? '').length,
                newStringChars: String(operation['new_string'] ?? '').length,
                replaceAll: operation['replace_all'] === true,
                occurrenceIndex: operation['occurrence_index'] ?? null,
                expectedHash: operation['expectedHash'] ?? null,
                dryRun: false,
            },
        });
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
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const details = readRepositoryPatchErrorDetails(error);
        const semantics = classifyRepositoryPatchFailure(code, details, 'target');
        return {
            index,
            success: false,
            path: resolved.relative,
            error: error instanceof Error ? error.message : String(error),
            code,
            ...semantics,
            ...(Object.keys(details).length > 0 ? { details } : {}),
            nextAction: buildRepositoryPatchNextAction(code, details),
        };
    }
}

/** @param {Record<string, unknown>} operation */
function readPatchExpectedHash(operation) {
    return typeof operation['expectedHash'] === 'string' && operation['expectedHash']
        ? operation['expectedHash']
        : null;
}

/**
 * @param {Record<string, unknown>} operation
 * @param {{ omitExpectedHash?: boolean }} [options]
 */
function toLockedPatchBatchOperation(operation, options = {}) {
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
        ...(!options.omitExpectedHash && readPatchExpectedHash(operation)
            ? { expectedHash: /** @type {string} */ (readPatchExpectedHash(operation)) }
            : {}),
        allowNoop: operation['allowNoop'] === true,
        diffContextLines: optionalInteger(operation['diffContextLines']) ?? 3,
        maxDiffLines: optionalInteger(operation['maxDiffLines']) ?? 160,
        computeDiff: operation['includeDiffPreview'] === true,
    };
}

/**
 * Infer a target-baseline hash only when the first operation supplies a hash and every supplied hash in the group is
 * identical. Distinct hashes preserve the advanced per-operation virtual-state contract.
 *
 * @param {{ operation: Record<string, unknown>; index: number }[]} group
 */
function buildLockedPatchBatchGroup(group) {
    const firstHash = readPatchExpectedHash(group[0]?.operation ?? {});
    const providedHashes = group
        .map(({ operation }) => readPatchExpectedHash(operation))
        .filter((value) => value !== null);
    const baselineExpectedHash = firstHash && providedHashes.every((value) => value === firstHash) ? firstHash : null;
    return {
        expectedHashMode: baselineExpectedHash ? 'group-baseline' : 'per-operation',
        ...(baselineExpectedHash ? { baselineExpectedHash } : {}),
        operations: group.map(({ operation }) =>
            toLockedPatchBatchOperation(operation, { omitExpectedHash: Boolean(baselineExpectedHash) }),
        ),
    };
}

/**
 * Run patch-batch planning/application while collapsing repeated same-file operations into one lock/read/write cycle.
 * Same-file operations are sequential and atomic; distinct files preserve the existing partial-batch behavior.
 *
 * @param {Record<string, unknown>[]} operations
 * @param {boolean} dryRun
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function runPatchBatchOperations(/** @type {RepositoryPatchRuntime} */ runtime, operations, dryRun) {
    /** @type {Map<string, { operation: Record<string, unknown>; index: number }[]>} */
    const groups = new Map();
    for (const [index, operation] of operations.entries()) {
        const key = String(operation['path'] ?? '');
        const group = groups.get(key) ?? [];
        group.push({ operation, index });
        groups.set(key, group);
    }

    /** @type {Record<string, unknown>[]} */
    const results = [];
    for (const group of groups.values()) {
        throwIfRepositoryPatchAborted(runtime);
        if (group.length === 1) {
            const entry = /** @type {{ operation: Record<string, unknown>; index: number }} */ (group[0]);
            results.push(
                dryRun
                    ? await planPatchBatchOperation(runtime, entry.operation, entry.index)
                    : await applyPatchBatchOperation(runtime, entry.operation, entry.index),
            );
            if (results.at(-1)?.['success'] !== true && !dryRun) break;
            continue;
        }

        const first = /** @type {{ operation: Record<string, unknown>; index: number }} */ (group[0]);
        const resolved = await runtime.workspace.resolveWritePath(String(first.operation['path'] ?? ''), {
            issueMutableCapability: true,
        });
        if (!resolved.ok) {
            for (const entry of group) {
                results.push({
                    index: entry.index,
                    success: false,
                    path: entry.operation['path'] ?? null,
                    error: resolved.reason,
                    code: resolved.code,
                });
            }
            if (!dryRun) break;
            continue;
        }
        const conflicting = group.find(
            ({ operation }) => operation['replace_all'] === true && operation['occurrence_index'] !== undefined,
        );
        if (conflicting) {
            for (const entry of group) {
                results.push({
                    index: entry.index,
                    success: false,
                    path: resolved.relative,
                    error: 'Same-file patch group aborted because one operation mixes replace_all and occurrence_index.',
                    code:
                        entry.index === conflicting.index
                            ? 'ERR_PATCH_CONFLICTING_MODE'
                            : 'ERR_PATCH_BATCH_GROUP_ABORTED',
                    groupedSameFile: true,
                });
            }
            if (!dryRun) break;
            continue;
        }

        const lockedGroup = buildLockedPatchBatchGroup(group);
        try {
            const patch = await patchResolvedTargetBatch(runtime, resolved, {
                operations: lockedGroup.operations,
                ...(lockedGroup.baselineExpectedHash ? { baselineExpectedHash: lockedGroup.baselineExpectedHash } : {}),
                dryRun,
                captureRollback: false,
                ...createRepositoryPatchResultValidationOption(resolved.relative),
                ...durabilityOption(first.operation['durability']),
                advisoryLimits: {
                    tool: dryRun ? 'repo_patch_batch_plan' : 'repo_apply_patch_batch',
                    groupedSameFile: true,
                    operationCount: group.length,
                },
            });
            if (!dryRun) clearRepoReadFileResultCacheForResolvedPath(resolved.resolved);
            for (const [groupIndex, entry] of group.entries()) {
                const operationResult = /** @type {Record<string, unknown>} */ (patch.operations[groupIndex] ?? {});
                const includeDiffPreview = entry.operation['includeDiffPreview'] === true;
                results.push({
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
                              bytesWritten: groupIndex === group.length - 1 ? patch.bytesWritten : 0,
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
                    expectedHashMode: lockedGroup.expectedHashMode,
                    ...maybeDiffPreview(includeDiffPreview, {
                        diff: String(operationResult['diffPreview'] ?? ''),
                        truncated: operationResult['diffPreviewTruncated'] === true,
                        lines: Number(operationResult['diffPreviewLines'] ?? 0),
                        bytes: Number(operationResult['diffPreviewBytes'] ?? 0),
                        contextLines: Number(operationResult['diffContextLines'] ?? 3),
                    }),
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errorRecord = /** @type {Record<string, unknown>} */ (
                error && typeof error === 'object' ? error : {}
            );
            const originalCode = typeof errorRecord['code'] === 'string' ? errorRecord['code'] : undefined;
            const failedGroupOperationIndex = Number.isInteger(errorRecord['operationIndex'])
                ? Number(errorRecord['operationIndex'])
                : null;
            const failedEntry =
                failedGroupOperationIndex !== null && failedGroupOperationIndex >= 0
                    ? group[failedGroupOperationIndex]
                    : undefined;
            const failedOperationIndex = failedEntry?.index ?? null;
            const completedOperationCount = Number.isInteger(errorRecord['completedOperationCount'])
                ? Number(errorRecord['completedOperationCount'])
                : null;
            const failurePhase = typeof errorRecord['failurePhase'] === 'string' ? errorRecord['failurePhase'] : null;
            const details = readRepositoryPatchErrorDetails(error);
            for (const [groupIndex, entry] of group.entries()) {
                const causal = failedGroupOperationIndex === null || groupIndex === failedGroupOperationIndex;
                const rowCode = causal ? originalCode : 'ERR_PATCH_BATCH_GROUP_ABORTED';
                const semantics = classifyRepositoryPatchFailure(
                    rowCode,
                    causal ? details : {},
                    group.length > 1 ? 'dependency-group' : 'target',
                );
                results.push({
                    index: entry.index,
                    success: false,
                    path: resolved.relative,
                    error: causal ? message : 'Same-file patch group aborted because another operation failed.',
                    code: rowCode,
                    ...semantics,
                    ...(causal || originalCode === undefined ? {} : { originalCode }),
                    groupedSameFile: true,
                    groupAborted: true,
                    expectedHashMode: lockedGroup.expectedHashMode,
                    failedOperationIndex,
                    failedGroupOperationIndex,
                    completedOperationCount,
                    failurePhase,
                    causalFailure: causal,
                    ...(causal && Object.keys(details).length > 0 ? { details } : {}),
                    ...(causal ? { nextAction: buildRepositoryPatchNextAction(originalCode, details) } : {}),
                });
            }
            if (!dryRun) break;
        }
    }
    return results.sort((left, right) => Number(left['index'] ?? 0) - Number(right['index'] ?? 0));
}

/**
 * Execute independent patch targets through the shared bulk scheduler. Same-path operations continue to use
 * runPatchBatchOperations, which collapses them into one patchTextBatchLocked lock/read/write cycle.
 *
 * @param {Record<string, unknown>[]} operations
 * @param {boolean} dryRun
 * @param {{ failureMode?: 'best-effort' | 'fail-fast'; concurrency?: number; maxTargets?: number; signal?: AbortSignal }} [options]
 */
async function runPatchBatchTargetGroups(
    /** @type {RepositoryPatchRuntime} */ runtime,
    operations,
    dryRun,
    options = {},
) {
    /** @type {{ path: string; entries: { operation: Record<string, unknown>; index: number }[] }[]} */
    const groups = [];
    /** @type {Map<string, (typeof groups)[number]>} */
    const byPath = new Map();
    for (const [index, operation] of operations.entries()) {
        const pathKey = String(operation['path'] ?? '');
        let group = byPath.get(pathKey);
        if (!group) {
            group = { path: pathKey, entries: [] };
            byPath.set(pathKey, group);
            groups.push(group);
        }
        group.entries.push({ operation, index });
    }

    const execution = await runBoundedOperationBatch(
        groups,
        async (group) => {
            throwIfRepositoryPatchAborted(runtime);
            const local = await runPatchBatchOperations(
                runtime,
                group.entries.map((entry) => entry.operation),
                dryRun,
            );
            const rows = local.map((row) => {
                const localIndex = Number(row['index'] ?? 0);
                const originalIndex = group.entries[localIndex]?.index ?? localIndex;
                return /** @type {Record<string, unknown>} */ ({ ...row, index: originalIndex });
            });
            return { path: group.path, success: rows.every((row) => row['success'] === true), rows };
        },
        {
            concurrency: options.concurrency ?? 1,
            failureMode: options.failureMode ?? 'best-effort',
            maxItems: resolveRepositoryPatchTargetLimit(options.maxTargets),
            isFailure: (group) => group.success !== true,
        },
    );

    /** @type {Record<string, unknown>[]} */
    const rows = [];
    for (const executionRow of execution.results) {
        const group = groups[executionRow.index];
        if (!group) continue;
        if (executionRow.status === 'skipped') {
            for (const entry of group.entries) {
                rows.push({
                    index: entry.index,
                    success: false,
                    skipped: true,
                    path: entry.operation['path'] ?? null,
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
        for (const entry of group.entries) {
            rows.push({
                index: entry.index,
                success: false,
                path: entry.operation['path'] ?? null,
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
 * @param {Record<string, unknown>[]} operations
 * @param {boolean} dryRun
 * @param {{ failureMode?: 'best-effort' | 'fail-fast'; concurrency?: number; maxTargets?: number; signal?: AbortSignal }} [options]
 */
export function runRepositoryPatchTargetGroups(workspace, operations, dryRun, options = {}) {
    if (!workspace) throw new TypeError('Repository patch execution requires a workspace capability.');
    resolveRepositoryPatchTargetLimit(options.maxTargets);
    return runPatchBatchTargetGroups(
        createRepositoryPatchRuntime(workspace, options.signal),
        operations,
        dryRun,
        options,
    );
}
