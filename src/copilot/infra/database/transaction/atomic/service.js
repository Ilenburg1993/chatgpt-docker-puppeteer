// @ts-check
/** Atomic SQLite transaction policy. @module copilot/infra/database/transaction/atomic/service */
/** @typedef {import('../../port/index.js').SqliteDatabasePort} SqliteDatabasePort */

/**
 * Execute one synchronous operation atomically against a structural SQLite database.
 *
 * @template TResult
 * @param {SqliteDatabasePort} database
 * @param {() => TResult} operation
 * @returns {TResult}
 */
export function runSqliteTransaction(database, operation) {
    if (typeof operation !== 'function') throw new TypeError('SQLite transaction requires an operation function.');
    if (database.inTransaction === true) return operation();

    if (typeof database.transaction === 'function') {
        return /** @type {TResult} */ (database.transaction(operation)());
    }

    database.exec('BEGIN IMMEDIATE');
    try {
        const result = operation();
        database.exec('COMMIT');
        return result;
    } catch (error) {
        try {
            database.exec('ROLLBACK');
        } catch {
            // Preserve the causal operation failure. A rollback failure cannot make the original write successful.
        }
        throw error;
    }
}
