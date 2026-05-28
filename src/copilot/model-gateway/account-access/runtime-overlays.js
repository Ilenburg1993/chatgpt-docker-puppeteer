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
    cerebras: 'CEREBRAS_API_KEY',
    chutes: 'CHUTES_API_KEY',
    'cloudflare-workers-ai': 'CLOUDFLARE_API_TOKEN',
    gemini: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    huggingface: 'HF_TOKEN',
    kilo: 'KILO_API_KEY',
    'kilo-code': 'KILO_CODE_API_KEY',
    'kilo-gateway': 'KILO_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    'nvidia-nim': 'NVIDIA_API_KEY',
    'ollama-cloud': 'OLLAMA_CLOUD_API_KEY',
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
 * @returns {string[]}
 */
function failureSignals(health) {
    const probes = isRecord(health['probes']) ? health['probes'] : {};
    const probeSignals = Object.values(probes)
        .filter(isRecord)
        .flatMap((probe) => [
            optionalString(probe['lastFailureKind']),
            optionalString(probe['lastErrorContext']),
            optionalString(probe['lastMessage']),
        ]);
    return [
        optionalString(health['runtimeClassifiedFailure']),
        optionalString(health['lastFailureKind']),
        optionalString(health['lastErrorContext']),
        optionalString(health['lastMessage']),
        optionalString(health['lastAgentProbeErrorContext']),
        optionalString(health['lastAgentProbeMessage']),
        ...probeSignals,
    ].filter((item) => item !== null);
}

/**
 * @param {Record<string, unknown>} health
 * @returns {number}
 */
function latestObservedMs(health) {
    const probes = isRecord(health['probes']) ? health['probes'] : {};
    const probeObserved = Object.values(probes)
        .filter(isRecord)
        .reduce((max, probe) => Math.max(max, dateMs(probe['lastAt']) ?? 0), 0);
    return Math.max(
        dateMs(health['runtimeObservedAtMs']) ?? 0,
        dateMs(health['lastFailureAt']) ?? 0,
        dateMs(health['lastAgentProbeFailureAt']) ?? 0,
        probeObserved,
    );
}

/**
 * @param {Record<string, unknown>} health
 * @returns {'auth' | 'credits' | 'rate-limit' | null}
 */
function inferRuntimeFailureKind(health) {
    for (const signal of failureSignals(health)) {
        if (/^(?:auth|credits|rate-limit)$/u.test(signal)) return /** @type {'auth' | 'credits' | 'rate-limit'} */ (signal);
        if (/provider\.credits|credit|credits|insufficient[_\s-]?quota|quota[_\s-]?exhausted|402\b/iu.test(signal)) {
            return 'credits';
        }
        if (/provider\.rate[_\s-]?limit|rate[_\s-]?limit|429\b|too many requests/iu.test(signal)) return 'rate-limit';
        if (/provider\.auth|auth|permission|unauthorized|forbidden|401\b|403\b/iu.test(signal)) return 'auth';
    }
    return null;
}

/**
 * @param {Record<string, unknown>} health
 * @param {object} options
 * @param {string} [options.accountScope]
 * @param {Record<string, string>} [options.secretRefsByProvider]
 * @param {number} [options.ttlSeconds]
 * @param {string[]} [options.accountWideFailureKinds]
 * @returns {Record<string, unknown> | null}
 */
export function deriveModelGatewayRuntimeAccountOverlayFromHealth(health, options = {}) {
    const failureKind = inferRuntimeFailureKind(health);
    if (!failureKind) return null;
    const providerId = optionalString(health['providerId']) ?? optionalString(health['provider']);
    if (!providerId) return null;
    const providerModel = optionalString(health['providerModel']) ?? optionalString(health['model']);
    const routeProfile = optionalString(health['routeProfile']) ?? optionalString(health['profile']);
    const observedMs = latestObservedMs(health) || Date.now();
    const retryAfterSeconds = optionalNumber(health['lastRetryAfterSeconds']);
    const resetAt = resolveResetAt(observedMs, retryAfterSeconds, optionalString(health['lastResetAt']));
    const ttlSeconds = optionalNumber(options.ttlSeconds) ?? DEFAULT_RUNTIME_OVERLAY_TTL_SECONDS;
    const secretRefsByProvider = isRecord(options.secretRefsByProvider)
        ? /** @type {Record<string, string>} */ (options.secretRefsByProvider)
        : {};
    const secretRef = defaultSecretRef(providerId, secretRefsByProvider);
    const accountWideFailureKinds = new Set(
        Array.isArray(options.accountWideFailureKinds)
            ? options.accountWideFailureKinds.map(optionalString).filter((item) => item !== null)
            : [],
    );
    const accountWide = accountWideFailureKinds.has(failureKind);
    const sourceModelPart = accountWide || !providerModel ? 'provider' : providerModel.replace(/[^a-z0-9_.-]+/giu, '_');
    const sourceId = `runtime-health-${failureKind}`;
    return /** @type {Record<string, unknown>} */ (createProviderAccountOverlay({
        accountOverlayId: `runtime-health:${providerId}:${options.accountScope ?? 'default'}:${sourceModelPart}:${failureKind}`,
        providerId,
        accountScope: options.accountScope ?? 'default',
        ...(secretRef ? { secretRef } : {}),
        sourceId,
        sourceKind: 'runtime_health',
        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.PROBE_FAILED,
        enabledModels: accountWide || !providerModel ? [] : [providerModel],
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
            accountWide,
            failureStatusCode: optionalNumber(health['lastFailureStatusCode']),
            disabled: failureKind === 'auth',
            observedFromHealthKey: optionalString(health['key']),
            runtimeObservedAtMs: optionalNumber(health['runtimeObservedAtMs']),
            runtimeHealthStatus: optionalString(health['runtimeHealthStatus']),
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
 * @param {string[]} [options.accountWideFailureKinds]
 * @returns {Record<string, unknown>[]}
 */
export function deriveModelGatewayRuntimeAccountOverlaysFromHealth(healthRecords, options = {}) {
    return (Array.isArray(healthRecords) ? healthRecords : [])
        .filter(isRecord)
        .map((health) => deriveModelGatewayRuntimeAccountOverlayFromHealth(health, options))
        .filter((overlay) => overlay !== null);
}

/**
 * @param {Record<string, unknown>[]} overlays
 * @param {object} [options]
 * @param {number} [options.maxItems]
 * @param {number} [options.maxModelsPerOverlay]
 * @param {string | number | Date} [options.now]
 * @returns {{
 *   total: number,
 *   activeCount: number,
 *   expiredCount: number,
 *   byProvider: Record<string, number>,
 *   byFailureKind: Record<string, number>,
 *   items: Array<{
 *     providerId: string,
 *     failureKind: string,
 *     modelCount: number,
 *     models: string[],
 *     sourceKind: string | null,
 *     expired: boolean,
 *     disabled: boolean,
 *     retryAfterSeconds: number | null,
 *     resetAt: string | null,
 *     expiresAt: string | null,
 *   }>,
 * }}
 */
export function summarizeModelGatewayRuntimeAccountOverlays(overlays, options = {}) {
    const maxItems = Math.max(0, optionalNumber(options.maxItems) ?? 8);
    const maxModelsPerOverlay = Math.max(0, optionalNumber(options.maxModelsPerOverlay) ?? 3);
    const nowMs = dateMs(options.now) ?? Date.now();
    /** @type {Record<string, number>} */
    const byProvider = {};
    /** @type {Record<string, number>} */
    const byFailureKind = {};
    let activeCount = 0;
    let expiredCount = 0;
    const normalized = (Array.isArray(overlays) ? overlays : []).filter(isRecord).map((overlay) => {
        const providerId = optionalString(overlay['providerId']) ?? 'unknown';
        const providerMetadata = isRecord(overlay['providerMetadata']) ? overlay['providerMetadata'] : {};
        const rateLimits = isRecord(overlay['rateLimits']) ? overlay['rateLimits'] : {};
        const failureKind = optionalString(providerMetadata['failureKind']) ?? 'unknown';
        const expiresAt = optionalString(overlay['expiresAt']);
        const expiresAtMs = dateMs(expiresAt);
        const expired = expiresAtMs !== null && expiresAtMs <= nowMs;
        const enabledModels = Array.isArray(overlay['enabledModels'])
            ? overlay['enabledModels'].filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
            : [];
        byProvider[providerId] = (byProvider[providerId] ?? 0) + 1;
        byFailureKind[failureKind] = (byFailureKind[failureKind] ?? 0) + 1;
        if (expired) expiredCount += 1;
        else activeCount += 1;
        return {
            providerId,
            failureKind,
            modelCount: enabledModels.length,
            models: enabledModels.slice(0, maxModelsPerOverlay),
            sourceKind: optionalString(overlay['sourceKind']),
            expired,
            disabled: providerMetadata['disabled'] === true,
            retryAfterSeconds: optionalNumber(rateLimits['retryAfterSeconds']),
            resetAt: optionalString(rateLimits['resetAt']),
            expiresAt,
        };
    });
    normalized.sort((left, right) => {
        const provider = left.providerId.localeCompare(right.providerId);
        if (provider !== 0) return provider;
        const failure = left.failureKind.localeCompare(right.failureKind);
        if (failure !== 0) return failure;
        return left.models.join(',').localeCompare(right.models.join(','));
    });
    return {
        total: normalized.length,
        activeCount,
        expiredCount,
        byProvider,
        byFailureKind,
        items: normalized.slice(0, maxItems),
    };
}
