// @ts-check
/** Sanitized MCP audit-event normalizer for the rebuildable round-trip index. */

export const MCP_ROUND_TRIP_NORMALIZER_VERSION = 3;
const INDEXED_EVENTS = Object.freeze([
    'tool_call_started',
    'tool_call_completed',
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
        durationMs: integerOrNull(event['durationMs']),
        isError: boolInt(event['isError']),
        code: stringOrNull(event['code']),
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

/** @param {unknown} value */
function integerOrNull(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
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

/** @param {unknown} value */
function boolInt(value) {
    return value === true ? 1 : value === false ? 0 : null;
}
