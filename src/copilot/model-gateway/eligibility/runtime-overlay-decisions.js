// @ts-check
/**
 * Helpers for applying runtime/account overlay eligibility without replacing canonical catalog eligibility.
 *
 * Runtime health can produce concrete temporary blockers such as `health_fatal` or `account_rate_limited`. Those
 * blockers should overlay pre-runtime selection. Generic absence of account visibility, however, must not erase
 * catalog/build-time eligibility after a health mirror, otherwise readiness can collapse to zero selected routes.
 *
 * @module copilot/model-gateway/eligibility/runtime-overlay-decisions
 */

const RUNTIME_OVERLAY_HARD_EXCLUSIONS = new Set([
    'health_fatal',
    'account_key_disabled',
    'account_spending_exhausted',
    'account_quota_exhausted',
    'account_rate_limited',
    'account_model_blocked',
]);

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * @param {Record<string, unknown>} decision
 * @returns {boolean}
 */
export function isModelGatewayRuntimeEligibilityOverlayDecision(decision) {
    const hardExclusions = stringList(decision['hardExclusions']);
    return hardExclusions.some((reason) => RUNTIME_OVERLAY_HARD_EXCLUSIONS.has(reason));
}

/**
 * @param {Record<string, unknown>[]} decisions
 * @returns {Record<string, unknown>[]}
 */
export function filterModelGatewayRuntimeEligibilityOverlayDecisions(decisions) {
    return decisions.filter(isModelGatewayRuntimeEligibilityOverlayDecision);
}
