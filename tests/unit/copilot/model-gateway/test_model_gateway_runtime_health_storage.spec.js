// @ts-check

import { adaptBetterSqliteDatabase } from '#copilot/infra/public/testing/database/sqlite';
import {
    MODEL_GATEWAY_SQLITE_SCHEMA_SQL,
    MODEL_GATEWAY_SQLITE_SCHEMA_VERSION,
    SqliteModelGatewayCatalogStore,
    clearByokProviderModelHealth,
    configureByokProviderHealthPersistenceStoreForTests,
    installByokProviderHealthSqliteMirror,
    readByokProviderHealthState,
    readHydratedByokProviderHealthSnapshot,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    resetByokProviderHealthForTests,
    restoreByokProviderHealthPersistenceStoreForTests,
} from '#copilot/model-gateway';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** @returns {Promise<import('better-sqlite3').default>} */
async function memoryDatabase() {
    const { default: Database } = await import('better-sqlite3');
    return new Database(':memory:');
}

/** @param {import('better-sqlite3').default} db @param {string} table */
function rowCount(db, table) {
    return /** @type {{ count: number }} */ (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count;
}

function runtimeRecord(providerModel, timestamp, status = 'ok') {
    return {
        key: `default|openrouter|${providerModel}`,
        routeProfile: 'default',
        providerId: 'openrouter',
        providerModel,
        lastStatus: status,
        ...(status === 'ok' ? { lastSuccessAt: timestamp } : { lastFailureAt: timestamp }),
        probes: {
            chat: {
                kind: 'chat',
                status,
                ok: status === 'ok',
                providerAttempted: true,
                count: 1,
                successCount: status === 'ok' ? 1 : 0,
                failureCount: status === 'ok' ? 0 : 1,
                lastAt: timestamp,
            },
        },
    };
}

describe('Model Gateway runtime-health SQLite storage', () => {
    beforeEach(() => resetByokProviderHealthForTests());
    afterEach(() => {
        restoreByokProviderHealthPersistenceStoreForTests();
        resetByokProviderHealthForTests();
    });

    it('mirrors only changed BYOK identities after the initial delta batch', async () => {
        const db = await memoryDatabase();
        try {
            const store = new SqliteModelGatewayCatalogStore({ db: adaptBetterSqliteDatabase(db) });
            const controller = installByokProviderHealthSqliteMirror({
                sqliteStore: store,
                debounceMs: 60_000,
                enabled: true,
            });

            recordByokProviderModelCallSuccess({
                routeProfile: 'default',
                providerId: 'openrouter',
                providerModel: 'model-a',
                timestamp: 1_000,
            });
            recordByokProviderModelCallSuccess({
                routeProfile: 'default',
                providerId: 'openrouter',
                providerModel: 'model-b',
                timestamp: 1_000,
            });
            const first = await controller.flush();

            recordByokProviderModelCallFailure({
                routeProfile: 'default',
                providerId: 'openrouter',
                providerModel: 'model-a',
                timestamp: 2_000,
                failureKind: 'rate-limit',
            });
            const second = await controller.flush();
            controller.dispose();

            expect(first.lastRecords).toBe(2);
            expect(second.lastRecords).toBe(1);
            expect(rowCount(db, 'copilot_model_gateway_health_observations')).toBe(3);
            expect(rowCount(db, 'copilot_model_gateway_runtime_health_latest')).toBe(2);
            const latest = await store.listLatestRuntimeHealthRecords();
            expect(latest).toHaveLength(2);
            expect(latest.find((entry) => entry['providerModel'] === 'model-a')?.['runtimeHealthStatus']).toBe(
                'failed',
            );
        } finally {
            db.close();
        }
    });

    it('projects scoped and global health clears into SQLite instead of leaving stale readiness evidence', async () => {
        const db = await memoryDatabase();
        try {
            const store = new SqliteModelGatewayCatalogStore({ db: adaptBetterSqliteDatabase(db) });
            const controller = installByokProviderHealthSqliteMirror({
                sqliteStore: store,
                debounceMs: 60_000,
                enabled: true,
            });

            for (const model of ['model-a', 'model-b']) {
                recordByokProviderModelCallSuccess({
                    routeProfile: 'default',
                    providerId: 'openrouter',
                    providerModel: model,
                    timestamp: 1_000,
                });
                recordByokProviderModelProbeResult({
                    routeProfile: 'default',
                    providerId: 'openrouter',
                    providerModel: model,
                    probeKind: 'chat',
                    status: 'ok',
                    ok: true,
                    providerAttempted: true,
                    timestamp: 1_000,
                });
            }
            await controller.flush();

            clearByokProviderModelHealth({
                routeProfile: 'default',
                providerId: 'openrouter',
                providerModel: 'model-a',
            });
            const scoped = await controller.flush();
            expect(scoped.lastRecords).toBe(0);
            expect(scoped.lastClearedHealthObservations).toBe(1);
            expect(scoped.lastClearedProbeResults).toBe(1);
            expect(await store.listLatestRuntimeHealthRecords()).toHaveLength(1);

            clearByokProviderModelHealth();
            const all = await controller.flush();
            controller.dispose();

            expect(all.lastClearedHealthObservations).toBe(1);
            expect(all.lastClearedProbeResults).toBe(1);
            expect(await store.listLatestRuntimeHealthRecords()).toEqual([]);
            expect(rowCount(db, 'copilot_model_gateway_runtime_health_latest')).toBe(0);
            expect(rowCount(db, 'copilot_model_gateway_runtime_probe_latest')).toBe(0);
        } finally {
            db.close();
        }
    });

    it('re-arms a delta that arrives while the previous SQLite batch is in flight', async () => {
        /** @type {((value?: unknown) => void) | null} */
        let releaseFirstWrite = null;
        const firstWriteGate = new Promise((resolve) => {
            releaseFirstWrite = resolve;
        });
        /** @type {string[][]} */
        const writes = [];
        let writeCount = 0;
        const controller = installByokProviderHealthSqliteMirror({
            sqliteStore: {
                async writeRuntimeHealthRecords(records) {
                    writeCount += 1;
                    writes.push(
                        records.map((record) =>
                            String(/** @type {Record<string, unknown>} */ (record)['providerModel']),
                        ),
                    );
                    if (writeCount === 1) await firstWriteGate;
                    return {
                        runId: `run-${writeCount}`,
                        healthObservations: records.length,
                        probeResults: 0,
                        skippedRecords: 0,
                    };
                },
                async deleteRuntimeHealthRecords() {
                    return { healthObservations: 0, probeResults: 0 };
                },
            },
            debounceMs: 60_000,
            enabled: true,
        });

        recordByokProviderModelCallSuccess({
            routeProfile: 'default',
            providerId: 'openrouter',
            providerModel: 'model-a',
            timestamp: 1_000,
        });
        const firstFlush = controller.flush();
        await new Promise((resolve) => setTimeout(resolve, 0));
        recordByokProviderModelCallSuccess({
            routeProfile: 'default',
            providerId: 'openrouter',
            providerModel: 'model-b',
            timestamp: 2_000,
        });
        releaseFirstWrite?.();
        await firstFlush;
        await controller.flush();
        controller.dispose();

        expect(writes).toEqual([['model-a'], ['model-b']]);
    });

    it('retries clear -> record batches without dropping the newer record after a SQLite write failure', async () => {
        /** @type {string[]} */
        const operations = [];
        let writeCount = 0;
        const controller = installByokProviderHealthSqliteMirror({
            sqliteStore: {
                async writeRuntimeHealthRecords(records) {
                    writeCount += 1;
                    const models = records.map((record) =>
                        String(/** @type {Record<string, unknown>} */ (record)['providerModel']),
                    );
                    operations.push(`write:${models.join(',')}:${writeCount}`);
                    if (writeCount === 1) throw new Error('synthetic-write-failure');
                    return {
                        runId: `run-${writeCount}`,
                        healthObservations: records.length,
                        probeResults: 0,
                        skippedRecords: 0,
                    };
                },
                async deleteRuntimeHealthRecords(scope) {
                    operations.push(`delete:${scope.providerModel ?? (scope.all ? 'all' : 'scope')}`);
                    return { healthObservations: 0, probeResults: 0 };
                },
            },
            debounceMs: 60_000,
            enabled: true,
        });

        clearByokProviderModelHealth({
            routeProfile: 'default',
            providerId: 'openrouter',
            providerModel: 'model-a',
        });
        recordByokProviderModelCallSuccess({
            routeProfile: 'default',
            providerId: 'openrouter',
            providerModel: 'model-a',
            timestamp: 2_000,
        });

        const failed = await controller.flush();
        expect(failed.lastError).toBe('synthetic-write-failure');
        expect(failed.pendingClearCount).toBe(1);
        expect(failed.pendingRecordCount).toBe(1);

        const retried = await controller.flush();
        controller.dispose();

        expect(retried.lastError).toBeNull();
        expect(retried.pendingClearCount).toBe(0);
        expect(retried.pendingRecordCount).toBe(0);
        expect(operations).toEqual(['delete:model-a', 'write:model-a:1', 'delete:model-a', 'write:model-a:2']);
    });

    it('does not resurrect a record when record -> clear is retried after a SQLite delete failure', async () => {
        /** @type {string[]} */
        const operations = [];
        let deleteCount = 0;
        const controller = installByokProviderHealthSqliteMirror({
            sqliteStore: {
                async writeRuntimeHealthRecords(records) {
                    operations.push(
                        `write:${records
                            .map((record) => String(/** @type {Record<string, unknown>} */ (record)['providerModel']))
                            .join(',')}`,
                    );
                    return {
                        runId: 'unexpected-write',
                        healthObservations: records.length,
                        probeResults: 0,
                        skippedRecords: 0,
                    };
                },
                async deleteRuntimeHealthRecords(scope) {
                    deleteCount += 1;
                    operations.push(`delete:${scope.providerModel ?? 'scope'}:${deleteCount}`);
                    if (deleteCount === 1) throw new Error('synthetic-delete-failure');
                    return { healthObservations: 1, probeResults: 0 };
                },
            },
            debounceMs: 60_000,
            enabled: true,
        });

        recordByokProviderModelCallSuccess({
            routeProfile: 'default',
            providerId: 'openrouter',
            providerModel: 'model-a',
            timestamp: 1_000,
        });
        clearByokProviderModelHealth({
            routeProfile: 'default',
            providerId: 'openrouter',
            providerModel: 'model-a',
        });

        const failed = await controller.flush();
        expect(failed.lastError).toBe('synthetic-delete-failure');
        expect(failed.pendingClearCount).toBe(1);
        expect(failed.pendingRecordCount).toBe(0);

        await controller.flush();
        controller.dispose();

        expect(operations).toEqual(['delete:model-a:1', 'delete:model-a:2']);
    });

    it('merges a failed clear-all batch with newer in-flight clears and records using causal order', async () => {
        /** @type {string[]} */
        const operations = [];
        let writeCount = 0;
        const controller = installByokProviderHealthSqliteMirror({
            sqliteStore: {
                async writeRuntimeHealthRecords(records) {
                    writeCount += 1;
                    const models = records
                        .map((record) => String(/** @type {Record<string, unknown>} */ (record)['providerModel']))
                        .sort();
                    operations.push(`write:${models.join(',')}:${writeCount}`);
                    if (writeCount === 1) {
                        clearByokProviderModelHealth({
                            routeProfile: 'default',
                            providerId: 'openrouter',
                            providerModel: 'model-b',
                        });
                        recordByokProviderModelCallSuccess({
                            routeProfile: 'default',
                            providerId: 'openrouter',
                            providerModel: 'model-c',
                            timestamp: 3_000,
                        });
                        throw new Error('synthetic-write-failure');
                    }
                    return {
                        runId: `run-${writeCount}`,
                        healthObservations: records.length,
                        probeResults: 0,
                        skippedRecords: 0,
                    };
                },
                async deleteRuntimeHealthRecords(scope) {
                    operations.push(`delete:${scope.all ? 'all' : (scope.providerModel ?? 'scope')}`);
                    return { healthObservations: 0, probeResults: 0 };
                },
            },
            debounceMs: 60_000,
            enabled: true,
        });

        clearByokProviderModelHealth();
        for (const [providerModel, timestamp] of [
            ['model-a', 1_000],
            ['model-b', 2_000],
        ]) {
            recordByokProviderModelCallSuccess({
                routeProfile: 'default',
                providerId: 'openrouter',
                providerModel,
                timestamp,
            });
        }

        const failed = await controller.flush();
        expect(failed.lastError).toBe('synthetic-write-failure');
        expect(failed.pendingClearCount).toBe(1);
        expect(failed.pendingRecordCount).toBe(2);

        await controller.flush();
        controller.dispose();

        expect(operations).toEqual(['delete:all', 'write:model-a,model-b:1', 'delete:all', 'write:model-a,model-c:2']);
    });

    it('waits for durable provider-health hydration before exposing an authoritative snapshot', async () => {
        /** @type {((value?: unknown) => void) | null} */
        let releaseRead = null;
        const readGate = new Promise((resolve) => {
            releaseRead = resolve;
        });
        configureByokProviderHealthPersistenceStoreForTests(
            /** @type {any} */ ({
                enabled: true,
                path: '/virtual/byok-provider-health.json',
                async readText() {
                    await readGate;
                    return JSON.stringify({ schemaVersion: 3, records: [runtimeRecord('model-a', 2_000)] });
                },
                async writeText() {},
                async stat() {
                    return { size: 1, mtimeMs: 1 };
                },
            }),
        );

        const pending = readHydratedByokProviderHealthSnapshot();
        await Promise.resolve();
        expect(readByokProviderHealthState().loaded).toBe(false);

        releaseRead?.();
        const snapshot = await pending;

        expect(snapshot.state.loaded).toBe(true);
        expect(snapshot.state.error).toBeNull();
        expect(snapshot.records.map((record) => record.providerModel)).toEqual(['model-a']);
    });

    it('fails closed when durable provider-health persistence has an unsupported schema', async () => {
        configureByokProviderHealthPersistenceStoreForTests(
            /** @type {any} */ ({
                enabled: true,
                path: '/virtual/byok-provider-health-invalid.json',
                async readText() {
                    return JSON.stringify({ schemaVersion: 999, records: [] });
                },
                async writeText() {},
                async stat() {
                    return { size: 1, mtimeMs: 1 };
                },
            }),
        );

        await expect(readHydratedByokProviderHealthSnapshot()).rejects.toThrow(
            'invalid BYOK provider-health persistence schema',
        );
        expect(readByokProviderHealthState().loaded).toBe(true);
        expect(readByokProviderHealthState().error).toBe('invalid BYOK provider-health persistence schema');
    });

    it('reconciles preexisting hydrated ledger facts into SQLite once without rewriting an equal latest fact', async () => {
        configureByokProviderHealthPersistenceStoreForTests(
            /** @type {any} */ ({
                enabled: true,
                path: '/virtual/byok-provider-health-reconcile.json',
                async readText() {
                    return JSON.stringify({ schemaVersion: 3, records: [runtimeRecord('model-a', 2_000)] });
                },
                async writeText() {},
                async stat() {
                    return { size: 1, mtimeMs: 1 };
                },
            }),
        );
        const db = await memoryDatabase();
        try {
            const store = new SqliteModelGatewayCatalogStore({ db: adaptBetterSqliteDatabase(db) });
            const controller = installByokProviderHealthSqliteMirror({
                sqliteStore: store,
                debounceMs: 60_000,
                enabled: true,
            });

            const first = await controller.reconcile();
            const rowsAfterFirst = rowCount(db, 'copilot_model_gateway_health_observations');
            const second = await controller.reconcile();
            controller.dispose();

            expect(first?.sourceRecords).toBe(1);
            expect(first?.candidateRecords).toBe(1);
            expect(first?.reconciledRecords).toBe(1);
            expect(rowsAfterFirst).toBe(1);
            expect(second?.candidateRecords).toBe(0);
            expect(second?.reconciledRecords).toBe(0);
            expect(rowCount(db, 'copilot_model_gateway_health_observations')).toBe(1);
            expect((await store.listLatestRuntimeHealthRecords())[0]?.['providerModel']).toBe('model-a');
        } finally {
            db.close();
        }
    });

    it('preserves every materialized latest identity when history retention budget is smaller than current identity count', async () => {
        const db = await memoryDatabase();
        try {
            let checkpointCalls = 0;
            const store = new SqliteModelGatewayCatalogStore({
                db: adaptBetterSqliteDatabase(db),
                checkpoint: async () => {
                    checkpointCalls += 1;
                    await Promise.resolve();
                    return {
                        attempted: true,
                        mode: /** @type {const} */ ('PASSIVE'),
                        busy: 0,
                        walPages: checkpointCalls * 10,
                        checkpointedPages: checkpointCalls * 10,
                        durationMs: 0,
                        workerDurationMs: 0.25,
                    };
                },
            });
            for (let run = 1; run <= 3; run += 1) {
                await store.writeRuntimeHealthRecords(
                    [runtimeRecord('model-a', run * 1_000), runtimeRecord('model-b', run * 1_000)],
                    { runId: `run-${run}`, observedAt: run * 1_000 },
                );
            }
            const before = await store.listLatestRuntimeHealthRecords();

            const retained = await store.applyOperationalRetention({
                runtimeProbeRunMaxRows: 100,
                runtimeProbeResultMaxRows: 1,
                healthObservationMaxRows: 1,
                batchDeleteRows: 1,
                checkpointEveryBatches: 4,
            });
            const after = await store.listLatestRuntimeHealthRecords();
            const healthRetention = retained.tables['copilot_model_gateway_health_observations'];
            const probeRetention = retained.tables['copilot_model_gateway_runtime_probe_results'];

            expect(after).toEqual(before);
            expect(rowCount(db, 'copilot_model_gateway_health_observations')).toBe(2);
            expect(rowCount(db, 'copilot_model_gateway_runtime_probe_results')).toBe(2);
            expect(healthRetention?.protectedLatestRows).toBe(2);
            expect(healthRetention?.remainingRows).toBe(2);
            expect(healthRetention?.budgetSatisfied).toBe(false);
            expect(probeRetention?.protectedLatestRows).toBe(2);
            expect(probeRetention?.remainingRows).toBe(2);
            expect(probeRetention?.budgetSatisfied).toBe(false);
            expect(healthRetention?.batches).toBe(4);
            expect(probeRetention?.batches).toBe(4);
            expect(healthRetention?.batchRows).toEqual({ min: 1, avg: 1, max: 1 });
            expect(probeRetention?.batchRows).toEqual({ min: 1, avg: 1, max: 1 });
            expect(retained.maintenance.batchDeleteRows).toBe(1);
            expect(retained.maintenance.checkpointEveryBatches).toBe(4);
            expect(retained.maintenance.transactionCount).toBe(8);
            expect(retained.maintenance.transactionDurationMs.max).toBeGreaterThanOrEqual(0);
            expect(retained.maintenance.deletedRowsPerBatch).toEqual({ min: 1, p50: 1, p95: 1, max: 1 });
            expect(retained.maintenance.autoCheckpoint.pagesDuringMaintenance).toBe(0);
            expect(retained.maintenance.autoCheckpoint.restored).toBe(true);
            expect(retained.maintenance.checkpoint.mode).toBe('PASSIVE');
            expect(retained.maintenance.checkpoint.requestCount).toBe(3);
            expect(retained.maintenance.checkpoint.completedCount).toBe(3);
            expect(retained.maintenance.checkpoint.skippedCount).toBe(0);
            expect(retained.maintenance.checkpoint.failureCount).toBe(0);
            expect(retained.maintenance.checkpoint.periodicRequestCount).toBe(2);
            expect(retained.maintenance.checkpoint.durationMs.max).toBeGreaterThanOrEqual(0);
            expect(retained.maintenance.checkpoint.final.status).toBe('completed');
            expect(retained.maintenance.checkpoint.final.workerDurationMs).toBe(0.25);
            expect(checkpointCalls).toBe(3);
            expect(Number(db.prepare('PRAGMA wal_autocheckpoint').get()?.wal_autocheckpoint ?? -1)).toBe(
                retained.maintenance.autoCheckpoint.pagesBefore,
            );
            expect(retained.maintenance.freelistPagesAfter).toBeGreaterThanOrEqual(
                retained.maintenance.freelistPagesBefore,
            );
        } finally {
            db.close();
        }
    });

    it('reports a post-commit checkpoint failure without undoing retention or leaking the temporary autocheckpoint policy', async () => {
        const db = await memoryDatabase();
        try {
            const store = new SqliteModelGatewayCatalogStore({
                db: adaptBetterSqliteDatabase(db),
                checkpoint: async () => {
                    await Promise.resolve();
                    throw new Error('simulated checkpoint I/O failure');
                },
            });
            for (let run = 1; run <= 4; run += 1) {
                await store.writeRuntimeHealthRecords([runtimeRecord('model-a', run * 1_000)], {
                    runId: `failure-run-${run}`,
                    observedAt: run * 1_000,
                });
            }
            const autoCheckpointBefore = Number(
                db.prepare('PRAGMA wal_autocheckpoint').get()?.wal_autocheckpoint ?? -1,
            );

            const retained = await store.applyOperationalRetention({
                runtimeProbeRunMaxRows: 100,
                runtimeProbeResultMaxRows: 2,
                healthObservationMaxRows: 2,
                batchDeleteRows: 1,
            });

            expect(rowCount(db, 'copilot_model_gateway_health_observations')).toBe(2);
            expect(rowCount(db, 'copilot_model_gateway_runtime_probe_results')).toBe(2);
            expect((await store.listLatestRuntimeHealthRecords())[0]?.['providerModel']).toBe('model-a');
            expect(retained.deletedRows).toBeGreaterThanOrEqual(4);
            expect(retained.maintenance.checkpoint.requestCount).toBe(1);
            expect(retained.maintenance.checkpoint.completedCount).toBe(0);
            expect(retained.maintenance.checkpoint.failureCount).toBe(1);
            expect(retained.maintenance.checkpoint.final.status).toBe('failed');
            expect(retained.maintenance.checkpoint.final.error).toContain('simulated checkpoint I/O failure');
            expect(Number(db.prepare('PRAGMA wal_autocheckpoint').get()?.wal_autocheckpoint ?? -1)).toBe(
                autoCheckpointBefore,
            );
        } finally {
            db.close();
        }
    });

    it('chunks orphan handoff-transition cleanup without retaining a monolithic maintenance transaction', async () => {
        const db = await memoryDatabase();
        try {
            let checkpointCalls = 0;
            const store = new SqliteModelGatewayCatalogStore({
                db: adaptBetterSqliteDatabase(db),
                checkpoint: async () => {
                    checkpointCalls += 1;
                    return {
                        attempted: true,
                        mode: /** @type {const} */ ('PASSIVE'),
                        busy: 0,
                        walPages: 1,
                        checkpointedPages: 1,
                        durationMs: 0,
                        workerDurationMs: 0,
                    };
                },
            });
            db.prepare(
                `INSERT INTO copilot_model_gateway_sdk_session_handoffs
                    (handoff_id, status, operation_kind, promotion_policy, promotion_authorized, requested_at_ms, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).run('handoff-live', 'requested', 'set_model', 'manual_review', 0, 1_000, '{}');
            const insertTransition = db.prepare(
                `INSERT INTO copilot_model_gateway_sdk_session_handoff_transitions
                    (transition_id, handoff_id, state, occurred_at_ms, payload_json)
                 VALUES (?, ?, ?, ?, ?)`,
            );
            insertTransition.run('transition-live', 'handoff-live', 'requested', 1_000, '{}');
            insertTransition.run('transition-orphan-1', 'handoff-missing-1', 'requested', 2_000, '{}');
            insertTransition.run('transition-orphan-2', 'handoff-missing-2', 'requested', 3_000, '{}');
            insertTransition.run('transition-orphan-3', 'handoff-missing-3', 'requested', 4_000, '{}');

            const retained = await store.applyOperationalRetention({
                sdkSessionHandoffMaxRows: 100,
                batchDeleteRows: 1,
                checkpointEveryBatches: 2,
            });
            const transitions = retained.tables['copilot_model_gateway_sdk_session_handoff_transitions'];

            expect(rowCount(db, 'copilot_model_gateway_sdk_session_handoff_transitions')).toBe(1);
            expect(transitions?.deletedRows).toBe(3);
            expect(transitions?.orphanDeletedRows).toBe(3);
            expect(transitions?.orphanBatches).toBe(3);
            expect(transitions?.batches).toBe(0);
            expect(transitions?.remainingRows).toBe(1);
            expect(retained.maintenance.transactionCount).toBe(3);
            expect(retained.maintenance.checkpoint.periodicRequestCount).toBe(1);
            expect(retained.maintenance.checkpoint.requestCount).toBe(2);
            expect(retained.maintenance.checkpoint.completedCount).toBe(2);
            expect(checkpointCalls).toBe(2);
        } finally {
            db.close();
        }
    });

    it('uses dedicated covering indexes for oldest-first runtime retention without temporary sort trees', async () => {
        const db = await memoryDatabase();
        try {
            new SqliteModelGatewayCatalogStore({ db: adaptBetterSqliteDatabase(db) });
            const probePlan = db
                .prepare(
                    `EXPLAIN QUERY PLAN
                     SELECT history.result_key
                     FROM copilot_model_gateway_runtime_probe_results AS history
                     LEFT JOIN copilot_model_gateway_runtime_probe_latest AS latest
                       ON latest.result_key = history.result_key
                     WHERE latest.result_key IS NULL
                     ORDER BY history.observed_at_ms ASC, history.result_key ASC
                     LIMIT 1000`,
                )
                .all()
                .map((row) => String(row.detail ?? ''));
            const healthPlan = db
                .prepare(
                    `EXPLAIN QUERY PLAN
                     SELECT history.observation_key
                     FROM copilot_model_gateway_health_observations AS history
                     LEFT JOIN copilot_model_gateway_runtime_health_latest AS latest
                       ON latest.observation_key = history.observation_key
                     WHERE latest.observation_key IS NULL
                     ORDER BY history.observed_at_ms ASC, history.observation_key ASC
                     LIMIT 1000`,
                )
                .all()
                .map((row) => String(row.detail ?? ''));

            expect(probePlan.some((detail) => detail.includes('idx_mg_runtime_probe_results_retention'))).toBe(true);
            expect(healthPlan.some((detail) => detail.includes('idx_mg_health_observations_retention'))).toBe(true);
            expect(probePlan.some((detail) => detail.includes('TEMP B-TREE'))).toBe(false);
            expect(healthPlan.some((detail) => detail.includes('TEMP B-TREE'))).toBe(false);
        } finally {
            db.close();
        }
    });

    it('backfills schema v14 latest pointers from a v13 runtime-history database', async () => {
        const db = await memoryDatabase();
        try {
            db.exec(MODEL_GATEWAY_SQLITE_SCHEMA_SQL);
            db.pragma('foreign_keys = ON');
            db.prepare(
                `INSERT INTO copilot_model_gateway_health_observations
                    (observation_key, provider_id, provider_model, route_profile, health_scope, status,
                     classified_failure, observed_at_ms, expires_at_ms, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run('old-health', 'openrouter', 'model-a', 'default', 'runtime', 'failed', null, 1_000, null, '{}');
            db.prepare(
                `INSERT INTO copilot_model_gateway_health_observations
                    (observation_key, provider_id, provider_model, route_profile, health_scope, status,
                     classified_failure, observed_at_ms, expires_at_ms, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run('new-health', 'openrouter', 'model-a', 'default', 'runtime', 'ok', null, 2_000, null, '{}');
            db.prepare(
                `INSERT INTO copilot_model_gateway_runtime_probe_results
                    (result_key, run_id, provider_id, provider_model, route_profile, probe_kind, wire_api,
                     ok, status, observed_at_ms, expires_at_ms, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run('old-probe', null, 'openrouter', 'model-a', 'default', 'chat', null, 0, 'failed', 1_000, null, '{}');
            db.prepare(
                `INSERT INTO copilot_model_gateway_runtime_probe_results
                    (result_key, run_id, provider_id, provider_model, route_profile, probe_kind, wire_api,
                     ok, status, observed_at_ms, expires_at_ms, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run('new-probe', null, 'openrouter', 'model-a', 'default', 'chat', null, 1, 'ok', 2_000, null, '{}');
            db.prepare('DELETE FROM copilot_model_gateway_runtime_health_latest').run();
            db.prepare('DELETE FROM copilot_model_gateway_runtime_probe_latest').run();
            db.pragma('user_version = 13');

            const store = new SqliteModelGatewayCatalogStore({ db: adaptBetterSqliteDatabase(db) });
            const latest = await store.listLatestRuntimeHealthRecords();

            expect(db.pragma('user_version', { simple: true })).toBe(MODEL_GATEWAY_SQLITE_SCHEMA_VERSION);
            expect(rowCount(db, 'copilot_model_gateway_runtime_health_latest')).toBe(1);
            expect(rowCount(db, 'copilot_model_gateway_runtime_probe_latest')).toBe(1);
            expect(latest).toHaveLength(1);
            expect(latest[0]?.['runtimeHealthStatus']).toBe('ok');
            expect(latest[0]?.['probes']?.['chat']?.['ok']).toBe(true);
        } finally {
            db.close();
        }
    });
});
