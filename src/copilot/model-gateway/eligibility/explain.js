// @ts-check
/**
 * Human-readable, terminal-safe eligibility explanations.
 *
 * The evaluator owns the decision. This module only formats stable summaries that terminal and observability code can
 * reuse without duplicating the exclusion policy.
 *
 * @module copilot/model-gateway/eligibility/explain
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
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(optionalString).filter((item) => item !== null))];
}

/**
 * @param {Record<string, any>} decision
 * @returns {string}
 */
function decisionKey(decision) {
    return [
        optionalString(decision['providerId']) ?? 'unknown-provider',
        optionalString(decision['providerModel']) ?? 'unknown-model',
        optionalString(decision['routeProfile']) ?? 'default',
        optionalString(decision['selectorKind']) ?? 'exact_model',
        optionalString(decision['selectorSyntax']) ?? optionalString(decision['providerModel']) ?? 'unknown-model',
    ].join(':');
}

/**
 * @param {string[]} hardExclusions
 * @param {string[]} softPenalties
 * @param {string[]} runtimeProbes
 * @returns {string[]}
 */
function nextActions(hardExclusions, softPenalties, runtimeProbes) {
    const actions = [];
    if (hardExclusions.some((reason) => reason.startsWith('secret_missing'))) actions.push('configure_required_secret');
    if (hardExclusions.includes('account_model_not_visible')) actions.push('refresh_account_overlay_or_choose_visible_model');
    if (hardExclusions.includes('account_access_unknown')) actions.push('collect_account_overlay_before_runtime');
    if (hardExclusions.includes('upstream_provider_not_allowed') || hardExclusions.includes('upstream_provider_blocked')) {
        actions.push('choose_allowed_upstream_provider_or_relax_policy');
    }
    if (hardExclusions.includes('route_layer_not_allowed') || hardExclusions.includes('route_layer_blocked')) {
        actions.push('choose_allowed_route_layer_or_relax_policy');
    }
    if (hardExclusions.includes('wire_api_not_allowed') || hardExclusions.includes('wire_api_blocked')) {
        actions.push('choose_allowed_wire_api_or_relax_policy');
    }
    if (hardExclusions.includes('account_overlay_expired') || softPenalties.includes('account_overlay_expired')) actions.push('refresh_account_overlay');
    if (hardExclusions.includes('account_quota_exhausted')) actions.push('wait_for_quota_or_choose_another_account');
    if (hardExclusions.includes('account_spending_exhausted')) actions.push('raise_spending_limit_or_choose_free_model');
    if (hardExclusions.includes('cloudflare_account_id_missing')) actions.push('configure_cloudflare_account_id');
    if (hardExclusions.includes('cloudflare_gateway_id_missing')) actions.push('configure_cloudflare_ai_gateway_id');
    if (hardExclusions.includes('ollama_local_model_not_installed')) actions.push('pull_or_select_installed_ollama_model');
    if (hardExclusions.includes('health_fatal')) actions.push('wait_or_clear_fatal_provider_health_after_fix');
    if (hardExclusions.includes('price_unknown')) actions.push('refresh_pricing_or_relax_known_price_policy');
    if (hardExclusions.some((reason) => reason.startsWith('budget_exceeded'))) actions.push('choose_lower_cost_model_or_raise_budget');
    if (softPenalties.some((reason) => reason.startsWith('price_above_preference'))) actions.push('prefer_lower_cost_model_when_possible');
    if (hardExclusions.length === 0 && softPenalties.includes('account_visibility_unknown')) actions.push('run_low_cost_access_probe');
    if (hardExclusions.length === 0 && runtimeProbes.length > 0) actions.push(`run_runtime_probes:${runtimeProbes.join(',')}`);
    if (actions.length === 0 && hardExclusions.length === 0) actions.push('candidate_can_be_ranked');
    return [...new Set(actions)];
}

/**
 * @param {string[]} hardExclusions
 * @param {string[]} softPenalties
 * @returns {{ category: string; dataNeeded: string[]; probeSafe: boolean; operatorHint: string }}
 */
function actionableContext(hardExclusions, softPenalties) {
    const dataNeeded = [];
    if (hardExclusions.some((reason) => reason.startsWith('secret_missing'))) dataNeeded.push('secret');
    if (hardExclusions.includes('account_overlay_missing')) dataNeeded.push('account_overlay');
    if (hardExclusions.includes('account_access_unknown') || softPenalties.includes('account_visibility_unknown')) {
        dataNeeded.push('account_visibility');
    }
    if (hardExclusions.includes('upstream_provider_not_allowed') || hardExclusions.includes('upstream_provider_blocked')) {
        dataNeeded.push('allowed_upstream_policy');
    }
    if (hardExclusions.includes('route_layer_not_allowed') || hardExclusions.includes('route_layer_blocked')) {
        dataNeeded.push('allowed_route_layer_policy');
    }
    if (hardExclusions.includes('wire_api_not_allowed') || hardExclusions.includes('wire_api_blocked')) {
        dataNeeded.push('allowed_wire_api_policy');
    }
    const probeSafe = hardExclusions.length === 0 && softPenalties.includes('account_visibility_unknown');
    return {
        category: hardExclusions.length > 0 ? 'blocked' : probeSafe ? 'unknown_probe_allowed' : 'rankable',
        dataNeeded: [...new Set(dataNeeded)],
        probeSafe,
        operatorHint: probeSafe
            ? 'run_low_cost_access_probe_or_collect_overlay'
            : dataNeeded.length > 0
              ? `resolve_${dataNeeded[0]}`
              : 'no_extra_action',
    };
}

/**
 * @param {Record<string, any>} decision
 * @returns {{
 *   key: string;
 *   include: boolean;
 *   disposition: string;
 *   status: 'eligible' | 'excluded' | 'unknown';
 *   primaryReason: string;
 *   hardExclusions: string[];
 *   softPenalties: string[];
 *   reasons: string[];
 *   requiredRuntimeProbes: string[];
 *   actionable: { category: string; dataNeeded: string[]; probeSafe: boolean; operatorHint: string };
 *   nextActions: string[];
 *   summary: string;
 * }}
 */
export function explainModelGatewayEligibilityDecision(decision) {
    const hardExclusions = stringList(decision['hardExclusions']);
    const softPenalties = stringList(decision['softPenalties']);
    const reasons = stringList(decision['reasons']);
    const requiredRuntimeProbes = stringList(decision['requiredRuntimeProbes']);
    const include = decision['include'] === true && hardExclusions.length === 0;
    const disposition = optionalString(decision['disposition']) ?? (include ? 'eligible' : 'excluded');
    const status = include ? (disposition.startsWith('unknown') ? 'unknown' : 'eligible') : 'excluded';
    const primaryReason = hardExclusions[0] ?? softPenalties[0] ?? reasons[0] ?? disposition;
    const actions = nextActions(hardExclusions, softPenalties, requiredRuntimeProbes);
    const actionable = actionableContext(hardExclusions, softPenalties);
    return {
        key: decisionKey(decision),
        include,
        disposition,
        status,
        primaryReason,
        hardExclusions,
        softPenalties,
        reasons,
        requiredRuntimeProbes,
        actionable,
        nextActions: actions,
        summary: `${status}:${primaryReason}`,
    };
}
