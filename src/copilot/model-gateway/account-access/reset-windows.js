// @ts-check
/**
 * Account/key reset-window strategy.
 *
 * This module keeps volatile account blockers separate from canonical metadata. It answers three different questions
 * that should not be conflated:
 *
 * 1. Is there a known provider reset window that can unblock attempts automatically?
 * 2. When should the overlay be refreshed even if no reset window is known?
 * 3. How long may a temporary runtime/account signal be retained before it becomes stale evidence?
 *
 * @module copilot/model-gateway/account-access/reset-windows
 */

export const MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS = Object.freeze({
    NOT_BLOCKING: 'not_blocking',
    TEMPORARY: 'temporary',
    DURABLE: 'durable',
    EXPIRED: 'expired',
    UNKNOWN: 'unknown',
});

export const MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_SOURCE = Object.freeze({
    EXPLICIT_RESET_AT: 'explicit_reset_at',
    RETRY_AFTER: 'retry_after',
    RETENTION_ONLY: 'retention_only',
    NONE: 'none',
});

/** @type {Readonly<
    Record<string, { refreshSeconds: number; retentionSeconds: number; autoUnblockWithoutReset: boolean }>
>} */
const STATUS_POLICIES = Object.freeze({
    ok: { refreshSeconds: 3600, retentionSeconds: 3600, autoUnblockWithoutReset: false },
    unknown: { refreshSeconds: 900, retentionSeconds: 3600, autoUnblockWithoutReset: false },
    rate_limited: { refreshSeconds: 60, retentionSeconds: 3600, autoUnblockWithoutReset: true },
    quota_exhausted: { refreshSeconds: 900, retentionSeconds: 86400, autoUnblockWithoutReset: false },
    spending_exhausted: { refreshSeconds: 3600, retentionSeconds: 86400, autoUnblockWithoutReset: false },
    key_disabled: { refreshSeconds: 86400, retentionSeconds: 604800, autoUnblockWithoutReset: false },
});

/** @type {Readonly<Record<string, string>>} */
const FAILURE_KIND_STATUS = Object.freeze({
    auth: 'key_disabled',
    credits: 'quota_exhausted',
    'rate-limit': 'rate_limited',
});

const DEFAULT_STATUS_POLICY = Object.freeze({
    refreshSeconds: 900,
    retentionSeconds: 3600,
    autoUnblockWithoutReset: false,
});

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
 * @returns {string | number | Date | null}
 */
function optionalDateInput(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return value;
    return null;
}

/**
 * @param {number | null} ms
 * @returns {string | null}
 */
function iso(ms) {
    return ms === null ? null : new Date(ms).toISOString();
}

/**
 * @param {string | null} status
 * @param {string | null} failureKind
 * @returns {string}
 */
function normalizeStatus(status, failureKind) {
    const normalizedStatus = optionalString(status)?.toLowerCase().replaceAll('-', '_') ?? null;
    if (normalizedStatus && STATUS_POLICIES[normalizedStatus]) return normalizedStatus;
    const normalizedKind = optionalString(failureKind)?.toLowerCase();
    return (normalizedKind ? FAILURE_KIND_STATUS[normalizedKind] : null) ?? 'unknown';
}

/**
 * @param {string} status
 * @returns {{ refreshSeconds: number; retentionSeconds: number; autoUnblockWithoutReset: boolean }}
 */
function resolveStatusPolicy(status) {
    return STATUS_POLICIES[status] ?? DEFAULT_STATUS_POLICY;
}

/**
 * @param {object} input
 * @param {string | null} [input.status]
 * @param {string | null} [input.failureKind]
 * @param {number | null} [input.retryAfterSeconds]
 * @param {string | number | Date | null} [input.resetAt]
 * @param {string | number | Date | null} [input.observedAt]
 * @param {string | number | Date | null} [input.expiresAt]
 * @param {object} [options]
 * @param {string | number | Date} [options.now]
 * @returns {{
 *     status: string;
 *     failureKind: string | null;
 *     class: string;
 *     source: string;
 *     resetAt: string | null;
 *     resetKnown: boolean;
 *     resetActive: boolean;
 *     resetExpired: boolean;
 *     retryAfterSeconds: number | null;
 *     observedAt: string | null;
 *     nextRefreshAfter: string | null;
 *     retentionExpiresAt: string | null;
 *     autoUnblocksAt: string | null;
 *     blocksUntilRefresh: boolean;
 *     operatorAction: string;
 * }}
 */
export function resolveModelGatewayAccountResetWindow(input, options = {}) {
    const nowMs = dateMs(options.now) ?? Date.now();
    const failureKind = optionalString(input.failureKind)?.toLowerCase() ?? null;
    const status = normalizeStatus(input.status ?? null, failureKind);
    const policy = resolveStatusPolicy(status);
    const retryAfterSeconds = Math.max(0, optionalNumber(input.retryAfterSeconds) ?? 0) || null;
    const observedMs = dateMs(input.observedAt) ?? nowMs;
    const explicitResetMs = dateMs(input.resetAt);
    const retryResetMs = retryAfterSeconds !== null ? nowMs + retryAfterSeconds * 1000 : null;
    const resetMs = explicitResetMs ?? retryResetMs;
    const expiresMs = dateMs(input.expiresAt);
    const nextRefreshMs = resetMs ?? observedMs + policy.refreshSeconds * 1000;
    const retentionMs = expiresMs ?? observedMs + policy.retentionSeconds * 1000;
    const resetKnown = resetMs !== null;
    const resetActive = resetMs !== null && resetMs > nowMs;
    const resetExpired = resetMs !== null && resetMs <= nowMs;
    const notBlocking = status === 'ok';
    const durable = ['key_disabled', 'spending_exhausted'].includes(status);
    const className = notBlocking
        ? MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.NOT_BLOCKING
        : resetExpired
          ? MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.EXPIRED
          : resetActive || (retryAfterSeconds !== null && policy.autoUnblockWithoutReset)
            ? MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.TEMPORARY
            : durable
              ? MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.DURABLE
              : resetKnown
                ? MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.TEMPORARY
                : MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.UNKNOWN;
    const source =
        retryAfterSeconds !== null
            ? MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_SOURCE.RETRY_AFTER
            : explicitResetMs !== null
              ? MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_SOURCE.EXPLICIT_RESET_AT
              : notBlocking
                ? MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_SOURCE.NONE
                : MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_SOURCE.RETENTION_ONLY;
    const autoUnblocksAt = resetKnown && !durable ? iso(resetMs) : null;
    const blocksUntilRefresh = !notBlocking && !autoUnblocksAt;
    return {
        status,
        failureKind,
        class: className,
        source,
        resetAt: iso(resetMs),
        resetKnown,
        resetActive,
        resetExpired,
        retryAfterSeconds,
        observedAt: iso(observedMs),
        nextRefreshAfter: iso(nextRefreshMs),
        retentionExpiresAt: iso(retentionMs),
        autoUnblocksAt,
        blocksUntilRefresh,
        operatorAction: notBlocking
            ? 'none'
            : autoUnblocksAt
              ? 'wait_for_reset_or_choose_another_route'
              : status === 'key_disabled'
                ? 'enable_or_replace_provider_key'
                : status === 'spending_exhausted'
                  ? 'raise_spending_limit_or_choose_another_account'
                  : 'refresh_account_overlay_or_choose_another_route',
    };
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {Parameters<typeof resolveModelGatewayAccountResetWindow>[1]} [options]
 * @returns {{
 *     rows: (ReturnType<typeof resolveModelGatewayAccountResetWindow> & {
 *         providerId: string;
 *         accountOverlayId: string;
 *     })[];
 *     summary: {
 *         total: number;
 *         temporary: number;
 *         durable: number;
 *         expired: number;
 *         unknown: number;
 *         notBlocking: number;
 *         byClass: Record<string, number>;
 *     };
 * }}
 */
export function summarizeModelGatewayAccountResetWindows(rows, options = {}) {
    const normalized = (Array.isArray(rows) ? rows : []).map((row) => {
        const resetWindow = resolveModelGatewayAccountResetWindow(
            {
                status: optionalString(row['status']) ?? optionalString(row['limitStatus']),
                failureKind: optionalString(row['failureKind']),
                retryAfterSeconds: optionalNumber(row['retryAfterSeconds']),
                resetAt: optionalDateInput(row['resetAt']),
                observedAt: optionalDateInput(row['observedAt']),
                expiresAt: optionalDateInput(row['expiresAt']),
            },
            options,
        );
        return {
            providerId: optionalString(row['providerId']) ?? 'unknown-provider',
            accountOverlayId: optionalString(row['accountOverlayId']) ?? 'unknown-overlay',
            ...resetWindow,
        };
    });
    /** @type {Record<string, number>} */
    const byClass = {};
    for (const row of normalized) byClass[row.class] = (byClass[row.class] ?? 0) + 1;
    return {
        rows: normalized,
        summary: {
            total: normalized.length,
            temporary: normalized.filter((row) => row.class === MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.TEMPORARY)
                .length,
            durable: normalized.filter((row) => row.class === MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.DURABLE).length,
            expired: normalized.filter((row) => row.class === MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.EXPIRED).length,
            unknown: normalized.filter((row) => row.class === MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.UNKNOWN).length,
            notBlocking: normalized.filter((row) => row.class === MODEL_GATEWAY_ACCOUNT_RESET_WINDOW_CLASS.NOT_BLOCKING)
                .length,
            byClass,
        },
    };
}
