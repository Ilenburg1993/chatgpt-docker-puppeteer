// @ts-check
/**
 * Instance-owned better-sqlite3 application database resource.
 *
 * This module owns one lazy connection plus canonical pragmas/migrations. It owns no application singleton, path
 * resolution, directory creation, environment access or process shutdown. The composition root decides resource
 * identity/lifetime and binds only the structural database port to consumers.
 *
 * Potentially long WAL checkpoints are delegated to a dedicated worker thread. `better-sqlite3` is synchronous, so a
 * checkpoint on the application thread would otherwise freeze unrelated MCP/Model Gateway work for the full I/O span.
 *
 * @module copilot/infra/database/sqlite/better-sqlite3/runtime
 */

import { applyCopilotSqlitePragmas } from '#copilot/infra/internal/database/sqlite';
import { migrateCopilotSqliteDatabase } from '#copilot/infra/internal/database/sqlite/application';
import { toError } from '#copilot/infra/internal/platform/error';
import Database from 'better-sqlite3';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { adaptBetterSqliteDatabase } from './adapter.js';

/** @typedef {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', msg: string) => void} DbLogFn */
/**
 * @typedef {Readonly<{
 *   attempted:boolean;
 *   mode:'PASSIVE';
 *   busy:number;
 *   walPages:number;
 *   checkpointedPages:number;
 *   durationMs:number;
 *   workerDurationMs:number;
 *   reason?:string;
 * }>} BetterSqliteCheckpointResult
 */

const CHECKPOINT_WORKER_URL = new URL('./checkpoint-worker.js', import.meta.url);
const DEFAULT_CHECKPOINT_TIMEOUT_MS = 120_000;
const DEFAULT_CHECKPOINT_BUSY_TIMEOUT_MS = 5_000;

/** @type {DbLogFn} */
const defaultSqliteLog = (level, msg) => {
    if (level !== 'WARN' && level !== 'ERROR' && level !== 'FATAL') return;
    const fn = level === 'WARN' ? console.warn : console.error;
    fn(`[db][${level}] ${msg}`);
};

/** @param {unknown} value @param {number} fallback @param {number} max */
function boundedPositiveInteger(value, fallback, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(1, Math.min(Math.trunc(numeric), max));
}

/**
 * @typedef {Readonly<{
 *   dbPath:string;
 *   getDatabase:()=>import('better-sqlite3').Database;
 *   getStructuralDatabase:()=>import('#copilot/infra/internal/database/port').SqliteDatabasePort;
 *   checkpoint:(options?:{mode?:'PASSIVE';timeoutMs?:number;busyTimeoutMs?:number})=>Promise<BetterSqliteCheckpointResult>;
 *   close:()=>void;
 *   status:()=>Readonly<{dbPath:string;open:boolean;disposed:boolean;checkpointInFlight:boolean}>;
 *   [Symbol.dispose]:()=>void;
 * }>} BetterSqliteApplicationRuntime
 */

/**
 * Create an isolated concrete connection runtime. The path is already resolved by the composition owner.
 *
 * @param {{dbPath:string;log?:DbLogFn}} options
 * @returns {BetterSqliteApplicationRuntime}
 */
export function createBetterSqliteApplicationRuntime(options) {
    const dbPath = typeof options?.dbPath === 'string' ? options.dbPath.trim() : '';
    if (!dbPath) throw new TypeError('createBetterSqliteApplicationRuntime requires an explicit dbPath.');
    const log = options.log ?? defaultSqliteLog;
    /** @type {import('better-sqlite3').Database | null} */
    let database = null;
    /** @type {import('#copilot/infra/internal/database/port').SqliteDatabasePort | null} */
    let structuralDatabase = null;
    /** @type {Worker | null} */
    let checkpointWorker = null;
    /** @type {Promise<BetterSqliteCheckpointResult> | null} */
    let checkpointInFlight = null;
    let disposed = false;

    function assertActive() {
        if (!disposed) return;
        const error = new Error(`SQLite resource for ${dbPath} has been disposed.`);
        Object.assign(error, { code: 'ERR_INFRA_SQLITE_RESOURCE_DISPOSED' });
        throw error;
    }

    function getDatabase() {
        assertActive();
        if (database?.open) return database;
        const next = new Database(dbPath);
        const structural = adaptBetterSqliteDatabase(next);
        try {
            applyCopilotSqlitePragmas(structural);
            migrateCopilotSqliteDatabase(structural, { log });
        } catch (error) {
            try {
                next.close();
            } catch {
                // Preserve the causal open/migration failure.
            }
            throw error;
        }
        database = next;
        structuralDatabase = structural;
        log('INFO', `[CopilotDB] SQLite copilot ready: ${dbPath}`);
        return next;
    }

    function getStructuralDatabase() {
        getDatabase();
        if (!structuralDatabase) throw new Error('Copilot SQLite structural projection was not materialized.');
        return structuralDatabase;
    }

    /**
     * Run one PASSIVE checkpoint away from the application event loop. Concurrent requests coalesce onto the same worker
     * because parallel checkpoint writers only add I/O pressure without creating useful additional progress.
     *
     * @param {{mode?:'PASSIVE';timeoutMs?:number;busyTimeoutMs?:number}} [checkpointOptions]
     * @returns {Promise<BetterSqliteCheckpointResult>}
     */
    function checkpoint(checkpointOptions = {}) {
        assertActive();
        if (checkpointOptions.mode && checkpointOptions.mode !== 'PASSIVE') {
            throw new TypeError(`Unsupported SQLite checkpoint mode: ${checkpointOptions.mode}`);
        }
        if (dbPath === ':memory:') {
            return Promise.resolve(
                Object.freeze({
                    attempted: false,
                    mode: 'PASSIVE',
                    busy: 0,
                    walPages: 0,
                    checkpointedPages: 0,
                    durationMs: 0,
                    workerDurationMs: 0,
                    reason: 'in_memory_database',
                }),
            );
        }
        if (checkpointInFlight) return checkpointInFlight;
        const timeoutMs = boundedPositiveInteger(checkpointOptions.timeoutMs, DEFAULT_CHECKPOINT_TIMEOUT_MS, 300_000);
        const busyTimeoutMs = boundedPositiveInteger(
            checkpointOptions.busyTimeoutMs,
            DEFAULT_CHECKPOINT_BUSY_TIMEOUT_MS,
            60_000,
        );
        const startedAt = performance.now();
        const operation = new Promise((resolve, reject) => {
            let settled = false;
            const worker = new Worker(CHECKPOINT_WORKER_URL, {
                workerData: { dbPath, busyTimeoutMs },
                name: 'copilot-sqlite-checkpoint',
                execArgv: [],
                env: {},
            });
            checkpointWorker = worker;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                checkpointWorker = null;
                void worker.terminate();
                const error = new Error(`SQLite PASSIVE checkpoint timed out after ${timeoutMs}ms.`);
                Object.assign(error, { code: 'ERR_INFRA_SQLITE_CHECKPOINT_TIMEOUT' });
                reject(error);
            }, timeoutMs);
            timer.unref?.();

            /** @param {unknown} result @param {unknown} [error] */
            const finish = (result, error = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                checkpointWorker = null;
                if (error) return reject(error instanceof Error ? error : new Error(String(error)));
                if (!result || typeof result !== 'object')
                    return reject(new Error('SQLite checkpoint worker returned no result.'));
                const record = /** @type {Record<string, unknown>} */ (result);
                if (record['success'] !== true) {
                    const workerError = new Error(String(record['error'] ?? 'SQLite checkpoint worker failed.'));
                    if (typeof record['code'] === 'string') Object.assign(workerError, { code: record['code'] });
                    return reject(workerError);
                }
                resolve(
                    Object.freeze({
                        attempted: true,
                        mode: 'PASSIVE',
                        busy: Number(record['busy'] ?? 0),
                        walPages: Number(record['walPages'] ?? -1),
                        checkpointedPages: Number(record['checkpointedPages'] ?? -1),
                        durationMs: Number((performance.now() - startedAt).toFixed(3)),
                        workerDurationMs: Number(record['workerDurationMs'] ?? 0),
                    }),
                );
            };
            worker.once('message', (result) => finish(result));
            worker.once('error', (error) => finish(null, error));
            worker.once('exit', (code) => {
                if (!settled && code !== 0)
                    finish(null, new Error(`SQLite checkpoint worker exited with ${String(code)}.`));
            });
        });
        checkpointInFlight = operation.finally(() => {
            checkpointInFlight = null;
        });
        return checkpointInFlight;
    }

    function close() {
        if (disposed) return;
        disposed = true;
        const activeWorker = checkpointWorker;
        checkpointWorker = null;
        if (activeWorker) void activeWorker.terminate();
        const active = database;
        database = null;
        structuralDatabase = null;
        if (!active?.open) return;
        try {
            active.close();
        } catch (error) {
            log('WARN', `[CopilotDB] Failed to close: ${toError(error).message}`);
        }
    }

    return Object.freeze({
        dbPath,
        getDatabase,
        getStructuralDatabase,
        checkpoint,
        close,
        status: () =>
            Object.freeze({
                dbPath,
                open: database?.open === true,
                disposed,
                checkpointInFlight: checkpointInFlight !== null,
            }),
        [Symbol.dispose]: close,
    });
}
