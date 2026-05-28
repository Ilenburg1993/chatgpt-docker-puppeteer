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
    const match =
        latestHealthRecordsFirst(listByokProviderModelHealth()).find((health) =>
            healthRecordMatches(health, { routeProfile, providerId, providerModel }),
        ) ?? null;
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
    const match = latest.find((record) => healthRecordMatches(record, identity));
    return match ? /** @type {ReturnType<typeof readGatewayModelHealth>} */ (match) : null;
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
