// @ts-check
/**
 * Explicit adapter from the default `better-sqlite3` driver to Infra's driver-agnostic structural database port.
 *
 * The concrete package type is intentionally confined to this adapter boundary. The adapter returns the original
 * database object after validating the synchronous methods required by the canonical port, so there is no per-statement
 * wrapper, proxy or hot-path indirection.
 *
 * @module copilot/infra/database/sqlite/better-sqlite3/adapter
 */

/** @typedef {import('#copilot/infra/internal/database/port').SqliteDatabasePort} InfraCompatibleSqliteDatabase */

/**
 * Validate and narrow one concrete connection at the adapter boundary.
 *
 * `better-sqlite3`'s declaration uses a highly generic `prepare()` overload whose static type is intentionally wider
 * than Infra's minimal port. The runtime object satisfies the required subset; this single boundary assertion prevents
 * those driver generics from leaking into every Infra consumer.
 *
 * @param {import('better-sqlite3').Database} database
 * @returns {InfraCompatibleSqliteDatabase}
 */
export function adaptBetterSqliteDatabase(database) {
    if (!database || typeof database !== 'object') throw new TypeError('SQLite adapter requires a database object.');
    if (typeof database.exec !== 'function') throw new TypeError('SQLite adapter requires database.exec().');
    if (typeof database.prepare !== 'function') throw new TypeError('SQLite adapter requires database.prepare().');
    if (typeof database.transaction !== 'function')
        throw new TypeError('SQLite adapter requires database.transaction().');
    return /** @type {InfraCompatibleSqliteDatabase} */ (/** @type {unknown} */ (database));
}

/**
 * Adapt a concrete provider once at composition time while preserving lazy connection materialization.
 *
 * @param {() => import('better-sqlite3').Database} getDatabase
 * @returns {() => InfraCompatibleSqliteDatabase}
 */
export function createBetterSqliteProvider(getDatabase) {
    if (typeof getDatabase !== 'function') throw new TypeError('SQLite adapter requires a provider function.');
    return () => adaptBetterSqliteDatabase(getDatabase());
}
