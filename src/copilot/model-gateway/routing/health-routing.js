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
export const DEFAULT_MODEL_GATEWAY_RUNTIME_PROOF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
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
 * A failed agent probe is operationally blocking only during the temporary-failure cooldown. Older failures remain
 * historical evidence and should trigger re-probing instead of permanently blacklisting the route.
 *
 * @param {{ agentProbeStatus?: 'failed' | 'ok' | null; lastAgentProbeFailureAt?: number | null; lastAgentProbeSuccessAt?: number | null }} health
 * @param {{ now?: string | number | Date; temporaryFailureCooldownMs?: number }} [options]
 * @returns {boolean}
 */
export function isGatewayModelAgentProbeHealthActivelyFailed(health, options = {}) {
    if (!isGatewayModelAgentProbeHealthFailed(health)) return false;
    const nowMs = dateMs(options.now) ?? Date.now();
    const cooldownMs = positiveNumber(
        options.temporaryFailureCooldownMs,
        DEFAULT_MODEL_TEMPORARY_FAILURE_COOLDOWN_MS,
    );
    const failedAt = optionalNumber(health.lastAgentProbeFailureAt);
    return failedAt !== null && failedAt <= nowMs && nowMs - failedAt <= cooldownMs;
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
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} record
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
 * @param {Record<string, unknown>} record
 * @returns {number}
 */
function latestProviderSuccessAt(record) {
    const probes = isRecord(record['probes']) ? record['probes'] : {};
    let probeSuccessAt = 0;
    for (const probe of Object.values(probes)) {
        if (!isRecord(probe) || probe['ok'] !== true) continue;
        probeSuccessAt = Math.max(probeSuccessAt, optionalNumber(probe['lastAt']) ?? 0);
    }
    return Math.max(
        optionalNumber(record['lastSuccessAt']) ?? 0,
        optionalNumber(record['lastAgentProbeSuccessAt']) ?? 0,
        record['runtimeHealthStatus'] === 'ok' ? (optionalNumber(record['runtimeObservedAtMs']) ?? 0) : 0,
        probeSuccessAt,
    );
}

/**
 * @param {Record<string, unknown>} record
 * @returns {{ at: number; kind: string | null; model: string | null; record: Record<string, unknown> } | null}
 */
function latestProviderFailure(record) {
    const probes = isRecord(record['probes']) ? record['probes'] : {};
    /** @type {Array<{ at: number; kind: string | null }>} */
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
    ];
    for (const probe of Object.values(probes)) {
        if (!isRecord(probe)) continue;
        candidates.push({
            at: optionalNumber(probe['lastAt']) ?? 0,
            kind: optionalString(probe['lastFailureKind']) ?? optionalString(probe['lastErrorContext']),
        });
    }
    candidates.sort((left, right) => right.at - left.at);
    const filteredCandidates = candidates.filter((candidate) => candidate.at > 0);
    const latest = filteredCandidates[0];
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
    if (normalized === 'invalid-request' || normalized.includes('provider.invalid_request')) return 'invalid-request';
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
 * @param {Record<string, unknown>} record
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
 * @param {Record<string, unknown>} record
 * @param {{ providerId: string | null; providerModel: string | null }} identity
 * @returns {boolean}
 */
function healthRecordMatchesProviderModel(record, identity) {
    const recordIdentity = healthIdentity(record);
    return recordIdentity.providerId === identity.providerId && recordIdentity.providerModel === identity.providerModel;
}

/**
 * @param {Record<string, unknown>[]} records
 * @returns {Record<string, unknown>[]}
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
 * @param {Record<string, unknown>[]} records
 * @returns {{
 *   schema: 'model-gateway-runtime-health-index';
 *   records: Record<string, unknown>[];
 *   exact: Map<string, Record<string, unknown>>;
 *   global: Map<string, Record<string, unknown>>;
 *   providerModel: Map<string, Record<string, unknown>>;
 *   provider: Map<string, Record<string, unknown>[]>;
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
 * @param {{ probes?: Record<string, { ok?: boolean; providerAttempted?: boolean; lastAt?: number | null }> } | null} health
 * @param {string} kind
 * @returns {{ ok?: boolean; providerAttempted?: boolean; lastAt?: number | null } | null}
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
 * @param {{ probes?: Record<string, { ok?: boolean; providerAttempted?: boolean; lastAt?: number | null }> } | null} health
 * @param {string} kind
 * @param {{ now?: string | number | Date; temporaryFailureCooldownMs?: number }} [options]
 * @returns {boolean}
 */
export function isGatewayModelProbeActivelyFailed(health, kind, options = {}) {
    if (!isGatewayModelProbeFailed(health, kind)) return false;
    const probe = readGatewayModelProbeHealth(health, kind);
    const failedAt = optionalNumber(probe?.lastAt);
    if (failedAt === null) return false;
    const nowMs = dateMs(options.now) ?? Date.now();
    const cooldownMs = positiveNumber(
        options.temporaryFailureCooldownMs,
        DEFAULT_MODEL_TEMPORARY_FAILURE_COOLDOWN_MS,
    );
    return failedAt <= nowMs && nowMs - failedAt <= cooldownMs;
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
 * Convert historical positive health into a time-bounded proof that is meaningful for the current terminal session.
 * Historical successes remain observable, but only fresh successes may promote a route as runtime-proved.
 *
 * @param {Record<string, unknown> | null} health
 * @param {{ now?: string | number | Date; maxAgeMs?: number }} [options]
 * @returns {{
 *   hasHistoricalProof: boolean;
 *   hasFreshProof: boolean;
 *   stale: boolean;
 *   maxAgeMs: number;
 *   latestProofAt: number | null;
 *   ageMs: number | null;
 *   chatFresh: boolean;
 *   agentFresh: boolean;
 *   freshProbeKinds: string[];
 *   staleProbeKinds: string[];
 * }}
 */
export function summarizeGatewayRuntimeProofFreshness(health, options = {}) {
    const nowMs = dateMs(options.now) ?? Date.now();
    const maxAgeMs = positiveNumber(options.maxAgeMs, DEFAULT_MODEL_GATEWAY_RUNTIME_PROOF_MAX_AGE_MS);
    /** @param {number | null} value */
    const successIsFresh = (value) => {
        const at = optionalNumber(value);
        return at !== null && at > 0 && at <= nowMs && nowMs - at <= maxAgeMs;
    };
    const chatHistorical =
        Boolean(health?.['lastStatus'] === 'ok') &&
        (optionalNumber(health?.['lastSuccessAt']) ?? 0) >= (optionalNumber(health?.['lastFailureAt']) ?? 0);
    const agentHistorical = Boolean(health && isGatewayModelAgentProbeVerified(health));
    const chatAt = chatHistorical ? optionalNumber(health?.['lastSuccessAt']) : null;
    const agentAt = agentHistorical ? optionalNumber(health?.['lastAgentProbeSuccessAt']) : null;
    const probeRows = health?.['probes']
        ? Object.entries(health['probes'])
              .filter(([, probe]) => probe?.ok === true && probe.providerAttempted !== false)
              .map(([kind, probe]) => ({ kind, at: optionalNumber(probe.lastAt) }))
        : [];
    const freshProbeKinds = probeRows.filter((row) => successIsFresh(row.at)).map((row) => row.kind).sort();
    const staleProbeKinds = probeRows.filter((row) => !successIsFresh(row.at)).map((row) => row.kind).sort();
    /** @type {number[]} */
    const historicalTimes = [];
    for (const value of [chatAt, agentAt, ...probeRows.map((row) => row.at)]) {
        if (typeof value === 'number' && value > 0) historicalTimes.push(value);
    }
    const latestProofAt = historicalTimes.length > 0 ? Math.max(...historicalTimes) : null;
    const chatFresh = chatHistorical && successIsFresh(chatAt);
    const agentFresh = agentHistorical && successIsFresh(agentAt);
    const hasHistoricalProof = chatHistorical || agentHistorical || probeRows.length > 0;
    const hasFreshProof = chatFresh || agentFresh || freshProbeKinds.length > 0;
    return {
        hasHistoricalProof,
        hasFreshProof,
        stale: hasHistoricalProof && !hasFreshProof,
        maxAgeMs,
        latestProofAt,
        ageMs: latestProofAt === null ? null : Math.max(0, nowMs - latestProofAt),
        chatFresh,
        agentFresh,
        freshProbeKinds,
        staleProbeKinds,
    };
}

/**
 * @param {Record<string, unknown> | null} health
 * @param {{ now?: string | number | Date; maxAgeMs?: number }} [options]
 * @returns {boolean}
 */
export function hasFreshGatewayRuntimeProof(health, options = {}) {
    return summarizeGatewayRuntimeProofFreshness(health, options).hasFreshProof;
}

/**
 * @param {Record<string, unknown> | null} health
 * @param {{ now?: string | number | Date; maxAgeMs?: number }} [options]
 * @returns {boolean}
 */
export function isGatewayModelAgentProbeFreshlyVerified(health, options = {}) {
    return summarizeGatewayRuntimeProofFreshness(health, options).agentFresh;
}

/**
 * @param {ReturnType<typeof readGatewayModelHealth>} health
 * @param {string} kind
 * @param {{ now?: string | number | Date; maxAgeMs?: number }} [options]
 * @returns {boolean}
 */
export function isGatewayModelProbeFreshlyVerified(health, kind, options = {}) {
    const normalized = normalizeProbeKind(kind);
    return normalized !== null && summarizeGatewayRuntimeProofFreshness(health, options).freshProbeKinds.includes(normalized);
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
 * @param {Record<string, unknown>} model
 * @param {{ runtimeHealthRecords?: Record<string, unknown>[]; runtimeHealthIndex?: ReturnType<typeof createGatewayRuntimeHealthIndex> }} options
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
 * @param {Record<string, unknown>} model
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
 * @param {Record<string, unknown>} model
 * @param {Record<string, unknown>[]} records
 * @param {{ routeProfile?: string | null; allowRouteProfileFallback?: boolean }} [options]
 * @returns {ReturnType<typeof readGatewayModelHealth>}
 */
export function readGatewayModelHealthFromRecords(model, records, options = {}) {
    return readGatewayModelHealthFromIndex(model, createGatewayRuntimeHealthIndex(records), options);
}

/**
 * @param {Record<string, unknown>} model
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
 * @param {Record<string, unknown>} model
 * @param {Record<string, unknown>[] | ReturnType<typeof createGatewayRuntimeHealthIndex>} recordsOrIndex
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
        : createGatewayRuntimeHealthIndex(/** @type {Record<string, unknown>[]} */ (recordsOrIndex));
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
 * @param {Record<string, unknown>} model
 * @param {{ routeProfile?: string | null; excludeFailed?: boolean; requireAgentProbeOk?: boolean; runtimeHealthRecords?: Record<string, unknown>[]; runtimeHealthIndex?: ReturnType<typeof createGatewayRuntimeHealthIndex>; now?: string | number | Date; maxRuntimeProofAgeMs?: number; temporaryFailureCooldownMs?: number; allowRouteProfileFallback?: boolean }} [options]
 * @returns {{ include: boolean; reason: string; health: ReturnType<typeof readGatewayModelHealth>; runtimeProof: ReturnType<typeof summarizeGatewayRuntimeProofFreshness> | null }}
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
            runtimeProof: null,
        };
    }
    const routeHealth = /** @type {NonNullable<typeof health>} */ (health);
    const proofOptions = {
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(typeof options.maxRuntimeProofAgeMs === 'number' ? { maxAgeMs: options.maxRuntimeProofAgeMs } : {}),
    };
    if (options.excludeFailed !== false && isGatewayModelChatHealthActivelyFailed(routeHealth, options)) {
        return {
            include: false,
            reason: 'chat_health_failed',
            health: routeHealth,
            runtimeProof: summarizeGatewayRuntimeProofFreshness(routeHealth, proofOptions),
        };
    }
    if (options.requireAgentProbeOk === true && optionalString(options.routeProfile)) {
        const fallback = readGatewayModelGlobalRuntimeHealth(model, options);
        if (canUseGlobalAgentProbeFallback(routeHealth, fallback)) {
            health = mergeGatewayModelAgentProbeFallback(routeHealth, fallback);
        }
    }
    const effectiveHealth = /** @type {NonNullable<typeof health>} */ (health);
    const runtimeProof = summarizeGatewayRuntimeProofFreshness(effectiveHealth, proofOptions);
    if (
        options.excludeFailed !== false &&
        options.requireAgentProbeOk === true &&
        isGatewayModelAgentProbeHealthActivelyFailed(effectiveHealth, options)
    ) {
        return { include: false, reason: 'agent_probe_failed', health: effectiveHealth, runtimeProof };
    }
    if (options.requireAgentProbeOk === true && !isGatewayModelAgentProbeVerified(effectiveHealth)) {
        return { include: false, reason: 'agent_probe_not_verified', health: effectiveHealth, runtimeProof };
    }
    if (options.requireAgentProbeOk === true && !runtimeProof.agentFresh) {
        return { include: false, reason: 'agent_probe_stale', health: effectiveHealth, runtimeProof };
    }
    return {
        include: true,
        reason: runtimeProof.stale ? 'health_allowed_runtime_proof_stale' : 'health_allowed',
        health: effectiveHealth,
        runtimeProof,
    };
}
