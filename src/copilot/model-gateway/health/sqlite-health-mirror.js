// @ts-check
/**
 * Mirror operational BYOK health into the model-gateway SQLite runtime layer.
 *
 * The source of truth for runtime health remains probe/live execution. This helper only materializes the latest
 * operational health facts into SQLite so catalog explain/search layers can consult them without reading terminal files.
 *
 * @module copilot/model-gateway/health/sqlite-health-mirror
 */

import { listByokProviderModelHealth, subscribeByokProviderHealthChanges } from './provider-health.js';

const DEFAULT_HEALTH_SQLITE_MIRROR_DEBOUNCE_MS = 1_000;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function debounceMs(value, fallback) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function errorMessage(value) {
    return value instanceof Error ? value.message : value === null || value === undefined ? null : String(value);
}

/**
 * @param {object} input
 * @param {{ writeRuntimeHealthRecords(records: Record<string, unknown>[], options?: { runId?: string; observedAt?: string | number | Date }): Promise<{ runId: string; healthObservations: number; probeResults: number; skippedRecords?: number }> }} input.sqliteStore
 * @param {Record<string, unknown>[]} [input.records]
 * @param {string | number | Date} [input.observedAt]
 * @returns {Promise<{ runId: string; healthObservations: number; probeResults: number; skippedRecords: number; records: number }>}
 */
export async function mirrorByokProviderHealthToSqlite(input) {
    const records = input.records ?? listByokProviderModelHealth();
    const options = input.observedAt === undefined ? {} : { observedAt: input.observedAt };
    const result = await input.sqliteStore.writeRuntimeHealthRecords(records, options);
    return {
        ...result,
        skippedRecords: result.skippedRecords ?? 0,
        records: records.length,
    };
}

/**
 * @typedef {object} ByokProviderHealthSqliteMirrorState
 * @property {boolean} enabled
 * @property {boolean} disposed
 * @property {boolean} pending
 * @property {boolean} inFlight
 * @property {number} debounceMs
 * @property {number} changeCount
 * @property {number} flushCount
 * @property {number | null} lastChangeAt
 * @property {number | null} lastFlushAt
 * @property {string | null} lastRunId
 * @property {number} lastRecords
 * @property {number} lastHealthObservations
 * @property {number} lastProbeResults
 * @property {number} lastSkippedRecords
 * @property {string | null} lastError
 */

/**
 * @typedef {object} ByokProviderHealthSqliteMirrorController
 * @property {boolean} enabled
 * @property {() => void} dispose
 * @property {() => Promise<ByokProviderHealthSqliteMirrorState>} flush
 * @property {() => ByokProviderHealthSqliteMirrorState} readState
 */

/**
 * Install an in-process SQLite mirror for BYOK runtime health changes.
 *
 * This keeps provider-health storage-neutral: runtime code records facts once, while the mirror subscribes from the
 * edge and materializes the latest redacted facts into SQLite for explain/readiness/selection layers.
 *
 * @param {object} input
 * @param {{ writeRuntimeHealthRecords(records: Record<string, unknown>[], options?: { runId?: string; observedAt?: string | number | Date }): Promise<{ runId: string; healthObservations: number; probeResults: number; skippedRecords?: number }> }} input.sqliteStore
 * @param {number} [input.debounceMs]
 * @param {boolean} [input.enabled]
 * @param {(error: unknown) => void} [input.onError]
 * @returns {ByokProviderHealthSqliteMirrorController}
 */
export function installByokProviderHealthSqliteMirror(input) {
    const enabled =
        input.enabled ??
        (process.env['MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_DISABLED'] !== 'true' &&
            (process.env['VITEST'] !== 'true' ||
                process.env['MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_ENABLED'] === 'true'));
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    /** @type {Promise<ByokProviderHealthSqliteMirrorState> | null} */
    let inFlightPromise = null;
    /** @type {(() => void) | null} */
    let unsubscribe = null;
    /** @type {ByokProviderHealthSqliteMirrorState} */
    const state = {
        enabled,
        disposed: false,
        pending: false,
        inFlight: false,
        debounceMs: debounceMs(input.debounceMs, DEFAULT_HEALTH_SQLITE_MIRROR_DEBOUNCE_MS),
        changeCount: 0,
        flushCount: 0,
        lastChangeAt: null,
        lastFlushAt: null,
        lastRunId: null,
        lastRecords: 0,
        lastHealthObservations: 0,
        lastProbeResults: 0,
        lastSkippedRecords: 0,
        lastError: null,
    };

    /**
     * @returns {ByokProviderHealthSqliteMirrorState}
     */
    function readState() {
        return { ...state };
    }

    /**
     * @returns {Promise<ByokProviderHealthSqliteMirrorState>}
     */
    async function flush() {
        if (!enabled || state.disposed) return readState();
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (!state.pending && !inFlightPromise) return readState();
        if (inFlightPromise) {
            state.pending = true;
            await inFlightPromise;
            return flush();
        }
        state.pending = false;
        state.inFlight = true;
        inFlightPromise = (async () => {
            try {
                const observedAt = new Date();
                const records = listByokProviderModelHealth();
                const result = await mirrorByokProviderHealthToSqlite({
                    sqliteStore: input.sqliteStore,
                    records,
                    observedAt,
                });
                state.flushCount += 1;
                state.lastFlushAt = observedAt.getTime();
                state.lastRunId = result.runId;
                state.lastRecords = result.records;
                state.lastHealthObservations = result.healthObservations;
                state.lastProbeResults = result.probeResults;
                state.lastSkippedRecords = result.skippedRecords;
                state.lastError = null;
            } catch (error) {
                state.lastError = errorMessage(error);
                input.onError?.(error);
            } finally {
                state.inFlight = false;
            }
            return readState();
        })();
        try {
            return await inFlightPromise;
        } finally {
            inFlightPromise = null;
        }
    }

    /**
     * @returns {void}
     */
    function schedule() {
        if (!enabled || state.disposed) return;
        state.changeCount += 1;
        state.lastChangeAt = Date.now();
        state.pending = true;
        if (timer || inFlightPromise) return;
        timer = setTimeout(() => {
            timer = null;
            void flush();
        }, state.debounceMs);
        if (typeof timer.unref === 'function') timer.unref();
    }

    /**
     * @returns {void}
     */
    function dispose() {
        state.disposed = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        unsubscribe?.();
        unsubscribe = null;
    }

    if (enabled) {
        unsubscribe = subscribeByokProviderHealthChanges(() => schedule());
    }

    return {
        enabled,
        dispose,
        flush,
        readState,
    };
}
