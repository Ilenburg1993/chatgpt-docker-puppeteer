// @ts-check
/**
 * tests/unit/copilot/test_copilot_db.spec.js
 *
 * Testes para src/copilot/db/sqlite.js e src/copilot/db/migrations.js
 *
 * Estratégia: análise estrutural do source + testes in-memory do SQLite.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'vitest';

// ─── Source-code analysis helpers ───────────────────────────────────────────────

const SQLITE_SRC = fs.readFileSync(path.resolve('src/copilot/db/sqlite.js'), 'utf8');

const MIGRATIONS_SRC = fs.readFileSync(path.resolve('src/copilot/db/migrations.js'), 'utf8');

// ─── sqlite.js — Structural Tests ──────────────────────────────────────────────

describe('copilot/db/sqlite.js — structural', () => {
    it('deve exportar getCopilotDb, closeCopilotDb, resolveCopilotDbPath', () => {
        assert.ok(
            SQLITE_SRC.includes('export { closeCopilotDb, getCopilotDb, resolveCopilotDbPath }') ||
                (SQLITE_SRC.includes('export') &&
                    SQLITE_SRC.includes('getCopilotDb') &&
                    SQLITE_SRC.includes('closeCopilotDb') &&
                    SQLITE_SRC.includes('resolveCopilotDbPath')),
        );
    });

    it('deve usar WAL journal mode', () => {
        assert.ok(SQLITE_SRC.includes('journal_mode = WAL'));
    });

    it('deve aplicar busy_timeout', () => {
        assert.ok(SQLITE_SRC.includes('busy_timeout'));
    });

    it('deve aplicar foreign_keys = ON', () => {
        assert.ok(SQLITE_SRC.includes('foreign_keys = ON'));
    });

    it('deve aplicar synchronous = NORMAL', () => {
        assert.ok(SQLITE_SRC.includes('synchronous = NORMAL'));
    });

    it('deve ler COPILOT_DB_PATH do ambiente', () => {
        assert.ok(SQLITE_SRC.includes('COPILOT_DB_PATH'));
    });

    it('deve ter fallback para data/copilot.sqlite', () => {
        assert.ok(SQLITE_SRC.includes('copilot.sqlite'));
    });

    it('deve lidar com :memory: sem criar diretório', () => {
        assert.ok(SQLITE_SRC.includes(':memory:'));
    });

    it('deve registrar exit handler para fechar db no exit', () => {
        assert.ok(SQLITE_SRC.includes("process.on('exit'"));
    });

    it('deve ter guard contra exit handler duplicado', () => {
        assert.ok(SQLITE_SRC.includes('exitHandlerRegistered'));
    });

    it('closeCopilotDb deve setar copilotDb = null no finally', () => {
        assert.ok(SQLITE_SRC.includes('copilotDb = null'));
    });
});

// ─── migrations.js — Structural Tests ──────────────────────────────────────────

describe('copilot/db/migrations.js — structural', () => {
    it('deve exportar COPILOT_MIGRATIONS como array', () => {
        assert.ok(
            MIGRATIONS_SRC.includes('export { COPILOT_MIGRATIONS }') ||
                MIGRATIONS_SRC.includes('export const COPILOT_MIGRATIONS'),
        );
    });

    it('deve ter pelo menos 5 migrations', () => {
        // Conta ocorrências de "version:" no source
        const versionMatches = MIGRATIONS_SRC.match(/version:\s*\d+/g) ?? [];
        assert.ok(versionMatches.length >= 5, `Encontradas ${versionMatches.length} migrations, esperado >= 5`);
    });

    it('deve ter versões únicas', () => {
        const versionMatches = MIGRATIONS_SRC.match(/version:\s*(\d+)/g) ?? [];
        const versions = versionMatches.map((m) => Number(m.replace(/version:\s*/, '')));
        const uniqueVersions = new Set(versions);
        assert.equal(versions.length, uniqueVersions.size, 'Versões duplicadas encontradas');
    });

    it('cada migration deve ter um nome', () => {
        const nameMatches = MIGRATIONS_SRC.match(/name:\s*'/g) ?? [];
        const versionMatches = MIGRATIONS_SRC.match(/version:\s*\d+/g) ?? [];
        assert.equal(nameMatches.length, versionMatches.length, 'Toda migration deve ter um name');
    });

    it('migration v1 deve criar copilot_hub_sessions', () => {
        assert.ok(MIGRATIONS_SRC.includes('copilot_hub_sessions'));
    });

    it('migration v2 deve criar copilot_conversation_turns', () => {
        assert.ok(MIGRATIONS_SRC.includes('copilot_conversation_turns'));
    });

    it('migration v3 deve criar FTS5 para turns', () => {
        assert.ok(MIGRATIONS_SRC.includes('copilot_turns_fts'));
        assert.ok(MIGRATIONS_SRC.includes('fts5'));
    });

    it('migration v4 deve criar copilot_memories com FTS', () => {
        assert.ok(MIGRATIONS_SRC.includes('copilot_memories'));
        assert.ok(MIGRATIONS_SRC.includes('copilot_memories_fts'));
    });

    it('migration v5 deve criar copilot_todo_tasks', () => {
        assert.ok(MIGRATIONS_SRC.includes('copilot_todo_tasks'));
    });

    it('migration v6 deve corrigir role llm-b → llm_b', () => {
        assert.ok(MIGRATIONS_SRC.includes("'llm_b'"));
        assert.ok(MIGRATIONS_SRC.includes("'llm-b'"));
    });

    it('FTS5 deve usar tokenizer porter unicode61 com remove_diacritics', () => {
        assert.ok(MIGRATIONS_SRC.includes('porter unicode61 remove_diacritics'));
    });

    it('turns deve ter constraint uq_hub_turn (unique)', () => {
        assert.ok(MIGRATIONS_SRC.includes('uq_hub_turn'));
    });

    it('deve ter triggers para FTS sync (insert, update, delete) em turns', () => {
        assert.ok(MIGRATIONS_SRC.includes('turns_ai'));
        assert.ok(MIGRATIONS_SRC.includes('turns_au'));
        assert.ok(MIGRATIONS_SRC.includes('turns_ad'));
    });

    it('deve ter triggers para FTS sync em memories', () => {
        assert.ok(MIGRATIONS_SRC.includes('memories_ai'));
        assert.ok(MIGRATIONS_SRC.includes('memories_au'));
        assert.ok(MIGRATIONS_SRC.includes('memories_ad'));
    });

    it('todo_tasks deve ser tabela STRICT', () => {
        assert.ok(MIGRATIONS_SRC.includes('STRICT'));
    });

    it('todo_tasks deve usar colunas generated (json_extract)', () => {
        assert.ok(MIGRATIONS_SRC.includes('GENERATED ALWAYS AS'));
        assert.ok(MIGRATIONS_SRC.includes("json_extract(data, '$.status')"));
    });
});

// ─── In-Memory DB Tests ─────────────────────────────────────────────────────────

describe('copilot/db — in-memory integration', () => {
    /** @type {import('better-sqlite3').Database | null} */
    let db = null;

    beforeEach(async () => {
        const { default: Database } = await import('better-sqlite3');
        const { COPILOT_MIGRATIONS } = await import('../../../src/copilot/db/migrations.js');

        db = new Database(':memory:');
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        // Run migrations
        db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                applied_at_ms INTEGER NOT NULL
            );
        `);

        for (const migration of COPILOT_MIGRATIONS) {
            if (typeof migration.upFn === 'function') {
                migration.upFn(db);
            } else if (typeof migration.up === 'string') {
                db.exec(migration.up);
            }
            db.prepare('INSERT INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)').run(
                migration.version,
                migration.name,
                Date.now(),
            );
        }
    });

    afterEach(() => {
        if (db) {
            try {
                db.close();
            } catch {
                /* noop */
            }
            db = null;
        }
    });

    it('deve criar todas as tabelas esperadas', () => {
        assert.ok(db);
        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'copilot_%' ORDER BY name")
            .all()
            .map(/** @param {any} r */ (r) => r.name);

        assert.ok(tables.includes('copilot_hub_sessions'));
        assert.ok(tables.includes('copilot_conversation_turns'));
        assert.ok(tables.includes('copilot_memories'));
        assert.ok(tables.includes('copilot_todo_tasks'));
    });

    it('deve criar tabelas FTS5 virtuais', () => {
        assert.ok(db);
        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'copilot_%fts%'")
            .all()
            .map(/** @param {any} r */ (r) => r.name);

        assert.ok(tables.includes('copilot_turns_fts'));
        assert.ok(tables.includes('copilot_memories_fts'));
    });

    it('deve inserir e consultar hub_session', () => {
        assert.ok(db);
        const now = Date.now();
        db.prepare(
            'INSERT INTO copilot_hub_sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run('test-1', 'Test Session', 'active', now, now);

        const row = /** @type {any} */ (db.prepare('SELECT * FROM copilot_hub_sessions WHERE id = ?').get('test-1'));
        assert.equal(row.id, 'test-1');
        assert.equal(row.title, 'Test Session');
        assert.equal(row.status, 'active');
    });

    it('deve inserir e consultar conversation_turn', () => {
        assert.ok(db);
        const now = Date.now();
        db.prepare(
            'INSERT INTO copilot_hub_sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run('s1', 'Test', 'active', now, now);

        db.prepare(
            'INSERT INTO copilot_conversation_turns (hub_session_id, role, content, turn_number, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run('s1', 'user', 'Hello world', 1, now);

        const row = /** @type {any} */ (
            db.prepare('SELECT * FROM copilot_conversation_turns WHERE hub_session_id = ?').get('s1')
        );
        assert.equal(row.role, 'user');
        assert.equal(row.content, 'Hello world');
        assert.equal(row.turn_number, 1);
    });

    it('FTS5 trigger deve sincronizar conteúdo de turns automaticamente', () => {
        assert.ok(db);
        const now = Date.now();
        db.prepare(
            'INSERT INTO copilot_hub_sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run('s1', 'Test', 'active', now, now);
        db.prepare(
            'INSERT INTO copilot_conversation_turns (hub_session_id, role, content, turn_number, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run('s1', 'assistant', 'Puppeteer automation with browser', 1, now);

        const ftsResults = db
            .prepare("SELECT * FROM copilot_turns_fts WHERE copilot_turns_fts MATCH 'puppeteer'")
            .all();
        assert.ok(ftsResults.length > 0, 'FTS deve encontrar conteúdo inserido via trigger');
    });

    it('deve inserir e consultar memory com FTS', () => {
        assert.ok(db);
        const now = Date.now();
        db.prepare(
            'INSERT INTO copilot_memories (id, tag, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run('mem-1', 'debug', 'Found a race condition in kernel loop', now, now);

        const ftsResults = db
            .prepare("SELECT * FROM copilot_memories_fts WHERE copilot_memories_fts MATCH 'race condition'")
            .all();
        assert.ok(ftsResults.length > 0, 'FTS deve encontrar conteúdo de memória');
    });

    it('todo_tasks deve ter colunas generated (status, priority)', () => {
        assert.ok(db);
        const data = JSON.stringify({
            status: 'pending',
            priority: 'high',
            parentId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        db.prepare('INSERT INTO copilot_todo_tasks (id, data) VALUES (?, ?)').run('t1', data);

        const row = /** @type {any} */ (db.prepare('SELECT * FROM copilot_todo_tasks WHERE id = ?').get('t1'));
        assert.equal(row.id, 't1');
        assert.equal(row.status, 'pending');
        assert.equal(row.priority, 'high');
    });

    it('uq_hub_turn deve impedir turnos duplicados na mesma sessão', () => {
        assert.ok(db);
        const now = Date.now();
        db.prepare(
            'INSERT INTO copilot_hub_sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run('s1', 'Test', 'active', now, now);
        db.prepare(
            'INSERT INTO copilot_conversation_turns (hub_session_id, role, content, turn_number, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run('s1', 'user', 'First', 1, now);

        assert.throws(() => {
            db?.prepare(
                'INSERT INTO copilot_conversation_turns (hub_session_id, role, content, turn_number, created_at) VALUES (?, ?, ?, ?, ?)',
            ).run('s1', 'user', 'Duplicate', 1, now);
        }, /UNIQUE constraint failed/);
    });

    it('CASCADE deve deletar turns ao excluir session', () => {
        assert.ok(db);
        const now = Date.now();
        db.prepare(
            'INSERT INTO copilot_hub_sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run('s1', 'Test', 'active', now, now);
        db.prepare(
            'INSERT INTO copilot_conversation_turns (hub_session_id, role, content, turn_number, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run('s1', 'user', 'Hello', 1, now);

        db.prepare('DELETE FROM copilot_hub_sessions WHERE id = ?').run('s1');
        const count = /** @type {any} */ (
            db.prepare('SELECT count(*) as c FROM copilot_conversation_turns WHERE hub_session_id = ?').get('s1')
        );
        assert.equal(count.c, 0, 'Turns devem ser deletados em cascata');
    });

    it('schema_migrations deve registrar todas as versões aplicadas', () => {
        assert.ok(db);
        const versions = db
            .prepare('SELECT version FROM schema_migrations ORDER BY version')
            .all()
            .map(/** @param {any} r */ (r) => r.version);
        assert.ok(versions.length >= 5);
        assert.ok(versions.includes(1));
        assert.ok(versions.includes(6));
    });
});
