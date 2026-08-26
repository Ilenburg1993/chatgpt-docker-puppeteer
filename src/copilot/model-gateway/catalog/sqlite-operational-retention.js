// @ts-check
/**
 * Bounded operational-retention owner for Model Gateway SQLite ledgers.
 *
 * The catalog store owns domain persistence APIs; this module owns only maintenance planning, chunked mutations,
 * retry/yield policy and checkpoint telemetry. Keeping the maintenance loop separate prevents the general store from
 * becoming the owner of a second, unrelated lifecycle.
 *
 * @module copilot/model-gateway/catalog/sqlite-operational-retention
 */

import { performance } from 'node:perf_hooks';

/** @typedef {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} SqliteDatabasePort */
/** @typedef {SqliteDatabasePort & { transaction: (operation: () => unknown) => () => unknown }} SqliteRetentionDatabase */
/**
 * @typedef {(options?:{mode?:'PASSIVE';timeoutMs?:number;busyTimeoutMs?:number}) => Promise<Readonly<{
 *   attempted:boolean;
 *   mode:'PASSIVE';
 *   busy:number;
 *   walPages:number;
 *   checkpointedPages:number;
 *   durationMs:number;
 *   workerDurationMs?:number;
 *   reason?:string;
 * }>>} SqliteCheckpointPort
 */

export const DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION = Object.freeze({
    accountHistoryMaxRowsPerTable: 10_000,
    accountQuotaSnapshotMaxRows: 20_000,
    accountRateLimitSnapshotMaxRows: 50_000,
    accountSpendingSnapshotMaxRows: 20_000,
    routeDecisionMaxRows: 50_000,
    automationDecisionMaxRows: 50_000,
    automationPolicySnapshotMaxRows: 50_000,
    automationEffectApplicationMaxRows: 50_000,
    recoveryAttemptMaxRows: 50_000,
    sdkSessionHandoffMaxRows: 50_000,
    sdkSessionHandoffTransitionMaxRows: 200_000,
    sdkSessionConfirmationMaxRows: 50_000,
    standbyPlanMaxRows: 50_000,
    liveScenarioRunMaxRows: 50_000,
    refreshLogMaxRows: 200_000,
    runtimeProbeRunMaxRows: 10_000,
    runtimeProbeResultMaxRows: 100_000,
    healthObservationMaxRows: 100_000,
});

/** @param {unknown} value @returns {number | null} */
function optionalInteger(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    const parsed = Number(value);
    return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null;
}

/** @param {unknown} value @param {number} fallback */
function retentionLimit(value, fallback) {
    const limit = optionalInteger(value);
    return limit === null ? fallback : Math.max(0, limit);
}

/** @param {SqliteRetentionDatabase} db @param {string} table */
function retentionTableRowCount(db, table) {
    const row = /** @type {{ count?: number } | undefined} */ (
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
    );
    return optionalInteger(row?.count) ?? 0;
}

/**
 * @param {SqliteRetentionDatabase} db
 * @param {{ table:string; keyColumn:string; orderColumn:string; maxDeleteRows:number }} input
 */
function deleteOldestRowsBatch(db, input) {
    if (input.maxDeleteRows <= 0) return 0;
    const result = db
        .prepare(
            `DELETE FROM ${input.table}
             WHERE ${input.keyColumn} IN (
                 SELECT ${input.keyColumn}
                 FROM ${input.table}
                 ORDER BY ${input.orderColumn} ASC, ${input.keyColumn} ASC
                 LIMIT ?
             )`,
        )
        .run(input.maxDeleteRows);
    return Number(result.changes ?? 0);
}

/**
 * @param {SqliteRetentionDatabase} db
 * @param {{ table:string; parentTable:string; foreignKeyColumn:string; parentKeyColumn:string }} input
 */
function retentionOrphanRowCount(db, input) {
    const row = /** @type {{ count?: number } | undefined} */ (
        db
            .prepare(
                `SELECT COUNT(*) AS count
                 FROM ${input.table} AS child
                 LEFT JOIN ${input.parentTable} AS parent
                   ON parent.${input.parentKeyColumn} = child.${input.foreignKeyColumn}
                 WHERE parent.${input.parentKeyColumn} IS NULL`,
            )
            .get()
    );
    return optionalInteger(row?.count) ?? 0;
}

/**
 * @param {SqliteRetentionDatabase} db
 * @param {{ table:string; keyColumn:string; parentTable:string; foreignKeyColumn:string; parentKeyColumn:string; maxDeleteRows:number }} input
 */
function deleteOrphanRowsBatch(db, input) {
    if (input.maxDeleteRows <= 0) return 0;
    const result = db
        .prepare(
            `DELETE FROM ${input.table}
             WHERE ${input.keyColumn} IN (
                 SELECT child.${input.keyColumn}
                 FROM ${input.table} AS child
                 LEFT JOIN ${input.parentTable} AS parent
                   ON parent.${input.parentKeyColumn} = child.${input.foreignKeyColumn}
                 WHERE parent.${input.parentKeyColumn} IS NULL
                 ORDER BY child.${input.keyColumn} ASC
                 LIMIT ?
             )`,
        )
        .run(input.maxDeleteRows);
    return Number(result.changes ?? 0);
}

/**
 * @param {SqliteRetentionDatabase} db
 * @param {{ table:string; keyColumn:string; orderColumn:string; latestTable:string; latestKeyColumn:string; maxDeleteRows:number }} input
 */
function deleteOldestRuntimeHistoryBatch(db, input) {
    if (input.maxDeleteRows <= 0) return 0;
    const result = db
        .prepare(
            `DELETE FROM ${input.table}
             WHERE ${input.keyColumn} IN (
                 SELECT history.${input.keyColumn}
                 FROM ${input.table} AS history
                 LEFT JOIN ${input.latestTable} AS latest
                   ON latest.${input.latestKeyColumn} = history.${input.keyColumn}
                 WHERE latest.${input.latestKeyColumn} IS NULL
                 ORDER BY history.${input.orderColumn} ASC, history.${input.keyColumn} ASC
                 LIMIT ?
             )`,
        )
        .run(input.maxDeleteRows);
    return Number(result.changes ?? 0);
}

/** @param {unknown} error */
function isSqliteBusyError(error) {
    const code = typeof error === 'object' && error !== null ? String(/** @type {any} */ (error).code ?? '') : '';
    return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
}

/** @param {number[]} values @param {number} quantile */
function retentionQuantile(values, quantile) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
    return Number((sorted[index] ?? 0).toFixed(3));
}

/** @param {number} delayMs */
function waitRetentionRetry(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** @returns {Promise<void>} */
function yieldRetentionLoop() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Apply bounded, latest-preserving operational retention.
 *
 * @param {{
 *   db: SqliteRetentionDatabase;
 *   checkpoint?: SqliteCheckpointPort | null;
 *   policy?: {
 *     accountHistoryMaxRowsPerTable?:number;
 *     accountQuotaSnapshotMaxRows?:number;
 *     accountRateLimitSnapshotMaxRows?:number;
 *     accountSpendingSnapshotMaxRows?:number;
 *     routeDecisionMaxRows?:number;
 *     refreshLogMaxRows?:number;
 *     runtimeProbeRunMaxRows?:number;
 *     runtimeProbeResultMaxRows?:number;
 *     healthObservationMaxRows?:number;
 *     automationDecisionMaxRows?:number;
 *     automationPolicySnapshotMaxRows?:number;
 *     automationEffectApplicationMaxRows?:number;
 *     recoveryAttemptMaxRows?:number;
 *     sdkSessionHandoffMaxRows?:number;
 *     sdkSessionConfirmationMaxRows?:number;
 *     standbyPlanMaxRows?:number;
 *     liveScenarioRunMaxRows?:number;
 *     batchDeleteRows?:number;
 *     checkpointEveryBatches?:number;
 *     busyRetryMax?:number;
 *     busyRetryDelayMs?:number;
 *   };
 * }} input
 */
export async function applyModelGatewayOperationalRetention(input) {
    const db = input.db;
    const checkpoint = input.checkpoint ?? null;
    const policy = input.policy ?? {};
    const accountHistoryMaxRowsPerTable = retentionLimit(
        policy.accountHistoryMaxRowsPerTable,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountHistoryMaxRowsPerTable,
    );
    const accountHistoryFallback =
        policy.accountHistoryMaxRowsPerTable === undefined ? null : accountHistoryMaxRowsPerTable;
    const accountQuotaSnapshotMaxRows = retentionLimit(
        policy.accountQuotaSnapshotMaxRows,
        accountHistoryFallback ?? DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountQuotaSnapshotMaxRows,
    );
    const accountRateLimitSnapshotMaxRows = retentionLimit(
        policy.accountRateLimitSnapshotMaxRows,
        accountHistoryFallback ?? DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountRateLimitSnapshotMaxRows,
    );
    const accountSpendingSnapshotMaxRows = retentionLimit(
        policy.accountSpendingSnapshotMaxRows,
        accountHistoryFallback ?? DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountSpendingSnapshotMaxRows,
    );
    const routeDecisionMaxRows = retentionLimit(
        policy.routeDecisionMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.routeDecisionMaxRows,
    );
    const refreshLogMaxRows = retentionLimit(
        policy.refreshLogMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.refreshLogMaxRows,
    );
    const runtimeProbeRunMaxRows = retentionLimit(
        policy.runtimeProbeRunMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.runtimeProbeRunMaxRows,
    );
    const runtimeProbeResultMaxRows = retentionLimit(
        policy.runtimeProbeResultMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.runtimeProbeResultMaxRows,
    );
    const healthObservationMaxRows = retentionLimit(
        policy.healthObservationMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.healthObservationMaxRows,
    );
    const automationDecisionMaxRows = retentionLimit(
        policy.automationDecisionMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.automationDecisionMaxRows,
    );
    const automationPolicySnapshotMaxRows = retentionLimit(
        policy.automationPolicySnapshotMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.automationPolicySnapshotMaxRows,
    );
    const automationEffectApplicationMaxRows = retentionLimit(
        policy.automationEffectApplicationMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.automationEffectApplicationMaxRows,
    );
    const recoveryAttemptMaxRows = retentionLimit(
        policy.recoveryAttemptMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.recoveryAttemptMaxRows,
    );
    const sdkSessionHandoffMaxRows = retentionLimit(
        policy.sdkSessionHandoffMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.sdkSessionHandoffMaxRows,
    );
    const sdkSessionConfirmationMaxRows = retentionLimit(
        policy.sdkSessionConfirmationMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.sdkSessionConfirmationMaxRows,
    );
    const standbyPlanMaxRows = retentionLimit(
        policy.standbyPlanMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.standbyPlanMaxRows,
    );
    const liveScenarioRunMaxRows = retentionLimit(
        policy.liveScenarioRunMaxRows,
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.liveScenarioRunMaxRows,
    );
    const batchDeleteRows = Math.max(1, Math.min(optionalInteger(policy.batchDeleteRows) ?? 5_000, 50_000));
    const checkpointEveryBatches = Math.max(0, Math.min(optionalInteger(policy.checkpointEveryBatches) ?? 0, 1_000));
    const busyRetryMax = Math.max(0, Math.min(optionalInteger(policy.busyRetryMax) ?? 3, 20));
    const busyRetryDelayMs = Math.max(1, Math.min(optionalInteger(policy.busyRetryDelayMs) ?? 50, 5_000));
    const autoCheckpointRow = /** @type {{ wal_autocheckpoint?: number } | undefined} */ (
        db.prepare('PRAGMA wal_autocheckpoint').get()
    );
    const walAutoCheckpointPagesBefore = optionalInteger(autoCheckpointRow?.wal_autocheckpoint) ?? 1_000;
    const pageSize =
        optionalInteger(
            /** @type {Record<string, unknown> | undefined} */ (db.prepare('PRAGMA page_size').get())?.['page_size'],
        ) ?? 4_096;
    db.exec('PRAGMA wal_autocheckpoint = 0');
    try {
        const maintenanceStartedAt = performance.now();
        /** @type {number[]} */
        const transactionDurationsMs = [];
        /** @type {number[]} */
        const retentionBatchRows = [];
        /** @type {number[]} */
        const checkpointDurationsMs = [];
        let busyRetryCount = 0;
        let mutationBatchCount = 0;
        let checkpointRequestCount = 0;
        let checkpointCompletedCount = 0;
        let checkpointSkippedCount = 0;
        let checkpointFailureCount = 0;
        let periodicCheckpointRequestCount = 0;
        let checkpointBusyCount = 0;
        let totalCheckpointedPages = 0;
        let peakWalPages = 0;
        const freelistPagesBefore =
            optionalInteger(
                /** @type {Record<string, unknown> | undefined} */ (db.prepare('PRAGMA freelist_count').get())?.[
                    'freelist_count'
                ],
            ) ?? 0;
        const pageCountBefore =
            optionalInteger(
                /** @type {Record<string, unknown> | undefined} */ (db.prepare('PRAGMA page_count').get())?.[
                    'page_count'
                ],
            ) ?? 0;

        /** @template T @param {() => T} operation @returns {Promise<T>} */
        const runBoundedTransaction = async (operation) => {
            let retry = 0;
            while (true) {
                const startedAt = performance.now();
                try {
                    const tx = db.transaction(operation);
                    const result = /** @type {T} */ (tx());
                    transactionDurationsMs.push(Number((performance.now() - startedAt).toFixed(3)));
                    return result;
                } catch (error) {
                    transactionDurationsMs.push(Number((performance.now() - startedAt).toFixed(3)));
                    if (!isSqliteBusyError(error) || retry >= busyRetryMax) throw error;
                    retry += 1;
                    busyRetryCount += 1;
                    await waitRetentionRetry(busyRetryDelayMs * retry);
                }
            }
        };

        /** @param {'periodic' | 'final'} kind */
        const runPassiveCheckpoint = async (kind) => {
            checkpointRequestCount += 1;
            if (kind === 'periodic') periodicCheckpointRequestCount += 1;
            const startedAt = performance.now();
            if (!checkpoint) {
                const durationMs = Number((performance.now() - startedAt).toFixed(3));
                checkpointDurationsMs.push(durationMs);
                checkpointSkippedCount += 1;
                return {
                    status: /** @type {const} */ ('skipped'),
                    attempted: false,
                    busy: 0,
                    walPages: 0,
                    walBytes: 0,
                    checkpointedPages: 0,
                    durationMs,
                    workerDurationMs: 0,
                    reason: 'checkpoint_capability_unavailable',
                };
            }
            try {
                const result = await checkpoint({ mode: 'PASSIVE' });
                const durationMs = Number((performance.now() - startedAt).toFixed(3));
                checkpointDurationsMs.push(durationMs);
                const attempted = result.attempted === true;
                const busy = Math.max(0, optionalInteger(result.busy) ?? 0);
                const walPages = optionalInteger(result.walPages) ?? -1;
                const checkpointedPages = optionalInteger(result.checkpointedPages) ?? -1;
                const workerDurationMs = Math.max(0, Number(result.workerDurationMs ?? 0));
                if (!attempted) {
                    checkpointSkippedCount += 1;
                    return {
                        status: /** @type {const} */ ('skipped'),
                        attempted: false,
                        busy,
                        walPages,
                        walBytes: walPages < 0 ? -1 : walPages * pageSize,
                        checkpointedPages,
                        durationMs,
                        workerDurationMs,
                        ...(result.reason ? { reason: result.reason } : {}),
                    };
                }
                checkpointCompletedCount += 1;
                if (busy > 0) checkpointBusyCount += 1;
                totalCheckpointedPages += Math.max(0, checkpointedPages);
                peakWalPages = Math.max(peakWalPages, Math.max(0, walPages));
                return {
                    status: /** @type {const} */ ('completed'),
                    attempted: true,
                    busy,
                    walPages,
                    walBytes: walPages < 0 ? -1 : walPages * pageSize,
                    checkpointedPages,
                    durationMs,
                    workerDurationMs,
                };
            } catch (error) {
                const durationMs = Number((performance.now() - startedAt).toFixed(3));
                checkpointDurationsMs.push(durationMs);
                checkpointFailureCount += 1;
                return {
                    status: /** @type {const} */ ('failed'),
                    attempted: true,
                    busy: 0,
                    walPages: -1,
                    walBytes: -1,
                    checkpointedPages: -1,
                    durationMs,
                    workerDurationMs: 0,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        };

        /** @type {Record<string, { deletedRows:number; maxRows:number; remainingRows?:number; protectedLatestRows?:number; budgetSatisfied?:boolean; batches?:number; batchRows?:{min:number;avg:number;max:number}; orphanDeletedRows?:number; orphanBatches?:number }>} */
        const tables = {};

        /**
         * @param {{ table:string; keyColumn:string; orderColumn:string; maxRows:number; latestTable?:string; latestKeyColumn?:string }} spec
         */
        const applyChunkedRetention = async (spec) => {
            const initialRows = retentionTableRowCount(db, spec.table);
            const initialProtectedLatestRows = spec.latestTable ? retentionTableRowCount(db, spec.latestTable) : null;
            const requestedDeleteRows = Math.max(0, initialRows - spec.maxRows);
            const deletableRows =
                initialProtectedLatestRows === null
                    ? initialRows
                    : Math.max(0, initialRows - initialProtectedLatestRows);
            let pendingDeleteRows = Math.min(requestedDeleteRows, deletableRows);
            let deletedRows = 0;
            /** @type {number[]} */
            const tableBatchRows = [];
            while (pendingDeleteRows > 0) {
                const requestedBatchRows = Math.min(batchDeleteRows, pendingDeleteRows);
                const batchDeletedRows = await runBoundedTransaction(() =>
                    spec.latestTable && spec.latestKeyColumn
                        ? deleteOldestRuntimeHistoryBatch(db, {
                              table: spec.table,
                              keyColumn: spec.keyColumn,
                              orderColumn: spec.orderColumn,
                              latestTable: spec.latestTable,
                              latestKeyColumn: spec.latestKeyColumn,
                              maxDeleteRows: requestedBatchRows,
                          })
                        : deleteOldestRowsBatch(db, {
                              table: spec.table,
                              keyColumn: spec.keyColumn,
                              orderColumn: spec.orderColumn,
                              maxDeleteRows: requestedBatchRows,
                          }),
                );
                if (batchDeletedRows <= 0) break;
                tableBatchRows.push(batchDeletedRows);
                retentionBatchRows.push(batchDeletedRows);
                deletedRows += batchDeletedRows;
                pendingDeleteRows = Math.max(0, pendingDeleteRows - batchDeletedRows);
                mutationBatchCount += 1;
                if (checkpointEveryBatches > 0 && mutationBatchCount % checkpointEveryBatches === 0) {
                    await runPassiveCheckpoint('periodic');
                }
                if (pendingDeleteRows > 0) await yieldRetentionLoop();
            }
            const remainingRows = retentionTableRowCount(db, spec.table);
            const protectedLatestRows = spec.latestTable ? retentionTableRowCount(db, spec.latestTable) : null;
            tables[spec.table] = {
                deletedRows,
                maxRows: spec.maxRows,
                remainingRows,
                ...(protectedLatestRows === null ? {} : { protectedLatestRows }),
                budgetSatisfied: remainingRows <= spec.maxRows,
                batches: tableBatchRows.length,
                batchRows: {
                    min: tableBatchRows.length > 0 ? Math.min(...tableBatchRows) : 0,
                    avg: tableBatchRows.length > 0 ? Number((deletedRows / tableBatchRows.length).toFixed(3)) : 0,
                    max: tableBatchRows.length > 0 ? Math.max(...tableBatchRows) : 0,
                },
            };
        };

        /** @param {{ table:string; keyColumn:string; parentTable:string; foreignKeyColumn:string; parentKeyColumn:string }} spec */
        const applyChunkedOrphanCleanup = async (spec) => {
            let pendingDeleteRows = retentionOrphanRowCount(db, spec);
            let deletedRows = 0;
            let batches = 0;
            while (pendingDeleteRows > 0) {
                const requestedBatchRows = Math.min(batchDeleteRows, pendingDeleteRows);
                const batchDeletedRows = await runBoundedTransaction(() =>
                    deleteOrphanRowsBatch(db, { ...spec, maxDeleteRows: requestedBatchRows }),
                );
                if (batchDeletedRows <= 0) break;
                retentionBatchRows.push(batchDeletedRows);
                deletedRows += batchDeletedRows;
                batches += 1;
                pendingDeleteRows = Math.max(0, pendingDeleteRows - batchDeletedRows);
                mutationBatchCount += 1;
                if (checkpointEveryBatches > 0 && mutationBatchCount % checkpointEveryBatches === 0) {
                    await runPassiveCheckpoint('periodic');
                }
                if (pendingDeleteRows > 0) await yieldRetentionLoop();
            }
            return { deletedRows, batches };
        };

        const standardRetentionTables = [
            [
                'copilot_model_gateway_account_quota_snapshots',
                'snapshot_key',
                'observed_at_ms',
                accountQuotaSnapshotMaxRows,
            ],
            [
                'copilot_model_gateway_account_rate_limit_snapshots',
                'snapshot_key',
                'observed_at_ms',
                accountRateLimitSnapshotMaxRows,
            ],
            [
                'copilot_model_gateway_account_spending_snapshots',
                'snapshot_key',
                'observed_at_ms',
                accountSpendingSnapshotMaxRows,
            ],
            ['copilot_model_gateway_route_decisions', 'decision_id', 'decided_at_ms', routeDecisionMaxRows],
            ['copilot_model_gateway_refresh_log_events', 'event_key', 'observed_at_ms', refreshLogMaxRows],
            ['copilot_model_gateway_automation_decisions', 'decision_id', 'decided_at_ms', automationDecisionMaxRows],
            [
                'copilot_model_gateway_automation_policy_snapshots',
                'policy_snapshot_id',
                'observed_at_ms',
                automationPolicySnapshotMaxRows,
            ],
            [
                'copilot_model_gateway_automation_effect_applications',
                'effect_id',
                'observed_at_ms',
                automationEffectApplicationMaxRows,
            ],
            [
                'copilot_model_gateway_recovery_attempts',
                'recovery_attempt_id',
                'observed_at_ms',
                recoveryAttemptMaxRows,
            ],
            ['copilot_model_gateway_sdk_session_handoffs', 'handoff_id', 'requested_at_ms', sdkSessionHandoffMaxRows],
        ];
        for (const [table, keyColumn, orderColumn, maxRows] of standardRetentionTables) {
            await applyChunkedRetention({
                table: String(table),
                keyColumn: String(keyColumn),
                orderColumn: String(orderColumn),
                maxRows: Number(maxRows),
            });
        }

        const transitionOrphans = await applyChunkedOrphanCleanup({
            table: 'copilot_model_gateway_sdk_session_handoff_transitions',
            keyColumn: 'transition_id',
            parentTable: 'copilot_model_gateway_sdk_session_handoffs',
            foreignKeyColumn: 'handoff_id',
            parentKeyColumn: 'handoff_id',
        });
        await applyChunkedRetention({
            table: 'copilot_model_gateway_sdk_session_handoff_transitions',
            keyColumn: 'transition_id',
            orderColumn: 'occurred_at_ms',
            maxRows: Math.max(1, sdkSessionHandoffMaxRows * 5),
        });
        const transitionRetention = tables['copilot_model_gateway_sdk_session_handoff_transitions'];
        if (transitionRetention) {
            transitionRetention.deletedRows += transitionOrphans.deletedRows;
            transitionRetention.orphanDeletedRows = transitionOrphans.deletedRows;
            transitionRetention.orphanBatches = transitionOrphans.batches;
        }

        const trailingRetentionTables = [
            [
                'copilot_model_gateway_sdk_session_confirmations',
                'confirmation_id',
                'observed_at_ms',
                sdkSessionConfirmationMaxRows,
            ],
            ['copilot_model_gateway_standby_plans', 'standby_plan_id', 'generated_at_ms', standbyPlanMaxRows],
            ['copilot_model_gateway_live_scenario_runs', 'run_id', 'completed_at_ms', liveScenarioRunMaxRows],
        ];
        for (const [table, keyColumn, orderColumn, maxRows] of trailingRetentionTables) {
            await applyChunkedRetention({
                table: String(table),
                keyColumn: String(keyColumn),
                orderColumn: String(orderColumn),
                maxRows: Number(maxRows),
            });
        }

        await applyChunkedRetention({
            table: 'copilot_model_gateway_runtime_probe_results',
            keyColumn: 'result_key',
            orderColumn: 'observed_at_ms',
            latestTable: 'copilot_model_gateway_runtime_probe_latest',
            latestKeyColumn: 'result_key',
            maxRows: runtimeProbeResultMaxRows,
        });
        await applyChunkedRetention({
            table: 'copilot_model_gateway_runtime_probe_runs',
            keyColumn: 'run_id',
            orderColumn: 'completed_at_ms',
            maxRows: runtimeProbeRunMaxRows,
        });
        await applyChunkedRetention({
            table: 'copilot_model_gateway_health_observations',
            keyColumn: 'observation_key',
            orderColumn: 'observed_at_ms',
            latestTable: 'copilot_model_gateway_runtime_health_latest',
            latestKeyColumn: 'observation_key',
            maxRows: healthObservationMaxRows,
        });

        const deletedRows = Object.values(tables).reduce((total, table) => total + table.deletedRows, 0);
        const freelistPagesAfter =
            optionalInteger(
                /** @type {Record<string, unknown> | undefined} */ (db.prepare('PRAGMA freelist_count').get())?.[
                    'freelist_count'
                ],
            ) ?? 0;
        const pageCountAfter =
            optionalInteger(
                /** @type {Record<string, unknown> | undefined} */ (db.prepare('PRAGMA page_count').get())?.[
                    'page_count'
                ],
            ) ?? 0;
        const finalCheckpoint = await runPassiveCheckpoint('final');
        return {
            schema: 'model-gateway-sqlite-operational-retention',
            deletedRows,
            tables,
            maintenance: {
                batchDeleteRows,
                checkpointEveryBatches,
                transactionCount: transactionDurationsMs.length,
                busyRetryCount,
                totalDurationMs: Number((performance.now() - maintenanceStartedAt).toFixed(3)),
                transactionDurationMs: {
                    p50: retentionQuantile(transactionDurationsMs, 0.5),
                    p95: retentionQuantile(transactionDurationsMs, 0.95),
                    max: Number(Math.max(0, ...transactionDurationsMs).toFixed(3)),
                },
                deletedRowsPerBatch: {
                    min: retentionBatchRows.length > 0 ? Math.min(...retentionBatchRows) : 0,
                    p50: retentionQuantile(retentionBatchRows, 0.5),
                    p95: retentionQuantile(retentionBatchRows, 0.95),
                    max: retentionBatchRows.length > 0 ? Math.max(...retentionBatchRows) : 0,
                },
                freelistPagesBefore,
                freelistPagesAfter,
                pageCountBefore,
                pageCountAfter,
                autoCheckpoint: {
                    pagesBefore: walAutoCheckpointPagesBefore,
                    pagesDuringMaintenance: /** @type {const} */ (0),
                    restored: /** @type {const} */ (true),
                },
                checkpoint: {
                    mode: /** @type {const} */ ('PASSIVE'),
                    requestCount: checkpointRequestCount,
                    completedCount: checkpointCompletedCount,
                    skippedCount: checkpointSkippedCount,
                    failureCount: checkpointFailureCount,
                    periodicRequestCount: periodicCheckpointRequestCount,
                    busyCount: checkpointBusyCount,
                    totalCheckpointedPages,
                    peakWalPages,
                    peakWalBytes: peakWalPages * pageSize,
                    totalDurationMs: Number(
                        checkpointDurationsMs.reduce((total, value) => total + value, 0).toFixed(3),
                    ),
                    durationMs: {
                        p50: retentionQuantile(checkpointDurationsMs, 0.5),
                        p95: retentionQuantile(checkpointDurationsMs, 0.95),
                        max: Number(Math.max(0, ...checkpointDurationsMs).toFixed(3)),
                    },
                    final: finalCheckpoint,
                },
            },
        };
    } finally {
        db.exec(`PRAGMA wal_autocheckpoint = ${walAutoCheckpointPagesBefore}`);
    }
}
