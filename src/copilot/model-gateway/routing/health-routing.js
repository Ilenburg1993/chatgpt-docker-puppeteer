// @ts-check
/**
 * Health-aware routing predicates for gateway model candidates.
 *
 * This module is intentionally independent from terminal rendering. It turns runtime-proved provider/model health into
 * routing facts that registry, policy engine and terminal UX can share.
 *
 * @module copilot/model-gateway/routing/health-routing
 */

import {
    byokProviderHealthRecordLastObservedAt,
    listByokProviderModelHealth,
    readByokProviderModelHealth,
} from '../health/index.js';

export const MODEL_GATEWAY_LIVE_PROTOCOL_PROBE_KINDS = Object.freeze(['live_tool_protocol', 'live_ask_user']);
export const MODEL_GATEWAY_PROVIDER_COOLDOWN_FAILURE_KINDS = Object.freeze([
    'timeout',
    'network',
    'upstream',
    'model-or-route',
]);
const DEFAULT_PROVIDER_COOLDOWN_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_PROVIDER_COOLDOWN_MIN_FAILED_MODELS = 2;
const DEFAULT_MODEL_TEMPORARY_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const TEMPORARY_MODEL_FAILURE_KINDS = Object.freeze(['timeout', 'network', 'upstream', 'rate-limit', 'unknown']);

/**
 * @param {{ lastStatus: 'failed' | 'ok' | null; lastFailureAt: number | null; lastSuccessAt: number | null }} health
 * @returns {boolean}
 */
export function isGatewayModelChatHealthFailed(health) {
    return health.lastStatus === 'failed' && (health.lastFailureAt ?? 0) >= (health.lastSuccessAt ?? 0);
}

/**
 * @param {{ agentProbeStatus?: 'failed' | 'ok' | null; lastAgentProbeFailureAt?: number | null; lastAgentProbeSuccessAt?: number | null }} health
 * @returns {boolean}
 */
export function isGatewayModelAgentProbeHealthFailed(health) {
    return (
        health.agentProbeStatus === 'failed' &&
        (health.lastAgentProbeFailureAt ?? 0) >= (health.lastAgentProbeSuccessAt ?? 0)
    );
}

/**
 * @param {{ agentProbeStatus?: 'failed' | 'ok' | null; lastAgentProbeFailureAt?: number | null; lastAgentProbeSuccessAt?: number | null }} health
 * @returns {boolean}
 */
export function isGatewayModelAgentProbeVerified(health) {
    return (
        health.agentProbeStatus === 'ok' &&
        (health.lastAgentProbeSuccessAt ?? 0) >= (health.lastAgentProbeFailureAt ?? 0)
    );
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeProbeKind(value) {
    return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {Record<string, any>} record
 * @returns {{ routeProfile: string | null; providerId: string | null; providerModel: string | null }}
 */
function healthIdentity(record) {
    return {
        routeProfile: optionalString(record['routeProfile']) ?? optionalString(record['profile']),
        providerId: optionalString(record['providerId']) ?? optionalString(record['provider']),
        providerModel: optionalString(record['providerModel']) ?? optionalString(record['model']),
    };
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
 * @returns {number | null}
 */
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveNumber(value, fallback) {
    const number = optionalNumber(value);
    return number !== null && number > 0 ? number : fallback;
}

/**
 * @param {Record<string, any>} record
 * @returns {number}
 */
function latestProviderSuccessAt(record) {
    const probes = record && typeof record['probes'] === 'object' && !Array.isArray(record['probes']) ? record['probes'] : {};
    const probeSuccessAt = Object.values(probes)
        .filter((probe) => probe && typeof probe === 'object' && !Array.isArray(probe))
        .reduce((max, probe) => {
            const item = /** @type {Record<string, unknown>} */ (probe);
            return item['ok'] === true ? Math.max(max, optionalNumber(item['lastAt']) ?? 0) : max;
        }, 0);
    return Math.max(
        optionalNumber(record['lastSuccessAt']) ?? 0,
        optionalNumber(record['lastAgentProbeSuccessAt']) ?? 0,
        record['runtimeHealthStatus'] === 'ok' ? (optionalNumber(record['runtimeObservedAtMs']) ?? 0) : 0,
        probeSuccessAt,
    );
}

/**
 * @param {Record<string, any>} record
 * @returns {{ at: number; kind: string | null; model: string | null; record: Record<string, any> } | null}
 */
function latestProviderFailure(record) {
    const probes = record && typeof record['probes'] === 'object' && !Array.isArray(record['probes']) ? record['probes'] : {};
    const candidates = [
        {
            at: optionalNumber(record['lastFailureAt']) ?? 0,
            kind: optionalString(record['lastFailureKind']) ?? optionalString(record['runtimeClassifiedFailure']),
        },
        {
            at: optionalNumber(record['lastAgentProbeFailureAt']) ?? 0,
            kind: optionalString(record['lastAgentProbeFailureKind']) ?? optionalString(record['lastAgentProbeErrorContext']),
        },
        {
            at: record['runtimeHealthStatus'] === 'failed' ? (optionalNumber(record['runtimeObservedAtMs']) ?? 0) : 0,
            kind: optionalString(record['runtimeClassifiedFailure']),
        },
        ...Object.values(probes)
            .filter((probe) => probe && typeof probe === 'object' && !Array.isArray(probe))
            .map((probe) => {
                const item = /** @type {Record<string, unknown>} */ (probe);
                return {
                    at: optionalNumber(item['lastAt']) ?? 0,
                    kind: optionalString(item['lastFailureKind']) ?? optionalString(item['lastErrorContext']),
                };
            }),
    ]
        .filter((candidate) => candidate.at > 0)
        .sort((left, right) => right.at - left.at);
    const latest = candidates[0];
    if (!latest) return null;
    return {
        at: latest.at,
        kind: normalizeFailureKind(latest.kind),
        model: healthIdentity(record).providerModel,
        record,
    };
}

/**
 * @param {string | null} value
 * @returns {string | null}
 */
function normalizeFailureKind(value) {
    if (!value) return null;
    const normalized = value.toLowerCase().trim();
    if (normalized === 'timeout' || normalized.includes('provider.timeout')) return 'timeout';
    if (normalized === 'network' || normalized.includes('provider.network')) return 'network';
    if (normalized === 'upstream' || normalized.includes('provider.upstream')) return 'upstream';
    if (normalized === 'model-or-route' || normalized.includes('provider.model_or_route')) return 'model-or-route';
    if (normalized === 'capability-unsupported' || normalized.includes('provider.capability_unsupported')) {
        return 'capability-unsupported';
    }
    if (normalized === 'credits' || normalized.includes('provider.credits')) return 'credits';
    if (normalized === 'rate-limit' || normalized.includes('rate_limit') || normalized.includes('rate-limit')) return 'rate-limit';
    if (normalized === 'auth' || normalized.includes('provider.auth')) return 'auth';
    return normalized;
}

/**
 * @param {{ lastFailureKind?: string | null; lastErrorContext?: string | null }} health
 * @returns {string | null}
 */
function modelLastFailureKind(health) {
    return normalizeFailureKind(optionalString(health.lastFailureKind) ?? optionalString(health.lastErrorContext));
}

/**
 * @param {{ lastStatus: 'failed' | 'ok' | null; lastFailureAt: number | null; lastSuccessAt: number | null; lastFailureKind?: string | null; lastErrorContext?: string | null }} health
 * @param {{ now?: string | number | Date; temporaryFailureCooldownMs?: number }} [options]
 * @returns {boolean}
 */
function isGatewayModelChatHealthActivelyFailed(health, options = {}) {
    if (!isGatewayModelChatHealthFailed(health)) return false;
    const failureKind = modelLastFailureKind(health);
    if (!failureKind || !TEMPORARY_MODEL_FAILURE_KINDS.includes(failureKind)) return true;
    const lastFailureAt = optionalNumber(health.lastFailureAt) ?? 0;
    const nowMs = dateMs(options.now) ?? Date.now();
    const cooldownMs = positiveNumber(options.temporaryFailureCooldownMs, DEFAULT_MODEL_TEMPORARY_FAILURE_COOLDOWN_MS);
    return lastFailureAt + cooldownMs > nowMs;
}

/**
 * @param {unknown} value
 * @param {readonly string[]} fallback
 * @returns {Set<string>}
 */
function normalizedFailureKindSet(value, fallback) {
    const raw = Array.isArray(value) ? value : fallback;
    return new Set(raw.map((item) => normalizeFailureKind(optionalString(item))).filter((item) => item !== null));
}

/**
 * @param {Record<string, any>} record
 * @param {{ routeProfile: string | null; providerId: string | null; providerModel: string | null }} identity
 * @returns {boolean}
 */
function healthRecordMatches(record, identity) {
    const recordIdentity = healthIdentity(record);
    if (recordIdentity.providerId !== identity.providerId) return false;
    if (recordIdentity.providerModel !== identity.providerModel) return false;
    return !identity.routeProfile || !recordIdentity.routeProfile || recordIdentity.routeProfile === identity.routeProfile;
}

/**
 * @param {Record<string, any>} record
 * @param {{ providerId: string | null; providerModel: string | null }} identity
 * @returns {boolean}
 */
function healthRecordMatchesProviderModel(record, identity) {
    const recordIdentity = healthIdentity(record);
    return recordIdentity.providerId === identity.providerId && recordIdentity.providerModel === identity.providerModel;
}

/**
 * @param {Record<string, any>[]} records
 * @returns {Record<string, any>[]}
 */
function latestHealthRecordsFirst(records) {
    return records
        .filter((record) => record && typeof record === 'object' && !Array.isArray(record))
        .sort((left, right) => byokProviderHealthRecordLastObservedAt(right) - byokProviderHealthRecordLastObservedAt(left));
}

/**
 * @param {string | null} providerId
 * @param {string | null} providerModel
 * @param {string | null} routeProfile
 * @returns {string}
 */
function healthIndexExactKey(providerId, providerModel, routeProfile) {
    return `${providerId ?? ''}\u001f${providerModel ?? ''}\u001f${routeProfile ?? ''}`;
}

/**
 * @param {string | null} providerId
 * @param {string | null} providerModel
 * @returns {string}
 */
function healthIndexProviderModelKey(providerId, providerModel) {
    return `${providerId ?? ''}\u001f${providerModel ?? ''}`;
}

/**
 * @param {unknown} value
 * @returns {value is ReturnType<typeof createGatewayRuntimeHealthIndex>}
 */
function isGatewayRuntimeHealthIndex(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = /** @type {Record<string, unknown>} */ (value);
    return (
        candidate['schema'] === 'model-gateway-runtime-health-index' &&
        Array.isArray(candidate['records']) &&
        candidate['exact'] instanceof Map &&
        candidate['global'] instanceof Map &&
        candidate['providerModel'] instanceof Map &&
        candidate['provider'] instanceof Map
    );
}

/**
 * Build a per-routing-call index over volatile runtime health. The index intentionally stores only pointers to the
 * provided records; it does not promote runtime facts into canonical metadata and it does not mutate the health store.
 *
 * @param {Record<string, any>[]} records
 * @returns {{
 *   schema: 'model-gateway-runtime-health-index';
 *   records: Record<string, any>[];
 *   exact: Map<string, Record<string, any>>;
 *   global: Map<string, Record<string, any>>;
 *   providerModel: Map<string, Record<string, any>>;
 *   provider: Map<string, Record<string, any>[]>;
 * }}
 */
export function createGatewayRuntimeHealthIndex(records) {
    const latest = latestHealthRecordsFirst(Array.isArray(records) ? records : []);
    const exact = new Map();
    const global = new Map();
    const providerModel = new Map();
    const provider = new Map();

    for (const record of latest) {
        const identity = healthIdentity(record);
        if (identity.providerId) {
            const providerRecords = provider.get(identity.providerId) ?? [];
            providerRecords.push(record);
            provider.set(identity.providerId, providerRecords);
        }
        if (!identity.providerId || !identity.providerModel) continue;

        const modelKey = healthIndexProviderModelKey(identity.providerId, identity.providerModel);
        if (!providerModel.has(modelKey)) providerModel.set(modelKey, record);
        if (identity.routeProfile) {
            const exactKey = healthIndexExactKey(identity.providerId, identity.providerModel, identity.routeProfile);
            if (!exact.has(exactKey)) exact.set(exactKey, record);
        } else if (!global.has(modelKey)) {
            global.set(modelKey, record);
        }
    }

    return {
        schema: 'model-gateway-runtime-health-index',
        records: latest,
        exact,
        global,
        providerModel,
        provider,
    };
}

/**
 * @param {{ probes?: Record<string, { ok?: boolean; providerAttempted?: boolean }> } | null} health
 * @param {string} kind
 * @returns {{ ok?: boolean; providerAttempted?: boolean } | null}
 */
export function readGatewayModelProbeHealth(health, kind) {
    const normalized = normalizeProbeKind(kind);
    if (!health || !normalized || !health.probes) return null;
    return health.probes[normalized] ?? null;
}

/**
 * @param {{ probes?: Record<string, { ok?: boolean; providerAttempted?: boolean }> } | null} health
 * @param {string} kind
 * @returns {boolean}
 */
export function isGatewayModelProbeVerified(health, kind) {
    const probe = readGatewayModelProbeHealth(health, kind);
    return probe?.ok === true && probe.providerAttempted !== false;
}

/**
 * @param {{ probes?: Record<string, { ok?: boolean; providerAttempted?: boolean }> } | null} health
 * @param {string} kind
 * @returns {boolean}
 */
export function isGatewayModelProbeFailed(health, kind) {
    const probe = readGatewayModelProbeHealth(health, kind);
    return probe?.ok === false && probe.providerAttempted !== false;
}

/**
 * @param {{ probes?: Record<string, { ok?: boolean; providerAttempted?: boolean }> } | null} health
 * @returns {string[]}
 */
export function listGatewayModelVerifiedProbeKinds(health) {
    if (!health?.probes) return [];
    return Object.entries(health.probes)
        .filter(([, probe]) => probe.ok === true && probe.providerAttempted !== false)
        .map(([kind]) => kind)
        .sort();
}

/**
 * @param {ReturnType<typeof readGatewayModelHealth>} primary
 * @param {ReturnType<typeof readGatewayModelHealth>} fallback
 * @returns {ReturnType<typeof readGatewayModelHealth>}
 */
function mergeGatewayModelAgentProbeFallback(primary, fallback) {
    if (!primary || !fallback) return primary;
    return /** @type {ReturnType<typeof readGatewayModelHealth>} */ ({
        ...primary,
        agentProbeStatus: fallback.agentProbeStatus,
        agentProbeSuccessCount: fallback.agentProbeSuccessCount,
        lastAgentProbeSuccessAt: fallback.lastAgentProbeSuccessAt,
        lastAgentProbeMessage: fallback.lastAgentProbeMessage,
        lastAgentProbeErrorContext: fallback.lastAgentProbeErrorContext,
        probes: {
            ...(fallback.probes ?? {}),
            ...(primary.probes ?? {}),
            ...(fallback.probes?.['agent'] ? { agent: fallback.probes['agent'] } : {}),
        },
    });
}

/**
 * @param {ReturnType<typeof readGatewayModelHealth>} primary
 * @param {ReturnType<typeof readGatewayModelHealth>} fallback
 * @returns {boolean}
 */
function canUseGlobalAgentProbeFallback(primary, fallback) {
    if (!primary || !fallback || primary === fallback) return false;
    if (!isGatewayModelAgentProbeVerified(fallback)) return false;
    if (isGatewayModelAgentProbeVerified(primary)) return false;
    if (!isGatewayModelAgentProbeHealthFailed(primary)) return true;
    return (fallback.lastAgentProbeSuccessAt ?? 0) >= (primary.lastAgentProbeFailureAt ?? 0);
}

/**
 * @param {Record<string, any>} model
 * @param {{ runtimeHealthRecords?: Record<string, any>[]; runtimeHealthIndex?: ReturnType<typeof createGatewayRuntimeHealthIndex> }} options
 * @returns {ReturnType<typeof readGatewayModelHealth>}
 */
function readGatewayModelGlobalRuntimeHealth(model, options) {
    if (isGatewayRuntimeHealthIndex(options.runtimeHealthIndex)) {
        return readGatewayModelHealthFromIndex(model, options.runtimeHealthIndex, {
            routeProfile: null,
            allowRouteProfileFallback: false,
        });
    }
    if (Array.isArray(options.runtimeHealthRecords)) {
        return readGatewayModelHealthFromRecords(model, options.runtimeHealthRecords, {
            routeProfile: null,
            allowRouteProfileFallback: false,
        });
    }
    return readGatewayModelHealth(model, { routeProfile: null });
}

/**
 * @param {Record<string, any>} model
 * @param {{ routeProfile?: string | null }} [options]
 * @returns {ReturnType<typeof readByokProviderModelHealth>}
 */
export function readGatewayModelHealth(model, options = {}) {
    const providerId = typeof model['providerId'] === 'string' ? model['providerId'] : null;
    const providerModel = typeof model['providerModel'] === 'string' ? model['providerModel'] : null;
    const routeProfile = typeof options.routeProfile === 'string' && options.routeProfile.trim() ? options.routeProfile : null;
    const exact = readByokProviderModelHealth({ routeProfile, providerId, providerModel });
    if (exact) return exact;
    if (routeProfile) {
        const global = readByokProviderModelHealth({ routeProfile: null, providerId, providerModel });
        if (global) return global;
    }
    const latest = latestHealthRecordsFirst(listByokProviderModelHealth());
    const match =
        latest.find((health) => healthRecordMatches(health, { routeProfile, providerId, providerModel })) ??
        latest.find((health) => healthRecordMatchesProviderModel(health, { providerId, providerModel })) ??
        null;
    return match ? /** @type {ReturnType<typeof readGatewayModelHealth>} */ (match) : null;
}

/**
 * Read model health from an explicit record set, usually the non-mutating merge of file and SQLite runtime mirrors.
 *
 * This keeps post-runtime/effective selection deterministic without promoting runtime facts into canonical metadata and
 * without depending on whichever health store happens to be hydrated in the current process.
 *
 * @param {Record<string, any>} model
 * @param {Record<string, any>[]} records
 * @param {{ routeProfile?: string | null; allowRouteProfileFallback?: boolean }} [options]
 * @returns {ReturnType<typeof readGatewayModelHealth>}
 */
export function readGatewayModelHealthFromRecords(model, records, options = {}) {
    return readGatewayModelHealthFromIndex(model, createGatewayRuntimeHealthIndex(records), options);
}

/**
 * @param {Record<string, any>} model
 * @param {ReturnType<typeof createGatewayRuntimeHealthIndex>} index
 * @param {{ routeProfile?: string | null; allowRouteProfileFallback?: boolean }} [options]
 * @returns {ReturnType<typeof readGatewayModelHealth>}
 */
export function readGatewayModelHealthFromIndex(model, index, options = {}) {
    const providerId = optionalString(model['providerId']);
    const providerModel = optionalString(model['providerModel']) ?? optionalString(model['id']);
    if (!providerId || !providerModel) return null;
    const routeProfile = optionalString(options.routeProfile);
    const allowRouteProfileFallback = options.allowRouteProfileFallback !== false;
    const modelKey = healthIndexProviderModelKey(providerId, providerModel);
    const exact = routeProfile ? index.exact.get(healthIndexExactKey(providerId, providerModel, routeProfile)) : null;
    if (exact) return /** @type {ReturnType<typeof readGatewayModelHealth>} */ (exact);
    const global = index.global.get(modelKey);
    if (global) return /** @type {ReturnType<typeof readGatewayModelHealth>} */ (global);
    const identity = { routeProfile, providerId, providerModel };
    const match = index.records.find((record) => {
        if (allowRouteProfileFallback) return healthRecordMatches(record, identity);
        const recordIdentity = healthIdentity(record);
        if (recordIdentity.providerId !== providerId || recordIdentity.providerModel !== providerModel) return false;
        return routeProfile ? recordIdentity.routeProfile === routeProfile || recordIdentity.routeProfile === null : recordIdentity.routeProfile === null;
    });
    if (match) return /** @type {ReturnType<typeof readGatewayModelHealth>} */ (match);
    if (!allowRouteProfileFallback) return null;
    const providerModelMatch = index.providerModel.get(modelKey);
    return providerModelMatch ? /** @type {ReturnType<typeof readGatewayModelHealth>} */ (providerModelMatch) : null;
}

/**
 * Repeated temporary failures across different models of the same provider usually indicate account/provider
 * instability, not a bad single model. Keep that volatile and time-bounded so canonical metadata stays clean.
 *
 * @param {Record<string, any>} model
 * @param {Record<string, any>[] | ReturnType<typeof createGatewayRuntimeHealthIndex>} recordsOrIndex
 * @param {{ now?: string | number | Date; windowMs?: number; minFailedModels?: number; failureKinds?: string[] }} [options]
 * @returns {{
 *   include: boolean;
 *   reason: 'provider_health_allowed' | 'provider_health_cooldown' | 'provider_health_unknown';
 *   providerId: string | null;
 *   failureKinds: string[];
 *   failedModelCount: number;
 *   failureCount: number;
 *   latestFailureAt: number | null;
 *   latestSuccessAt: number | null;
 *   failedModels: string[];
 * }}
 */
export function evaluateGatewayProviderHealthCooldown(model, recordsOrIndex, options = {}) {
    const providerId = optionalString(model['providerId']) ?? optionalString(model['provider']);
    if (!providerId) {
        return {
            include: true,
            reason: 'provider_health_unknown',
            providerId,
            failureKinds: [],
            failedModelCount: 0,
            failureCount: 0,
            latestFailureAt: null,
            latestSuccessAt: null,
            failedModels: [],
        };
    }
    const nowMs = dateMs(options.now) ?? Date.now();
    const windowMs = optionalNumber(options.windowMs) ?? DEFAULT_PROVIDER_COOLDOWN_WINDOW_MS;
    const minFailedModels = Math.max(1, Math.floor(optionalNumber(options.minFailedModels) ?? DEFAULT_PROVIDER_COOLDOWN_MIN_FAILED_MODELS));
    const failureKinds = normalizedFailureKindSet(options.failureKinds, MODEL_GATEWAY_PROVIDER_COOLDOWN_FAILURE_KINDS);
    const index = isGatewayRuntimeHealthIndex(recordsOrIndex)
        ? recordsOrIndex
        : createGatewayRuntimeHealthIndex(/** @type {Record<string, any>[]} */ (recordsOrIndex));
    const providerRecords = index.provider.get(providerId) ?? [];
    const latestSuccessAt = providerRecords.reduce((max, record) => Math.max(max, latestProviderSuccessAt(record)), 0);
    const since = nowMs - Math.max(0, windowMs);
    const failures = providerRecords
        .map(latestProviderFailure)
        .filter((failure) => failure !== null)
        .filter((failure) => {
            if (!failure.kind || !failureKinds.has(failure.kind)) return false;
            if (failure.at < since) return false;
            return failure.at >= latestProviderSuccessAt(failure.record) && failure.at >= latestSuccessAt;
        });
    const failedModels = [...new Set(failures.map((failure) => failure.model).filter((item) => item !== null))].sort();
    const latestFailureAt = failures.reduce((max, failure) => Math.max(max, failure.at), 0);
    const blocked = failedModels.length >= minFailedModels;
    return {
        include: !blocked,
        reason: blocked ? 'provider_health_cooldown' : 'provider_health_allowed',
        providerId,
        failureKinds: [...new Set(failures.map((failure) => failure.kind).filter((item) => item !== null))].sort(),
        failedModelCount: failedModels.length,
        failureCount: failures.length,
        latestFailureAt: latestFailureAt > 0 ? latestFailureAt : null,
        latestSuccessAt: latestSuccessAt > 0 ? latestSuccessAt : null,
        failedModels,
    };
}

/**
 * @param {Record<string, any>} model
 * @param {{ routeProfile?: string | null; excludeFailed?: boolean; requireAgentProbeOk?: boolean; runtimeHealthRecords?: Record<string, any>[]; runtimeHealthIndex?: ReturnType<typeof createGatewayRuntimeHealthIndex>; now?: string | number | Date; temporaryFailureCooldownMs?: number; allowRouteProfileFallback?: boolean }} [options]
 * @returns {{ include: boolean; reason: string; health: ReturnType<typeof readGatewayModelHealth> }}
 */
export function evaluateGatewayModelHealthRoute(model, options = {}) {
    const routeScopedOptions = {
        ...options,
        allowRouteProfileFallback: options.allowRouteProfileFallback === true,
    };
    let health = isGatewayRuntimeHealthIndex(options.runtimeHealthIndex)
        ? readGatewayModelHealthFromIndex(model, options.runtimeHealthIndex, routeScopedOptions)
        : Array.isArray(options.runtimeHealthRecords)
          ? readGatewayModelHealthFromRecords(model, options.runtimeHealthRecords, routeScopedOptions)
          : readGatewayModelHealth(model, options);
    if (!health) {
        return {
            include: options.requireAgentProbeOk === true ? false : true,
            reason: options.requireAgentProbeOk === true ? 'agent_probe_missing' : 'health_unknown',
            health,
        };
    }
    const routeHealth = /** @type {NonNullable<typeof health>} */ (health);
    if (options.excludeFailed !== false && isGatewayModelChatHealthActivelyFailed(routeHealth, options)) {
        return { include: false, reason: 'chat_health_failed', health: routeHealth };
    }
    if (options.requireAgentProbeOk === true && optionalString(options.routeProfile)) {
        const fallback = readGatewayModelGlobalRuntimeHealth(model, options);
        if (canUseGlobalAgentProbeFallback(routeHealth, fallback)) {
            health = mergeGatewayModelAgentProbeFallback(routeHealth, fallback);
        }
    }
    const effectiveHealth = /** @type {NonNullable<typeof health>} */ (health);
    if (options.excludeFailed !== false && options.requireAgentProbeOk === true && isGatewayModelAgentProbeHealthFailed(effectiveHealth)) {
        return { include: false, reason: 'agent_probe_failed', health: effectiveHealth };
    }
    if (options.requireAgentProbeOk === true && !isGatewayModelAgentProbeVerified(effectiveHealth)) {
        return { include: false, reason: 'agent_probe_not_verified', health: effectiveHealth };
    }
    return { include: true, reason: 'health_allowed', health: effectiveHealth };
}
