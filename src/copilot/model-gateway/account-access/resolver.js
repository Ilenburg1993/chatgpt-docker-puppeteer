// @ts-check
/**
 * Account access resolver for pre-runtime model admission.
 *
 * This layer reads account overlays and secret presence without calling providers. The result is account/policy scoped
 * evidence that eligibility, explain views and future probe planners can reuse without mutating the canonical catalog.
 *
 * @module copilot/model-gateway/account-access/resolver
 */

export const MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS = Object.freeze({
    VISIBLE: 'visible',
    BLOCKED: 'blocked',
    NOT_VISIBLE: 'not_visible',
    MISSING_SECRET: 'missing_secret',
    MISSING_OVERLAY: 'missing_overlay',
    EXPIRED: 'expired',
    QUOTA_EXHAUSTED: 'quota_exhausted',
    SPENDING_EXHAUSTED: 'spending_exhausted',
    UNKNOWN: 'unknown',
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function dateMs(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
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
 * @param {unknown} value
 * @returns {boolean}
 */
function truthy(value) {
    return value === true;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function keyToken(value) {
    return String(value ?? '').trim().toLowerCase();
}

/**
 * @param {string} providerModel
 * @param {unknown} models
 * @returns {boolean}
 */
function modelListIncludes(providerModel, models) {
    const target = keyToken(providerModel);
    return stringList(models).some((model) => keyToken(model) === target);
}

/**
 * @param {Record<string, any>} overlay
 * @param {string} providerId
 * @param {string | null} accountScope
 * @returns {boolean}
 */
function overlayMatches(overlay, providerId, accountScope) {
    if (optionalString(overlay['providerId']) !== providerId) return false;
    if (accountScope && optionalString(overlay['accountScope']) !== accountScope) return false;
    return true;
}

/**
 * @param {Record<string, any>[]} overlays
 * @returns {string | null}
 */
function firstSecretRef(overlays) {
    for (const overlay of overlays) {
        const secretRef = optionalString(overlay['secretRef']);
        if (secretRef) return secretRef;
    }
    return null;
}

/**
 * @param {string[]} hardReasons
 * @param {string[]} softReasons
 * @param {boolean} modelVisible
 * @returns {string}
 */
function resolveStatus(hardReasons, softReasons, modelVisible) {
    if (hardReasons.some((reason) => reason.startsWith('secret_missing'))) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.MISSING_SECRET;
    if (hardReasons.includes('account_spending_exhausted')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.SPENDING_EXHAUSTED;
    if (hardReasons.includes('account_quota_exhausted')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.QUOTA_EXHAUSTED;
    if (hardReasons.includes('account_model_blocked')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.BLOCKED;
    if (hardReasons.includes('account_model_not_visible')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.NOT_VISIBLE;
    if (hardReasons.includes('account_overlay_expired')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.EXPIRED;
    if (hardReasons.includes('account_overlay_missing')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.MISSING_OVERLAY;
    if (softReasons.includes('account_overlay_expired')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.EXPIRED;
    if (softReasons.includes('account_overlay_missing')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.MISSING_OVERLAY;
    if (softReasons.includes('account_visibility_unknown') || hardReasons.includes('account_access_unknown')) {
        return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.UNKNOWN;
    }
    return modelVisible ? MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.VISIBLE : MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.UNKNOWN;
}

/**
 * @param {Record<string, any>} overlay
 * @param {number} nowMs
 * @returns {boolean}
 */
function overlayExpired(overlay, nowMs) {
    const expiresAtMs = dateMs(overlay['expiresAt']);
    return expiresAtMs !== null && expiresAtMs <= nowMs;
}

/**
 * @param {Record<string, any>} overlay
 * @returns {boolean}
 */
function overlaySpendingExhausted(overlay) {
    const spending = isRecord(overlay['spendingLimits']) ? overlay['spendingLimits'] : {};
    const remainingUsd = optionalNumber(spending['remainingUsd']);
    return remainingUsd !== null && remainingUsd <= 0;
}

/**
 * @param {Record<string, any>} overlay
 * @returns {boolean}
 */
function overlayQuotaExhausted(overlay) {
    const quota = isRecord(overlay['quota']) ? overlay['quota'] : {};
    const remainingCreditsUsd = optionalNumber(quota['remainingCreditsUsd']);
    const dailyRequests = optionalNumber(quota['dailyRequests']);
    const dailyTokens = optionalNumber(quota['dailyTokens']);
    return (
        (remainingCreditsUsd !== null && remainingCreditsUsd <= 0) ||
        (dailyRequests !== null && dailyRequests <= 0) ||
        (dailyTokens !== null && dailyTokens <= 0)
    );
}

/**
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} input.providerModel
 * @param {string | null} [input.accountScope]
 * @param {Record<string, any>[]} [input.accountOverlays]
 * @param {{ has(ref: string): boolean }} [input.secretRegistry]
 * @param {string | null} [input.secretRef]
 * @param {boolean} [input.requireAccountOverlay]
 * @param {boolean} [input.requireFreshAccountOverlay]
 * @param {boolean} [input.allowExpiredAccountOverlay]
 * @param {'allow_probe' | 'block' | string} [input.unknownAccessPolicy]
 * @param {boolean} [input.treatEnabledModelsAsClosed]
 * @param {boolean} [input.localPrivate]
 * @param {string | number | Date} [input.now]
 * @returns {{
 *   providerId: string;
 *   providerModel: string;
 *   accountScope: string;
 *   status: string;
 *   canAttempt: boolean;
 *   secretRef: string | null;
 *   secretConfigured: boolean | null;
 *   modelVisible: boolean;
 *   overlays: Record<string, any>[];
 *   overlayRefs: string[];
 *   hardReasons: string[];
 *   softReasons: string[];
 *   reasons: string[];
 * }}
 */
export function resolveModelGatewayAccountAccess(input) {
    const providerId = optionalString(input.providerId) ?? 'unknown-provider';
    const providerModel = optionalString(input.providerModel) ?? 'unknown-model';
    const requestedAccountScope = optionalString(input.accountScope);
    const accountScope = requestedAccountScope ?? 'default';
    const nowMs = dateMs(input.now) ?? Date.now();
    const matchedOverlays = (Array.isArray(input.accountOverlays) ? input.accountOverlays.filter(isRecord) : []).filter((overlay) =>
        overlayMatches(overlay, providerId, requestedAccountScope),
    );
    const expiredOverlays = matchedOverlays.filter((overlay) => overlayExpired(overlay, nowMs));
    const overlays = input.allowExpiredAccountOverlay === true ? matchedOverlays : matchedOverlays.filter((overlay) => !overlayExpired(overlay, nowMs));
    const secretRef = optionalString(input.secretRef) ?? firstSecretRef(overlays);
    const hardReasons = [];
    const softReasons = [];
    const reasons = [];
    let secretConfigured = /** @type {boolean | null} */ (null);
    let modelVisible = false;

    if (secretRef) {
        secretConfigured = input.secretRegistry ? input.secretRegistry.has(secretRef) : null;
        if (secretConfigured === false) hardReasons.push(`secret_missing:${secretRef}`);
        else reasons.push(`secret_configured:${secretRef}`);
    } else if (!truthy(input.localPrivate)) {
        softReasons.push('account_visibility_unknown');
    }

    if (expiredOverlays.length > 0) {
        if (input.requireFreshAccountOverlay === true) hardReasons.push('account_overlay_expired');
        else softReasons.push('account_overlay_expired');
    }

    if (overlays.some(overlaySpendingExhausted)) hardReasons.push('account_spending_exhausted');
    if (overlays.some(overlayQuotaExhausted)) hardReasons.push('account_quota_exhausted');

    if (overlays.length === 0) {
        if (input.requireAccountOverlay === true) hardReasons.push('account_overlay_missing');
        else softReasons.push('account_overlay_missing');
        if (input.unknownAccessPolicy === 'block') hardReasons.push('account_access_unknown');
    } else {
        reasons.push('account_overlay_available');
        if (overlays.some((overlay) => modelListIncludes(providerModel, overlay['blockedModels']))) {
            hardReasons.push('account_model_blocked');
        }
        const overlaysWithEnabledModels = overlays.filter((overlay) => stringList(overlay['enabledModels']).length > 0);
        modelVisible = overlaysWithEnabledModels.some((overlay) => modelListIncludes(providerModel, overlay['enabledModels']));
        if (modelVisible) reasons.push('account_model_visible');
        else if (overlaysWithEnabledModels.length > 0 && input.treatEnabledModelsAsClosed !== false) {
            hardReasons.push('account_model_not_visible');
        } else {
            softReasons.push('account_visibility_unknown');
        }
    }

    const status = resolveStatus(hardReasons, softReasons, modelVisible);
    return {
        providerId,
        providerModel,
        accountScope,
        status,
        canAttempt: hardReasons.length === 0,
        secretRef,
        secretConfigured,
        modelVisible,
        overlays,
        overlayRefs: overlays.map((overlay) => optionalString(overlay['accountOverlayId'])).filter((id) => id !== null),
        hardReasons: [...new Set(hardReasons)],
        softReasons: [...new Set(softReasons)],
        reasons: [...new Set(reasons)],
    };
}
