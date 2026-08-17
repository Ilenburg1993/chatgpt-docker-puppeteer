// @ts-check

/**
 * Resolve the selector policy used to discover a bootstrap candidate before a
 * disposable agent admission probe.
 *
 * `require_runtime_proof` is a promotion/admission invariant, not a reason to
 * make pre-proof candidate discovery impossible. When an explicit agent
 * admission gate is active, candidate discovery therefore uses
 * `prefer_runtime_proved`; the candidate still cannot reach the live terminal
 * until the agent probe succeeds.
 *
 * @param {string | null | undefined} selectionPolicy
 * @param {{ requireAgentAdmission?: boolean }} [options]
 * @returns {{
 *   requestedSelectionPolicy: string,
 *   candidateSelectionPolicy: string,
 *   relaxedForAdmission: boolean,
 * }}
 */
export function resolveModelGatewayAdmissionCandidateSelectionPolicy(selectionPolicy, options = {}) {
    const requestedSelectionPolicy = String(selectionPolicy ?? '')
        .trim()
        .toLowerCase()
        .replaceAll('-', '_');
    const candidateSelectionPolicy =
        options.requireAgentAdmission === true && requestedSelectionPolicy === 'require_runtime_proof'
            ? 'prefer_runtime_proved'
            : requestedSelectionPolicy;
    return {
        requestedSelectionPolicy,
        candidateSelectionPolicy,
        relaxedForAdmission: candidateSelectionPolicy !== requestedSelectionPolicy,
    };
}
