// @ts-check
import CONFIG from '#core/config';
import { log } from '#core/logger';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations.js';

/** @type {import('better-sqlite3').Database | null} */
let singletonDb = null;

/**
 * Função exportada: resolveDbPath.
 *
 * @returns {string}
 */
function resolveDbPath() {
    const fromEnv = process.env.MAESTRO_DB_PATH || process.env.DB_PATH || null;
    const fromConfig = typeof CONFIG?.all?.DB_PATH === 'string' ? CONFIG.all.DB_PATH : null;
    const raw = fromEnv || fromConfig || path.join(process.cwd(), 'data', 'maestro.sqlite');

    // If a directory is provided, place default filename inside it.
    const looksLikeDir = raw.endsWith(path.sep) || raw.endsWith('/') || raw.endsWith('\\');
    const resolved = looksLikeDir ? path.join(raw, 'maestro.sqlite') : raw;
    return path.resolve(resolved);
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function applyPragmas(db) {
    // Concurrency + perf defaults.
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('wal_autocheckpoint = 1000');
    // F6.10 (UPG-13): otimizações de memória — 32 MB page cache + sorts/índices em RAM
    db.pragma('cache_size = -32000'); // negativo = KiB → 32 MB
    db.pragma('temp_store = MEMORY');
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function migrate(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at_ms INTEGER NOT NULL
        );
    `);

    /** @type {Set<number>} */
    const applied = new Set(
        db
            .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
            .all()
            .map(/** @param {any} r */ (r) => Number(r.version)),
    );

    for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) {
            continue;
        }

        log('INFO', `[DB] Applying migration v${migration.version}: ${migration.name}`);

        const tx = db.transaction(() => {
            if (typeof migration.upFn === 'function') {
                migration.upFn(db);
            } else if (typeof migration.up === 'string') {
                db.exec(migration.up);
            } else {
                throw new Error(`[DB] Invalid migration shape for v${migration.version}: missing up/upFn`);
            }
            db.prepare('INSERT INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)').run(
                migration.version,
                migration.name,
                Date.now(),
            );
        });

        tx();
    }
}

/**
 * Função exportada: getDb.
 *
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
    if (singletonDb) {
        return singletonDb;
    }

    const dbPath = resolveDbPath();
    const dir = path.dirname(dbPath);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (/** @type {any} */ err) {
        log(
            'ERROR',
            `[DB] Failed to create DB directory: ${dir} - ${/** @type {any} */ (err)?.message || String(err)}`,
        );
        throw err;
    }

    // Open connection (single process connection; multiple processes open the same file).
    const db = new Database(dbPath);
    applyPragmas(db);
    migrate(db);

    singletonDb = db;
    registerExitHandler();
    log('INFO', `[DB] SQLite SSOT ready: ${dbPath}`);
    return singletonDb;
}

/**
 * Função exportada: closeDb.
 *
 * @returns {void}
 */
function closeDb() {
    if (!singletonDb) {
        return;
    }
    try {
        singletonDb.close();
    } catch (/** @type {any} */ err) {
        log('WARN', `[DB] Failed to close SQLite DB: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
        singletonDb = null;
    }
}

// Ensure WAL locks are released on process exit to prevent blocking next instance startup
let exitHandlerRegistered = false;
function registerExitHandler() {
    if (exitHandlerRegistered) return;
    exitHandlerRegistered = true;
    process.on('exit', () => {
        if (singletonDb) {
            try {
                singletonDb.close();
            } catch (/** @type {any} */ _) {
                /* process is exiting — best-effort */
            }
            singletonDb = null;
        }
    });
}

export { closeDb, getDb, resolveDbPath };
