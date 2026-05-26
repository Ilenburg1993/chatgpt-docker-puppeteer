// @ts-check
/**
 * Dynamic account/key limit normalization.
 *
 * These facts are operator/account scoped and intentionally separate from canonical model metadata. They may change
 * minute by minute, so pre-runtime admission can use them as temporary gates without mutating the global catalog.
 *
 * @module copilot/model-gateway/account-access/limits
 */

export const MODEL_GATEWAY_ACCOUNT_LIMIT_STATUS = Object.freeze({
    OK: 'ok',
    UNKNOWN: 'unknown',
    KEY_DISABLED: 'key_disabled',
    SPENDING_EXHAUSTED: 'spending_exhausted',
    QUOTA_EXHAUSTED: 'quota_exhausted',
    RATE_LIMITED: 'rate_limited',
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
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function optionalBoolean(value) {
    if (value === true || value === false) return value;
    if (typeof value !== 'string') return null;
    const token = value.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(token)) return true;
    if (['false', 'no', '0'].includes(token)) return false;
    return null;
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
 * @returns {string | null}
 */
function isoDate(value) {
    const ms = dateMs(value);
    return ms === null ? null : new Date(ms).toISOString();
}

/**
 * @param {Record<string, unknown>} record
 * @param {readonly string[]} keys
 * @returns {number | null}
 */
function firstNumber(record, keys) {
    for (const key of keys) {
        const value = optionalNumber(record[key]);
        if (value !== null) return value;
    }
    return null;
}

/**
 * @param {Record<string, unknown>} record
 * @param {readonly string[]} keys
 * @returns {string | null}
 */
function firstString(record, keys) {
    for (const key of keys) {
        const value = optionalString(record[key]);
        if (value) return value;
    }
    return null;
}

/**
 * @param {Record<string, unknown>} record
 * @param {readonly string[]} keys
 * @returns {boolean | null}
 */
function firstBoolean(record, keys) {
    for (const key of keys) {
        const value = optionalBoolean(record[key]);
        if (value !== null) return value;
    }
    return null;
}

/**
 * @param {Record<string, unknown>} rateLimits
 * @param {number} nowMs
 * @returns {{ limited: boolean; retryAfterSeconds: number | null; resetAt: string | null; remainingRequests: number | null; remainingTokens: number | null; limitRequests: number | null; limitTokens: number | null }}
 */
function normalizeRateLimitState(rateLimits, nowMs) {
    const retryAfterSeconds = firstNumber(rateLimits, ['retryAfterSeconds', 'retry_after_seconds', 'retryAfter']);
    const resetAt =
        isoDate(firstString(rateLimits, ['resetAt', 'reset_at', 'requestsResetAt', 'tokensResetAt'])) ??
        (retryAfterSeconds !== null && retryAfterSeconds > 0 ? new Date(nowMs + retryAfterSeconds * 1000).toISOString() : null);
    const remainingRequests = firstNumber(rateLimits, [
        'remainingRequests',
        'requestsRemaining',
        'remaining_requests',
        'x-ratelimit-remaining-requests',
    ]);
    const remainingTokens = firstNumber(rateLimits, [
        'remainingTokens',
        'tokensRemaining',
        'remaining_tokens',
        'x-ratelimit-remaining-tokens',
    ]);
    const limitRequests = firstNumber(rateLimits, ['limitRequests', 'requestsLimit', 'requests', 'requestsPerMinute']);
    const limitTokens = firstNumber(rateLimits, ['limitTokens', 'tokensLimit', 'tokens', 'tokensPerMinute']);
    const resetMs = resetAt ? dateMs(resetAt) : null;
    const activeReset = resetMs !== null && resetMs > nowMs;
    const explicitLimited = firstBoolean(rateLimits, ['limited', 'rateLimited', 'exhausted']) === true;
    const remainingZero = remainingRequests === 0 || remainingTokens === 0;
    const retryActive = retryAfterSeconds !== null && retryAfterSeconds > 0;
    return {
        limited: (explicitLimited || retryActive || remainingZero) && (resetMs === null || activeReset || retryActive),
        retryAfterSeconds,
        resetAt,
        remainingRequests,
        remainingTokens,
        limitRequests,
        limitTokens,
    };
}

/**
 * @param {{ resetAt: string | null }} quotaState
 * @param {number} nowMs
 * @returns {{ resetActive: boolean; resetExpired: boolean }}
 */
function quotaResetWindow(quotaState, nowMs) {
    const resetMs = dateMs(quotaState.resetAt);
    return {
        resetActive: resetMs !== null && resetMs > nowMs,
        resetExpired: resetMs !== null && resetMs <= nowMs,
    };
}

/**
 * @param {Record<string, any>} overlay
 * @param {{ now?: string | number | Date }} [options]
 * @returns {{
 *   status: string;
 *   keyDisabled: boolean;
 *   spendingExhausted: boolean;
 *   quotaExhausted: boolean;
 *   rateLimited: boolean;
 *   retryAfterSeconds: number | null;
 *   resetAt: string | null;
 *   spending: { limitUsd: number | null; usageUsd: number | null; remainingUsd: number | null; unlimited: boolean };
 *   quota: { remainingCreditsUsd: number | null; dailyRequests: number | null; dailyTokens: number | null; resetAt: string | null; resetActive: boolean; resetExpired: boolean };
 *   rateLimit: ReturnType<typeof normalizeRateLimitState>;
 * }}
 */
export function normalizeModelGatewayAccountLimitState(overlay, options = {}) {
    const nowMs = dateMs(options.now) ?? Date.now();
    const providerMetadata = isRecord(overlay['providerMetadata']) ? overlay['providerMetadata'] : {};
    const spendingLimits = isRecord(overlay['spendingLimits']) ? overlay['spendingLimits'] : {};
    const quota = isRecord(overlay['quota']) ? overlay['quota'] : {};
    const rateLimits = isRecord(overlay['rateLimits']) ? overlay['rateLimits'] : {};
    const spending = {
        limitUsd: firstNumber(spendingLimits, ['limitUsd', 'hardLimitUsd', 'monthlyBudgetUsd']),
        usageUsd: firstNumber(spendingLimits, ['usageUsd', 'usedUsd']),
        remainingUsd: firstNumber(spendingLimits, ['remainingUsd', 'remainingCreditsUsd']),
        unlimited: firstBoolean(spendingLimits, ['unlimited']) === true,
    };
    const quotaState = {
        remainingCreditsUsd: firstNumber(quota, ['remainingCreditsUsd', 'remainingUsd']),
        dailyRequests: firstNumber(quota, ['dailyRequests', 'requestsPerDay']),
        dailyTokens: firstNumber(quota, ['dailyTokens', 'tokensPerDay']),
        resetAt: isoDate(firstString(quota, ['resetAt', 'quotaResetAt', 'dailyResetAt', 'monthlyResetAt', 'creditResetAt'])),
    };
    const quotaWindow = quotaResetWindow(quotaState, nowMs);
    const quotaResetNoLongerBlocks = quotaWindow.resetExpired;
    const rateLimit = normalizeRateLimitState(rateLimits, nowMs);
    const keyDisabled =
        firstBoolean(providerMetadata, ['disabled', 'keyDisabled', 'apiKeyDisabled']) === true ||
        firstBoolean(overlay, ['disabled', 'keyDisabled']) === true;
    const spendingExhausted = spending.remainingUsd !== null && spending.remainingUsd <= 0 && !spending.unlimited;
    const quotaExhausted =
        !quotaResetNoLongerBlocks &&
        ((quotaState.remainingCreditsUsd !== null && quotaState.remainingCreditsUsd <= 0) ||
            (quotaState.dailyRequests !== null && quotaState.dailyRequests <= 0) ||
            (quotaState.dailyTokens !== null && quotaState.dailyTokens <= 0));
    const status = keyDisabled
        ? MODEL_GATEWAY_ACCOUNT_LIMIT_STATUS.KEY_DISABLED
        : spendingExhausted
          ? MODEL_GATEWAY_ACCOUNT_LIMIT_STATUS.SPENDING_EXHAUSTED
          : quotaExhausted
            ? MODEL_GATEWAY_ACCOUNT_LIMIT_STATUS.QUOTA_EXHAUSTED
            : rateLimit.limited
              ? MODEL_GATEWAY_ACCOUNT_LIMIT_STATUS.RATE_LIMITED
              : MODEL_GATEWAY_ACCOUNT_LIMIT_STATUS.OK;
    return {
        status,
        keyDisabled,
        spendingExhausted,
        quotaExhausted,
        rateLimited: rateLimit.limited,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        resetAt: rateLimit.resetAt ?? quotaState.resetAt,
        spending,
        quota: { ...quotaState, ...quotaWindow },
        rateLimit,
    };
}
