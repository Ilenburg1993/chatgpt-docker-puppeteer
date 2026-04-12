// @ts-check
/**
 * tests/unit/copilot/conversation-hub/test_store_sync.spec.js
 *
 * F158: Testes para store-sync.js (sincronização SDK → ConversationStore). Usa better-sqlite3 in-memory com migrations
 * copilot.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it, before, after } from 'node:test';

import { syncFromSdkHistory } from '../../../../src/copilot/conversation-hub/store-sync.js';
import { COPILOT_MIGRATIONS } from '../../../../src/copilot/db/migrations.js';

const require = createRequire(import.meta.url);

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

const HUB_SESSION = 'sync-test-session';
const SDK_SESSION = 'sdk-session-001';

before(() => {
    const Database = require('better-sqlite3');
    db = new Database(':memory:');
    applyCopilotMigrations(db);
    db.prepare(
        `INSERT INTO copilot_hub_sessions (id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
    ).run(HUB_SESSION, 'Sync Test', 'active', Date.now(), Date.now());
});

after(() => {
    db?.close();
});

describe('syncFromSdkHistory', () => {
    it('sincroniza mensagens do SDK para turns', () => {
        const messages = [
            { id: 'msg-1', type: 'user', content: 'Olá LLM-B' },
            { id: 'msg-2', type: 'assistant', content: 'Olá! Como posso ajudar?' },
        ];
        const result = syncFromSdkHistory(db, HUB_SESSION, SDK_SESSION, messages);
        assert.strictEqual(result.synced, 2);
        assert.strictEqual(result.skipped, 0);
    });

    it('mapeia type=assistant para role=llm_b', () => {
        const row = /** @type {{ role: string } | undefined} */ (
            db
                .prepare(
                    `SELECT role FROM copilot_conversation_turns
                 WHERE hub_session_id = ? AND sdk_turn_id = ?`,
                )
                .get(HUB_SESSION, 'msg-2')
        );
        assert.ok(row);
        assert.strictEqual(row.role, 'llm_b');
    });

    it('mapeia type=user para role=user', () => {
        const row = /** @type {{ role: string } | undefined} */ (
            db
                .prepare(
                    `SELECT role FROM copilot_conversation_turns
                 WHERE hub_session_id = ? AND sdk_turn_id = ?`,
                )
                .get(HUB_SESSION, 'msg-1')
        );
        assert.ok(row);
        assert.strictEqual(row.role, 'user');
    });

    it('ignora mensagens duplicadas (idempotência)', () => {
        const messages = [
            { id: 'msg-1', type: 'user', content: 'Olá LLM-B' },
            { id: 'msg-3', type: 'user', content: 'Nova mensagem' },
        ];
        const result = syncFromSdkHistory(db, HUB_SESSION, SDK_SESSION, messages);
        assert.strictEqual(result.skipped, 1, 'msg-1 já existe, deve ser skipada');
        assert.strictEqual(result.synced, 1, 'msg-3 é nova');
    });

    it('atribui turn_number sequencial', () => {
        const rows = /** @type {{ turn_number: number }[]} */ (
            db
                .prepare(
                    `SELECT turn_number FROM copilot_conversation_turns
                 WHERE hub_session_id = ? ORDER BY turn_number ASC`,
                )
                .all(HUB_SESSION)
        );
        for (let i = 0; i < rows.length; i++) {
            assert.strictEqual(rows[i].turn_number, i + 1);
        }
    });

    it('marca mensagens sincronizadas como user_read=1', () => {
        const rows = /** @type {{ user_read: number }[]} */ (
            db
                .prepare(
                    `SELECT user_read FROM copilot_conversation_turns
                 WHERE hub_session_id = ?`,
                )
                .all(HUB_SESSION)
        );
        for (const row of rows) {
            assert.strictEqual(row.user_read, 1);
        }
    });

    it('lida com mensagens sem id (sem dedup)', () => {
        const messages = [
            { type: 'user', content: 'Sem ID 1' },
            { type: 'user', content: 'Sem ID 2' },
        ];
        const result = syncFromSdkHistory(db, HUB_SESSION, SDK_SESSION, messages);
        assert.strictEqual(result.synced, 2);
        assert.strictEqual(result.skipped, 0);
    });
});
