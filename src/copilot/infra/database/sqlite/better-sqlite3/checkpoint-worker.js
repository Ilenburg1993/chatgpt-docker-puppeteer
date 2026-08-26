// @ts-check
/**
 * Dedicated worker-thread entrypoint for SQLite WAL checkpoints.
 *
 * `better-sqlite3` is intentionally synchronous. Running a potentially large checkpoint on the application thread can
 * therefore freeze every unrelated Model Gateway/MCP operation for the full storage-I/O duration. The concrete driver
 * owns this worker because only this layer is allowed to know the physical SQLite path and native driver.
 *
 * @module copilot/infra/database/sqlite/better-sqlite3/checkpoint-worker
 */

import { applyCopilotSqlitePragmas } from '#copilot/infra/internal/database/sqlite';
import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';

import Database from 'better-sqlite3';
import { adaptBetterSqliteDatabase } from './adapter.js';

/** @param {unknown} value @param {number} fallback */
function boundedInteger(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.min(Math.trunc(numeric), 60_000));
}

function runCheckpoint() {
    if (!parentPort) throw new Error('SQLite checkpoint worker requires a parentPort.');
    const input =
        workerData && typeof workerData === 'object' ? /** @type {Record<string, unknown>} */ (workerData) : {};
    const dbPath = typeof input['dbPath'] === 'string' ? input['dbPath'].trim() : '';
    if (!dbPath || dbPath === ':memory:') throw new Error('SQLite checkpoint worker requires a file-backed dbPath.');
    const busyTimeoutMs = boundedInteger(input['busyTimeoutMs'], 5_000);
    const database = new Database(dbPath, { fileMustExist: true });
    try {
        // Checkpoint connections must use the same WAL+synchronous policy as the owning application connection. A fresh
        // SQLite connection otherwise defaults to synchronous=FULL, which materially overstates checkpoint cost and can
        // create avoidable foreground I/O pressure. Autocheckpoint stays disabled here because this worker owns exactly
        // one explicit checkpoint and must never create a second implicit checkpoint path.
        applyCopilotSqlitePragmas(adaptBetterSqliteDatabase(database));
        database.pragma(`busy_timeout = ${busyTimeoutMs}`);
        database.pragma('wal_autocheckpoint = 0');
        const startedAt = performance.now();
        const row = /** @type {{ busy?: number; log?: number; checkpointed?: number } | undefined} */ (
            database.prepare('PRAGMA wal_checkpoint(PASSIVE)').get()
        );
        return {
            success: true,
            busy: Number(row?.busy ?? 0),
            walPages: Number(row?.log ?? -1),
            checkpointedPages: Number(row?.checkpointed ?? -1),
            workerDurationMs: Number((performance.now() - startedAt).toFixed(3)),
        };
    } finally {
        database.close();
    }
}

try {
    parentPort?.postMessage(runCheckpoint());
} catch (error) {
    parentPort?.postMessage({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code:
            error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null,
    });
} finally {
    parentPort?.close();
}
