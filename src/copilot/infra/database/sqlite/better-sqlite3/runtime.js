// @ts-check
/**
 * Instance-owned better-sqlite3 application database resource.
 *
 * This module owns one lazy connection plus canonical pragmas/migrations. It owns no application singleton, path
 * resolution, directory creation, environment access or process shutdown. The composition root decides resource
 * identity/lifetime and binds only the structural database port to consumers.
 *
 * @module copilot/infra/database/sqlite/better-sqlite3/runtime
 */

import { toError } from '#copilot/core/error-handlers';
import { applyCopilotSqlitePragmas } from '#copilot/infra/internal/database/sqlite';
import { migrateCopilotSqliteDatabase } from '#copilot/infra/internal/database/sqlite/application';
import Database from 'better-sqlite3';
import { adaptBetterSqliteDatabase } from './adapter.js';

/** @typedef {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', msg: string) => void} DbLogFn */

/** @type {DbLogFn} */
const defaultSqliteLog = (level, msg) => {
    if (level !== 'WARN' && level !== 'ERROR' && level !== 'FATAL') return;
    const fn = level === 'WARN' ? console.warn : console.error;
    fn(`[db][${level}] ${msg}`);
};

/**
 * @typedef {Readonly<{
 *   dbPath:string;
 *   getDatabase:()=>import('better-sqlite3').Database;
 *   getStructuralDatabase:()=>import('#copilot/infra/internal/database/port').SqliteDatabasePort;
 *   close:()=>void;
 *   status:()=>Readonly<{dbPath:string;open:boolean;disposed:boolean}>;
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

    function close() {
        if (disposed) return;
        disposed = true;
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
        close,
        status: () => Object.freeze({ dbPath, open: database?.open === true, disposed }),
        [Symbol.dispose]: close,
    });
}
