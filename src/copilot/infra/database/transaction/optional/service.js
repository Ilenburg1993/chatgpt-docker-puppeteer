// @ts-check
/** Optional-transaction SQLite policy. @module copilot/infra/database/transaction/optional/service */
/** @typedef {import('../../port/index.js').SqliteDatabasePort} SqliteDatabasePort */

/**
 * Execute an operation transactionally when the supplied adapter supports transactions, otherwise execute directly.
 * This is appropriate only for owners whose pre-existing contract explicitly permits a non-transactional test port.
 *
 * @template TResult
 * @param {SqliteDatabasePort} database
 * @param {() => TResult} operation
 * @returns {TResult}
 */
export function runSqliteTransactionOrDirect(database, operation) {
    if (typeof database.transaction !== 'function') return operation();
    const transaction = database.transaction(operation);
    return /** @type {() => TResult} */ (transaction)();
}
