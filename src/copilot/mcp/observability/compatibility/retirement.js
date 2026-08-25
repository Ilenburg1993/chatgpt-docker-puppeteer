// @ts-check
/**
 * Pure compatibility-retirement policy for MCP protocol/OAuth compatibility surfaces.
 *
 * This module never reads files, environment variables or live host state. It consumes the privacy-bounded aggregate
 * produced by the audit capability and classifies evidence only; removal remains an explicit architectural action.
 *
 * @module copilot/mcp/observability/compatibility/retirement
 */

export const MCP_COMPATIBILITY_RETIREMENT_POLICY_VERSION = 1;
export const DEFAULT_MCP_COMPATIBILITY_RETIREMENT_POLICY = Object.freeze({
    minObservationWindowMs: 7 * 24 * 60 * 60 * 1000,
    minProtocolRequests: 100,
    requiredHostClasses: Object.freeze(['chatgpt']),
});

/** @typedef {'chatgpt' | 'claude'} McpCompatibilityRequiredHostClass */
/** @typedef {'insufficient-evidence' | 'blocked-by-use' | 'candidate'} McpCompatibilityRetirementStatus */

/**
 * @typedef {{
 *     minObservationWindowMs?: number;
 *     minProtocolRequests?: number;
 *     requiredHostClasses?: readonly McpCompatibilityRequiredHostClass[];
 * }} McpCompatibilityRetirementPolicyInput
 */

/**
 * Evaluate whether the retained evidence window is strong enough to consider retirement of the 2025 protocol path or
 * DCR. A zero counter is never sufficient on its own: the shared evidence gate must first prove a long enough window,
 * enough real MCP traffic, modern-protocol use, and successful evidence for every required host class.
 *
 * @param {unknown} summary
 * @param {McpCompatibilityRetirementPolicyInput} [policyInput]
 */
export function evaluateMcpCompatibilityRetirementReadiness(summary, policyInput = {}) {
    const policy = normalizeRetirementPolicy(policyInput);
    const root = asRecord(summary);
    const source = asRecord(root['source']);
    const window = asRecord(root['window']);
    const protocol = asRecord(root['protocol']);
    const byEra = asRecord(protocol['byEra']);
    const oauth = asRecord(root['oauth']);
    const clientActivity = asRecord(oauth['clientActivity']);
    const successfulByHostClass = asRecord(clientActivity['successfulByHostClass']);
    const grants = asRecord(oauth['grants']);
    const grantsByClientSource = asRecord(grants['byClientSource']);
    const clientActivityBySource = asRecord(clientActivity['bySource']);

    const sourceOk = source['ok'] === true;
    const observationWindowMs = nonNegativeNumber(window['durationMs']);
    const protocolRequests = nonNegativeNumber(protocol['totalRequests']);
    const modern2026Requests = nonNegativeNumber(byEra['2026']);
    const legacy2025Requests = nonNegativeNumber(byEra['2025']);
    const dcrClientActivity = nonNegativeNumber(clientActivityBySource['dcr']);
    const dcrGrantActivity = nonNegativeNumber(grantsByClientSource['dcr']);
    const dcrUseSignals = dcrClientActivity + dcrGrantActivity;

    const hostEvidence = Object.fromEntries(
        policy.requiredHostClasses.map((hostClass) => [hostClass, nonNegativeNumber(successfulByHostClass[hostClass])]),
    );

    /** @type {string[]} */
    const sharedBlockers = [];
    if (!sourceOk) sharedBlockers.push('audit-source-unhealthy');
    if (observationWindowMs < policy.minObservationWindowMs) sharedBlockers.push('observation-window-too-short');
    if (protocolRequests < policy.minProtocolRequests) sharedBlockers.push('protocol-volume-too-low');
    if (modern2026Requests <= 0) sharedBlockers.push('modern-2026-not-observed');
    for (const hostClass of policy.requiredHostClasses) {
        if ((hostEvidence[hostClass] ?? 0) <= 0) sharedBlockers.push(`required-host-not-observed:${hostClass}`);
    }

    const protocol2025 = classifyCandidate(sharedBlockers, legacy2025Requests, {
        zeroUseLabel: '2025-protocol-zero-use',
        useLabel: '2025-protocol-still-observed',
    });
    const dcr = classifyCandidate(sharedBlockers, dcrUseSignals, {
        zeroUseLabel: 'dcr-zero-use',
        useLabel: 'dcr-still-observed',
    });

    return Object.freeze({
        policyVersion: MCP_COMPATIBILITY_RETIREMENT_POLICY_VERSION,
        policy,
        evidence: {
            sourceOk,
            observationWindowMs,
            protocolRequests,
            modern2026Requests,
            requiredHostSuccesses: hostEvidence,
            retainedWindow: {
                firstObservedAt: typeof window['firstObservedAt'] === 'string' ? window['firstObservedAt'] : null,
                lastObservedAt: typeof window['lastObservedAt'] === 'string' ? window['lastObservedAt'] : null,
                truncatedByBytes: source['truncatedByBytes'] === true,
            },
        },
        sharedEvidence: {
            sufficient: sharedBlockers.length === 0,
            blockers: Object.freeze([...sharedBlockers]),
        },
        retirement: {
            protocol2025: {
                ...protocol2025,
                observedUseSignals: legacy2025Requests,
                exitCondition:
                    'Candidate only after the minimum evidence window/volume/required-host gates pass and 2025 protocol requests remain zero in that retained window.',
            },
            dcr: {
                ...dcr,
                observedUseSignals: dcrUseSignals,
                observedClientActivity: dcrClientActivity,
                observedGrantActivity: dcrGrantActivity,
                exitCondition:
                    'Candidate only after the minimum evidence window/volume/required-host gates pass and both DCR client activity and DCR-backed grants remain zero in that retained window.',
            },
        },
        decisionBoundary:
            'candidate is evidence for an explicit retirement review, never permission to remove compatibility automatically.',
    });
}

/**
 * @param {McpCompatibilityRetirementPolicyInput} input
 */
function normalizeRetirementPolicy(input) {
    const requestedHosts = Array.isArray(input.requiredHostClasses)
        ? input.requiredHostClasses.filter((host) => host === 'chatgpt' || host === 'claude')
        : [];
    const requiredHostClasses = [...new Set(requestedHosts.length > 0 ? requestedHosts : ['chatgpt'])].sort();
    return Object.freeze({
        minObservationWindowMs: boundedPositiveInteger(
            input.minObservationWindowMs,
            DEFAULT_MCP_COMPATIBILITY_RETIREMENT_POLICY.minObservationWindowMs,
            60 * 60 * 1000,
            90 * 24 * 60 * 60 * 1000,
        ),
        minProtocolRequests: boundedPositiveInteger(
            input.minProtocolRequests,
            DEFAULT_MCP_COMPATIBILITY_RETIREMENT_POLICY.minProtocolRequests,
            1,
            1_000_000,
        ),
        requiredHostClasses: Object.freeze(requiredHostClasses),
    });
}

/**
 * @param {readonly string[]} sharedBlockers
 * @param {number} observedUseSignals
 * @param {{ zeroUseLabel: string; useLabel: string }} labels
 * @returns {{ status: McpCompatibilityRetirementStatus; qualifiedZeroUse: boolean; evidenceLabel: string; blockers: readonly string[] }}
 */
function classifyCandidate(sharedBlockers, observedUseSignals, labels) {
    if (sharedBlockers.length > 0) {
        return {
            status: 'insufficient-evidence',
            qualifiedZeroUse: false,
            evidenceLabel: 'unqualified-zero-use',
            blockers: Object.freeze([...sharedBlockers]),
        };
    }
    if (observedUseSignals > 0) {
        return {
            status: 'blocked-by-use',
            qualifiedZeroUse: false,
            evidenceLabel: labels.useLabel,
            blockers: Object.freeze([labels.useLabel]),
        };
    }
    return {
        status: 'candidate',
        qualifiedZeroUse: true,
        evidenceLabel: labels.zeroUseLabel,
        blockers: Object.freeze([]),
    };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/** @param {unknown} value */
function nonNegativeNumber(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedPositiveInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}
