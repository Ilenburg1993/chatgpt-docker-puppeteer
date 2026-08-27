// @ts-check
import { createMcpRecoveryRecipe } from '#copilot/mcp/public/protocol/tools/recovery';

/**
 * Repository patch failure semantics.
 *
 * This owner interprets exact-patch failures independently from MCP wire/result transport. It turns low-level patch
 * evidence into stable recovery semantics that can be reused by single-target and batched repository operations.
 *
 * @module copilot/mcp/workspace/repository/patch/failure-semantics
 */

/** @param {unknown} error */
export function readRepositoryPatchErrorDetails(error) {
    if (!error || typeof error !== 'object') return {};
    const details = /** @type {Record<string, unknown>} */ (error)['details'];
    return details && typeof details === 'object' && !Array.isArray(details)
        ? /** @type {Record<string, unknown>} */ (details)
        : {};
}

/**
 * Classify a patch failure independently from transport success. This metadata is advisory for recovery planning and
 * never weakens the mutation precondition that produced the error.
 *
 * @param {unknown} code
 * @param {Record<string, unknown>} [details]
 * @param {'operation' | 'target' | 'dependency-group'} [failureScope]
 */
export function classifyRepositoryPatchFailure(code, details = {}, failureScope = 'target') {
    const normalizedCode = typeof code === 'string' ? code : 'ERR_PATCH_UNKNOWN';
    const convergenceCandidate = details['convergenceCandidate'] === true;
    let failureClass = 'unknown';
    let retryability = 'caller-refresh';
    let mutationState = 'none';
    let recoveryRequired = true;

    if (normalizedCode === 'ERR_PATCH_NOT_FOUND') {
        const virtualBatchState = details['currentStateKind'] === 'virtual-batch';
        const exactContextMismatch =
            Number(details['quoteEscapeNormalizedOccurrenceCount'] ?? 0) > 0 ||
            Number(details['lineEndingNormalizedOccurrenceCount'] ?? 0) > 0 ||
            Number(details['whitespaceNormalizedOccurrenceCount'] ?? 0) > 0;
        failureClass = convergenceCandidate
            ? 'already-converged-candidate'
            : virtualBatchState
              ? 'virtual-batch-context'
              : exactContextMismatch
                ? 'exact-context-mismatch'
                : 'stale-context';
        retryability =
            convergenceCandidate || exactContextMismatch || virtualBatchState ? 'manual-decision' : 'caller-refresh';
        mutationState = convergenceCandidate ? 'already-converged-candidate' : 'none';
        recoveryRequired = !convergenceCandidate && !virtualBatchState;
    } else if (
        normalizedCode === 'ERR_PATCH_AMBIGUOUS_MATCH' ||
        normalizedCode === 'ERR_PATCH_EXPECTED_OCCURRENCES' ||
        normalizedCode === 'ERR_PATCH_OCCURRENCE_INDEX_OUT_OF_RANGE'
    ) {
        failureClass = 'ambiguous-context';
        retryability = 'manual-decision';
    } else if (normalizedCode === 'ERR_PATCH_INVALID_JSON_RESULT') {
        failureClass = 'result-validation';
        retryability = 'manual-decision';
        recoveryRequired = false;
    } else if (normalizedCode === 'EEXPECTEDHASH' || normalizedCode === 'ERR_PATH_DENIED') {
        failureClass = 'integrity';
        retryability = normalizedCode === 'EEXPECTEDHASH' ? 'caller-refresh' : 'manual-decision';
        if (normalizedCode === 'ERR_PATH_DENIED') recoveryRequired = false;
    } else if (normalizedCode === 'ENOENT') {
        failureClass = 'target-missing';
        retryability = 'manual-decision';
        recoveryRequired = false;
    } else if (normalizedCode === 'EISDIR' || normalizedCode === 'ENOTDIR') {
        failureClass = 'target-kind';
        retryability = 'manual-decision';
        recoveryRequired = false;
    } else if (
        normalizedCode === 'ERR_EMPTY_PATH' ||
        normalizedCode === 'ERR_NULL_BYTE_PATH' ||
        normalizedCode === 'ERR_INVALID_PATH'
    ) {
        failureClass = 'shape-config';
        retryability = 'manual-decision';
        recoveryRequired = false;
    } else if (normalizedCode === 'ERR_PATCH_BATCH_GROUP_ABORTED') {
        failureClass = 'dependency-abort';
        retryability = 'non-retryable';
        recoveryRequired = false;
    } else if (normalizedCode === 'ERR_PATCH_NOOP') {
        failureClass = 'already-converged';
        retryability = 'non-retryable';
        mutationState = 'already-converged';
        recoveryRequired = false;
    } else if (
        normalizedCode === 'ERR_PATCH_CONFLICTING_MODE' ||
        normalizedCode === 'ERR_PATCH_INVALID_OLD_STRING' ||
        normalizedCode === 'ERR_PATCH_INVALID_NEW_STRING' ||
        normalizedCode === 'ERR_PATCH_INVALID_OCCURRENCE_INDEX'
    ) {
        failureClass = 'shape-config';
        retryability = 'non-retryable';
    }

    return {
        failureClass,
        failureScope,
        retryability,
        mutationState,
        recoveryRequired,
        ...(convergenceCandidate ? { convergenceCandidate: true } : {}),
    };
}

/** @param {unknown} value */
function isSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

/**
 * Build a machine-readable recovery recipe without weakening the failed mutation preconditions.
 * A retry-safe recipe is deliberately narrower than the textual nextAction guidance.
 *
 * @param {unknown} code
 * @param {Record<string, unknown>} details
 * @param {Record<string, unknown>} operation
 * @param {{ dryRun?: boolean; failureScope?: 'operation' | 'target' | 'dependency-group' }} [options]
 */
export function buildRepositoryPatchRecoveryRecipe(code, details, operation, options = {}) {
    const failureScope = options.failureScope ?? 'target';
    const path = typeof operation['path'] === 'string' && operation['path'] ? operation['path'] : null;
    const currentHash = isSha256(details['currentHash']) ? /** @type {string} */ (details['currentHash']) : null;
    const recoveryOldString =
        typeof details['recoveryOldString'] === 'string' && details['recoveryOldString'].length > 0
            ? details['recoveryOldString']
            : null;
    const callerBoundHash = typeof operation['expectedHash'] === 'string' && operation['expectedHash'].length > 0;
    const hasSelectorSemantics =
        operation['replace_all'] === true ||
        operation['expected_occurrences'] !== undefined ||
        operation['occurrence_index'] !== undefined;

    if (code === 'ERR_PATCH_NOOP' || details['convergenceCandidate'] === true) {
        return createMcpRecoveryRecipe({
            disposition: 'no-retry',
            scope: failureScope,
            reasonCode: 'patch-already-converged',
            preconditions: ['Do not repeat the unchanged mutation.'],
        });
    }

    if (code === 'ERR_PATCH_BATCH_GROUP_ABORTED' || failureScope === 'dependency-group') {
        return createMcpRecoveryRecipe({
            disposition: 'manual',
            scope: 'dependency-group',
            reasonCode: 'patch-dependent-group-requires-replan',
            preconditions: ['Retrying one dependent same-file operation in isolation is not safe.'],
        });
    }

    if (code === 'EEXPECTEDHASH' && path) {
        return createMcpRecoveryRecipe({
            disposition: 'suggested',
            scope: failureScope,
            reasonCode: 'patch-refresh-target-hash',
            suggestedInvocation: {
                tool: 'repo_file_stats',
                args: { path, includeHash: true },
            },
            preconditions: ['A refreshed hash is diagnostic evidence, not permission to override caller intent.'],
        });
    }

    if (code === 'ERR_PATCH_NOT_FOUND' && details['currentStateKind'] === 'virtual-batch') {
        return createMcpRecoveryRecipe({
            disposition: 'manual',
            scope: 'dependency-group',
            reasonCode: 'patch-virtual-state-requires-group-replan',
            preconditions: ['Preserve same-file operation ordering and virtual-state semantics.'],
        });
    }

    const exactRecoveryProven =
        code === 'ERR_PATCH_NOT_FOUND' &&
        details['recoveryExactAnchor'] === true &&
        details['recoveryRereadRequired'] !== true &&
        recoveryOldString !== null &&
        currentHash !== null &&
        path !== null &&
        typeof operation['new_string'] === 'string';

    if (exactRecoveryProven && !callerBoundHash && !hasSelectorSemantics && failureScope === 'target') {
        const args = {
            path,
            old_string: recoveryOldString,
            new_string: operation['new_string'],
            expectedHash: currentHash,
            dryRun: options.dryRun === true,
            ...(operation['allowNoop'] === true ? { allowNoop: true } : {}),
            ...(Number.isInteger(operation['diffContextLines'])
                ? { diffContextLines: operation['diffContextLines'] }
                : {}),
            ...(Number.isInteger(operation['maxDiffLines']) ? { maxDiffLines: operation['maxDiffLines'] } : {}),
            ...(operation['includeDiffPreview'] === true ? { includeDiffPreview: true } : {}),
            ...(options.dryRun !== true && typeof operation['durability'] === 'string'
                ? { durability: operation['durability'] }
                : {}),
        };
        return createMcpRecoveryRecipe({
            disposition: 'retry-safe',
            scope: 'target',
            reasonCode: 'patch-exact-anchor-same-snapshot',
            retryInvocation: { tool: 'repo_apply_patch', args },
            preconditions: [
                'The recovery anchor was proven unique against the same failed snapshot.',
                'The retry is hash-bound to that snapshot.',
                'No caller-supplied expectedHash or cardinality selector is being replaced.',
            ],
        });
    }

    if (exactRecoveryProven) {
        return createMcpRecoveryRecipe({
            disposition: 'manual',
            scope: failureScope,
            reasonCode: callerBoundHash
                ? 'patch-caller-hash-must-not-be-overridden'
                : hasSelectorSemantics
                  ? 'patch-selector-semantics-must-be-preserved'
                  : 'patch-recovery-scope-not-independent',
            preconditions: [
                'Exact recovery evidence exists, but automatic invocation reconstruction would change caller semantics.',
            ],
        });
    }

    if (
        code === 'ERR_PATCH_AMBIGUOUS_MATCH' ||
        code === 'ERR_PATCH_EXPECTED_OCCURRENCES' ||
        code === 'ERR_PATCH_OCCURRENCE_INDEX_OUT_OF_RANGE'
    ) {
        return createMcpRecoveryRecipe({
            disposition: 'manual',
            scope: failureScope,
            reasonCode: 'patch-ambiguous-selection-requires-choice',
        });
    }

    return null;
}

/** @param {unknown} code @param {Record<string, unknown>} [details] */
export function buildRepositoryPatchNextAction(code, details = {}) {
    if (code === 'ERR_PATCH_AMBIGUOUS_MATCH') {
        const lines = Array.isArray(details['occurrenceLines']) ? details['occurrenceLines'] : [];
        return lines.length > 0
            ? `Retry with occurrence_index=1..${String(lines.length)} using occurrenceLines=${JSON.stringify(lines)}, or send a more specific old_string.`
            : 'Retry with occurrence_index or send a more specific old_string.';
    }
    if (code === 'ERR_PATCH_EXPECTED_OCCURRENCES') {
        return 'Adjust expected_occurrences from the returned occurrence evidence, or refine old_string.';
    }
    if (code === 'ERR_PATCH_NOOP') {
        return 'This operation is already a no-op. Remove it from the batch, change new_string, or use allowNoop=true when an intentional idempotent no-op is part of the plan.';
    }
    if (code === 'EEXPECTEDHASH') {
        return 'Refresh only this target hash and retry; other independent targets need not be repeated.';
    }
    if (code === 'ERR_PATCH_INVALID_JSON_RESULT') {
        return 'The computed patch result is invalid JSON and was not published. Fix new_string or group dependent JSON edits into one atomic same-file batch whose final state parses successfully; no recovery reread is required.';
    }
    if (code === 'ERR_PATH_DENIED') {
        return 'The target is outside the permitted repository write policy or is sensitive/binary; inspect the path-policy reason. A reread will not bypass this policy.';
    }
    if (code === 'ERR_EMPTY_PATH') {
        return 'Provide a non-empty workspace-relative target path; no recovery reread is required.';
    }
    if (code === 'ERR_NULL_BYTE_PATH') {
        return 'Remove the null byte from the target path and retry; no recovery reread is required.';
    }
    if (code === 'ERR_INVALID_PATH') {
        return 'Correct the workspace-relative target path according to the returned path-policy reason; no recovery reread is required.';
    }
    if (code === 'ENOENT') {
        return 'The patch target does not exist. Verify the exact path or use the governed create-file workflow when creation is intended; do not retry the unchanged patch.';
    }
    if (code === 'EISDIR' || code === 'ENOTDIR') {
        return 'Patch requires an existing regular-file target. Correct the file/directory path mismatch before retrying; no recovery reread is required.';
    }
    if (code === 'ERR_PATCH_NOT_FOUND') {
        if (
            details['recoveryExactAnchor'] === true &&
            typeof details['recoveryOldString'] === 'string' &&
            typeof details['currentHash'] === 'string'
        ) {
            return 'Retry this target directly with details.recoveryOldString as old_string and details.currentHash as expectedHash. The exact recovery anchor was proven unique against the same failed snapshot, so no reread is required.';
        }
        if (details['currentStateKind'] === 'virtual-batch') {
            return 'The anchor is missing from the in-memory virtual state produced by earlier same-file batch operations. diskBaselineHash/diskBaselineBytes identify the unchanged locked file baseline; refine batch ordering/anchors instead of assuming external modification or rereading solely for staleness.';
        }
        if (details['convergenceCandidate'] === true) {
            return 'Do not repeat the unchanged patch: new_string is already present exactly once. Treat this as a convergence candidate, or review intent using currentHash without rereading solely for diagnosis.';
        }
        if (Number(details['quoteEscapeNormalizedOccurrenceCount'] ?? 0) > 0) {
            return 'old_string matches after removing literal quote escapes. Retry with exact source quotes and currentHash; this is an encoding mismatch, not evidence of concurrent modification.';
        }
        if (Number(details['lineEndingNormalizedOccurrenceCount'] ?? 0) > 0) {
            return `old_string matches after line-ending normalization; retry with newlineStyle=${String(details['newlineStyle'] ?? 'current')} and currentHash.`;
        }
        if (Number(details['whitespaceNormalizedOccurrenceCount'] ?? 0) > 0) {
            return 'old_string matches after bounded whitespace normalization. Use candidateLines/currentHash to refine the exact anchor.';
        }
        const candidateLines = Array.isArray(details['candidateLines']) ? details['candidateLines'] : [];
        if (candidateLines.length > 0) {
            return `Exact old_string is stale, but related fragments exist near candidateLines=${JSON.stringify(candidateLines)}. Inspect only that bounded region if needed, then retry only this target.`;
        }
        return 'Refresh only this target or refine old_string; other independent targets need not be repeated.';
    }
    return 'Retry only the failed target after inspecting its causal error.';
}

/** @param {Record<string, unknown>[]} rows */
export function compactRepositoryPatchFailureRows(rows) {
    /** @type {Map<string, Record<string, unknown>[]>} */
    const groups = new Map();
    for (const row of rows) {
        const key = typeof row['path'] === 'string' ? row['path'] : `#${String(row['index'] ?? groups.size)}`;
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
    }
    return [...groups.values()].map((group) => {
        const ordered = [...group].sort((left, right) => Number(left['index'] ?? 0) - Number(right['index'] ?? 0));
        const causal =
            ordered.find((row) => row['causalFailure'] === true) ??
            ordered.find((row) => row['code'] !== 'ERR_PATCH_BATCH_GROUP_ABORTED') ??
            ordered[0] ??
            {};
        const details =
            causal['details'] && typeof causal['details'] === 'object' && !Array.isArray(causal['details'])
                ? /** @type {Record<string, unknown>} */ (causal['details'])
                : {};
        return {
            index: causal['index'],
            success: false,
            path: causal['path'] ?? null,
            code: causal['code'] ?? 'ERR_PATCH_BATCH_TARGET_EXECUTION',
            error: causal['error'] ?? causal['reason'] ?? 'Patch target failed.',
            failureClass: causal['failureClass'] ?? 'unknown',
            failureScope: causal['failureScope'] ?? 'target',
            retryability: causal['retryability'] ?? 'caller-refresh',
            mutationState: causal['mutationState'] ?? 'none',
            recoveryRequired: causal['recoveryRequired'] !== false,
            ...(causal['convergenceCandidate'] === true ? { convergenceCandidate: true } : {}),
            affectedOperationIndices: ordered.map((row) => Number(row['index'] ?? 0)),
            affectedOperationCount: ordered.length,
            abortedOperationCount: ordered.filter((row) => row['code'] === 'ERR_PATCH_BATCH_GROUP_ABORTED').length,
            ...(Object.keys(details).length > 0 ? { details } : {}),
            ...(causal['recoveryRecipe'] && typeof causal['recoveryRecipe'] === 'object'
                ? { recoveryRecipe: causal['recoveryRecipe'] }
                : {}),
            ...(causal['exactSelfRepair'] && typeof causal['exactSelfRepair'] === 'object'
                ? { exactSelfRepair: causal['exactSelfRepair'] }
                : {}),
            nextAction:
                typeof causal['nextAction'] === 'string'
                    ? causal['nextAction']
                    : buildRepositoryPatchNextAction(causal['code'], details),
        };
    });
}

/** @param {Record<string, unknown>[]} rows */
export function summarizeRepositoryPatchFailures(rows) {
    const reported = compactRepositoryPatchFailureRows(rows);
    /** @type {Record<string, number>} */
    const causalByCode = {};
    /** @type {Record<string, number>} */
    const failureClassCounts = {};
    /** @type {Record<string, number>} */
    const retryabilityCounts = {};
    let recoveryRequiredTargetCount = 0;
    let convergenceCandidateCount = 0;
    let recoveryRecipeTargetCount = 0;
    let retrySafeRecoveryRecipeTargetCount = 0;
    let suggestedRecoveryRecipeTargetCount = 0;
    for (const row of reported) {
        const code = String(row['code'] ?? 'ERR_PATCH_BATCH_TARGET_EXECUTION');
        causalByCode[code] = (causalByCode[code] ?? 0) + 1;
        const failureClass = String(row['failureClass'] ?? 'unknown');
        failureClassCounts[failureClass] = (failureClassCounts[failureClass] ?? 0) + 1;
        const retryability = String(row['retryability'] ?? 'caller-refresh');
        retryabilityCounts[retryability] = (retryabilityCounts[retryability] ?? 0) + 1;
        if (row['recoveryRequired'] !== false) recoveryRequiredTargetCount += 1;
        if (row['convergenceCandidate'] === true) convergenceCandidateCount += 1;
        const recipe = row['recoveryRecipe'];
        if (recipe && typeof recipe === 'object' && !Array.isArray(recipe)) {
            recoveryRecipeTargetCount += 1;
            const disposition = /** @type {Record<string, unknown>} */ (recipe)['disposition'];
            if (disposition === 'retry-safe') retrySafeRecoveryRecipeTargetCount += 1;
            if (disposition === 'suggested') suggestedRecoveryRecipeTargetCount += 1;
        }
    }
    return {
        failedOperationCount: rows.length,
        failedTargetCount: reported.length,
        causalFailureCount: reported.length,
        abortedOperationCount: rows.filter((row) => row['code'] === 'ERR_PATCH_BATCH_GROUP_ABORTED').length,
        causalByCode,
        failureClassCounts,
        retryabilityCounts,
        recoveryRequiredTargetCount,
        convergenceCandidateCount,
        recoveryRecipeTargetCount,
        retrySafeRecoveryRecipeTargetCount,
        suggestedRecoveryRecipeTargetCount,
    };
}
