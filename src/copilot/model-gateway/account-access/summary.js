// @ts-check
/**
 * Account/key overlay summaries for operator UX.
 *
 * @module copilot/model-gateway/account-access/summary
 */

import { normalizeModelGatewayAccountLimitState } from './limits.js';

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
 * @returns {number}
 */
function arrayLength(value) {
    return Array.isArray(value) ? value.length : 0;
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
 * @param {string | null} selector
 * @param {Record<string, unknown>} overlay
 * @returns {boolean}
 */
function matchesSelector(selector, overlay) {
    if (!selector) return true;
    const needle = selector.toLowerCase();
    return [
        overlay['providerId'],
        overlay['accountScope'],
        overlay['secretRef'],
        overlay['sourceId'],
        overlay['sourceKind'],
        overlay['confidence'],
    ]
        .map((value) => optionalString(value)?.toLowerCase() ?? '')
        .some((value) => value.includes(needle));
}

/**
 * @param {string} status
 * @param {boolean} expiredSignal
 * @returns {string}
 */
function limitNextAction(status, expiredSignal) {
    if (status === 'key_disabled') return 'enable_or_replace_provider_key';
    if (status === 'spending_exhausted') return 'raise_spending_limit_or_choose_free_model';
    if (status === 'quota_exhausted') return 'wait_for_quota_reset_or_choose_another_account';
    if (status === 'rate_limited') return 'wait_for_rate_limit_reset_or_choose_another_route';
    if (status === 'unknown') return 'collect_or_refresh_account_overlay';
    if (expiredSignal) return 'refresh_overlay_or_retry_pre_runtime_selection';
    return 'account_limits_do_not_block_pre_runtime';
}

/**
 * @param {string | null} sourceKind
 * @returns {'runtime' | 'account' | 'catalog' | 'unknown'}
 */
function limitSourceLayer(sourceKind) {
    if (sourceKind === 'runtime_health') return 'runtime';
    if (sourceKind && /account/iu.test(sourceKind)) return 'account';
    if (sourceKind) return 'catalog';
    return 'unknown';
}

/**
 * @param {Record<string, unknown>[]} overlays
 * @param {{ selector?: string | null; now?: string | number | Date }} [options]
 * @returns {{
 *   rows: Array<{
 *     accountOverlayId: string;
 *     providerId: string;
 *     accountScope: string;
 *     secretRef: string | null;
 *     sourceId: string | null;
 *     sourceKind: string;
 *     confidence: string;
 *     enabledModelCount: number;
 *     blockedModelCount: number;
 *     observedAt: string | null;
 *     expiresAt: string | null;
 *     limitStatus: string;
 *     retryAfterSeconds: number | null;
 *     resetAt: string | null;
 *     quotaResetActive: boolean;
 *     quotaResetExpired: boolean;
 *     remainingUsd: number | null;
 *     remainingCreditsUsd: number | null;
 *   }>;
 *   summary: { total: number; visible: number; matched: number; providers: number; statusCounts: Record<string, number> };
 * }}
 */
export function summarizeModelGatewayAccountOverlays(overlays, options = {}) {
    const selector = optionalString(options.selector);
    const rows = overlays
        .filter(isRecord)
        .filter((overlay) => matchesSelector(selector, overlay))
        .map((overlay) => {
            const limitOptions = options.now === undefined ? {} : { now: options.now };
            const limits = normalizeModelGatewayAccountLimitState(overlay, limitOptions);
            return {
                accountOverlayId: optionalString(overlay['accountOverlayId']) ?? [
                    optionalString(overlay['providerId']) ?? 'unknown-provider',
                    optionalString(overlay['accountScope']) ?? 'default',
                    optionalString(overlay['secretRef']) ?? 'no-secret',
                ].join(':'),
                providerId: optionalString(overlay['providerId']) ?? 'unknown-provider',
                accountScope: optionalString(overlay['accountScope']) ?? 'default',
                secretRef: optionalString(overlay['secretRef']),
                sourceId: optionalString(overlay['sourceId']),
                sourceKind: optionalString(overlay['sourceKind']) ?? 'unknown',
                confidence: optionalString(overlay['confidence']) ?? 'unknown',
                enabledModelCount: arrayLength(overlay['enabledModels']),
                blockedModelCount: arrayLength(overlay['blockedModels']),
                observedAt: optionalString(overlay['observedAt']),
                expiresAt: optionalString(overlay['expiresAt']),
                limitStatus: limits.status,
                retryAfterSeconds: limits.retryAfterSeconds,
                resetAt: limits.resetAt,
                quotaResetActive: limits.quota.resetActive,
                quotaResetExpired: limits.quota.resetExpired,
                remainingUsd: limits.spending.remainingUsd,
                remainingCreditsUsd: limits.quota.remainingCreditsUsd,
            };
        });
    const statusCounts = /** @type {Record<string, number>} */ ({});
    for (const row of rows) statusCounts[row.limitStatus] = (statusCounts[row.limitStatus] ?? 0) + 1;
    return {
        rows,
        summary: {
            total: overlays.filter(isRecord).length,
            visible: rows.length,
            matched: rows.length,
            providers: new Set(rows.map((row) => row.providerId)).size,
            statusCounts,
        },
    };
}

/**
 * Explains account/key limit overlays as pre-runtime blockers without mutating the canonical model catalog.
 *
 * @param {Record<string, unknown>[]} overlays
 * @param {{ selector?: string | null; now?: string | number | Date }} [options]
 * @returns {{
 *   rows: Array<{
 *     accountOverlayId: string;
 *     providerId: string;
 *     accountScope: string;
 *     secretRef: string | null;
 *     sourceId: string | null;
 *     sourceKind: string;
 *     sourceLayer: 'runtime' | 'account' | 'catalog' | 'unknown';
 *     confidence: string;
 *     limitStatus: string;
 *     activeBlocker: boolean;
 *     expiredSignal: boolean;
 *     temporaryBlocker: boolean;
 *     retryAfterSeconds: number | null;
 *     resetAt: string | null;
 *     expiresAt: string | null;
 *     remainingUsd: number | null;
 *     remainingCreditsUsd: number | null;
 *     failureKind: string | null;
 *     nextAction: string;
 *   }>;
 *   summary: {
 *     total: number;
 *     matched: number;
 *     providers: number;
 *     activeBlockers: number;
 *     expiredSignals: number;
 *     temporaryBlockers: number;
 *     byStatus: Record<string, number>;
 *     bySourceKind: Record<string, number>;
 *     bySourceLayer: Record<string, number>;
 *   };
 * }}
 */
export function explainModelGatewayAccountLimitOverlays(overlays, options = {}) {
    const selector = optionalString(options.selector);
    const nowMs = dateMs(options.now) ?? Date.now();
    const rows = overlays
        .filter(isRecord)
        .filter((overlay) => matchesSelector(selector, overlay))
        .map((overlay) => {
            const limits = normalizeModelGatewayAccountLimitState(overlay, options.now === undefined ? {} : { now: options.now });
            const sourceKind = optionalString(overlay['sourceKind']) ?? 'unknown';
            const providerMetadata = isRecord(overlay['providerMetadata']) ? overlay['providerMetadata'] : {};
            const expiresAt = optionalString(overlay['expiresAt']);
            const expiresAtMs = dateMs(expiresAt);
            const overlayExpired = expiresAtMs !== null && expiresAtMs <= nowMs;
            const expiredSignal = overlayExpired || limits.quota.resetExpired;
            const activeBlocker = !overlayExpired && !['ok', 'unknown'].includes(limits.status);
            const temporaryBlocker = activeBlocker && ['quota_exhausted', 'rate_limited'].includes(limits.status);
            return {
                accountOverlayId: optionalString(overlay['accountOverlayId']) ?? [
                    optionalString(overlay['providerId']) ?? 'unknown-provider',
                    optionalString(overlay['accountScope']) ?? 'default',
                    optionalString(overlay['secretRef']) ?? 'no-secret',
                ].join(':'),
                providerId: optionalString(overlay['providerId']) ?? 'unknown-provider',
                accountScope: optionalString(overlay['accountScope']) ?? 'default',
                secretRef: optionalString(overlay['secretRef']),
                sourceId: optionalString(overlay['sourceId']),
                sourceKind,
                sourceLayer: limitSourceLayer(sourceKind),
                confidence: optionalString(overlay['confidence']) ?? 'unknown',
                limitStatus: limits.status,
                activeBlocker,
                expiredSignal,
                temporaryBlocker,
                retryAfterSeconds: limits.retryAfterSeconds,
                resetAt: limits.resetAt,
                expiresAt,
                remainingUsd: limits.spending.remainingUsd,
                remainingCreditsUsd: limits.quota.remainingCreditsUsd,
                failureKind: optionalString(providerMetadata['failureKind']),
                nextAction: limitNextAction(limits.status, expiredSignal),
            };
        });
    rows.sort((left, right) => {
        if (left.activeBlocker !== right.activeBlocker) return left.activeBlocker ? -1 : 1;
        if (left.expiredSignal !== right.expiredSignal) return left.expiredSignal ? -1 : 1;
        const provider = left.providerId.localeCompare(right.providerId);
        if (provider !== 0) return provider;
        return left.accountOverlayId.localeCompare(right.accountOverlayId);
    });
    /** @type {Record<string, number>} */
    const byStatus = {};
    /** @type {Record<string, number>} */
    const bySourceKind = {};
    /** @type {Record<string, number>} */
    const bySourceLayer = {};
    for (const row of rows) {
        byStatus[row.limitStatus] = (byStatus[row.limitStatus] ?? 0) + 1;
        bySourceKind[row.sourceKind] = (bySourceKind[row.sourceKind] ?? 0) + 1;
        bySourceLayer[row.sourceLayer] = (bySourceLayer[row.sourceLayer] ?? 0) + 1;
    }
    return {
        rows,
        summary: {
            total: overlays.filter(isRecord).length,
            matched: rows.length,
            providers: new Set(rows.map((row) => row.providerId)).size,
            activeBlockers: rows.filter((row) => row.activeBlocker).length,
            expiredSignals: rows.filter((row) => row.expiredSignal).length,
            temporaryBlockers: rows.filter((row) => row.temporaryBlocker).length,
            byStatus,
            bySourceKind,
            bySourceLayer,
        },
    };
}
