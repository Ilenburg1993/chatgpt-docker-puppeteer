// @ts-check
/**
 * Driver-agnostic SQLite operation boundary for runtime domains.
 *
 * This entrypoint cannot construct/open a database. Callers must already possess a database capability supplied by
 * application composition or an explicitly injected test resource.
 *
 * @module copilot/infra/public/database/sqlite
 */
/** @typedef {import('../../../database/port/index.js').SqliteDatabasePort} SqliteDatabasePort */
/** @typedef {import('../../../database/port/index.js').SqliteStatementPort} SqliteStatementPort */
/** @typedef {import('../../../database/port/index.js').SqliteRunResultPort} SqliteRunResultPort */
/** @typedef {import('../../../database/port/index.js').InfraSqliteProvider} InfraSqliteProvider */
export { runSqliteTransaction } from '../../../database/transaction/atomic/index.js';
