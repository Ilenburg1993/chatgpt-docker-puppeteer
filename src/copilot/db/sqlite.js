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
 * L0 (db) — não importa camadas superiores. Logger injetável via `setDbLogger`.
 *
 * @module copilot/db/sqlite
 * @see EventBus
 * @see module:copilot/db/migrations
 * @see module:copilot/conversation-hub/store
 */

import { ConfigError, registerShutdownHandler, toError } from '#copilot/core';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { logSwallowed } from '../core/error-handlers.js';
import { COPILOT_MIGRATIONS } from './migrations.js';

/**
 * @typedef {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', msg: string) => void} DbLogFn
 */

/** @type {DbLogFn} */
let log = (level, msg) => {
    const fn = level === 'WARN' || level === 'ERROR' ? console.warn : console.log;
    fn(`[db][${level}] ${msg}`);
};

/**
 * Injeta logger externo (ex: observability/logger). Chamado no bootstrap.
 *
 * @param {DbLogFn} logFn
 */
export function setDbLogger(logFn) {
    log = logFn;
}

/**
 * Leitura direta de env para evitar import de config (L2) em db (L0).
 *
 * @type {string}
 */
const ENV_DB_PATH = process.env['COPILOT_DB_PATH'] || '';

/** @type {import('better-sqlite3').Database | null} */
let copilotDb = null;

/**
 * @typedef {Object} SqliteExitHandlerState
 * @property {boolean} registered
 * @property {Set<() => void>} handlers
 */

const EXIT_HANDLER_STATE_KEY = Symbol.for('copilot.db.sqlite.exitHandlerState');

/**
 * @returns {SqliteExitHandlerState}
 */
function getExitHandlerState() {
    const existing = /** @type {SqliteExitHandlerState | undefined} */ (
        Reflect.get(globalThis, EXIT_HANDLER_STATE_KEY)
    );
    if (existing) return existing;

    /** @type {SqliteExitHandlerState} */
    const state = {
        registered: false,
        handlers: new Set(),
    };
    Reflect.set(globalThis, EXIT_HANDLER_STATE_KEY, state);
    return state;
}

/**
 * Resolve o caminho do arquivo `copilot.sqlite`.
 *
 * @returns {string}
 */
function resolveCopilotDbPath() {
    const fromEnv = ENV_DB_PATH;
    const raw = fromEnv || path.join(process.cwd(), 'data', 'copilot.sqlite');

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
 * @throws {Error} Se uma migration tiver formato inválido (sem up/upFn)
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
            .map((/** @type {unknown} */ r) => Number(/** @type {{ version: number }} */ (r).version)),
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
                throw new ConfigError(`[CopilotDB] Invalid migration shape for v${migration.version}: missing up/upFn`);
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
 * @throws {Error} Se a criação do diretório ou abertura do SQLite falhar
 */
function getCopilotDb() {
    if (copilotDb) return copilotDb;

    const dbPath = resolveCopilotDbPath();

    // Não tenta criar diretório para :memory:
    if (dbPath !== ':memory:') {
        const dir = path.dirname(dbPath);
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
            log('ERROR', `[CopilotDB] Failed to create directory: ${dir} — ${toError(err).message ?? String(err)}`);
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
    } catch (err) {
        log('WARN', `[CopilotDB] Failed to close: ${toError(err).message ?? String(err)}`);
    } finally {
        copilotDb = null;
    }
}

let exitHandlerRegistered = false;
/**
 * Registra handlers de saída para fechar o banco de dados. DB-P4-01: idempotente via `exitHandlerRegistered` — seguro
 * para chamadas múltiplas (hot-reload, testes).
 */
function registerExitHandler() {
    if (exitHandlerRegistered) return;
    exitHandlerRegistered = true;
    const exitState = getExitHandlerState();

    const handler = () => {
        if (copilotDb) {
            try {
                copilotDb.close();
            } catch (e) {
                logSwallowed(e, 'db.sqlite.close');
            }
            copilotDb = null;
        }
    };
    exitState.handlers.add(handler);

    const runExitHandlers = () => {
        for (const closeHandler of exitState.handlers) {
            closeHandler();
        }
    };

    // DB-P3-01: registrar também SIGTERM/SIGINT para garantir flush do WAL em
    // graceful shutdown PM2 (SIGTERM → 1600ms timeout).
    if (!exitState.registered) {
        process.on('exit', runExitHandlers);
        process.once('SIGTERM', runExitHandlers);
        process.once('SIGINT', runExitHandlers);
        exitState.registered = true;
    }

    // Participar do shutdown gracioso centralizado (prioridade 15: após agent.stop)
    registerShutdownHandler('copilot-db.close', async () => runExitHandlers(), 15);
}

/**
 * F93: Garante que o diretório do banco exista via fs/promises. Chamar no boot (antes de getCopilotDb) para evitar
 * mkdirSync no lazy init.
 *
 * @returns {Promise<void>}
 */
async function ensureCopilotDbDir() {
    const dbPath = resolveCopilotDbPath();
    if (dbPath === ':memory:') return;
    await mkdir(path.dirname(dbPath), { recursive: true });
}

export { closeCopilotDb, ensureCopilotDbDir, getCopilotDb, resolveCopilotDbPath };
