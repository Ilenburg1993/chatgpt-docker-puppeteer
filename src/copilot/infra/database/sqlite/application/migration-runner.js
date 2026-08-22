// @ts-check
/**
 * Driver-agnostic application migration runner.
 *
 * Migration ordering/schema bookkeeping belong to the DB layer; transaction mechanics are expressed only through the
 * structural SQLite contract. Concrete runtimes remain responsible for opening/closing their connection.
 *
 * @module copilot/infra/database/sqlite/application/migration-runner
 */

import { ConfigError } from '#copilot/core';
import { runSqliteTransaction } from '#copilot/infra/internal/database/transaction/atomic';
import { COPILOT_MIGRATIONS } from './migrations.js';

/** @typedef {(level:'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL',message:string)=>void} MigrationLogFn */

/**
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} database
 * @param {{log?:MigrationLogFn}} [options]
 */
export function migrateCopilotSqliteDatabase(database, options = {}) {
    const log = options.log ?? (() => undefined);
    database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version       INTEGER PRIMARY KEY,
            name          TEXT NOT NULL,
            applied_at_ms INTEGER NOT NULL
        );
    `);

    const applied = new Set(
        /** @type {{version?:unknown}[]} */ (
            database.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all()
        ).map((row) => Number(row.version)),
    );
    const insertMigration = database.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)',
    );

    for (const migration of COPILOT_MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        log('INFO', `[CopilotDB] Applying migration v${migration.version}: ${migration.name}`);
        runSqliteTransaction(database, () => {
            if (typeof migration.upFn === 'function') migration.upFn(database);
            else if (typeof migration.up === 'string') database.exec(migration.up);
            else
                throw new ConfigError(`[CopilotDB] Invalid migration shape for v${migration.version}: missing up/upFn`);
            insertMigration.run(migration.version, migration.name, Date.now());
        });
    }
}
