// @ts-check
/** Canonical connection policy shared by concrete SQLite runtimes. @module copilot/infra/database/sqlite/pragmas */

export const COPILOT_SQLITE_PRAGMAS = Object.freeze([
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = NORMAL',
    'PRAGMA foreign_keys = ON',
    'PRAGMA busy_timeout = 5000',
    'PRAGMA wal_autocheckpoint = 1000',
    'PRAGMA cache_size = -16000',
    'PRAGMA temp_store = MEMORY',
]);

/**
 * Apply the canonical connection policy through the structural SQL surface. Using SQL rather than a driver-specific
 * `pragma()` helper keeps better-sqlite3 and Node's DatabaseSync semantically identical.
 *
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} database
 */
export function applyCopilotSqlitePragmas(database) {
    for (const statement of COPILOT_SQLITE_PRAGMAS) database.exec(statement);
}
