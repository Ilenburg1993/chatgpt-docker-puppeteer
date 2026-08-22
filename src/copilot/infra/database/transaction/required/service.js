// @ts-check
/** Required-transaction SQLite policy. @module copilot/infra/database/transaction/required/service */
/** @typedef {import('../../port/index.js').SqliteDatabasePort} SqliteDatabasePort */

/**
 * Execute a transaction that is semantically required for consistency. Missing transaction support is a capability
 * failure, never a signal to weaken the operation silently.
 *
 * @template TResult
 * @param {SqliteDatabasePort} database
 * @param {() => TResult} operation
 * @returns {TResult}
 */
export function runRequiredSqliteTransaction(database, operation) {
    if (typeof database.transaction !== 'function') {
        const error = new Error(
            'SQLite adapter does not provide the transaction capability required by this operation.',
        );
        Object.assign(error, { code: 'ERR_INFRA_SQLITE_TRANSACTION_UNAVAILABLE' });
        throw error;
    }
    const transaction = database.transaction(operation);
    return /** @type {() => TResult} */ (transaction)();
}
