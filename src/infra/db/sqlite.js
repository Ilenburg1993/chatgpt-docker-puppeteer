// @ts-check - Type checking rigoroso habilitado (arquivo core)
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import CONFIG from '#core/config';
import { log } from '#core/logger';
import { MIGRATIONS } from './migrations.js';

/** @type {import('better-sqlite3').Database|null} */
let singletonDb = null;

function resolveDbPath() {
    const fromEnv = process.env.MAESTRO_DB_PATH || process.env.DB_PATH || null;
    const fromConfig = CONFIG?.all?.DB_PATH || null;
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
        db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all().map(r => Number(r.version))
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
            db.prepare(
                'INSERT INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)'
            ).run(migration.version, migration.name, Date.now());
        });

        tx();
    }
}

function getDb() {
    if (singletonDb) {
        return singletonDb;
    }

    const dbPath = resolveDbPath();
    const dir = path.dirname(dbPath);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
        log('ERROR', `[DB] Failed to create DB directory: ${dir} - ${err?.message || String(err)}`);
        throw err;
    }

    // Open connection (single process connection; multiple processes open the same file).
    const db = new Database(dbPath);
    applyPragmas(db);
    migrate(db);

    singletonDb = db;
    log('INFO', `[DB] SQLite SSOT ready: ${dbPath}`);
    return singletonDb;
}

function closeDb() {
    if (!singletonDb) {
        return;
    }
    try {
        singletonDb.close();
    } catch (err) {
        log('WARN', `[DB] Failed to close SQLite DB: ${err?.message || String(err)}`);
    } finally {
        singletonDb = null;
    }
}

export { getDb, closeDb, resolveDbPath };
