// @ts-check
/**
 * Current-process operational health for BYOK provider/model pairs.
 *
 * The model catalog says "the provider lists this model"; this state says "a real chat turn using this provider/model
 * recently worked or failed". It is intentionally fed by runtime events, not by another discovery path.
 *
 * @module copilot/terminal/state/byok-provider-health
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MAX_BYOK_PROVIDER_HEALTH_RECORDS = 200;
const BYOK_PROVIDER_HEALTH_SCHEMA_VERSION = 1;
const DEFAULT_BYOK_PROVIDER_HEALTH_PATH = join(process.cwd(), 'data', 'copilot-terminal', 'byok-provider-health.json');

/** @type {Map<string, { key: string; profile: string | null; provider: string | null; model: string | null; lastStatus: 'failed' | 'ok'; failureCount: number; successCount: number; lastFailureAt: number | null; lastSuccessAt: number | null; lastMessage: string | null; lastErrorContext: string | null }>} */
const _byokProviderHealthByKey = new Map();
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
 * @param {{ profile?: string | null; provider?: string | null; model?: string | null }} input
 * @returns {string}
 */
function healthKey(input) {
    return [normalizePart(input.profile) ?? '-', normalizePart(input.provider) ?? '-', normalizePart(input.model) ?? '-']
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
    const redacted = normalized
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/giu, 'Bearer [redacted]')
        .replace(/\b(sk|gsk|hf|csk|nvapi|cpk|cfat|AIza)[A-Za-z0-9._~+/=-]{8,}/gu, '[redacted]')
        .replace(/((?:api[_-]?key|authorization|token|secret)\s*[:=]\s*["']?)[^"',\s;]{8,}/giu, '$1[redacted]');
    return redacted.length > 500 ? `${redacted.slice(0, 497)}...` : redacted;
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
 * @param {unknown} value
 * @returns {{ key: string; profile: string | null; provider: string | null; model: string | null; lastStatus: 'failed' | 'ok'; failureCount: number; successCount: number; lastFailureAt: number | null; lastSuccessAt: number | null; lastMessage: string | null; lastErrorContext: string | null } | null}
 */
function normalizeRecord(value) {
    if (!isRecord(value)) return null;
    const profile = normalizePart(/** @type {string | null | undefined} */ (value['profile']));
    const provider = normalizePart(/** @type {string | null | undefined} */ (value['provider']));
    const model = normalizePart(/** @type {string | null | undefined} */ (value['model']));
    const lastStatus = normalizeStatus(value['lastStatus']);
    if (!lastStatus || (!profile && !provider && !model)) return null;
    const record = {
        key: healthKey({ profile, provider, model }),
        profile,
        provider,
        model,
        lastStatus,
        failureCount: normalizeCount(value['failureCount']),
        successCount: normalizeCount(value['successCount']),
        lastFailureAt: normalizeTimestamp(value['lastFailureAt']),
        lastSuccessAt: normalizeTimestamp(value['lastSuccessAt']),
        lastMessage: sanitizeHealthText(/** @type {string | null | undefined} */ (value['lastMessage'])),
        lastErrorContext: sanitizeHealthText(/** @type {string | null | undefined} */ (value['lastErrorContext'])),
    };
    if (record.failureCount === 0 && record.lastFailureAt) record.failureCount = 1;
    if (record.successCount === 0 && record.lastSuccessAt) record.successCount = 1;
    return record;
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

function hydrateByokProviderHealthFromDisk() {
    if (_byokProviderHealthHydrated) return;
    _byokProviderHealthHydrated = true;
    if (!isByokProviderHealthPersistenceEnabled()) return;
    const filePath = resolveByokProviderHealthPath();
    if (!existsSync(filePath)) return;
    try {
        const raw = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed) || parsed['schemaVersion'] !== BYOK_PROVIDER_HEALTH_SCHEMA_VERSION) return;
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
 * @param {{ profile?: string | null; provider?: string | null; model?: string | null; message?: string | null; errorContext?: string | null; timestamp?: number }} input
 * @returns {void}
 */
export function recordByokProviderModelCallFailure(input) {
    hydrateByokProviderHealthFromDisk();
    const profile = normalizePart(input.profile);
    const provider = normalizePart(input.provider);
    const model = normalizePart(input.model);
    if (!profile && !provider && !model) return;
    const key = healthKey({ profile, provider, model });
    const now = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
    const previous = _byokProviderHealthByKey.get(key);
    _byokProviderHealthByKey.set(key, {
        key,
        profile,
        provider,
        model,
        lastStatus: 'failed',
        failureCount: (previous?.failureCount ?? 0) + 1,
        successCount: previous?.successCount ?? 0,
        lastFailureAt: now,
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        lastMessage: sanitizeHealthText(input.message) ?? previous?.lastMessage ?? null,
        lastErrorContext: sanitizeHealthText(input.errorContext) ?? previous?.lastErrorContext ?? null,
    });
    pruneByokProviderHealth();
    scheduleByokProviderHealthFlush();
}

/**
 * @param {{ profile?: string | null; provider?: string | null; model?: string | null; timestamp?: number }} input
 * @returns {void}
 */
export function recordByokProviderModelCallSuccess(input) {
    hydrateByokProviderHealthFromDisk();
    const profile = normalizePart(input.profile);
    const provider = normalizePart(input.provider);
    const model = normalizePart(input.model);
    if (!profile && !provider && !model) return;
    const key = healthKey({ profile, provider, model });
    const now = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
    const previous = _byokProviderHealthByKey.get(key);
    _byokProviderHealthByKey.set(key, {
        key,
        profile,
        provider,
        model,
        lastStatus: 'ok',
        failureCount: previous?.failureCount ?? 0,
        successCount: (previous?.successCount ?? 0) + 1,
        lastFailureAt: previous?.lastFailureAt ?? null,
        lastSuccessAt: now,
        lastMessage: null,
        lastErrorContext: null,
    });
    pruneByokProviderHealth();
    scheduleByokProviderHealthFlush();
}

/**
 * @param {{ profile?: string | null; provider?: string | null; model?: string | null }} input
 * @returns {{ key: string; profile: string | null; provider: string | null; model: string | null; lastStatus: 'failed' | 'ok'; failureCount: number; successCount: number; lastFailureAt: number | null; lastSuccessAt: number | null; lastMessage: string | null; lastErrorContext: string | null } | null}
 */
export function readByokProviderModelHealth(input) {
    hydrateByokProviderHealthFromDisk();
    return _byokProviderHealthByKey.get(healthKey(input)) ?? null;
}

/**
 * @returns {Array<{ key: string; profile: string | null; provider: string | null; model: string | null; lastStatus: 'failed' | 'ok'; failureCount: number; successCount: number; lastFailureAt: number | null; lastSuccessAt: number | null; lastMessage: string | null; lastErrorContext: string | null }>}
 */
export function listByokProviderModelHealth() {
    hydrateByokProviderHealthFromDisk();
    return [..._byokProviderHealthByKey.values()].sort((a, b) => {
        const aTime = Math.max(a.lastFailureAt ?? 0, a.lastSuccessAt ?? 0);
        const bTime = Math.max(b.lastFailureAt ?? 0, b.lastSuccessAt ?? 0);
        return bTime - aTime;
    });
}

/**
 * @returns {void}
 */
export function clearByokProviderModelHealth() {
    hydrateByokProviderHealthFromDisk();
    _byokProviderHealthByKey.clear();
    scheduleByokProviderHealthFlush();
}

/**
 * @returns {{ enabled: boolean; path: string | null; loaded: boolean; records: number; persistedRecords: number; flushScheduled: boolean; flushInFlight: boolean; dirty: boolean; error: string | null }}
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
    };
}

/**
 * @returns {void}
 */
export function resetByokProviderHealthForTests() {
    _byokProviderHealthByKey.clear();
    _byokProviderHealthHydrated = false;
    _byokProviderHealthFlushScheduled = false;
    _byokProviderHealthFlushInFlight = false;
    _byokProviderHealthDirty = false;
    _byokProviderHealthFlushPromise = null;
    _byokProviderHealthLastError = null;
    _byokProviderHealthPersistedRecords = 0;
}
