// @ts-check
/**
 * Mirror operational BYOK health into the model-gateway SQLite runtime layer.
 *
 * The source of truth for runtime health remains probe/live execution. Explicit operator mirrors may still materialize
 * the full current ledger, while the installed in-process mirror consumes change events as deltas so one model update
 * never rewrites every unchanged health fact.
 *
 * @module copilot/model-gateway/health/sqlite-health-mirror
 */

import {
    flushByokProviderHealth,
    readHydratedByokProviderHealthSnapshot,
    subscribeByokProviderHealthChanges,
} from './provider-health.js';
import { comparableModelGatewayRuntimeHealthRecord } from './runtime-health-diff.js';

const DEFAULT_HEALTH_SQLITE_MIRROR_DEBOUNCE_MS = 1_000;

/**
 * @typedef {{
 *     routeProfile?: string | null;
 *     providerId?: string | null;
 *     providerModel?: string | null;
 *     all?: boolean;
 * }} RuntimeHealthClearScope
 */

/**
 * @typedef {{
 *     writeRuntimeHealthRecords(
 *         records: readonly unknown[],
 *         options?: { runId?: string; observedAt?: string | number | Date },
 *     ): Promise<{ runId: string; healthObservations: number; probeResults: number; skippedRecords?: number }>;
 *     deleteRuntimeHealthRecords(
 *         scope: RuntimeHealthClearScope,
 *     ): Promise<{ healthObservations: number; probeResults: number }>;
 *     listLatestRuntimeHealthRecords?: (
 *         options?: { limit?: number },
 *     ) => Promise<Record<string, unknown>[]>;
 * }} RuntimeHealthSqliteMirrorStore
 */

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
 * @param {RuntimeHealthClearScope} scope
 * @param {Record<string, unknown>} record
 * @returns {boolean}
 */
function clearScopeMatchesRecord(scope, record) {
    if (scope.all === true) return true;
    if (scope.routeProfile && record['routeProfile'] !== scope.routeProfile) return false;
    if (scope.providerId && record['providerId'] !== scope.providerId) return false;
    if (scope.providerModel && record['providerModel'] !== scope.providerModel) return false;
    return Boolean(scope.routeProfile || scope.providerId || scope.providerModel);
}

/**
 * @param {RuntimeHealthClearScope} left
 * @param {RuntimeHealthClearScope} right
 * @returns {boolean}
 */
function sameClearScope(left, right) {
    return (
        left.all === right.all &&
        (left.routeProfile ?? null) === (right.routeProfile ?? null) &&
        (left.providerId ?? null) === (right.providerId ?? null) &&
        (left.providerModel ?? null) === (right.providerModel ?? null)
    );
}

/**
 * Explicit full-snapshot mirror used by operator commands and bootstraps. The installed event listener below deliberately
 * does not call this helper: event-driven synchronization is delta-only.
 *
 * @param {object} input
 * @param {Pick<RuntimeHealthSqliteMirrorStore, 'writeRuntimeHealthRecords'>} input.sqliteStore
 * @param {Record<string, unknown>[]} [input.records]
 * @param {string | number | Date} [input.observedAt]
 * @returns {Promise<{
 *     runId: string;
 *     healthObservations: number;
 *     probeResults: number;
 *     skippedRecords: number;
 *     records: number;
 * }>}
 */
export async function mirrorByokProviderHealthToSqlite(input) {
    const records = input.records ?? (await readHydratedByokProviderHealthSnapshot()).records;
    const options = input.observedAt === undefined ? {} : { observedAt: input.observedAt };
    const result = await input.sqliteStore.writeRuntimeHealthRecords(records, options);
    return {
        ...result,
        skippedRecords: result.skippedRecords ?? 0,
        records: records.length,
    };
}

/**
 * Flushes the BYOK health ledger to its durable JSON store and then performs one explicit full current-state mirror.
 *
 * @param {object} input
 * @param {Pick<RuntimeHealthSqliteMirrorStore, 'writeRuntimeHealthRecords'>} input.sqliteStore
 * @param {Record<string, unknown>[]} [input.records]
 * @param {string | number | Date} [input.observedAt]
 * @returns {Promise<{
 *     runId: string;
 *     healthObservations: number;
 *     probeResults: number;
 *     skippedRecords: number;
 *     records: number;
 *     flushed: boolean;
 * }>}
 */
export async function flushAndMirrorByokProviderHealthToSqlite(input) {
    await flushByokProviderHealth();
    const result = await mirrorByokProviderHealthToSqlite(input);
    return {
        ...result,
        flushed: true,
    };
}

/**
 * Reconcile durable BYOK health into SQLite without deleting SQLite-only evidence owned by other runtime lanes.
 *
 * The file ledger has a hard in-process bound (currently 200 records), while latest SQLite reads use the v14 pointer
 * projections. Reconciliation therefore stays bounded and additive: write only identities missing from SQLite or whose
 * durable file observation is strictly newer. SQLite-only/direct-probe evidence is intentionally left untouched.
 *
 * @param {{ sqliteStore: RuntimeHealthSqliteMirrorStore; observedAt?: string | number | Date; sqliteLimit?: number }} input
 * @returns {Promise<{
 *     sourceRecords: number;
 *     sqliteRecords: number;
 *     candidateRecords: number;
 *     reconciledRecords: number;
 *     runId: string | null;
 *     healthObservations: number;
 *     probeResults: number;
 *     skippedRecords: number;
 * }>}
 */
export async function reconcileByokProviderHealthToSqlite(input) {
    const { records } = await readHydratedByokProviderHealthSnapshot();
    const sqliteLimit = Math.max(1, Math.min(input.sqliteLimit ?? 10_000, 10_000));
    const sqliteRecords = input.sqliteStore.listLatestRuntimeHealthRecords
        ? await input.sqliteStore.listLatestRuntimeHealthRecords({ limit: sqliteLimit })
        : [];
    const sqliteByKey = new Map(
        sqliteRecords.map((record) => {
            const comparable = comparableModelGatewayRuntimeHealthRecord(record);
            return [comparable.key, comparable];
        }),
    );
    const candidates = records.filter((record) => {
        const comparable = comparableModelGatewayRuntimeHealthRecord(/** @type {Record<string, unknown>} */ (record));
        const sqlite = sqliteByKey.get(comparable.key);
        return !sqlite || comparable.observedAt > sqlite.observedAt;
    });
    if (candidates.length === 0) {
        return {
            sourceRecords: records.length,
            sqliteRecords: sqliteRecords.length,
            candidateRecords: 0,
            reconciledRecords: 0,
            runId: null,
            healthObservations: 0,
            probeResults: 0,
            skippedRecords: 0,
        };
    }
    const mirrored = await mirrorByokProviderHealthToSqlite({
        sqliteStore: input.sqliteStore,
        records: /** @type {Record<string, unknown>[]} */ (candidates),
        ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    });
    return {
        sourceRecords: records.length,
        sqliteRecords: sqliteRecords.length,
        candidateRecords: candidates.length,
        reconciledRecords: mirrored.records,
        runId: mirrored.runId,
        healthObservations: mirrored.healthObservations,
        probeResults: mirrored.probeResults,
        skippedRecords: mirrored.skippedRecords,
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
 * @property {number} pendingRecordCount
 * @property {number} pendingClearCount
 * @property {number | null} lastChangeAt
 * @property {number | null} lastFlushAt
 * @property {string | null} lastRunId
 * @property {number} lastRecords
 * @property {number} lastHealthObservations
 * @property {number} lastProbeResults
 * @property {number} lastSkippedRecords
 * @property {number} lastClearedHealthObservations
 * @property {number} lastClearedProbeResults
 * @property {string | null} lastError
 */

/**
 * @typedef {object} ByokProviderHealthSqliteMirrorController
 * @property {boolean} enabled
 * @property {() => void} dispose
 * @property {() => Promise<ByokProviderHealthSqliteMirrorState>} flush
 * @property {() => Promise<Awaited<ReturnType<typeof reconcileByokProviderHealthToSqlite>> | null>} reconcile
 * @property {() => ByokProviderHealthSqliteMirrorState} readState
 */

/**
 * Install an in-process delta mirror for BYOK runtime health changes.
 *
 * Event ordering is preserved at the batch boundary by applying queued clears before queued records. A clear removes any
 * older pending record that it covers; a record observed after the clear remains queued and is written after deletion.
 * Work arriving while a batch is in flight is never folded into that batch and is automatically re-armed afterwards.
 *
 * @param {object} input
 * @param {RuntimeHealthSqliteMirrorStore} input.sqliteStore
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
    /** @type {Map<string, Record<string, unknown>>} */
    const pendingRecords = new Map();
    /** @type {RuntimeHealthClearScope[]} */
    let pendingClearScopes = [];
    /** @type {ByokProviderHealthSqliteMirrorState} */
    const state = {
        enabled,
        disposed: false,
        pending: false,
        inFlight: false,
        debounceMs: debounceMs(input.debounceMs, DEFAULT_HEALTH_SQLITE_MIRROR_DEBOUNCE_MS),
        changeCount: 0,
        flushCount: 0,
        pendingRecordCount: 0,
        pendingClearCount: 0,
        lastChangeAt: null,
        lastFlushAt: null,
        lastRunId: null,
        lastRecords: 0,
        lastHealthObservations: 0,
        lastProbeResults: 0,
        lastSkippedRecords: 0,
        lastClearedHealthObservations: 0,
        lastClearedProbeResults: 0,
        lastError: null,
    };

    function refreshPendingState() {
        state.pendingRecordCount = pendingRecords.size;
        state.pendingClearCount = pendingClearScopes.length;
        state.pending = pendingRecords.size > 0 || pendingClearScopes.length > 0;
    }

    /** @returns {ByokProviderHealthSqliteMirrorState} */
    function readState() {
        refreshPendingState();
        return { ...state };
    }

    function armTimer() {
        if (!enabled || state.disposed || timer || inFlightPromise) return;
        refreshPendingState();
        if (!state.pending) return;
        timer = setTimeout(() => {
            timer = null;
            void flush();
        }, state.debounceMs);
        if (typeof timer.unref === 'function') timer.unref();
    }

    /** @param {RuntimeHealthClearScope} scope */
    function queueClear(scope) {
        const normalized = {
            routeProfile: scope.routeProfile ?? null,
            providerId: scope.providerId ?? null,
            providerModel: scope.providerModel ?? null,
            all: scope.all === true,
        };
        if (normalized.all) {
            pendingRecords.clear();
            pendingClearScopes = [normalized];
            return;
        }
        for (const [key, record] of pendingRecords) {
            if (clearScopeMatchesRecord(normalized, record)) pendingRecords.delete(key);
        }
        if (pendingClearScopes.some((existing) => existing.all === true)) return;
        if (!pendingClearScopes.some((existing) => sameClearScope(existing, normalized))) {
            pendingClearScopes.push(normalized);
        }
    }

    /**
     * @param {{
     *     reason: 'call_failure' | 'call_success' | 'agent_probe_failure' | 'agent_probe_success' | 'probe_result' | 'clear';
     *     observedAt: number;
     *     key: string | null;
     *     record: Record<string, unknown> | null;
     *     scope: { routeProfile: string | null; providerId: string | null; providerModel: string | null; all: boolean };
     * }} event
     */
    function queueEvent(event) {
        if (!enabled || state.disposed) return;
        state.changeCount += 1;
        state.lastChangeAt = event.observedAt;
        if (event.reason === 'clear') {
            queueClear(event.scope);
        } else if (event.record && event.key) {
            pendingRecords.set(event.key, /** @type {Record<string, unknown>} */ (event.record));
        }
        refreshPendingState();
        armTimer();
    }

    /**
     * Requeue an unsuccessful batch while preserving causal last-write semantics relative to work that arrived while
     * the failed batch was in flight.
     *
     * Both the failed batch and the current pending batch are already normalized to `clears -> records`. The failed
     * batch is older, so rebuild the pending state by replaying its normalized operations first and the newer pending
     * operations second. This is intentionally different from filtering failed records against all pending clears: a
     * record from `clear(A) -> record(A)` belongs after that clear and must survive retry, while a newer clear(A) must
     * still remove it.
     *
     * @param {RuntimeHealthClearScope[]} clearScopes
     * @param {Map<string, Record<string, unknown>>} records
     */
    function requeueFailedBatch(clearScopes, records) {
        const newerClearScopes = pendingClearScopes;
        const newerRecords = new Map(pendingRecords);
        pendingClearScopes = [];
        pendingRecords.clear();

        for (const scope of clearScopes) queueClear(scope);
        for (const [key, record] of records) pendingRecords.set(key, record);
        for (const scope of newerClearScopes) queueClear(scope);
        for (const [key, record] of newerRecords) pendingRecords.set(key, record);
        refreshPendingState();
    }

    /** @returns {Promise<ByokProviderHealthSqliteMirrorState>} */
    async function flush() {
        if (!enabled || state.disposed) return readState();
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (inFlightPromise) {
            await inFlightPromise;
            return flush();
        }
        refreshPendingState();
        if (!state.pending) return readState();

        const clearScopes = pendingClearScopes;
        pendingClearScopes = [];
        const records = new Map(pendingRecords);
        pendingRecords.clear();
        refreshPendingState();
        state.inFlight = true;

        inFlightPromise = (async () => {
            const observedAt = new Date();
            let clearedHealthObservations = 0;
            let clearedProbeResults = 0;
            let writeResult = null;
            try {
                for (const scope of clearScopes) {
                    const deleted = await input.sqliteStore.deleteRuntimeHealthRecords(scope);
                    clearedHealthObservations += deleted.healthObservations;
                    clearedProbeResults += deleted.probeResults;
                }
                if (records.size > 0) {
                    writeResult = await mirrorByokProviderHealthToSqlite({
                        sqliteStore: input.sqliteStore,
                        records: [...records.values()],
                        observedAt,
                    });
                }
                state.flushCount += 1;
                state.lastFlushAt = observedAt.getTime();
                state.lastRunId = writeResult?.runId ?? null;
                state.lastRecords = writeResult?.records ?? 0;
                state.lastHealthObservations = writeResult?.healthObservations ?? 0;
                state.lastProbeResults = writeResult?.probeResults ?? 0;
                state.lastSkippedRecords = writeResult?.skippedRecords ?? 0;
                state.lastClearedHealthObservations = clearedHealthObservations;
                state.lastClearedProbeResults = clearedProbeResults;
                state.lastError = null;
            } catch (error) {
                requeueFailedBatch(clearScopes, records);
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
            refreshPendingState();
            armTimer();
        }
    }

    async function reconcile() {
        if (!enabled || state.disposed) return null;
        return reconcileByokProviderHealthToSqlite({ sqliteStore: input.sqliteStore });
    }

    function dispose() {
        state.disposed = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        unsubscribe?.();
        unsubscribe = null;
        pendingRecords.clear();
        pendingClearScopes = [];
        refreshPendingState();
    }

    if (enabled) unsubscribe = subscribeByokProviderHealthChanges(queueEvent);

    return {
        enabled,
        dispose,
        flush,
        reconcile,
        readState,
    };
}
