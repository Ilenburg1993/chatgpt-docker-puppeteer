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
    if (normalized === 'credits' || normalized.includes('provider.credits')) return 'credits';
    if (normalized === 'rate-limit' || normalized.includes('rate_limit') || normalized.includes('rate-limit')) return 'rate-limit';
    if (normalized === 'auth' || normalized.includes('provider.auth')) return 'auth';
    return normalized;
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
 * @param {{ routeProfile?: string | null }} [options]
 * @returns {ReturnType<typeof readGatewayModelHealth>}
 */
export function readGatewayModelHealthFromRecords(model, records, options = {}) {
    const providerId = optionalString(model['providerId']);
    const providerModel = optionalString(model['providerModel']) ?? optionalString(model['id']);
    if (!providerId || !providerModel) return null;
    const routeProfile = optionalString(options.routeProfile);
    const identity = { routeProfile, providerId, providerModel };
    const latest = latestHealthRecordsFirst(records);
    const exact = routeProfile
        ? latest.find((record) => {
              const recordIdentity = healthIdentity(record);
              return (
                  recordIdentity.providerId === providerId &&
                  recordIdentity.providerModel === providerModel &&
                  recordIdentity.routeProfile === routeProfile
              );
          })
        : null;
    if (exact) return /** @type {ReturnType<typeof readGatewayModelHealth>} */ (exact);
    const global = routeProfile
        ? latest.find((record) => {
              const recordIdentity = healthIdentity(record);
              return (
                  recordIdentity.providerId === providerId &&
                  recordIdentity.providerModel === providerModel &&
                  !recordIdentity.routeProfile
              );
          })
        : null;
    if (global) return /** @type {ReturnType<typeof readGatewayModelHealth>} */ (global);
    const match = latest.find((record) => healthRecordMatches(record, identity));
    if (match) return /** @type {ReturnType<typeof readGatewayModelHealth>} */ (match);
    const providerModelMatch = latest.find((record) => healthRecordMatchesProviderModel(record, { providerId, providerModel }));
    return providerModelMatch ? /** @type {ReturnType<typeof readGatewayModelHealth>} */ (providerModelMatch) : null;
}

/**
 * Repeated temporary failures across different models of the same provider usually indicate account/provider
 * instability, not a bad single model. Keep that volatile and time-bounded so canonical metadata stays clean.
 *
 * @param {Record<string, any>} model
 * @param {Record<string, any>[]} records
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
export function evaluateGatewayProviderHealthCooldown(model, records, options = {}) {
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
    const providerRecords = latestHealthRecordsFirst(records).filter((record) => healthIdentity(record).providerId === providerId);
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
 * @param {{ routeProfile?: string | null; excludeFailed?: boolean; requireAgentProbeOk?: boolean; runtimeHealthRecords?: Record<string, any>[] }} [options]
 * @returns {{ include: boolean; reason: string; health: ReturnType<typeof readGatewayModelHealth> }}
 */
export function evaluateGatewayModelHealthRoute(model, options = {}) {
    const health = Array.isArray(options.runtimeHealthRecords)
        ? readGatewayModelHealthFromRecords(model, options.runtimeHealthRecords, options)
        : readGatewayModelHealth(model, options);
    if (!health) {
        return {
            include: options.requireAgentProbeOk === true ? false : true,
            reason: options.requireAgentProbeOk === true ? 'agent_probe_missing' : 'health_unknown',
            health,
        };
    }
    if (options.excludeFailed !== false && isGatewayModelChatHealthFailed(health)) {
        return { include: false, reason: 'chat_health_failed', health };
    }
    if (options.excludeFailed !== false && isGatewayModelAgentProbeHealthFailed(health)) {
        return { include: false, reason: 'agent_probe_failed', health };
    }
    if (options.requireAgentProbeOk === true && !isGatewayModelAgentProbeVerified(health)) {
        return { include: false, reason: 'agent_probe_not_verified', health };
    }
    return { include: true, reason: 'health_allowed', health };
}
