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
