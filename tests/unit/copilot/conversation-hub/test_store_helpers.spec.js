// @ts-check
/**
 * tests/unit/copilot/conversation-hub/test_store_helpers.spec.js
 *
 * F157: Testes para store-helpers.js, store-queries.js e store-memories.js. Usa better-sqlite3 in-memory com migrations
 * copilot.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
    initTurnsFts,
    migrateFts5Tokenizer,
    sanitizeFtsQuery,
} from '../../../../src/copilot/conversation-hub/store-helpers.js';
import { deleteMemory, recallMemories, storeMemory } from '../../../../src/copilot/conversation-hub/store-memories.js';
import { countTurns, getTurn, readTurns, searchTurns } from '../../../../src/copilot/conversation-hub/store-queries.js';
import { COPILOT_MIGRATIONS } from '../../../../src/copilot/db/migrations.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** @param {import('better-sqlite3').Database} db */
function applyCopilotMigrations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at_ms INTEGER NOT NULL
        );
    `);
    for (const m of COPILOT_MIGRATIONS) {
        if (typeof m.up === 'string') db.exec(m.up);
        else if (typeof m.upFn === 'function') m.upFn(db);
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)').run(
            m.version,
            m.name,
            Date.now(),
        );
    }
}

/** @type {import('better-sqlite3').Database} */
let db;

const HUB_SESSION = 'test-hub-session-001';

beforeAll(() => {
    db = new Database(':memory:');
    applyCopilotMigrations(db);
    // Criar sessão de teste
    db.prepare(
        `INSERT INTO copilot_hub_sessions (id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
    ).run(HUB_SESSION, 'Test Session', 'active', Date.now(), Date.now());
});

afterAll(() => {
    db?.close();
});

// ──────────────────────────────────────────────────────────────────────────────
// store-helpers.js
// ──────────────────────────────────────────────────────────────────────────────

describe('sanitizeFtsQuery', () => {
    it('remove metacaracteres FTS5', () => {
        const result = sanitizeFtsQuery('test*query');
        assert.ok(result);
        assert.ok(!result.includes('*'));
    });

    it('remove operadores AND/OR/NOT/NEAR', () => {
        const result = sanitizeFtsQuery('hello AND world OR NOT NEAR test');
        assert.ok(result);
        assert.ok(!result.includes('AND'));
        assert.ok(!result.includes('OR'));
    });

    it('retorna null para query vazia após sanitização', () => {
        assert.strictEqual(sanitizeFtsQuery('***'), null);
        assert.strictEqual(sanitizeFtsQuery(''), null);
    });

    it('envolve resultado em aspas duplas', () => {
        const result = sanitizeFtsQuery('hello world');
        assert.strictEqual(result, '"hello world"');
    });
});

describe('initTurnsFts', () => {
    it('popula FTS a partir de turns existentes quando FTS está vazia', () => {
        // Inserir um turn sem FTS
        db.prepare(
            `INSERT INTO copilot_conversation_turns
             (hub_session_id, role, content, turn_number, created_at, user_read)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(HUB_SESSION, 'user', 'mensagem para FTS init test', 1, Date.now(), 1);

        // Limpar FTS
        db.exec('DELETE FROM copilot_turns_fts');

        initTurnsFts(db);

        const count = /** @type {{ count: number }} */ (
            db.prepare('SELECT COUNT(*) AS count FROM copilot_turns_fts').get()
        );
        assert.ok(count.count > 0, 'FTS deve conter registros após init');
    });

    it('não faz nada quando FTS já está populada', () => {
        // FTS já populada pelo teste anterior
        const before = /** @type {{ count: number }} */ (
            db.prepare('SELECT COUNT(*) AS count FROM copilot_turns_fts').get()
        );
        initTurnsFts(db);
        const after = /** @type {{ count: number }} */ (
            db.prepare('SELECT COUNT(*) AS count FROM copilot_turns_fts').get()
        );
        assert.strictEqual(before.count, after.count);
    });
});

describe('migrateFts5Tokenizer', () => {
    it('não lança quando tokenizer já está correto', () => {
        assert.doesNotThrow(() => migrateFts5Tokenizer(db));
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// store-queries.js
// ──────────────────────────────────────────────────────────────────────────────

describe('store-queries', () => {
    const SESSION = 'queries-session-001';

    beforeAll(() => {
        db.prepare(
            `INSERT INTO copilot_hub_sessions (id, title, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
        ).run(SESSION, 'Queries Session', 'active', Date.now(), Date.now());

        for (let i = 1; i <= 5; i++) {
            db.prepare(
                `INSERT INTO copilot_conversation_turns
                 (hub_session_id, role, content, turn_number, created_at, user_read)
                 VALUES (?, ?, ?, ?, ?, ?)`,
            ).run(SESSION, i % 2 === 0 ? 'llm_b' : 'user', `turn content ${i}`, i, Date.now(), 1);
        }
        // Sync FTS
        db.exec(`
            INSERT INTO copilot_turns_fts(rowid, id, hub_session_id, content)
            SELECT id, id, hub_session_id, content FROM copilot_conversation_turns
            WHERE hub_session_id = '${SESSION}'
        `);
    });

    describe('readTurns', () => {
        it('retorna turns ordenados por turn_number ASC', () => {
            const turns = readTurns(db, SESSION);
            assert.ok(turns.length >= 5);
            for (let i = 1; i < turns.length; i++) {
                const current = turns[i];
                const previous = turns[i - 1];
                assert.ok(current && previous, 'turns devem existir para comparação sequencial');
                assert.ok(current.turn_number >= previous.turn_number);
            }
        });

        it('respeita limit', () => {
            const turns = readTurns(db, SESSION, { limit: 2 });
            assert.strictEqual(turns.length, 2);
        });

        it('filtra por after (id)', () => {
            const all = readTurns(db, SESSION);
            const second = all[1];
            assert.ok(second, 'deve haver pelo menos dois turns para testar after');
            const afterId = second.id;
            const filtered = readTurns(db, SESSION, { after: afterId });
            for (const t of filtered) {
                assert.ok(t.id > afterId);
            }
        });

        it('retorna array vazio para sessão inexistente', () => {
            const turns = readTurns(db, 'inexistente');
            assert.strictEqual(turns.length, 0);
        });
    });

    describe('searchTurns', () => {
        it('encontra turns por conteúdo FTS', () => {
            const results = searchTurns(db, { query: 'turn content' });
            assert.ok(results.length > 0);
        });

        it('filtra por hubSessionId', () => {
            const results = searchTurns(db, { query: 'turn content', hubSessionId: SESSION });
            for (const r of results) {
                assert.strictEqual(r.hub_session_id, SESSION);
            }
        });

        it('retorna vazio para query sem matches', () => {
            const results = searchTurns(db, { query: 'xyznonexistent99' });
            assert.strictEqual(results.length, 0);
        });

        it('retorna vazio para query que sanitiza para null', () => {
            const results = searchTurns(db, { query: '***' });
            assert.strictEqual(results.length, 0);
        });
    });

    describe('getTurn', () => {
        it('retorna turn por id', () => {
            const all = readTurns(db, SESSION);
            const first = all[0];
            assert.ok(first, 'deve haver ao menos um turn');
            const turn = getTurn(db, first.id);
            assert.ok(turn);
            assert.strictEqual(turn.hub_session_id, SESSION);
        });

        it('retorna null para id inexistente', () => {
            assert.strictEqual(getTurn(db, 999999), null);
        });
    });

    describe('countTurns', () => {
        it('conta turns da sessão', () => {
            const count = countTurns(db, SESSION);
            assert.ok(count >= 5);
        });

        it('retorna 0 para sessão sem turns', () => {
            assert.strictEqual(countTurns(db, 'no-turns-session'), 0);
        });
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// store-memories.js
// ──────────────────────────────────────────────────────────────────────────────

describe('store-memories', () => {
    it('storeMemory persiste e retorna id', () => {
        const id = storeMemory(db, { content: 'Memória de teste', tag: 'unit-test' });
        assert.ok(typeof id === 'string');
        assert.ok(id.length > 0);
    });

    it('recallMemories retorna memórias por tag', () => {
        storeMemory(db, { content: 'Memória tagged', tag: 'recall-test' });
        const memories = recallMemories(db, { tag: 'recall-test' });
        assert.ok(memories.length >= 1);
        const first = memories[0];
        assert.ok(first, 'deve haver ao menos uma memória');
        assert.strictEqual(first.tag, 'recall-test');
    });

    it('recallMemories retorna todas quando sem filtro', () => {
        const memories = recallMemories(db);
        assert.ok(memories.length >= 1);
    });

    it('recallMemories filtra por hubSessionId', () => {
        storeMemory(db, { content: 'Session memory', tag: 'session-test', hubSessionId: HUB_SESSION });
        const memories = recallMemories(db, { hubSessionId: HUB_SESSION });
        for (const m of memories) {
            assert.strictEqual(m.hub_session_id, HUB_SESSION);
        }
    });

    it('recallMemories busca por FTS (search)', () => {
        storeMemory(db, { content: 'Unicorn rainbow sparkles', tag: 'fts-test' });
        const memories = recallMemories(db, { search: 'unicorn rainbow' });
        assert.ok(memories.length >= 1);
    });

    it('deleteMemory remove memória existente', () => {
        const id = storeMemory(db, { content: 'Para deletar', tag: 'delete-test' });
        assert.ok(deleteMemory(db, id));
        const after = recallMemories(db, { tag: 'delete-test' });
        const found = after.find((m) => m.id === id);
        assert.ok(!found);
    });

    it('deleteMemory retorna false para id inexistente', () => {
        assert.strictEqual(deleteMemory(db, 'non-existent-id'), false);
    });

    it('recallMemories com search e tag combinados', () => {
        storeMemory(db, { content: 'Special content for combo test', tag: 'combo-tag' });
        const results = recallMemories(db, { search: 'special content', tag: 'combo-tag' });
        assert.ok(results.length >= 1);
        const first = results[0];
        assert.ok(first, 'deve haver pelo menos um resultado');
        assert.strictEqual(first.tag, 'combo-tag');
    });
});
