// @ts-check
/**
 * Stable explanations for model-gateway route decisions.
 *
 * @module copilot/model-gateway/routing/explain
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, any>} candidate
 * @returns {string}
 */
function candidateId(candidate) {
    const model = isRecord(candidate['model']) ? candidate['model'] : {};
    return (
        optionalString(model['id']) ??
        [optionalString(model['providerId']) ?? 'unknown-provider', optionalString(model['providerModel']) ?? 'unknown-model'].join(':')
    );
}

/**
 * @param {string[]} reasons
 * @returns {Record<string, number>}
 */
function reasonCounts(reasons) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
}

/**
 * @param {string[]} reasons
 * @returns {string[]}
 */
function nextActions(reasons) {
    const actions = [];
    if (reasons.some((reason) => reason.startsWith('eligibility:secret_missing'))) actions.push('configure_required_secret');
    if (reasons.includes('eligibility:account_model_not_visible')) actions.push('refresh_account_overlay_or_choose_visible_model');
    if (reasons.includes('eligibility:account_access_unknown')) actions.push('collect_account_overlay_before_runtime');
    if (reasons.some((reason) => reason.startsWith('missing_capability:'))) actions.push('choose_model_with_required_capabilities');
    if (reasons.some((reason) => reason.startsWith('context_too_small:'))) actions.push('choose_larger_context_model_or_compact');
    if (reasons.some((reason) => reason.startsWith('route_layer_blocked:'))) actions.push('relax_route_layer_policy_or_choose_allowed_route');
    if (reasons.some((reason) => reason.startsWith('wire_api_blocked:'))) actions.push('relax_wire_api_policy_or_choose_allowed_adapter');
    if (reasons.some((reason) => reason.startsWith('upstream_provider_'))) {
        actions.push('choose_allowed_upstream_provider_or_relax_policy');
    }
    if (reasons.some((reason) => reason.startsWith('data_policy_'))) {
        actions.push('choose_model_matching_data_policy_or_relax_policy');
    }
    if (reasons.some((reason) => reason.startsWith('price_above_limit:'))) actions.push('raise_budget_or_choose_lower_cost_model');
    if (reasons.some((reason) => reason.startsWith('confidence_below_minimum:'))) actions.push('refresh_catalog_or_run_probe_to_raise_confidence');
    if (reasons.some((reason) => reason.includes('health') || reason.includes('failed'))) actions.push('wait_or_clear_provider_health_after_fix');
    if (actions.length === 0 && reasons.length > 0) actions.push('inspect_rejected_reasons');
    if (actions.length === 0) actions.push('route_decision_ready');
    return [...new Set(actions)];
}

/**
 * @param {Record<string, any>} route
 * @returns {{
 *   selected: boolean;
 *   selectedId: string | null;
 *   candidateCount: number;
 *   rejectedCount: number;
 *   fallbackChain: string[];
 *   rejectedReasonCounts: Record<string, number>;
 *   topRejectedReasons: string[];
 *   nextActions: string[];
 *   summary: string;
 * }}
 */
export function explainGatewayRouteDecision(route) {
    const candidates = Array.isArray(route['candidates']) ? route['candidates'].filter(isRecord) : [];
    const rejected = Array.isArray(route['rejected']) ? route['rejected'].filter(isRecord) : [];
    const selected = isRecord(route['selected']) ? route['selected'] : null;
    const reasons = rejected.flatMap((candidate) =>
        Array.isArray(candidate['rejectedReasons']) ? candidate['rejectedReasons'].map(optionalString).filter((item) => item !== null) : [],
    );
    const counts = reasonCounts(reasons);
    const topRejectedReasons = Object.entries(counts)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 8)
        .map(([reason]) => reason);
    const selectedId = selected ? candidateId(selected) : null;
    return {
        selected: selected !== null,
        selectedId,
        candidateCount: candidates.length,
        rejectedCount: rejected.length,
        fallbackChain: Array.isArray(route['fallbackChain']) ? route['fallbackChain'].map(String) : [],
        rejectedReasonCounts: counts,
        topRejectedReasons,
        nextActions: nextActions(topRejectedReasons),
        summary: selectedId ? `selected:${selectedId}` : `unselected:${topRejectedReasons[0] ?? 'no_candidate'}`,
    };
}
