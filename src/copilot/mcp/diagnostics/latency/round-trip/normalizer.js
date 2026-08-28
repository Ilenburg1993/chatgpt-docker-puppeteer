// @ts-check
/** Sanitized MCP audit-event normalizer for the rebuildable round-trip index. */

export const MCP_ROUND_TRIP_NORMALIZER_VERSION = 11;

export const MCP_TOOL_CALL_TERMINAL_EVENTS = Object.freeze([
    'tool_call_completed',
    'tool_call_failed',
    'tool_call_rate_limited',
    'tool_call_auth_denied',
    'tool_call_result_rejected',
]);

const INDEXED_EVENTS = Object.freeze([
    'tool_call_started',
    ...MCP_TOOL_CALL_TERMINAL_EVENTS,
    'repo_apply_patch_failed',
    'repo_apply_patch_batch_preflight_blocked',
    'repo_apply_patch_batch_partial_failure',
    'repo_apply_patch_batch_applied',
    'repo_apply_patch_batch_post_validation',
]);

/** @param {Record<string, unknown>} event */
export function normalizeMcpRoundTripAuditEvent(event) {
    const eventName = stringOrNull(event['event']);
    if (!eventName || !INDEXED_EVENTS.includes(eventName)) return null;
    const tsMs = Date.parse(String(event['ts'] ?? ''));
    if (!Number.isFinite(tsMs)) return null;
    const path = stringOrNull(event['path']);
    return {
        tsMs: Math.trunc(tsMs),
        event: eventName,
        tool: stringOrNull(event['tool']),
        callId: boundedStringOrNull(event['callId'], 128),
        traceKey: boundedHexOrNull(event['traceKey'], 64),
        traceContextState: boundedStringOrNull(event['traceContextState'], 40),
        targetPrecision: boundedStringOrNull(event['targetPrecision'], 32),
        targetKeysJson: boundedStringArrayJsonOrNull(event['targetKeys'], 64, 96),
        runtimeEpochId: boundedStringOrNull(event['runtimeEpochId'], 128),
        runtimeSourceBinding: boundedStringOrNull(event['runtimeSourceBinding'], 64),
        runtimeSourceFingerprint: boundedHexOrNull(event['runtimeSourceFingerprint'], 128),
        durationMs: integerOrNull(event['durationMs']),
        isError: boolInt(event['isError']),
        code: stringOrNull(event['code']),
        resultCode: boundedMachineCodeOrNull(event['resultCode']),
        resultState: enumOrNull(event['resultState'], ['success', 'tool-error', 'domain-failure']),
        resultClass: enumOrNull(event['resultClass'], [
            'success',
            'option-config',
            'precondition',
            'domain-or-unknown',
            'uncoded-failure',
        ]),
        recoveryRecipeCount: nonNegativeIntegerOrNull(event['recoveryRecipeCount']),
        retrySafeRecoveryRecipeCount: nonNegativeIntegerOrNull(event['retrySafeRecoveryRecipeCount']),
        suggestedRecoveryRecipeCount: nonNegativeIntegerOrNull(event['suggestedRecoveryRecipeCount']),
        manualRecoveryRecipeCount: nonNegativeIntegerOrNull(event['manualRecoveryRecipeCount']),
        noRetryRecoveryRecipeCount: nonNegativeIntegerOrNull(event['noRetryRecoveryRecipeCount']),
        exactSelfRepairAttemptedCount: nonNegativeIntegerOrNull(event['exactSelfRepairAttemptedCount']),
        exactSelfRepairSucceededCount: nonNegativeIntegerOrNull(event['exactSelfRepairSucceededCount']),
        exactSelfRepairFailedClosedCount: nonNegativeIntegerOrNull(event['exactSelfRepairFailedClosedCount']),
        optionContractVersion: boundedStringOrNull(event['optionContractVersion'], 32),
        optionPolicyCoverage: enumOrNull(event['optionPolicyCoverage'], ['complete']),
        optionMode: boundedStringOrNull(event['optionMode'], 48),
        optionDeclaredCount: nonNegativeIntegerOrNull(event['optionDeclaredCount']),
        optionRequestedCount: nonNegativeIntegerOrNull(event['optionRequestedCount']),
        optionEffectiveRequestedCount: nonNegativeIntegerOrNull(event['optionEffectiveRequestedCount']),
        optionDefaultedCount: nonNegativeIntegerOrNull(event['optionDefaultedCount']),
        optionNormalizedCount: nonNegativeIntegerOrNull(event['optionNormalizedCount']),
        optionIgnoredCount: nonNegativeIntegerOrNull(event['optionIgnoredCount']),
        optionCoercedCount: nonNegativeIntegerOrNull(event['optionCoercedCount']),
        optionRejectedCount: nonNegativeIntegerOrNull(event['optionRejectedCount']),
        optionConflictCount: nonNegativeIntegerOrNull(event['optionConflictCount']),
        logicalOperations: positiveIntegerOrNull(event['logicalOperations']),
        failedOperations: nonNegativeIntegerOrNull(event['failedOperations']),
        skippedOperations: nonNegativeIntegerOrNull(event['skippedOperations']),
        executionMode: boundedStringOrNull(event['executionMode'], 96),
        executionPolicyClass: enumOrNull(event['executionPolicyClass'], [
            'dry-run',
            'preflight-blocked',
            'direct-apply',
            'preflight-gated-apply',
            'atomic-preflight-elided-apply',
        ]),
        executionFailurePolicyClass: enumOrNull(event['executionFailurePolicyClass'], ['best-effort', 'fail-fast']),
        executionConcurrencyClass: enumOrNull(event['executionConcurrencyClass'], ['sequential', 'parallel-bounded']),
        batchSize: positiveIntegerOrNull(event['batchSize']),
        batchCapacity: positiveIntegerOrNull(event['batchCapacity']),
        resultBudgetBytes: nonNegativeIntegerOrNull(event['resultBudgetBytes']),
        truncatedOperations: nonNegativeIntegerOrNull(event['truncatedOperations']),
        legacyContinuationRequired: boolInt(event['continuationRequired']),
        continuationAvailable: boolInt(event['continuationAvailable']),
        continuationAvailableOperations: nonNegativeIntegerOrNull(event['continuationAvailableOperations']),
        continuationTransportRequired: boolInt(event['continuationTransportRequired']),
        continuationTransportRequiredOperations: nonNegativeIntegerOrNull(
            event['continuationTransportRequiredOperations'],
        ),
        continuationRecommended: boolInt(event['continuationRecommended']),
        continuationRecommendedOperations: nonNegativeIntegerOrNull(event['continuationRecommendedOperations']),
        resultBytes: nonNegativeIntegerOrNull(event['resultBytes']),
        resultSizeStrategy: boundedStringOrNull(event['resultSizeStrategy'], 32),
        textResultBytes: nonNegativeIntegerOrNull(event['textResultBytes']),
        nonTextResultBytes: nonNegativeIntegerOrNull(event['nonTextResultBytes']),
        duplicateTextBytes: nonNegativeIntegerOrNull(event['duplicateTextBytes']),
        failureClass: stringOrNull(event['failureClass']),
        retryability: stringOrNull(event['retryability']),
        causalByCodeJson: countMapJsonOrNull(event['causalByCode']),
        failureClassCountsJson: countMapJsonOrNull(event['failureClassCounts']),
        retryabilityCountsJson: countMapJsonOrNull(event['retryabilityCounts']),
        recoveryRequired: boolInt(event['recoveryRequired']),
        inlineNextActionProvided: boolInt(event['inlineNextActionProvided']),
        inlineNextActionTargetCount: nonNegativeIntegerOrNull(event['inlineNextActionTargetCount']),
        inlineRecoveryAnchorProvided: boolInt(event['inlineRecoveryAnchorProvided']),
        inlineRecoveryAnchorTargetCount: nonNegativeIntegerOrNull(event['inlineRecoveryAnchorTargetCount']),
        workflowSuccess: boolInt(event['workflowSuccess']),
        partial: boolInt(event['partial']),
        applyMode: stringOrNull(event['applyMode']),
        operationCount: integerOrNull(event['operationCount']),
        targetCount: integerOrNull(event['targetCount']),
        appliedCount: integerOrNull(event['appliedCount']),
        failedCount: integerOrNull(event['failedCount']),
        causalFailureCount: integerOrNull(event['causalFailureCount']),
        abortedOperationCount: integerOrNull(event['abortedOperationCount']),
        recoveryRequiredTargetCount: integerOrNull(event['recoveryRequiredTargetCount']),
        convergenceCandidateCount: integerOrNull(event['convergenceCandidateCount']),
        synthetic: path && path.includes('/.ai/jobs/') ? 1 : 0,
    };
}

/** @param {unknown} value */
function stringOrNull(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** @param {unknown} value @param {number} maxLength */
function boundedStringOrNull(value, maxLength) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text && text.length <= maxLength ? text : null;
}

/** @param {unknown} value @param {number} maxLength */
function boundedHexOrNull(value, maxLength) {
    const text = boundedStringOrNull(value, maxLength);
    return text && /^[0-9a-f]+$/u.test(text) ? text : null;
}

/** @param {unknown} value */
function boundedMachineCodeOrNull(value) {
    const text = boundedStringOrNull(value, 96);
    return text && /^[A-Z][A-Z0-9_]{1,95}$/u.test(text) ? text : null;
}

/** @template {string} T @param {unknown} value @param {readonly T[]} allowed @returns {T | null} */
function enumOrNull(value, allowed) {
    return typeof value === 'string' && allowed.includes(/** @type {T} */ (value)) ? /** @type {T} */ (value) : null;
}

/** @param {unknown} value */
function integerOrNull(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

/** @param {unknown} value */
function positiveIntegerOrNull(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/** @param {unknown} value */
function nonNegativeIntegerOrNull(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Serialize only a small string→non-negative-integer map. Audit payload text, paths and arbitrary nested values never
 * enter the derived round-trip index through this channel.
 *
 * @param {unknown} value
 */
function countMapJsonOrNull(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    /** @type {[string, number][]} */
    const entries = [];
    for (const [rawKey, rawCount] of Object.entries(/** @type {Record<string, unknown>} */ (value)).slice(0, 64)) {
        const key = rawKey.trim().slice(0, 160);
        const count = nonNegativeIntegerOrNull(rawCount);
        if (!key || count === null || count === 0) continue;
        entries.push([key, count]);
    }
    if (entries.length === 0) return null;
    entries.sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify(Object.fromEntries(entries));
}

/** @param {unknown} value @param {number} maxItems @param {number} maxItemLength */
function boundedStringArrayJsonOrNull(value, maxItems, maxItemLength) {
    if (!Array.isArray(value)) return null;
    const items = [
        ...new Set(
            value
                .slice(0, maxItems)
                .map((item) => boundedStringOrNull(item, maxItemLength))
                .filter((item) => item !== null),
        ),
    ].sort();
    return items.length > 0 ? JSON.stringify(items) : null;
}

/** @param {unknown} value */
function boolInt(value) {
    return value === true ? 1 : value === false ? 0 : null;
}
