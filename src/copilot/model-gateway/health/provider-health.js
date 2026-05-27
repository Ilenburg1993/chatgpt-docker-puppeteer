// @ts-check
/**
 * Current-process operational health for BYOK provider/model pairs.
 *
 * The model catalog says "the provider lists this model"; this state says "a real chat turn using this provider/model
 * recently worked or failed". It also records the stricter disposable agent probe, which verifies tool calling and
 * `ask_user` independently from plain chat. It is intentionally fed by runtime events/probes, not by another discovery
 * path.
 *
 * @module copilot/model-gateway/health/provider-health
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { redactSecretText } from '#copilot/core';

const MAX_BYOK_PROVIDER_HEALTH_RECORDS = 200;
const BYOK_PROVIDER_HEALTH_SCHEMA_VERSION = 3;
const PREVIOUS_BYOK_PROVIDER_HEALTH_SCHEMA_VERSION = 2;
const LEGACY_BYOK_PROVIDER_HEALTH_SCHEMA_VERSION = 1;
const DEFAULT_BYOK_PROVIDER_HEALTH_PATH = join(process.cwd(), 'data', 'copilot-terminal', 'byok-provider-health.json');

/**
 * @typedef {object} ByokProviderHealthRecord
 * @property {string} key
 * @property {string | null} routeProfile
 * @property {string | null} providerId
 * @property {string | null} providerModel
 * @property {string | null} profile
 * @property {string | null} provider
 * @property {string | null} model
 * @property {'failed' | 'ok' | null} lastStatus
 * @property {number} failureCount
 * @property {number} successCount
 * @property {number | null} lastFailureAt
 * @property {number | null} lastSuccessAt
 * @property {string | null} lastMessage
 * @property {string | null} lastErrorContext
 * @property {string | null} lastFailureKind
 * @property {number | null} lastFailureStatusCode
 * @property {number | null} lastRetryAfterSeconds
 * @property {string | null} lastResetAt
 * @property {string | null} lastSuccessContext
 * @property {'failed' | 'ok' | null} agentProbeStatus
 * @property {number} agentProbeFailureCount
 * @property {number} agentProbeSuccessCount
 * @property {number | null} lastAgentProbeFailureAt
 * @property {number | null} lastAgentProbeSuccessAt
 * @property {string | null} lastAgentProbeMessage
 * @property {string | null} lastAgentProbeErrorContext
 * @property {Record<string, ByokProviderProbeHealthRecord>} probes
 */

/**
 * @typedef {object} ByokProviderProbeHealthRecord
 * @property {string} kind
 * @property {string} status
 * @property {boolean} ok
 * @property {boolean} providerAttempted
 * @property {number} count
 * @property {number} successCount
 * @property {number} failureCount
 * @property {number | null} lastAt
 * @property {string | null} lastMessage
 * @property {string | null} lastErrorContext
 * @property {string | null} lastFailureKind
 * @property {number | null} lastFailureStatusCode
 * @property {number | null} lastRetryAfterSeconds
 * @property {string | null} lastResetAt
 */

/**
 * @typedef {object} ByokProviderHealthChangeEvent
 * @property {'call_failure' | 'call_success' | 'agent_probe_failure' | 'agent_probe_success' | 'probe_result' | 'clear'} reason
 * @property {number} observedAt
 * @property {string | null} key
 * @property {ByokProviderHealthRecord | null} record
 */

/** @type {Map<string, ByokProviderHealthRecord>} */
const _byokProviderHealthByKey = new Map();
/** @type {Set<(event: ByokProviderHealthChangeEvent) => void | Promise<void>>} */
const _byokProviderHealthChangeListeners = new Set();
let _byokProviderHealthHydrated = false;
let _byokProviderHealthFlushScheduled = false;
let _byokProviderHealthFlushInFlight = false;
let _byokProviderHealthDirty = false;
/** @type {Promise<void> | null} */
let _byokProviderHealthFlushPromise = null;
/** @type {string | null} */
let _byokProviderHealthLastError = null;
let _byokProviderHealthPersistedRecords = 0;

/**
 * @returns {boolean}
 */
function isByokProviderHealthPersistenceEnabled() {
    if (process.env['TERMINAL_BYOK_PROVIDER_HEALTH_PERSIST_DISABLED'] === 'true') return false;
    if (process.env['VITEST'] === 'true' && !process.env['TERMINAL_BYOK_PROVIDER_HEALTH_PATH']) return false;
    return true;
}

/**
 * @returns {string}
 */
function resolveByokProviderHealthPath() {
    const configured = process.env['TERMINAL_BYOK_PROVIDER_HEALTH_PATH'];
    return typeof configured === 'string' && configured.trim() ? configured : DEFAULT_BYOK_PROVIDER_HEALTH_PATH;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizePart(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @typedef {object} ByokProviderHealthIdentity
 * @property {string | null} routeProfile
 * @property {string | null} providerId
 * @property {string | null} providerModel
 * @property {string | null} profile
 * @property {string | null} provider
 * @property {string | null} model
 */

/**
 * @param {{ routeProfile?: string | null | undefined; providerId?: string | null | undefined; providerModel?: string | null | undefined; profile?: string | null | undefined; provider?: string | null | undefined; model?: string | null | undefined }} input
 * @returns {ByokProviderHealthIdentity}
 */
function normalizeHealthIdentity(input) {
    const routeProfile = normalizePart(input.routeProfile) ?? normalizePart(input.profile);
    const providerId = normalizePart(input.providerId) ?? normalizePart(input.provider);
    const providerModel = normalizePart(input.providerModel) ?? normalizePart(input.model);
    return {
        routeProfile,
        providerId,
        providerModel,
        profile: routeProfile,
        provider: providerId,
        model: providerModel,
    };
}

/**
 * @param {{ routeProfile?: string | null | undefined; providerId?: string | null | undefined; providerModel?: string | null | undefined; profile?: string | null | undefined; provider?: string | null | undefined; model?: string | null | undefined }} input
 * @returns {string}
 */
function healthKey(input) {
    const identity = normalizeHealthIdentity(input);
    return [identity.routeProfile ?? '-', identity.providerId ?? '-', identity.providerModel ?? '-']
        .join('|')
        .toLowerCase();
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function sanitizeHealthText(value) {
    const normalized = normalizePart(value);
    if (!normalized) return null;
    return redactSecretText(normalized, { maxLength: 500 });
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeTimestamp(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeOptionalNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeIsoTimestamp(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * @param {unknown} value
 * @returns {'failed' | 'ok' | null}
 */
function normalizeStatus(value) {
    return value === 'failed' || value === 'ok' ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * @param {string} kind
 * @param {unknown} value
 * @returns {ByokProviderProbeHealthRecord | null}
 */
function normalizeProbeRecord(kind, value) {
    if (!isRecord(value)) return null;
    const status = normalizePart(/** @type {string | null | undefined} */ (value['status']));
    if (!status) return null;
    return {
        kind,
        status,
        ok: value['ok'] === true,
        providerAttempted: value['providerAttempted'] !== false,
        count: normalizeCount(value['count']),
        successCount: normalizeCount(value['successCount']),
        failureCount: normalizeCount(value['failureCount']),
        lastAt: normalizeTimestamp(value['lastAt']),
        lastMessage: sanitizeHealthText(/** @type {string | null | undefined} */ (value['lastMessage'])),
        lastErrorContext: sanitizeHealthText(/** @type {string | null | undefined} */ (value['lastErrorContext'])),
        lastFailureKind: sanitizeHealthText(/** @type {string | null | undefined} */ (value['lastFailureKind'])),
        lastFailureStatusCode: normalizeOptionalNumber(value['lastFailureStatusCode']),
        lastRetryAfterSeconds: normalizeOptionalNumber(value['lastRetryAfterSeconds']),
        lastResetAt: normalizeIsoTimestamp(value['lastResetAt']),
    };
}

/**
 * @param {unknown} value
 * @returns {Record<string, ByokProviderProbeHealthRecord>}
 */
function normalizeProbeRecords(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value)
            .map(([kind, probe]) => [kind, normalizeProbeRecord(kind, probe)])
            .filter((entry) => entry[1] !== null),
    );
}

/**
 * @param {ByokProviderProbeHealthRecord | null | undefined} previousProbe
 * @param {{ kind: string; status: string; ok: boolean; providerAttempted?: boolean; message?: string | null | undefined; errorContext?: string | null | undefined; failureKind?: string | null | undefined; failureStatusCode?: number | null | undefined; retryAfterSeconds?: number | null | undefined; resetAt?: string | number | Date | null | undefined }} input
 * @param {number} now
 * @returns {ByokProviderProbeHealthRecord}
 */
function createUpdatedProbeRecord(previousProbe, input, now) {
    return {
        kind: input.kind,
        status: input.status,
        ok: input.ok,
        providerAttempted: input.providerAttempted !== false,
        count: (previousProbe?.count ?? 0) + 1,
        successCount: (previousProbe?.successCount ?? 0) + (input.ok ? 1 : 0),
        failureCount: (previousProbe?.failureCount ?? 0) + (input.ok ? 0 : 1),
        lastAt: now,
        lastMessage: sanitizeHealthText(input.message) ?? previousProbe?.lastMessage ?? null,
        lastErrorContext: sanitizeHealthText(input.errorContext) ?? previousProbe?.lastErrorContext ?? null,
        lastFailureKind: input.ok ? null : sanitizeHealthText(input.failureKind) ?? previousProbe?.lastFailureKind ?? null,
        lastFailureStatusCode: input.ok
            ? null
            : normalizeOptionalNumber(input.failureStatusCode) ?? previousProbe?.lastFailureStatusCode ?? null,
        lastRetryAfterSeconds: input.ok
            ? null
            : normalizeOptionalNumber(input.retryAfterSeconds) ?? previousProbe?.lastRetryAfterSeconds ?? null,
        lastResetAt: input.ok ? null : normalizeIsoTimestamp(input.resetAt) ?? previousProbe?.lastResetAt ?? null,
    };
}

/**
 * @param {unknown} value
 * @returns {ByokProviderHealthRecord | null}
 */
function normalizeRecord(value) {
    if (!isRecord(value)) return null;
    const identity = normalizeHealthIdentity({
        routeProfile: /** @type {string | null | undefined} */ (value['routeProfile']),
        providerId: /** @type {string | null | undefined} */ (value['providerId']),
        providerModel: /** @type {string | null | undefined} */ (value['providerModel']),
        profile: /** @type {string | null | undefined} */ (value['profile']),
        provider: /** @type {string | null | undefined} */ (value['provider']),
        model: /** @type {string | null | undefined} */ (value['model']),
    });
    const lastStatus = normalizeStatus(value['lastStatus']);
    const agentProbeStatus = normalizeStatus(value['agentProbeStatus']);
    const lastAgentProbeFailureAt = normalizeTimestamp(value['lastAgentProbeFailureAt']);
    const lastAgentProbeSuccessAt = normalizeTimestamp(value['lastAgentProbeSuccessAt']);
    const normalizedAgentProbeFailureCount = normalizeCount(value['agentProbeFailureCount']);
    const normalizedAgentProbeSuccessCount = normalizeCount(value['agentProbeSuccessCount']);
    const agentProbeFailureCount =
        normalizedAgentProbeFailureCount === 0 && lastAgentProbeFailureAt ? 1 : normalizedAgentProbeFailureCount;
    const agentProbeSuccessCount =
        normalizedAgentProbeSuccessCount === 0 && lastAgentProbeSuccessAt ? 1 : normalizedAgentProbeSuccessCount;
    const probes = normalizeProbeRecords(value['probes']);
    if (agentProbeStatus && !probes['agent']) {
        probes['agent'] = {
            kind: 'agent',
            status: agentProbeStatus,
            ok: agentProbeStatus === 'ok',
            providerAttempted: true,
            count: Math.max(1, agentProbeFailureCount + agentProbeSuccessCount),
            successCount: agentProbeSuccessCount,
            failureCount: agentProbeFailureCount,
            lastAt:
                agentProbeStatus === 'ok'
                    ? lastAgentProbeSuccessAt ?? lastAgentProbeFailureAt
                    : lastAgentProbeFailureAt ?? lastAgentProbeSuccessAt,
            lastMessage: sanitizeHealthText(/** @type {string | null | undefined} */ (value['lastAgentProbeMessage'])),
            lastErrorContext: sanitizeHealthText(
                /** @type {string | null | undefined} */ (value['lastAgentProbeErrorContext']),
            ),
            lastFailureKind: agentProbeStatus === 'ok' ? null : 'agent_probe_failed',
            lastFailureStatusCode: null,
            lastRetryAfterSeconds: null,
            lastResetAt: null,
        };
    }
    if (
        (!lastStatus && !agentProbeStatus && Object.keys(probes).length === 0) ||
        (!identity.routeProfile && !identity.providerId && !identity.providerModel)
    ) {
        return null;
    }
    const record = {
        key: healthKey(identity),
        routeProfile: identity.routeProfile,
        providerId: identity.providerId,
        providerModel: identity.providerModel,
        profile: identity.profile,
        provider: identity.provider,
        model: identity.model,
        lastStatus,
        failureCount: normalizeCount(value['failureCount']),
        successCount: normalizeCount(value['successCount']),
        lastFailureAt: normalizeTimestamp(value['lastFailureAt']),
        lastSuccessAt: normalizeTimestamp(value['lastSuccessAt']),
        lastMessage: sanitizeHealthText(/** @type {string | null | undefined} */ (value['lastMessage'])),
        lastErrorContext: sanitizeHealthText(/** @type {string | null | undefined} */ (value['lastErrorContext'])),
        lastFailureKind: sanitizeHealthText(/** @type {string | null | undefined} */ (value['lastFailureKind'])),
        lastFailureStatusCode: normalizeOptionalNumber(value['lastFailureStatusCode']),
        lastRetryAfterSeconds: normalizeOptionalNumber(value['lastRetryAfterSeconds']),
        lastResetAt: normalizeIsoTimestamp(value['lastResetAt']),
        lastSuccessContext: sanitizeHealthText(
            /** @type {string | null | undefined} */ (value['lastSuccessContext']),
        ),
        agentProbeStatus,
        agentProbeFailureCount,
        agentProbeSuccessCount,
        lastAgentProbeFailureAt,
        lastAgentProbeSuccessAt,
        lastAgentProbeMessage: sanitizeHealthText(
            /** @type {string | null | undefined} */ (value['lastAgentProbeMessage']),
        ),
        lastAgentProbeErrorContext: sanitizeHealthText(
            /** @type {string | null | undefined} */ (value['lastAgentProbeErrorContext']),
        ),
        probes,
    };
    if (record.failureCount === 0 && record.lastFailureAt) record.failureCount = 1;
    if (record.successCount === 0 && record.lastSuccessAt) record.successCount = 1;
    if (record.agentProbeFailureCount === 0 && record.lastAgentProbeFailureAt) record.agentProbeFailureCount = 1;
    if (record.agentProbeSuccessCount === 0 && record.lastAgentProbeSuccessAt) record.agentProbeSuccessCount = 1;
    return record;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function byokProviderHealthRecordKey(value) {
    const record = normalizeRecord(value);
    return record?.key ?? null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function byokProviderHealthRecordLastObservedAt(value) {
    const record = normalizeRecord(value);
    if (!record) return 0;
    const direct = Math.max(
        record.lastFailureAt ?? 0,
        record.lastSuccessAt ?? 0,
        record.lastAgentProbeFailureAt ?? 0,
        record.lastAgentProbeSuccessAt ?? 0,
    );
    return Object.values(record.probes).reduce((max, probe) => Math.max(max, probe.lastAt ?? 0), direct);
}

/**
 * @param {...Record<string, unknown>[]} recordSets
 * @returns {Record<string, unknown>[]}
 */
export function mergeByokProviderHealthRecords(...recordSets) {
    /** @type {Map<string, Record<string, unknown>>} */
    const byKey = new Map();
    for (const records of recordSets) {
        for (const record of records) {
            const normalized = normalizeRecord(record);
            const key = normalized?.key ?? null;
            if (!key || !normalized) continue;
            const previous = byKey.get(key);
            if (
                !previous ||
                byokProviderHealthRecordLastObservedAt(normalized) >= byokProviderHealthRecordLastObservedAt(previous)
            ) {
                byKey.set(key, normalized);
            }
        }
    }
    return [...byKey.values()];
}

function pruneByokProviderHealth() {
    if (_byokProviderHealthByKey.size <= MAX_BYOK_PROVIDER_HEALTH_RECORDS) return;
    const entries = [..._byokProviderHealthByKey.values()].sort((a, b) => {
        const aTime = Math.max(a.lastFailureAt ?? 0, a.lastSuccessAt ?? 0);
        const bTime = Math.max(b.lastFailureAt ?? 0, b.lastSuccessAt ?? 0);
        return bTime - aTime;
    });
    _byokProviderHealthByKey.clear();
    for (const entry of entries.slice(0, MAX_BYOK_PROVIDER_HEALTH_RECORDS)) {
        _byokProviderHealthByKey.set(entry.key, entry);
    }
}

/**
 * @param {ByokProviderHealthChangeEvent['reason']} reason
 * @param {ByokProviderHealthRecord | null} record
 * @returns {void}
 */
function notifyByokProviderHealthChange(reason, record) {
    if (_byokProviderHealthChangeListeners.size === 0) return;
    const event = {
        reason,
        observedAt: Date.now(),
        key: record?.key ?? null,
        record,
    };
    for (const listener of _byokProviderHealthChangeListeners) {
        try {
            const result = listener(event);
            if (result && typeof result === 'object' && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        } catch {
            // Health updates must never fail because an observer failed.
        }
    }
}

function hydrateByokProviderHealthFromDisk() {
    if (_byokProviderHealthHydrated) return;
    _byokProviderHealthHydrated = true;
    if (!isByokProviderHealthPersistenceEnabled()) return;
    const filePath = resolveByokProviderHealthPath();
    if (!existsSync(filePath)) return;
    try {
        const raw = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (
            !isRecord(parsed) ||
            ![BYOK_PROVIDER_HEALTH_SCHEMA_VERSION, PREVIOUS_BYOK_PROVIDER_HEALTH_SCHEMA_VERSION, LEGACY_BYOK_PROVIDER_HEALTH_SCHEMA_VERSION].includes(
                /** @type {number} */ (parsed['schemaVersion']),
            )
        ) {
            return;
        }
        const records = Array.isArray(parsed['records']) ? parsed['records'] : [];
        for (const item of records) {
            const record = normalizeRecord(item);
            if (record) _byokProviderHealthByKey.set(record.key, record);
        }
        pruneByokProviderHealth();
        _byokProviderHealthPersistedRecords = _byokProviderHealthByKey.size;
        _byokProviderHealthLastError = null;
    } catch (error) {
        _byokProviderHealthLastError = error instanceof Error ? error.message : String(error);
    }
}

function scheduleByokProviderHealthFlush() {
    if (!isByokProviderHealthPersistenceEnabled()) return;
    _byokProviderHealthDirty = true;
    if (_byokProviderHealthFlushScheduled || _byokProviderHealthFlushInFlight) return;
    _byokProviderHealthFlushScheduled = true;
    setImmediate(() => {
        _byokProviderHealthFlushScheduled = false;
        void flushByokProviderHealth();
    });
}

/**
 * @returns {Promise<void>}
 */
export async function flushByokProviderHealth() {
    if (!isByokProviderHealthPersistenceEnabled()) return;
    hydrateByokProviderHealthFromDisk();
    if (_byokProviderHealthFlushInFlight) {
        await _byokProviderHealthFlushPromise;
        return;
    }
    _byokProviderHealthFlushInFlight = true;
    const filePath = resolveByokProviderHealthPath();
    const flushPromise = (async () => {
        try {
            await mkdir(dirname(filePath), { recursive: true });
            _byokProviderHealthDirty = false;
            const records = listByokProviderModelHealth();
            const payload = {
                schemaVersion: BYOK_PROVIDER_HEALTH_SCHEMA_VERSION,
                updatedAt: new Date().toISOString(),
                records,
            };
            const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
            await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
            await rename(temp, filePath);
            _byokProviderHealthPersistedRecords = records.length;
            _byokProviderHealthLastError = null;
        } catch (error) {
            _byokProviderHealthLastError = error instanceof Error ? error.message : String(error);
        } finally {
            _byokProviderHealthFlushInFlight = false;
            if (_byokProviderHealthDirty) scheduleByokProviderHealthFlush();
        }
    })();
    _byokProviderHealthFlushPromise = flushPromise;
    try {
        await flushPromise;
    } finally {
        if (_byokProviderHealthFlushPromise === flushPromise) {
            _byokProviderHealthFlushPromise = null;
        }
    }
}

/**
 * Subscribe to in-process BYOK provider health changes.
 *
 * The provider-health ledger remains storage-neutral. Observers may mirror the latest runtime facts into SQLite,
 * telemetry, or operator UIs, but runtime callers do not depend on those sinks.
 *
 * @param {(event: ByokProviderHealthChangeEvent) => void | Promise<void>} listener
 * @returns {() => void}
 */
export function subscribeByokProviderHealthChanges(listener) {
    _byokProviderHealthChangeListeners.add(listener);
    return () => {
        _byokProviderHealthChangeListeners.delete(listener);
    };
}

/**
 * @param {{ routeProfile?: string | null; providerId?: string | null; providerModel?: string | null; profile?: string | null; provider?: string | null; model?: string | null; message?: string | null; errorContext?: string | null; failureKind?: string | null; failureStatusCode?: number | null; retryAfterSeconds?: number | null; resetAt?: string | number | Date | null; timestamp?: number }} input
 * @returns {void}
 */
export function recordByokProviderModelCallFailure(input) {
    hydrateByokProviderHealthFromDisk();
    const identity = normalizeHealthIdentity(input);
    if (!identity.routeProfile && !identity.providerId && !identity.providerModel) return;
    const key = healthKey(identity);
    const now = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
    const previous = _byokProviderHealthByKey.get(key);
    _byokProviderHealthByKey.set(key, {
        key,
        ...identity,
        lastStatus: 'failed',
        failureCount: (previous?.failureCount ?? 0) + 1,
        successCount: previous?.successCount ?? 0,
        lastFailureAt: now,
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        lastMessage: sanitizeHealthText(input.message) ?? previous?.lastMessage ?? null,
        lastErrorContext: sanitizeHealthText(input.errorContext) ?? previous?.lastErrorContext ?? null,
        lastFailureKind: sanitizeHealthText(input.failureKind) ?? previous?.lastFailureKind ?? null,
        lastFailureStatusCode: normalizeOptionalNumber(input.failureStatusCode) ?? previous?.lastFailureStatusCode ?? null,
        lastRetryAfterSeconds: normalizeOptionalNumber(input.retryAfterSeconds) ?? previous?.lastRetryAfterSeconds ?? null,
        lastResetAt: normalizeIsoTimestamp(input.resetAt) ?? previous?.lastResetAt ?? null,
        lastSuccessContext: previous?.lastSuccessContext ?? null,
        agentProbeStatus: previous?.agentProbeStatus ?? null,
        agentProbeFailureCount: previous?.agentProbeFailureCount ?? 0,
        agentProbeSuccessCount: previous?.agentProbeSuccessCount ?? 0,
        lastAgentProbeFailureAt: previous?.lastAgentProbeFailureAt ?? null,
        lastAgentProbeSuccessAt: previous?.lastAgentProbeSuccessAt ?? null,
        lastAgentProbeMessage: previous?.lastAgentProbeMessage ?? null,
        lastAgentProbeErrorContext: previous?.lastAgentProbeErrorContext ?? null,
        probes: previous?.probes ?? {},
    });
    pruneByokProviderHealth();
    scheduleByokProviderHealthFlush();
    notifyByokProviderHealthChange('call_failure', _byokProviderHealthByKey.get(key) ?? null);
}

/**
 * @param {{ routeProfile?: string | null; providerId?: string | null; providerModel?: string | null; profile?: string | null; provider?: string | null; model?: string | null; successContext?: string | null; timestamp?: number }} input
 * @returns {void}
 */
export function recordByokProviderModelCallSuccess(input) {
    hydrateByokProviderHealthFromDisk();
    const identity = normalizeHealthIdentity(input);
    if (!identity.routeProfile && !identity.providerId && !identity.providerModel) return;
    const key = healthKey(identity);
    const now = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
    const previous = _byokProviderHealthByKey.get(key);
    _byokProviderHealthByKey.set(key, {
        key,
        ...identity,
        lastStatus: 'ok',
        failureCount: previous?.failureCount ?? 0,
        successCount: (previous?.successCount ?? 0) + 1,
        lastFailureAt: previous?.lastFailureAt ?? null,
        lastSuccessAt: now,
        lastMessage: null,
        lastErrorContext: null,
        lastFailureKind: null,
        lastFailureStatusCode: null,
        lastRetryAfterSeconds: null,
        lastResetAt: null,
        lastSuccessContext: sanitizeHealthText(input.successContext) ?? previous?.lastSuccessContext ?? null,
        agentProbeStatus: previous?.agentProbeStatus ?? null,
        agentProbeFailureCount: previous?.agentProbeFailureCount ?? 0,
        agentProbeSuccessCount: previous?.agentProbeSuccessCount ?? 0,
        lastAgentProbeFailureAt: previous?.lastAgentProbeFailureAt ?? null,
        lastAgentProbeSuccessAt: previous?.lastAgentProbeSuccessAt ?? null,
        lastAgentProbeMessage: previous?.lastAgentProbeMessage ?? null,
        lastAgentProbeErrorContext: previous?.lastAgentProbeErrorContext ?? null,
        probes: previous?.probes ?? {},
    });
    pruneByokProviderHealth();
    scheduleByokProviderHealthFlush();
    notifyByokProviderHealthChange('call_success', _byokProviderHealthByKey.get(key) ?? null);
}

/**
 * @param {{ routeProfile?: string | null; providerId?: string | null; providerModel?: string | null; profile?: string | null; provider?: string | null; model?: string | null; message?: string | null; errorContext?: string | null; timestamp?: number }} input
 * @returns {void}
 */
export function recordByokProviderModelAgentProbeFailure(input) {
    hydrateByokProviderHealthFromDisk();
    const identity = normalizeHealthIdentity(input);
    if (!identity.routeProfile && !identity.providerId && !identity.providerModel) return;
    const key = healthKey(identity);
    const now = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
    const previous = _byokProviderHealthByKey.get(key);
    const agentProbe = createUpdatedProbeRecord(
        previous?.probes?.['agent'],
        {
            kind: 'agent',
            status: 'failed',
            ok: false,
            providerAttempted: true,
            message: input.message,
            errorContext: input.errorContext,
            failureKind: 'agent_probe_failed',
        },
        now,
    );
    _byokProviderHealthByKey.set(key, {
        key,
        ...identity,
        lastStatus: previous?.lastStatus ?? null,
        failureCount: previous?.failureCount ?? 0,
        successCount: previous?.successCount ?? 0,
        lastFailureAt: previous?.lastFailureAt ?? null,
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        lastMessage: previous?.lastMessage ?? null,
        lastErrorContext: previous?.lastErrorContext ?? null,
        lastFailureKind: previous?.lastFailureKind ?? null,
        lastFailureStatusCode: previous?.lastFailureStatusCode ?? null,
        lastRetryAfterSeconds: previous?.lastRetryAfterSeconds ?? null,
        lastResetAt: previous?.lastResetAt ?? null,
        lastSuccessContext: previous?.lastSuccessContext ?? null,
        agentProbeStatus: 'failed',
        agentProbeFailureCount: (previous?.agentProbeFailureCount ?? 0) + 1,
        agentProbeSuccessCount: previous?.agentProbeSuccessCount ?? 0,
        lastAgentProbeFailureAt: now,
        lastAgentProbeSuccessAt: previous?.lastAgentProbeSuccessAt ?? null,
        lastAgentProbeMessage: sanitizeHealthText(input.message) ?? previous?.lastAgentProbeMessage ?? null,
        lastAgentProbeErrorContext:
            sanitizeHealthText(input.errorContext) ?? previous?.lastAgentProbeErrorContext ?? null,
        probes: {
            ...(previous?.probes ?? {}),
            agent: agentProbe,
        },
    });
    pruneByokProviderHealth();
    scheduleByokProviderHealthFlush();
    notifyByokProviderHealthChange('agent_probe_failure', _byokProviderHealthByKey.get(key) ?? null);
}

/**
 * @param {{ routeProfile?: string | null; providerId?: string | null; providerModel?: string | null; profile?: string | null; provider?: string | null; model?: string | null; timestamp?: number }} input
 * @returns {void}
 */
export function recordByokProviderModelAgentProbeSuccess(input) {
    hydrateByokProviderHealthFromDisk();
    const identity = normalizeHealthIdentity(input);
    if (!identity.routeProfile && !identity.providerId && !identity.providerModel) return;
    const key = healthKey(identity);
    const now = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
    const previous = _byokProviderHealthByKey.get(key);
    const agentProbe = createUpdatedProbeRecord(
        previous?.probes?.['agent'],
        {
            kind: 'agent',
            status: 'ok',
            ok: true,
            providerAttempted: true,
        },
        now,
    );
    _byokProviderHealthByKey.set(key, {
        key,
        ...identity,
        lastStatus: previous?.lastStatus ?? null,
        failureCount: previous?.failureCount ?? 0,
        successCount: previous?.successCount ?? 0,
        lastFailureAt: previous?.lastFailureAt ?? null,
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        lastMessage: previous?.lastMessage ?? null,
        lastErrorContext: previous?.lastErrorContext ?? null,
        lastFailureKind: previous?.lastFailureKind ?? null,
        lastFailureStatusCode: previous?.lastFailureStatusCode ?? null,
        lastRetryAfterSeconds: previous?.lastRetryAfterSeconds ?? null,
        lastResetAt: previous?.lastResetAt ?? null,
        lastSuccessContext: previous?.lastSuccessContext ?? null,
        agentProbeStatus: 'ok',
        agentProbeFailureCount: previous?.agentProbeFailureCount ?? 0,
        agentProbeSuccessCount: (previous?.agentProbeSuccessCount ?? 0) + 1,
        lastAgentProbeFailureAt: previous?.lastAgentProbeFailureAt ?? null,
        lastAgentProbeSuccessAt: now,
        lastAgentProbeMessage: null,
        lastAgentProbeErrorContext: null,
        probes: {
            ...(previous?.probes ?? {}),
            agent: agentProbe,
        },
    });
    pruneByokProviderHealth();
    scheduleByokProviderHealthFlush();
    notifyByokProviderHealthChange('agent_probe_success', _byokProviderHealthByKey.get(key) ?? null);
}

/**
 * @param {{ routeProfile?: string | null; providerId?: string | null; providerModel?: string | null; profile?: string | null; provider?: string | null; model?: string | null; probeKind: string; status: string; ok?: boolean; providerAttempted?: boolean; message?: string | null; errorContext?: string | null; failureKind?: string | null; failureStatusCode?: number | null; retryAfterSeconds?: number | null; resetAt?: string | number | Date | null; timestamp?: number }} input
 * @returns {void}
 */
export function recordByokProviderModelProbeResult(input) {
    hydrateByokProviderHealthFromDisk();
    const identity = normalizeHealthIdentity(input);
    const probeKind = normalizePart(input.probeKind);
    const status = normalizePart(input.status);
    if ((!identity.routeProfile && !identity.providerId && !identity.providerModel) || !probeKind || !status) return;
    const key = healthKey(identity);
    const now = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
    const previous = _byokProviderHealthByKey.get(key);
    const ok = input.ok === true;
    const probe = createUpdatedProbeRecord(
        previous?.probes?.[probeKind],
        {
            kind: probeKind,
            status,
            ok,
            providerAttempted: input.providerAttempted !== false,
            message: input.message,
            errorContext: input.errorContext,
            failureKind: input.failureKind,
            failureStatusCode: input.failureStatusCode,
            retryAfterSeconds: input.retryAfterSeconds,
            resetAt: input.resetAt,
        },
        now,
    );
    _byokProviderHealthByKey.set(key, {
        key,
        ...identity,
        lastStatus: previous?.lastStatus ?? null,
        failureCount: previous?.failureCount ?? 0,
        successCount: previous?.successCount ?? 0,
        lastFailureAt: previous?.lastFailureAt ?? null,
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        lastMessage: previous?.lastMessage ?? null,
        lastErrorContext: previous?.lastErrorContext ?? null,
        lastFailureKind: previous?.lastFailureKind ?? null,
        lastFailureStatusCode: previous?.lastFailureStatusCode ?? null,
        lastRetryAfterSeconds: previous?.lastRetryAfterSeconds ?? null,
        lastResetAt: previous?.lastResetAt ?? null,
        lastSuccessContext: previous?.lastSuccessContext ?? null,
        agentProbeStatus: previous?.agentProbeStatus ?? null,
        agentProbeFailureCount: previous?.agentProbeFailureCount ?? 0,
        agentProbeSuccessCount: previous?.agentProbeSuccessCount ?? 0,
        lastAgentProbeFailureAt: previous?.lastAgentProbeFailureAt ?? null,
        lastAgentProbeSuccessAt: previous?.lastAgentProbeSuccessAt ?? null,
        lastAgentProbeMessage: previous?.lastAgentProbeMessage ?? null,
        lastAgentProbeErrorContext: previous?.lastAgentProbeErrorContext ?? null,
        probes: {
            ...(previous?.probes ?? {}),
            [probeKind]: probe,
        },
    });
    pruneByokProviderHealth();
    scheduleByokProviderHealthFlush();
    notifyByokProviderHealthChange('probe_result', _byokProviderHealthByKey.get(key) ?? null);
}

/**
 * @param {{ routeProfile?: string | null; providerId?: string | null; providerModel?: string | null; profile?: string | null; provider?: string | null; model?: string | null }} input
 * @returns {ByokProviderHealthRecord | null}
 */
export function readByokProviderModelHealth(input) {
    hydrateByokProviderHealthFromDisk();
    return _byokProviderHealthByKey.get(healthKey(input)) ?? null;
}

/**
 * @returns {ByokProviderHealthRecord[]}
 */
export function listByokProviderModelHealth() {
    hydrateByokProviderHealthFromDisk();
    return [..._byokProviderHealthByKey.values()].sort((a, b) => {
        const aTime = Math.max(
            a.lastFailureAt ?? 0,
            a.lastSuccessAt ?? 0,
            a.lastAgentProbeFailureAt ?? 0,
            a.lastAgentProbeSuccessAt ?? 0,
        );
        const bTime = Math.max(
            b.lastFailureAt ?? 0,
            b.lastSuccessAt ?? 0,
            b.lastAgentProbeFailureAt ?? 0,
            b.lastAgentProbeSuccessAt ?? 0,
        );
        return bTime - aTime;
    });
}

/**
 * @param {{ routeProfile?: string | null; providerId?: string | null; providerModel?: string | null; profile?: string | null; provider?: string | null; model?: string | null }} [input]
 * @returns {void}
 */
export function clearByokProviderModelHealth(input = {}) {
    hydrateByokProviderHealthFromDisk();
    const identity = normalizeHealthIdentity(input);
    if (!identity.routeProfile && !identity.providerId && !identity.providerModel) {
        _byokProviderHealthByKey.clear();
    } else {
        for (const [key, record] of _byokProviderHealthByKey.entries()) {
            if (identity.routeProfile && record.routeProfile !== identity.routeProfile) continue;
            if (identity.providerId && record.providerId !== identity.providerId) continue;
            if (identity.providerModel && record.providerModel !== identity.providerModel) continue;
            _byokProviderHealthByKey.delete(key);
        }
    }
    scheduleByokProviderHealthFlush();
    notifyByokProviderHealthChange('clear', null);
}

/**
 * @returns {{ enabled: boolean; path: string | null; loaded: boolean; records: number; persistedRecords: number; flushScheduled: boolean; flushInFlight: boolean; dirty: boolean; error: string | null; changeListenerCount: number }}
 */
export function readByokProviderHealthState() {
    hydrateByokProviderHealthFromDisk();
    return {
        enabled: isByokProviderHealthPersistenceEnabled(),
        path: isByokProviderHealthPersistenceEnabled() ? resolveByokProviderHealthPath() : null,
        loaded: _byokProviderHealthHydrated,
        records: _byokProviderHealthByKey.size,
        persistedRecords: _byokProviderHealthPersistedRecords,
        flushScheduled: _byokProviderHealthFlushScheduled,
        flushInFlight: _byokProviderHealthFlushInFlight,
        dirty: _byokProviderHealthDirty,
        error: _byokProviderHealthLastError,
        changeListenerCount: _byokProviderHealthChangeListeners.size,
    };
}

/**
 * @returns {void}
 */
export function resetByokProviderHealthForTests() {
    _byokProviderHealthByKey.clear();
    _byokProviderHealthChangeListeners.clear();
    _byokProviderHealthHydrated = false;
    _byokProviderHealthFlushScheduled = false;
    _byokProviderHealthFlushInFlight = false;
    _byokProviderHealthDirty = false;
    _byokProviderHealthFlushPromise = null;
    _byokProviderHealthLastError = null;
    _byokProviderHealthPersistedRecords = 0;
}
