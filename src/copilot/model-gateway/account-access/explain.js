// @ts-check
/**
 * Human-readable explanations for account-scoped access facts.
 *
 * @module copilot/model-gateway/account-access/explain
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
 * @param {Record<string, any>} access
 * @returns {string}
 */
function accountAccessKey(access) {
    return [
        optionalString(access['providerId']) ?? 'unknown-provider',
        optionalString(access['providerModel']) ?? 'unknown-model',
        optionalString(access['accountScope']) ?? 'default',
    ].join(':');
}

/**
 * @param {string} status
 * @param {string[]} hardReasons
 * @param {string[]} softReasons
 * @returns {string[]}
 */
function nextActions(status, hardReasons, softReasons) {
    const actions = [];
    if (status === 'missing_secret' || hardReasons.some((reason) => reason.startsWith('secret_missing'))) {
        actions.push('configure_required_secret');
    }
    if (status === 'missing_overlay' || hardReasons.includes('account_overlay_missing') || softReasons.includes('account_overlay_missing')) {
        actions.push('refresh_or_collect_account_overlay');
    }
    if (status === 'expired' || hardReasons.includes('account_overlay_expired') || softReasons.includes('account_overlay_expired')) {
        actions.push('refresh_account_overlay');
    }
    if (status === 'not_visible' || hardReasons.includes('account_model_not_visible')) {
        actions.push('choose_visible_model_or_refresh_overlay');
    }
    if (status === 'blocked' || hardReasons.includes('account_model_blocked')) actions.push('choose_unblocked_model');
    if (status === 'quota_exhausted' || hardReasons.includes('account_quota_exhausted')) {
        actions.push('wait_for_quota_or_choose_another_account');
    }
    if (status === 'spending_exhausted' || hardReasons.includes('account_spending_exhausted')) {
        actions.push('raise_spending_limit_or_choose_free_model');
    }
    if (status === 'rate_limited' || hardReasons.includes('account_rate_limited')) {
        actions.push('wait_for_rate_limit_reset_or_choose_another_route');
    }
    if (status === 'key_disabled' || hardReasons.includes('account_key_disabled')) {
        actions.push('enable_or_replace_provider_key');
    }
    if (status === 'unknown' || softReasons.includes('account_visibility_unknown')) actions.push('run_low_cost_access_probe');
    if (actions.length === 0 && status === 'visible') actions.push('account_access_can_enter_eligibility');
    return [...new Set(actions)];
}

/**
 * @param {Record<string, any>} access
 * @returns {{
 *   key: string;
 *   status: string;
 *   canAttempt: boolean;
 *   accessConfidence: string;
 *   failureClass: string;
 *   primaryReason: string;
 *   hardReasons: string[];
 *   softReasons: string[];
 *   reasons: string[];
 *   overlayRefs: string[];
 *   nextActions: string[];
 *   summary: string;
 * }}
 */
export function explainModelGatewayAccountAccess(access) {
    const status = optionalString(access['status']) ?? 'unknown';
    const hardReasons = stringList(access['hardReasons']);
    const softReasons = stringList(access['softReasons']);
    const reasons = stringList(access['reasons']);
    const overlayRefs = stringList(access['overlayRefs']);
    const primaryReason = hardReasons[0] ?? softReasons[0] ?? reasons[0] ?? status;
    return {
        key: accountAccessKey(access),
        status,
        canAttempt: access['canAttempt'] === true,
        accessConfidence: optionalString(access['accessConfidence']) ?? 'unknown',
        failureClass: optionalString(access['failureClass']) ?? 'unknown_access',
        primaryReason,
        hardReasons,
        softReasons,
        reasons,
        overlayRefs,
        nextActions: nextActions(status, hardReasons, softReasons),
        summary: `${status}:${primaryReason}`,
    };
}
