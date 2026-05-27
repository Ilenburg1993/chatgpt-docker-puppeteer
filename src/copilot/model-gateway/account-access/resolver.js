// @ts-check
/**
 * Account access resolver for pre-runtime model admission.
 *
 * This layer reads account overlays and secret presence without calling providers. The result is account/policy scoped
 * evidence that eligibility, explain views and future probe planners can reuse without mutating the canonical catalog.
 *
 * @module copilot/model-gateway/account-access/resolver
 */

import { normalizeModelGatewayAccountLimitState } from './limits.js';
import { evaluateModelGatewayAccountOverlayFreshness } from './freshness.js';

export const MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS = Object.freeze({
    VISIBLE: 'visible',
    BLOCKED: 'blocked',
    NOT_VISIBLE: 'not_visible',
    MISSING_SECRET: 'missing_secret',
    MISSING_OVERLAY: 'missing_overlay',
    EXPIRED: 'expired',
    KEY_DISABLED: 'key_disabled',
    QUOTA_EXHAUSTED: 'quota_exhausted',
    SPENDING_EXHAUSTED: 'spending_exhausted',
    RATE_LIMITED: 'rate_limited',
    UNKNOWN: 'unknown',
});

export const MODEL_GATEWAY_ACCOUNT_ACCESS_CONFIDENCE = Object.freeze({
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
    UNKNOWN: 'unknown',
});

export const MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS = Object.freeze({
    NONE: 'none',
    SECRET_CONFIGURATION: 'secret_configuration',
    ACCOUNT_LIMITS: 'account_limits',
    ACCOUNT_KEY: 'account_key',
    ACCOUNT_OVERLAY: 'account_overlay',
    MODEL_VISIBILITY: 'model_visibility',
    POLICY_BLOCK: 'policy_block',
    UNKNOWN_ACCESS: 'unknown_access',
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
 * @param {string[]} aliases
 * @returns {string[]}
 */
function modelIdentityTokens(providerModel, aliases = []) {
    return [...new Set([providerModel, ...aliases].map(optionalString).filter((item) => item !== null))];
}

/**
 * @param {string[]} providerModelTokens
 * @param {unknown} models
 * @returns {boolean}
 */
function modelListIncludesAny(providerModelTokens, models) {
    const targets = new Set(providerModelTokens.map(keyToken));
    return stringList(models).some((model) => targets.has(keyToken(model)));
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
    if (hardReasons.includes('account_key_disabled')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.KEY_DISABLED;
    if (hardReasons.includes('account_spending_exhausted')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.SPENDING_EXHAUSTED;
    if (hardReasons.includes('account_quota_exhausted')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.QUOTA_EXHAUSTED;
    if (hardReasons.includes('account_rate_limited')) return MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.RATE_LIMITED;
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
 * @param {string} status
 * @param {string[]} hardReasons
 * @param {string[]} softReasons
 * @returns {string}
 */
function classifyFailure(status, hardReasons, softReasons) {
    if (status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.VISIBLE) return MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS.NONE;
    if (status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.MISSING_SECRET) {
        return MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS.SECRET_CONFIGURATION;
    }
    if (
        status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.QUOTA_EXHAUSTED ||
        status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.SPENDING_EXHAUSTED ||
        status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.RATE_LIMITED
    ) {
        return MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS.ACCOUNT_LIMITS;
    }
    if (status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.KEY_DISABLED) return MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS.ACCOUNT_KEY;
    if (status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.BLOCKED) return MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS.POLICY_BLOCK;
    if (status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.NOT_VISIBLE) {
        return MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS.MODEL_VISIBILITY;
    }
    if (
        status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.EXPIRED ||
        status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.MISSING_OVERLAY ||
        hardReasons.includes('account_overlay_missing') ||
        softReasons.includes('account_overlay_missing')
    ) {
        return MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS.ACCOUNT_OVERLAY;
    }
    return MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS.UNKNOWN_ACCESS;
}

/**
 * @param {string} status
 * @param {boolean | null} secretConfigured
 * @param {boolean} modelVisible
 * @param {Record<string, any>[]} overlays
 * @returns {string}
 */
function resolveConfidence(status, secretConfigured, modelVisible, overlays) {
    if (status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.UNKNOWN) return MODEL_GATEWAY_ACCOUNT_ACCESS_CONFIDENCE.UNKNOWN;
    if (status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.EXPIRED) return MODEL_GATEWAY_ACCOUNT_ACCESS_CONFIDENCE.MEDIUM;
    if (
        status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.MISSING_OVERLAY ||
        (overlays.length === 0 && status !== MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.MISSING_SECRET)
    ) {
        return MODEL_GATEWAY_ACCOUNT_ACCESS_CONFIDENCE.LOW;
    }
    if (status === MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.VISIBLE && (secretConfigured === true || modelVisible)) {
        return MODEL_GATEWAY_ACCOUNT_ACCESS_CONFIDENCE.HIGH;
    }
    if (status !== MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS.VISIBLE && overlays.length > 0) {
        return MODEL_GATEWAY_ACCOUNT_ACCESS_CONFIDENCE.HIGH;
    }
    return MODEL_GATEWAY_ACCOUNT_ACCESS_CONFIDENCE.LOW;
}

/**
 * @param {Record<string, any>} overlay
 * @param {number} nowMs
 * @returns {boolean}
 */
function overlayExpired(overlay, nowMs) {
    return evaluateModelGatewayAccountOverlayFreshness(overlay, { now: nowMs }).expired;
}

/**
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} input.providerModel
 * @param {string[]} [input.providerModelAliases]
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
 *   modelIdentifiers: string[];
 *   accessConfidence: string;
 *   failureClass: string;
 *   overlays: Record<string, any>[];
 *   overlayRefs: string[];
 *   resetWindows: Array<{
 *     status: string;
 *     class: string;
 *     source: string;
 *     resetAt: string | null;
 *     nextRefreshAfter: string | null;
 *     retentionExpiresAt: string | null;
 *     autoUnblocksAt: string | null;
 *     blocksUntilRefresh: boolean;
 *   }>;
 *   hardReasons: string[];
 *   softReasons: string[];
 *   reasons: string[];
 * }}
 */
export function resolveModelGatewayAccountAccess(input) {
    const providerId = optionalString(input.providerId) ?? 'unknown-provider';
    const providerModel = optionalString(input.providerModel) ?? 'unknown-model';
    const modelIdentifiers = modelIdentityTokens(providerModel, stringList(input.providerModelAliases));
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

    const limitStates = overlays.map((overlay) => normalizeModelGatewayAccountLimitState(overlay, { now: nowMs }));
    const resetWindows = limitStates.map((state) => ({
        status: state.resetWindow.status,
        class: state.resetWindow.class,
        source: state.resetWindow.source,
        resetAt: state.resetWindow.resetAt,
        nextRefreshAfter: state.resetWindow.nextRefreshAfter,
        retentionExpiresAt: state.resetWindow.retentionExpiresAt,
        autoUnblocksAt: state.resetWindow.autoUnblocksAt,
        blocksUntilRefresh: state.resetWindow.blocksUntilRefresh,
    }));
    if (limitStates.some((state) => state.keyDisabled)) hardReasons.push('account_key_disabled');
    if (limitStates.some((state) => state.spendingExhausted)) hardReasons.push('account_spending_exhausted');
    if (limitStates.some((state) => state.quotaExhausted)) hardReasons.push('account_quota_exhausted');
    if (limitStates.some((state) => state.rateLimited)) hardReasons.push('account_rate_limited');

    if (overlays.length === 0) {
        if (input.requireAccountOverlay === true) hardReasons.push('account_overlay_missing');
        else softReasons.push('account_overlay_missing');
        if (input.unknownAccessPolicy === 'block') hardReasons.push('account_access_unknown');
    } else {
        reasons.push('account_overlay_available');
        if (overlays.some((overlay) => modelListIncludesAny(modelIdentifiers, overlay['blockedModels']))) {
            hardReasons.push('account_model_blocked');
        }
        const overlaysWithEnabledModels = overlays.filter((overlay) => stringList(overlay['enabledModels']).length > 0);
        modelVisible = overlaysWithEnabledModels.some((overlay) => modelListIncludesAny(modelIdentifiers, overlay['enabledModels']));
        if (modelVisible) reasons.push('account_model_visible');
        else if (overlaysWithEnabledModels.length > 0 && input.treatEnabledModelsAsClosed !== false) {
            hardReasons.push('account_model_not_visible');
        } else {
            softReasons.push('account_visibility_unknown');
        }
    }

    const status = resolveStatus(hardReasons, softReasons, modelVisible);
    const uniqueHard = [...new Set(hardReasons)];
    const uniqueSoft = [...new Set(softReasons)];
    return {
        providerId,
        providerModel,
        accountScope,
        status,
        canAttempt: hardReasons.length === 0,
        secretRef,
        secretConfigured,
        modelVisible,
        modelIdentifiers,
        accessConfidence: resolveConfidence(status, secretConfigured, modelVisible, overlays),
        failureClass: classifyFailure(status, uniqueHard, uniqueSoft),
        overlays,
        overlayRefs: overlays.map((overlay) => optionalString(overlay['accountOverlayId'])).filter((id) => id !== null),
        resetWindows,
        hardReasons: uniqueHard,
        softReasons: uniqueSoft,
        reasons: [...new Set(reasons)],
    };
}
