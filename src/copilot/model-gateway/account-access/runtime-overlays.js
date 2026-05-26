// @ts-check
/**
 * Runtime-health derived account overlays.
 *
 * These overlays are volatile projections from already-observed runtime failures. They do not execute providers and do
 * not belong to canonical model metadata; they let pre-runtime UX reason about active account/key blockers collected by
 * probes or live turns.
 *
 * @module copilot/model-gateway/account-access/runtime-overlays
 */

import { MODEL_GATEWAY_CATALOG_CONFIDENCE, createProviderAccountOverlay } from '../catalog/contracts.js';

const DEFAULT_RUNTIME_OVERLAY_TTL_SECONDS = 3600;

/** @type {Readonly<Record<string, string>>} */
const DEFAULT_SECRET_REF_BY_PROVIDER = Object.freeze({
    anthropic: 'ANTHROPIC_API_KEY',
    'cloudflare-workers-ai': 'CLOUDFLARE_API_TOKEN',
    gemini: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    huggingface: 'HF_TOKEN',
    kilo: 'KILO_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    'nvidia-nim': 'NVIDIA_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    zai: 'ZAI_API_KEY',
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
 * @param {number | null} observedMs
 * @param {number | null} retryAfterSeconds
 * @param {string | null} resetAt
 * @returns {string | null}
 */
function resolveResetAt(observedMs, retryAfterSeconds, resetAt) {
    const resetMs = dateMs(resetAt);
    if (resetMs !== null) return new Date(resetMs).toISOString();
    if (observedMs !== null && retryAfterSeconds !== null && retryAfterSeconds > 0) {
        return new Date(observedMs + retryAfterSeconds * 1000).toISOString();
    }
    return null;
}

/**
 * @param {number} observedMs
 * @param {string | null} resetAt
 * @param {number} ttlSeconds
 * @returns {string}
 */
function resolveExpiresAt(observedMs, resetAt, ttlSeconds) {
    const resetMs = dateMs(resetAt);
    if (resetMs !== null && resetMs > observedMs) return new Date(resetMs).toISOString();
    return new Date(observedMs + ttlSeconds * 1000).toISOString();
}

/**
 * @param {string} providerId
 * @param {Record<string, string>} overrides
 * @returns {string | null}
 */
function defaultSecretRef(providerId, overrides) {
    return overrides[providerId] ?? DEFAULT_SECRET_REF_BY_PROVIDER[providerId] ?? null;
}

/**
 * @param {Record<string, unknown>} health
 * @param {object} options
 * @param {string} [options.accountScope]
 * @param {Record<string, string>} [options.secretRefsByProvider]
 * @param {number} [options.ttlSeconds]
 * @returns {Record<string, unknown> | null}
 */
export function deriveModelGatewayRuntimeAccountOverlayFromHealth(health, options = {}) {
    const failureKind = optionalString(health['lastFailureKind']);
    if (!['auth', 'credits', 'rate-limit'].includes(failureKind ?? '')) return null;
    const providerId = optionalString(health['providerId']) ?? optionalString(health['provider']);
    if (!providerId) return null;
    const providerModel = optionalString(health['providerModel']) ?? optionalString(health['model']);
    const routeProfile = optionalString(health['routeProfile']) ?? optionalString(health['profile']);
    const observedMs = dateMs(health['lastFailureAt']) ?? Date.now();
    const retryAfterSeconds = optionalNumber(health['lastRetryAfterSeconds']);
    const resetAt = resolveResetAt(observedMs, retryAfterSeconds, optionalString(health['lastResetAt']));
    const ttlSeconds = optionalNumber(options.ttlSeconds) ?? DEFAULT_RUNTIME_OVERLAY_TTL_SECONDS;
    const secretRefsByProvider = isRecord(options.secretRefsByProvider)
        ? /** @type {Record<string, string>} */ (options.secretRefsByProvider)
        : {};
    const secretRef = defaultSecretRef(providerId, secretRefsByProvider);
    const sourceModelPart = providerModel ? providerModel.replace(/[^a-z0-9_.-]+/giu, '_') : 'provider';
    const sourceId = `runtime-health-${failureKind}`;
    return /** @type {Record<string, unknown>} */ (createProviderAccountOverlay({
        accountOverlayId: `runtime-health:${providerId}:${options.accountScope ?? 'default'}:${sourceModelPart}:${failureKind}`,
        providerId,
        accountScope: options.accountScope ?? 'default',
        ...(secretRef ? { secretRef } : {}),
        sourceId,
        sourceKind: 'runtime_health',
        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.PROBE_FAILED,
        enabledModels: providerModel ? [providerModel] : [],
        quota: failureKind === 'credits' ? { remainingCreditsUsd: 0, resetAt } : {},
        spendingLimits: failureKind === 'credits' ? { remainingUsd: 0 } : {},
        rateLimits:
            failureKind === 'rate-limit'
                ? {
                      limited: true,
                      remainingRequests: 0,
                      retryAfterSeconds,
                      resetAt,
                  }
                : {},
        providerMetadata: {
            semantics: 'runtime_failure_account_overlay',
            routeProfile,
            failureKind,
            failureStatusCode: optionalNumber(health['lastFailureStatusCode']),
            disabled: failureKind === 'auth',
            observedFromHealthKey: optionalString(health['key']),
        },
        observedAt: observedMs,
        expiresAt: resolveExpiresAt(observedMs, resetAt, ttlSeconds),
    }));
}

/**
 * @param {unknown[]} healthRecords
 * @param {object} [options]
 * @param {string} [options.accountScope]
 * @param {Record<string, string>} [options.secretRefsByProvider]
 * @param {number} [options.ttlSeconds]
 * @returns {Record<string, unknown>[]}
 */
export function deriveModelGatewayRuntimeAccountOverlaysFromHealth(healthRecords, options = {}) {
    return (Array.isArray(healthRecords) ? healthRecords : [])
        .filter(isRecord)
        .map((health) => deriveModelGatewayRuntimeAccountOverlayFromHealth(health, options))
        .filter((overlay) => overlay !== null);
}
