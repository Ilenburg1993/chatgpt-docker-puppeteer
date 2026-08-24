// @ts-check
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
        return 'The target is outside the permitted repository write policy or is sensitive/binary; inspect the path-policy reason.';
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
    for (const row of reported) {
        const code = String(row['code'] ?? 'ERR_PATCH_BATCH_TARGET_EXECUTION');
        causalByCode[code] = (causalByCode[code] ?? 0) + 1;
        const failureClass = String(row['failureClass'] ?? 'unknown');
        failureClassCounts[failureClass] = (failureClassCounts[failureClass] ?? 0) + 1;
        const retryability = String(row['retryability'] ?? 'caller-refresh');
        retryabilityCounts[retryability] = (retryabilityCounts[retryability] ?? 0) + 1;
        if (row['recoveryRequired'] !== false) recoveryRequiredTargetCount += 1;
        if (row['convergenceCandidate'] === true) convergenceCandidateCount += 1;
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
    };
}
