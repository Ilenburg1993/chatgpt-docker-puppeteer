// @ts-check
/**
 * Backoff-aware pre-runtime probe planning.
 *
 * This planner does not execute providers. It only reads account overlays and runtime health facts already collected by
 * earlier phases so probes can avoid known active rate-limit windows.
 *
 * @module copilot/model-gateway/probes/backoff-planner
 */

import { normalizeModelGatewayAccountLimitState } from '../account-access/limits.js';

const DEFAULT_RUNTIME_PROBE_FAILURE_COOLDOWN_SECONDS = 15 * 60;

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
function finiteNumber(value) {
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
 * @param {Record<string, unknown>} row
 * @returns {{ providerId: string; providerModel: string; routeProfile: string; key: string }}
 */
function recommendationIdentity(row) {
    const key = optionalString(row['key']);
    const keyParts = key ? key.split(':') : [];
    const providerId = optionalString(row['providerId']) ?? keyParts[0] ?? 'unknown-provider';
    const providerModel =
        optionalString(row['providerModel']) ??
        optionalString(row['id']) ??
        keyParts.slice(1, -1).join(':') ??
        'unknown-model';
    const routeProfile = optionalString(row['routeProfile']) ?? keyParts.at(-1) ?? 'default';
    return {
        providerId,
        providerModel: providerModel || 'unknown-model',
        routeProfile,
        key: key ?? [providerId, providerModel || 'unknown-model', routeProfile].join(':'),
    };
}

/**
 * @param {Record<string, unknown>} overlay
 * @param {string} providerId
 * @returns {boolean}
 */
function overlayMatchesProvider(overlay, providerId) {
    return optionalString(overlay['providerId']) === providerId;
}

/**
 * @param {Record<string, unknown>} health
 * @param {{ providerId: string; providerModel: string; routeProfile: string }} identity
 * @returns {boolean}
 */
function healthMatchesRecommendation(health, identity) {
    const providerId = optionalString(health['providerId']) ?? optionalString(health['provider']);
    const providerModel = optionalString(health['providerModel']) ?? optionalString(health['model']);
    const routeProfile = optionalString(health['routeProfile']) ?? optionalString(health['profile']) ?? 'default';
    return (
        providerId === identity.providerId &&
        providerModel === identity.providerModel &&
        routeProfile === identity.routeProfile
    );
}

/**
 * @param {Record<string, unknown>} health
 * @param {number} nowMs
 * @returns {{ active: boolean; retryAfterSeconds: number | null; resetAt: string | null }}
 */
function runtimeRateLimitState(health, nowMs) {
    const kind = optionalString(health['lastFailureKind']);
    const context = [health['lastErrorContext'], health['lastMessage']].map(optionalString).filter(Boolean).join(' ');
    const rateLimited = kind === 'rate-limit' || /rate[_ -]?limit|too many requests/iu.test(context);
    if (!rateLimited) return { active: false, retryAfterSeconds: null, resetAt: null };
    const resetAt = optionalString(health['lastResetAt']);
    const resetMs = dateMs(resetAt);
    if (resetMs !== null) return { active: resetMs > nowMs, retryAfterSeconds: null, resetAt };
    const retryAfterSeconds = finiteNumber(health['lastRetryAfterSeconds']);
    const lastFailureAtMs = dateMs(health['lastFailureAt']);
    if (retryAfterSeconds !== null && retryAfterSeconds > 0 && lastFailureAtMs !== null) {
        const reset = new Date(lastFailureAtMs + retryAfterSeconds * 1000).toISOString();
        return { active: lastFailureAtMs + retryAfterSeconds * 1000 > nowMs, retryAfterSeconds, resetAt: reset };
    }
    return { active: true, retryAfterSeconds: null, resetAt: null };
}

/**
 * @param {Record<string, unknown>} health
 * @param {string} kind
 * @param {number} nowMs
 * @param {number} cooldownSeconds
 * @returns {{ active: boolean; probeKind: string; retryAfterSeconds: number | null; resetAt: string | null }}
 */
function runtimeProbeFailureState(health, kind, nowMs, cooldownSeconds) {
    const probes = isRecord(health['probes']) ? health['probes'] : {};
    const probe = isRecord(probes[kind]) ? probes[kind] : null;
    const failed =
        probe?.['ok'] === false ||
        (kind === 'agent' &&
            optionalString(health['agentProbeStatus']) === 'failed' &&
            (dateMs(health['lastAgentProbeFailureAt']) ?? 0) >= (dateMs(health['lastAgentProbeSuccessAt']) ?? 0));
    if (!failed) return { active: false, probeKind: kind, retryAfterSeconds: null, resetAt: null };
    const resetAt = optionalString(probe?.['lastResetAt']);
    const resetMs = dateMs(resetAt);
    if (resetMs !== null) return { active: resetMs > nowMs, probeKind: kind, retryAfterSeconds: null, resetAt };
    const retryAfterSeconds = finiteNumber(probe?.['lastRetryAfterSeconds']);
    const observedMs =
        dateMs(probe?.['lastAt']) ??
        (kind === 'agent' ? dateMs(health['lastAgentProbeFailureAt']) : null) ??
        dateMs(health['lastFailureAt']);
    if (observedMs === null) return { active: true, probeKind: kind, retryAfterSeconds: null, resetAt: null };
    const waitSeconds = retryAfterSeconds !== null && retryAfterSeconds > 0 ? retryAfterSeconds : cooldownSeconds;
    const retryMs = observedMs + waitSeconds * 1000;
    return {
        active: retryMs > nowMs,
        probeKind: kind,
        retryAfterSeconds: Math.max(0, Math.ceil((retryMs - nowMs) / 1000)),
        resetAt: new Date(retryMs).toISOString(),
    };
}

/**
 * @param {object} input
 * @param {Record<string, unknown>[]} [input.recommendations]
 * @param {Record<string, unknown>[]} [input.accountOverlays]
 * @param {Record<string, unknown>[]} [input.healthRecords]
 * @param {string | number | Date} [input.now]
 * @param {number} [input.probeFailureCooldownSeconds]
 * @returns {{
 *     ready: {
 *         key: string;
 *         providerId: string;
 *         providerModel: string;
 *         routeProfile: string;
 *         probeKinds: string[];
 *         reasons: string[];
 *     }[];
 *     deferred: {
 *         key: string;
 *         providerId: string;
 *         providerModel: string;
 *         routeProfile: string;
 *         reason: string;
 *         probeKind?: string;
 *         retryAfterSeconds: number | null;
 *         resetAt: string | null;
 *     }[];
 *     summary: { total: number; ready: number; deferred: number; reasonCounts: Record<string, number> };
 * }}
 */
export function planModelGatewayProbeBackoff(input = {}) {
    const nowMs = dateMs(input.now) ?? Date.now();
    const probeFailureCooldownSeconds =
        finiteNumber(input.probeFailureCooldownSeconds) ?? DEFAULT_RUNTIME_PROBE_FAILURE_COOLDOWN_SECONDS;
    const overlays = Array.isArray(input.accountOverlays) ? input.accountOverlays.filter(isRecord) : [];
    const healthRecords = Array.isArray(input.healthRecords) ? input.healthRecords.filter(isRecord) : [];
    const ready = [];
    const deferred = [];

    for (const recommendation of Array.isArray(input.recommendations) ? input.recommendations.filter(isRecord) : []) {
        const identity = recommendationIdentity(recommendation);
        const probeKinds = Array.isArray(recommendation['probeKinds'])
            ? recommendation['probeKinds'].map(optionalString).filter((kind) => kind !== null)
            : [];
        const providerOverlays = overlays.filter((overlay) => overlayMatchesProvider(overlay, identity.providerId));
        const overlayLimit = providerOverlays
            .map((overlay) => normalizeModelGatewayAccountLimitState(overlay, { now: nowMs }))
            .find((limits) => limits.rateLimited);
        if (overlayLimit) {
            deferred.push({
                ...identity,
                reason: 'account_rate_limited',
                retryAfterSeconds: overlayLimit.retryAfterSeconds,
                resetAt: overlayLimit.resetAt,
            });
            continue;
        }
        const runtimeLimit = healthRecords
            .filter((health) => healthMatchesRecommendation(health, identity))
            .map((health) => runtimeRateLimitState(health, nowMs))
            .find((limits) => limits.active);
        if (runtimeLimit) {
            deferred.push({
                ...identity,
                reason: 'runtime_rate_limited',
                retryAfterSeconds: runtimeLimit.retryAfterSeconds,
                resetAt: runtimeLimit.resetAt,
            });
            continue;
        }
        const runtimeProbeCooldown = healthRecords
            .filter((health) => healthMatchesRecommendation(health, identity))
            .flatMap((health) =>
                probeKinds.map((kind) => runtimeProbeFailureState(health, kind, nowMs, probeFailureCooldownSeconds)),
            )
            .find((state) => state.active);
        if (runtimeProbeCooldown) {
            deferred.push({
                ...identity,
                reason: 'runtime_probe_failed_recent',
                probeKind: runtimeProbeCooldown.probeKind,
                retryAfterSeconds: runtimeProbeCooldown.retryAfterSeconds,
                resetAt: runtimeProbeCooldown.resetAt,
            });
            continue;
        }
        ready.push({
            ...identity,
            probeKinds,
            reasons: Array.isArray(recommendation['reasons']) ? recommendation['reasons'].map(String) : [],
        });
    }

    const reasonCounts = /** @type {Record<string, number>} */ ({});
    for (const item of deferred) reasonCounts[item.reason] = (reasonCounts[item.reason] ?? 0) + 1;
    return {
        ready,
        deferred,
        summary: {
            total: ready.length + deferred.length,
            ready: ready.length,
            deferred: deferred.length,
            reasonCounts,
        },
    };
}
