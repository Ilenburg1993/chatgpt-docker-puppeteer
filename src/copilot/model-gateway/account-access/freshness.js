// @ts-check
/**
 * Account overlay freshness policy.
 *
 * Freshness is account/provider scoped. It is used to decide whether an overlay is still safe enough for pre-runtime
 * admission; it never mutates canonical model metadata.
 *
 * @module copilot/model-gateway/account-access/freshness
 */

export const MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS = Object.freeze({
    FRESH: 'fresh',
    STALE: 'stale',
    EXPIRED: 'expired',
    UNKNOWN: 'unknown',
});

const DEFAULT_ACCOUNT_OVERLAY_TTL_SECONDS = 3600;
const DEFAULT_STALE_RATIO = 0.8;

/** @type {Readonly<Record<string, number>>} */
const PROVIDER_TTL_SECONDS = Object.freeze({
    'cloudflare-workers-ai': 900,
    kilo: 900,
    'kilo-code': 900,
    'kilo-gateway': 900,
    'ollama-local': 300,
    openrouter: 900,
});

/** @type {Readonly<Record<string, number>>} */
const SOURCE_KIND_TTL_SECONDS = Object.freeze({
    local_daemon: 300,
    runtime_health: 3600,
    authenticated_account_api: 900,
    authenticated_api: 3600,
    public_api: 86400,
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
 * @param {Record<string, unknown>} overlay
 * @param {object} [options]
 * @param {number} [options.defaultTtlSeconds]
 * @param {Record<string, number>} [options.providerTtlSeconds]
 * @param {Record<string, number>} [options.sourceKindTtlSeconds]
 * @returns {{
 *     providerId: string;
 *     sourceKind: string;
 *     ttlSeconds: number;
 *     staleAfterSeconds: number;
 *     policySource: 'provider' | 'source_kind' | 'default';
 * }}
 */
export function resolveModelGatewayAccountOverlayFreshnessPolicy(overlay, options = {}) {
    const providerId = optionalString(overlay['providerId']) ?? 'unknown-provider';
    const sourceKind = optionalString(overlay['sourceKind']) ?? 'unknown';
    const providerTtl = optionalNumber(options.providerTtlSeconds?.[providerId]) ?? PROVIDER_TTL_SECONDS[providerId];
    const sourceKindTtl =
        optionalNumber(options.sourceKindTtlSeconds?.[sourceKind]) ?? SOURCE_KIND_TTL_SECONDS[sourceKind];
    const defaultTtl = optionalNumber(options.defaultTtlSeconds) ?? DEFAULT_ACCOUNT_OVERLAY_TTL_SECONDS;
    const ttlSeconds = Math.max(1, Math.floor(providerTtl ?? sourceKindTtl ?? defaultTtl));
    return {
        providerId,
        sourceKind,
        ttlSeconds,
        staleAfterSeconds: Math.max(1, Math.floor(ttlSeconds * DEFAULT_STALE_RATIO)),
        policySource: providerTtl !== undefined ? 'provider' : sourceKindTtl !== undefined ? 'source_kind' : 'default',
    };
}

/**
 * @param {Record<string, unknown>} overlay
 * @param {object} [options]
 * @param {string | number | Date} [options.now]
 * @param {number} [options.defaultTtlSeconds]
 * @param {Record<string, number>} [options.providerTtlSeconds]
 * @param {Record<string, number>} [options.sourceKindTtlSeconds]
 * @returns {{
 *     status: string;
 *     fresh: boolean;
 *     stale: boolean;
 *     expired: boolean;
 *     observedAt: string | null;
 *     expiresAt: string | null;
 *     effectiveExpiresAt: string | null;
 *     ageSeconds: number | null;
 *     ttlSeconds: number;
 *     staleAfterSeconds: number;
 *     policySource: 'provider' | 'source_kind' | 'default';
 * }}
 */
export function evaluateModelGatewayAccountOverlayFreshness(overlay, options = {}) {
    const policy = resolveModelGatewayAccountOverlayFreshnessPolicy(overlay, options);
    const nowMs = dateMs(options.now) ?? Date.now();
    const observedMs = dateMs(overlay['observedAt']);
    const explicitExpiresMs = dateMs(overlay['expiresAt']);
    const effectiveExpiresMs =
        explicitExpiresMs ?? (observedMs === null ? null : observedMs + policy.ttlSeconds * 1000);
    const ageSeconds = observedMs === null ? null : Math.max(0, Math.floor((nowMs - observedMs) / 1000));
    const expired = effectiveExpiresMs !== null && effectiveExpiresMs <= nowMs;
    const stale = !expired && ageSeconds !== null && ageSeconds >= policy.staleAfterSeconds;
    const status = expired
        ? MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS.EXPIRED
        : stale
          ? MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS.STALE
          : observedMs === null
            ? MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS.UNKNOWN
            : MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS.FRESH;
    return {
        status,
        fresh: status === MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS.FRESH,
        stale,
        expired,
        observedAt: observedMs === null ? null : new Date(observedMs).toISOString(),
        expiresAt: explicitExpiresMs === null ? null : new Date(explicitExpiresMs).toISOString(),
        effectiveExpiresAt: effectiveExpiresMs === null ? null : new Date(effectiveExpiresMs).toISOString(),
        ageSeconds,
        ttlSeconds: policy.ttlSeconds,
        staleAfterSeconds: policy.staleAfterSeconds,
        policySource: policy.policySource,
    };
}

/**
 * @param {Record<string, unknown>[]} overlays
 * @param {Parameters<typeof evaluateModelGatewayAccountOverlayFreshness>[1]} [options]
 * @returns {{
 *     rows: (ReturnType<typeof evaluateModelGatewayAccountOverlayFreshness> & {
 *         providerId: string;
 *         accountOverlayId: string;
 *         sourceKind: string;
 *     })[];
 *     summary: {
 *         total: number;
 *         fresh: number;
 *         stale: number;
 *         expired: number;
 *         unknown: number;
 *         byStatus: Record<string, number>;
 *     };
 * }}
 */
export function summarizeModelGatewayAccountOverlayFreshness(overlays, options = {}) {
    const rows = (Array.isArray(overlays) ? overlays : []).filter(isRecord).map((overlay) => {
        const freshness = evaluateModelGatewayAccountOverlayFreshness(overlay, options);
        return {
            providerId: optionalString(overlay['providerId']) ?? 'unknown-provider',
            accountOverlayId: optionalString(overlay['accountOverlayId']) ?? 'unknown-overlay',
            sourceKind: optionalString(overlay['sourceKind']) ?? 'unknown',
            ...freshness,
        };
    });
    /** @type {Record<string, number>} */
    const byStatus = {};
    for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    return {
        rows,
        summary: {
            total: rows.length,
            fresh: rows.filter((row) => row.status === MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS.FRESH).length,
            stale: rows.filter((row) => row.status === MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS.STALE).length,
            expired: rows.filter((row) => row.status === MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS.EXPIRED).length,
            unknown: rows.filter((row) => row.status === MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS.UNKNOWN).length,
            byStatus,
        },
    };
}
