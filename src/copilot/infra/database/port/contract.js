// @ts-check
/**
 * Canonical structural SQLite port owned by Infra.
 *
 * This contract is deliberately a strict subset of a synchronous SQLite driver. Database mechanics — adapters,
 * connection resources, pragmas and migration execution — live below `infra/database`, while composition roots own
 * application path selection and resource lifetime. Domain consumers depend only on this structural capability.
 *
 * @module copilot/infra/database/port/contract
 */

/**
 * Result fields actually observed by Infra after a mutating statement.
 *
 * @typedef {Readonly<{
 *   changes?: number | bigint;
 *   lastInsertRowid?: number | bigint;
 * }>} SqliteRunResultPort
 */

/**
 * Prepared-statement subset used by Infra. Bind values remain `unknown` intentionally: SQLite adapters accept scalar,
 * buffer and named-object bindings, and individual SQL owners project result rows to their own domain types.
 *
 * @typedef {Readonly<{
 *   get: (...params: unknown[]) => unknown | undefined;
 *   all: (...params: unknown[]) => unknown[];
 *   run: (...params: unknown[]) => SqliteRunResultPort;
 * }>} SqliteStatementPort
 */

/**
 * Synchronous database subset required by Infra. Transactions are optional because isolated test ports may execute the
 * already-atomic operation directly; production adapters are expected to provide them.
 *
 * The transaction callback is intentionally zero-argument. Infra closes over the values to commit, which keeps the
 * structural contract small and avoids exposing a driver's generic transaction wrapper type.
 *
 * @typedef {Readonly<{
 *   exec: (source: string) => unknown;
 *   prepare: (source: string) => SqliteStatementPort;
 *   transaction?: (operation: () => unknown) => () => unknown;
 *   inTransaction?: boolean;
 * }>} SqliteDatabasePort
 */

/** @typedef {() => SqliteDatabasePort} InfraSqliteProvider */
/** @typedef {Readonly<{ configured: boolean; revision: number }>} InfraSqliteProviderStatus */
/**
 * Read-only projection handed to runtime consumers. Configuration/reset authority stays at the composition owner.
 * @typedef {Readonly<{
 *   get: () => SqliteDatabasePort;
 *   status: () => InfraSqliteProviderStatus;
 * }>} InfraSqliteProviderReader
 */
