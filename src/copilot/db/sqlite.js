// @ts-check
/**
 * src/copilot/db/sqlite.js
 *
 * Singleton SQLite isolado para o módulo copilot (copilot.sqlite).
 *
 * Mantido separado de `src/infra/db/sqlite.js` (maestro.sqlite) para:
 *
 * 1. Evitar contenção de WAL entre queries copilot e workloads do agente principal.
 * 2. Isolar o schema copilot em seu próprio arquivo de migrations versionadas.
 * 3. Permitir que testes do módulo copilot usem `:memory:` sem interferir nos testes/fixtures do domínio principal.
 *
 * Variável de ambiente: `COPILOT_DB_PATH` sobrescreve o caminho padrão. Padrão: `<cwd>/data/copilot.sqlite`
 *
 * @module copilot/db/sqlite
 */

import CONFIG from '#core/config';
import { log } from '#core/logger';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { COPILOT_MIGRATIONS } from './migrations.js';

/** @type {import('better-sqlite3').Database | null} */
let copilotDb = null;

/**
 * Resolve o caminho do arquivo `copilot.sqlite`.
 *
 * @returns {string}
 */
function resolveCopilotDbPath() {
    const fromEnv = process.env['COPILOT_DB_PATH'] || null;
    const fromConfig = typeof CONFIG?.all?.['COPILOT_DB_PATH'] === 'string' ? CONFIG.all['COPILOT_DB_PATH'] : null;
    const raw = fromEnv || fromConfig || path.join(process.cwd(), 'data', 'copilot.sqlite');

    const looksLikeDir = raw.endsWith(path.sep) || raw.endsWith('/') || raw.endsWith('\\');
    const resolved = looksLikeDir ? path.join(raw, 'copilot.sqlite') : raw;
    return path.resolve(resolved);
}

/**
 * Aplica pragmas de performance e segurança ao copilot.sqlite.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
function applyPragmas(db) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('wal_autocheckpoint = 1000');
    db.pragma('cache_size = -16000'); // 16 MB (menor que maestro — workload mais leve)
    db.pragma('temp_store = MEMORY');
}

/**
 * Executa as migrations do módulo copilot. Usa a mesma tabela `schema_migrations` que o sistema central para
 * consistência (não há colisão pois é um arquivo de BD separado).
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
function migrate(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
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

    for (const migration of COPILOT_MIGRATIONS) {
        if (applied.has(migration.version)) continue;

        log('INFO', `[CopilotDB] Applying migration v${migration.version}: ${migration.name}`);

        const tx = db.transaction(() => {
            if (typeof migration.upFn === 'function') {
                migration.upFn(db);
            } else if (typeof migration.up === 'string') {
                db.exec(migration.up);
            } else {
                throw new Error(`[CopilotDB] Invalid migration shape for v${migration.version}: missing up/upFn`);
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
 * Retorna (ou cria) o singleton copilot.sqlite.
 *
 * Em testes, passe `:memory:` via `COPILOT_DB_PATH=:memory:` ou use {{{getCopilotDb}}} com o override no construtor de
 * `ConversationStore` / `_initTodoDb`.
 *
 * @returns {import('better-sqlite3').Database}
 */
function getCopilotDb() {
    if (copilotDb) return copilotDb;

    const dbPath = resolveCopilotDbPath();

    // Não tenta criar diretório para :memory:
    if (dbPath !== ':memory:') {
        const dir = path.dirname(dbPath);
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (/** @type {any} */ err) {
            log('ERROR', `[CopilotDB] Failed to create directory: ${dir} — ${err?.message ?? String(err)}`);
            throw err;
        }
    }

    const db = new Database(dbPath);
    applyPragmas(db);
    migrate(db);

    copilotDb = db;
    registerExitHandler();
    log('INFO', `[CopilotDB] SQLite copilot ready: ${dbPath}`);
    return copilotDb;
}

/**
 * Fecha o banco copilot.sqlite. Chamado em testes ou shutdown graceful.
 *
 * @returns {void}
 */
function closeCopilotDb() {
    if (!copilotDb) return;
    try {
        copilotDb.close();
    } catch (/** @type {any} */ err) {
        log('WARN', `[CopilotDB] Failed to close: ${err?.message ?? String(err)}`);
    } finally {
        copilotDb = null;
    }
}

let exitHandlerRegistered = false;
function registerExitHandler() {
    if (exitHandlerRegistered) return;
    exitHandlerRegistered = true;
    process.on('exit', () => {
        if (copilotDb) {
            try {
                copilotDb.close();
            } catch {
                /* best-effort */
            }
            copilotDb = null;
        }
    });
}

export { closeCopilotDb, getCopilotDb, resolveCopilotDbPath };
