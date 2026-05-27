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
 * @param {Record<string, any> | null} health
 * @returns {{
 *   status: string | null;
 *   agentProbeStatus: string | null;
 *   chatOk: boolean;
 *   agentProbeVerified: boolean;
 *   verifiedProbes: string[];
 *   failedProbes: string[];
 * }}
 */
function probeSummary(health) {
    const probes = isRecord(health?.['probes']) ? health['probes'] : {};
    const verifiedProbes = [];
    const failedProbes = [];
    for (const [kind, probe] of Object.entries(probes)) {
        if (!isRecord(probe)) continue;
        if (probe['status'] === 'ok') verifiedProbes.push(kind);
        if (probe['status'] === 'failed') failedProbes.push(kind);
    }
    const status = optionalString(health?.['lastStatus']) ?? null;
    const agentProbeStatus = optionalString(health?.['agentProbeStatus']) ?? null;
    return {
        status,
        agentProbeStatus,
        chatOk: status === 'ok',
        agentProbeVerified: agentProbeStatus === 'ok',
        verifiedProbes: verifiedProbes.sort(),
        failedProbes: failedProbes.sort(),
    };
}

/**
 * @param {Record<string, any>} candidate
 * @returns {Record<string, unknown>}
 */
function candidateSummary(candidate) {
    const model = isRecord(candidate['model']) ? candidate['model'] : {};
    const eligibility = isRecord(candidate['eligibility']) ? candidate['eligibility'] : null;
    const health = isRecord(candidate['health']) ? candidate['health'] : null;
    const normalizedPolicy = isRecord(model['normalizedPolicy']) ? model['normalizedPolicy'] : {};
    return {
        id: candidateId(candidate),
        providerId: optionalString(model['providerId']),
        providerModel: optionalString(model['providerModel'] ?? model['id']),
        routeProfile: optionalString(model['routeProfile']),
        routeLayer: optionalString(normalizedPolicy['routeLayer']),
        wireApi: optionalString(normalizedPolicy['wireApi'] ?? normalizedPolicy['directWireApi']),
        score: typeof candidate['score'] === 'number' ? candidate['score'] : null,
        included: candidate['include'] === true,
        rejectedReasons: Array.isArray(candidate['rejectedReasons'])
            ? candidate['rejectedReasons'].map(optionalString).filter((item) => item !== null)
            : [],
        positiveReasons: Array.isArray(candidate['reasons']) ? candidate['reasons'].map(optionalString).filter((item) => item !== null) : [],
        eligibility: eligibility
            ? {
                  include: eligibility['include'] === true,
                  disposition: optionalString(eligibility['disposition']),
                  hardExclusions: Array.isArray(eligibility['hardExclusions']) ? eligibility['hardExclusions'].map(String) : [],
                  softPenalties: Array.isArray(eligibility['softPenalties']) ? eligibility['softPenalties'].map(String) : [],
                  overlayRefs: Array.isArray(eligibility['overlayRefs']) ? eligibility['overlayRefs'].map(String) : [],
              }
            : null,
        probes: probeSummary(health),
    };
}

/**
 * @param {Record<string, any>[]} candidates
 * @returns {Record<string, unknown>}
 */
function decisionLayers(candidates) {
    const summaries = candidates.map(candidateSummary);
    const probeSummaries = summaries.map((summary) => (isRecord(summary['probes']) ? summary['probes'] : {}));
    const chatOkCount = probeSummaries.filter((probes) => probes['chatOk'] === true).length;
    const agentProbeProofCount = probeSummaries.filter((probes) => probes['agentProbeVerified'] === true).length;
    const runtimeProbeProofCount = probeSummaries.filter(
        (probes) => Array.isArray(probes['verifiedProbes']) && probes['verifiedProbes'].length > 0,
    ).length;
    return {
        catalogCandidateCount: summaries.length,
        eligibilityEvaluatedCount: summaries.filter((summary) => summary['eligibility'] !== null).length,
        healthRecordCount: probeSummaries.filter((probes) => probes['status'] !== null).length,
        runtimeChatOkCount: chatOkCount,
        runtimeAgentProbeProofCount: agentProbeProofCount,
        runtimeProbeProofCount,
        runtimeHealthProofCount: probeSummaries.filter(
            (probes) =>
                probes['chatOk'] === true ||
                probes['agentProbeVerified'] === true ||
                (Array.isArray(probes['verifiedProbes']) && probes['verifiedProbes'].length > 0),
        ).length,
    };
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
    if (
        reasons.includes('missing_capability:local') ||
        reasons.includes('missing_capability:privacy') ||
        reasons.includes('missing_capability:no_remote_secrets')
    ) {
        actions.push('start_or_configure_explicit_local_provider');
    }
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
 *   selectedSummary: Record<string, unknown> | null;
 *   candidateSummaries: Record<string, unknown>[];
 *   rejectedSummaries: Record<string, unknown>[];
 *   decisionLayers: Record<string, unknown>;
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
    const allCandidates = [...candidates, ...rejected];
    return {
        selected: selected !== null,
        selectedId,
        candidateCount: candidates.length,
        rejectedCount: rejected.length,
        fallbackChain: Array.isArray(route['fallbackChain']) ? route['fallbackChain'].map(String) : [],
        rejectedReasonCounts: counts,
        topRejectedReasons,
        selectedSummary: selected ? candidateSummary(selected) : null,
        candidateSummaries: candidates.map(candidateSummary),
        rejectedSummaries: rejected.map(candidateSummary),
        decisionLayers: decisionLayers(allCandidates),
        nextActions: nextActions(topRejectedReasons),
        summary: selectedId ? `selected:${selectedId}` : `unselected:${topRejectedReasons[0] ?? 'no_candidate'}`,
    };
}
