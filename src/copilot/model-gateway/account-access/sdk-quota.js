// @ts-check
/**
 * GitHub Copilot SDK quota normalization.
 *
 * AssistantUsageQuotaSnapshot is a host/SDK entitlement signal. It is useful for Copilot-native routes and operator
 * diagnostics, but it is intentionally not a BYOK provider quota and must not be mixed into provider account overlays.
 *
 * @module copilot/model-gateway/account-access/sdk-quota
 */

export const MODEL_GATEWAY_SDK_QUOTA_STATUS = Object.freeze({
    OK: 'ok',
    WARN: 'warn',
    CRITICAL: 'critical',
    EXHAUSTED: 'exhausted',
    UNLIMITED: 'unlimited',
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
 * @returns {number | null}
 */
function optionalNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function booleanValue(value) {
    return value === true;
}

/**
 * Some legacy RPC tests and older bridges reported 0..100 even though AssistantUsageQuotaSnapshot documents 0..1.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeRemainingFraction(value) {
    const number = optionalNumber(value);
    if (number === null) return null;
    if (number > 1 && number <= 100) return Math.max(0, Math.min(1, number / 100));
    return Math.max(0, Math.min(1, number));
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function isoDate(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {string}
 */
function quotaStatus(snapshot) {
    if (booleanValue(snapshot['isUnlimitedEntitlement'])) return MODEL_GATEWAY_SDK_QUOTA_STATUS.UNLIMITED;
    const remaining = normalizeRemainingFraction(snapshot['remainingPercentage']);
    if (remaining === null) return MODEL_GATEWAY_SDK_QUOTA_STATUS.UNKNOWN;
    if (remaining <= 0) return MODEL_GATEWAY_SDK_QUOTA_STATUS.EXHAUSTED;
    if (remaining <= 0.05) return MODEL_GATEWAY_SDK_QUOTA_STATUS.CRITICAL;
    if (remaining <= 0.2) return MODEL_GATEWAY_SDK_QUOTA_STATUS.WARN;
    return MODEL_GATEWAY_SDK_QUOTA_STATUS.OK;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function quotaSnapshotMap(value) {
    const record = isRecord(value) ? value : {};
    const snapshots = isRecord(record['quotaSnapshots']) ? record['quotaSnapshots'] : record;
    return isRecord(snapshots) ? snapshots : {};
}

/**
 * @param {unknown} input
 * @returns {{
 *   rows: Array<{
 *     quotaId: string;
 *     status: string;
 *     remainingFraction: number | null;
 *     remainingPercentage: number | null;
 *     entitlementRequests: number | null;
 *     usedRequests: number | null;
 *     overage: number | null;
 *     resetAt: string | null;
 *     isUnlimitedEntitlement: boolean;
 *     usageAllowedWithExhaustedQuota: boolean;
 *     overageAllowedWithExhaustedQuota: boolean;
 *     canBlockSdkNativeRoute: boolean;
 *     appliesToByokProviderRuntime: false;
 *     scope: 'copilot_sdk_entitlement';
 *   }>;
 *   summary: { total: number; status: string; worstRemainingFraction: number | null; blocked: number; appliesToByokProviderRuntime: false };
 * }}
 */
export function summarizeModelGatewaySdkQuotaSnapshots(input) {
    const rows = Object.entries(quotaSnapshotMap(input)).map(([quotaId, rawSnapshot]) => {
        const snapshot = isRecord(rawSnapshot) ? rawSnapshot : {};
        const remainingFraction = normalizeRemainingFraction(snapshot['remainingPercentage']);
        const isUnlimitedEntitlement = booleanValue(snapshot['isUnlimitedEntitlement']);
        const usageAllowedWithExhaustedQuota = booleanValue(snapshot['usageAllowedWithExhaustedQuota']);
        const overageAllowedWithExhaustedQuota = booleanValue(snapshot['overageAllowedWithExhaustedQuota']);
        const status = quotaStatus(snapshot);
        const exhausted = status === MODEL_GATEWAY_SDK_QUOTA_STATUS.EXHAUSTED;
        return {
            quotaId,
            status,
            remainingFraction,
            remainingPercentage: remainingFraction === null ? null : remainingFraction * 100,
            entitlementRequests: optionalNumber(snapshot['entitlementRequests']),
            usedRequests: optionalNumber(snapshot['usedRequests']),
            overage: optionalNumber(snapshot['overage']),
            resetAt: isoDate(snapshot['resetDate']),
            isUnlimitedEntitlement,
            usageAllowedWithExhaustedQuota,
            overageAllowedWithExhaustedQuota,
            canBlockSdkNativeRoute: exhausted && !usageAllowedWithExhaustedQuota && !overageAllowedWithExhaustedQuota && !isUnlimitedEntitlement,
            appliesToByokProviderRuntime: /** @type {false} */ (false),
            scope: /** @type {'copilot_sdk_entitlement'} */ ('copilot_sdk_entitlement'),
        };
    });
    const finiteRemaining = rows.map((row) => row.remainingFraction).filter((value) => value !== null);
    const worstRemainingFraction = finiteRemaining.length > 0 ? Math.min(...finiteRemaining) : null;
    const blocked = rows.filter((row) => row.canBlockSdkNativeRoute).length;
    const statuses = rows.map((row) => row.status);
    const status = blocked > 0
        ? MODEL_GATEWAY_SDK_QUOTA_STATUS.EXHAUSTED
        : statuses.includes(MODEL_GATEWAY_SDK_QUOTA_STATUS.EXHAUSTED)
          ? MODEL_GATEWAY_SDK_QUOTA_STATUS.EXHAUSTED
        : statuses.includes(MODEL_GATEWAY_SDK_QUOTA_STATUS.CRITICAL)
          ? MODEL_GATEWAY_SDK_QUOTA_STATUS.CRITICAL
          : statuses.includes(MODEL_GATEWAY_SDK_QUOTA_STATUS.WARN)
            ? MODEL_GATEWAY_SDK_QUOTA_STATUS.WARN
            : statuses.includes(MODEL_GATEWAY_SDK_QUOTA_STATUS.UNKNOWN)
              ? MODEL_GATEWAY_SDK_QUOTA_STATUS.UNKNOWN
              : MODEL_GATEWAY_SDK_QUOTA_STATUS.OK;
    return {
        rows,
        summary: {
            total: rows.length,
            status,
            worstRemainingFraction,
            blocked,
            appliesToByokProviderRuntime: /** @type {false} */ (false),
        },
    };
}
