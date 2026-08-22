// @ts-check
/**
 * Experimental Node 24+ `node:sqlite` adapter for Infra's synchronous structural SQLite port.
 *
 * DatabaseSync has exec/prepare but no better-sqlite3-style transaction helper. This adapter supplies the missing
 * capability with BEGIN IMMEDIATE at the root and SAVEPOINTs for nested adapter-owned transactions. Prepared statements
 * remain native StatementSync objects; there is no per-row or per-statement proxy.
 *
 * This module is experimental and is not used by the application default provider.
 *
 * @module copilot/infra/database/sqlite/node-sqlite/runtime
 */

import { applyCopilotSqlitePragmas } from '#copilot/infra/internal/database/sqlite';
import { migrateCopilotSqliteDatabase } from '#copilot/infra/internal/database/sqlite/application';
import { DatabaseSync, backup } from 'node:sqlite';

/** @typedef {import('#copilot/infra/internal/database/port').SqliteDatabasePort} InfraCompatibleSqliteDatabase */

/** @param {number} value */
function savepointName(value) {
    return `infra_node_sqlite_tx_${value}`;
}

/**
 * @param {DatabaseSync} database
 * @returns {InfraCompatibleSqliteDatabase}
 */
export function adaptNodeSqliteDatabase(database) {
    if (!(database instanceof DatabaseSync)) throw new TypeError('node:sqlite adapter requires DatabaseSync.');
    let transactionDepth = 0;
    let savepointSequence = 0;

    /** @param {() => unknown} operation */
    function transaction(operation) {
        if (typeof operation !== 'function') throw new TypeError('SQLite transaction requires an operation function.');
        return () => {
            const root = transactionDepth === 0;
            const savepoint = root ? null : savepointName(++savepointSequence);
            if (root) database.exec('BEGIN IMMEDIATE');
            else database.exec(`SAVEPOINT ${savepoint}`);
            transactionDepth += 1;
            try {
                const result = operation();
                if (root) database.exec('COMMIT');
                else database.exec(`RELEASE SAVEPOINT ${savepoint}`);
                return result;
            } catch (error) {
                if (root) database.exec('ROLLBACK');
                else {
                    database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
                    database.exec(`RELEASE SAVEPOINT ${savepoint}`);
                }
                throw error;
            } finally {
                transactionDepth -= 1;
            }
        };
    }

    return Object.freeze({
        exec: (source) => database.exec(source),
        prepare: (source) =>
            /** @type {import('#copilot/infra/internal/database/port').SqliteStatementPort} */ (
                /** @type {unknown} */ (database.prepare(source))
            ),
        transaction,
    });
}

/**
 * Create an isolated experimental node:sqlite resource plus its Infra port.
 *
 * @param {{dbPath:string;readOnly?:boolean}} options
 */
export function createNodeSqliteInfraRuntime(options) {
    return createNodeSqliteRuntime(options, false);
}

/**
 * Create a full experimental application database with the same pragmas and migration ledger as the default runtime.
 * This remains opt-in and is not wired into ApplicationInfraHost.
 *
 * @param {{dbPath:string;readOnly?:boolean}} options
 */
export function createNodeSqliteApplicationRuntime(options) {
    return createNodeSqliteRuntime(options, true);
}

/** @param {{dbPath:string;readOnly?:boolean}} options @param {boolean} initializeApplicationSchema */
function createNodeSqliteRuntime(options, initializeApplicationSchema) {
    const dbPath = typeof options?.dbPath === 'string' ? options.dbPath.trim() : '';
    if (!dbPath) throw new TypeError('node:sqlite runtime requires an explicit dbPath.');
    const readOnly = options.readOnly === true;
    const database = new DatabaseSync(dbPath, { readOnly });
    const port = adaptNodeSqliteDatabase(database);
    if (!readOnly) {
        applyCopilotSqlitePragmas(port);
        if (initializeApplicationSchema) migrateCopilotSqliteDatabase(port);
    }
    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        database.close();
    }
    return Object.freeze({
        dbPath,
        database,
        port,
        close,
        /** @param {string} destination */
        backupTo(destination) {
            if (closed) throw new Error('Cannot backup a closed node:sqlite runtime.');
            return backup(database, destination);
        },
        status: () => Object.freeze({ dbPath, open: !closed }),
        [Symbol.dispose]: close,
    });
}
