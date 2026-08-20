// @ts-check
/**
 * tests/unit/copilot/conversation-hub/test_hub.spec.js
 *
 * F165: Testes para hub.js — ConversationHub singleton facade. Testa init() (standalone, sem Socket.io), lifecycle,
 * facade methods, isReady, stop, close.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { ConversationHub } from '../../../../src/copilot/conversation-hub/hub.js';
import { ConversationStore } from '../../../../src/copilot/conversation-hub/store.js';
import { COPILOT_MIGRATIONS } from '../../../../src/copilot/db/migrations.js';

/** @param {import('better-sqlite3').Database} db */
function applyCopilotMigrations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at_ms INTEGER NOT NULL
        );
    `);
    for (const migration of COPILOT_MIGRATIONS) {
        if (typeof migration.up === 'string') db.exec(migration.up);
        else if (typeof migration.upFn === 'function') migration.upFn(db);
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)').run(
            migration.version,
            migration.name,
            Date.now(),
        );
    }
}

// ─── Helper ──────────────────────────────────────────────────────────────

/** Helper para criar instância não-singleton com init() standalone */
async function createHub() {
    const db = new Database(':memory:');
    applyCopilotMigrations(db);
    const store = new ConversationStore();
    store.init(db);
    const hub = new ConversationHub(store);
    await hub.init();
    /** @type {ConversationHub & { __testDb?: import('better-sqlite3').Database }} */
    const testHub = hub;
    testHub.__testDb = db;
    return hub;
}

/**
 * @param {ConversationHub} hub
 */
function cleanupHub(hub) {
    hub.stop();
    hub.store.close();
    /** @type {ConversationHub & { __testDb?: import('better-sqlite3').Database }} */
    const testHub = hub;
    testHub.__testDb?.close();
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('ConversationHub lifecycle', () => {
    it('init() sem args marca isReady=true', async () => {
        const hub = await createHub();
        assert.strictEqual(hub.isReady, true);
        cleanupHub(hub);
    });

    it('init() é idempotente', async () => {
        const hub = await createHub();
        await hub.init();
        assert.strictEqual(hub.isReady, true);
        cleanupHub(hub);
    });

    it('orchestrator getter lança antes de init', () => {
        const hub = new ConversationHub();
        assert.throws(() => hub.orchestrator, /Não inicializado/);
    });

    it('stop reseta isReady para false', async () => {
        const hub = await createHub();
        assert.strictEqual(hub.isReady, true);
        cleanupHub(hub);
        assert.strictEqual(hub.isReady, false);
    });

    it('close é no-op se não inicializado', async () => {
        const hub = new ConversationHub();
        await hub.close(); // deve não lançar
        assert.strictEqual(hub.isReady, false);
    });

    it('close fecha sessões ativas e para o hub', async () => {
        const hub = await createHub();
        // Criar uma sessão ativa
        const sessionId = hub.createSession({ title: 'close-test' });
        assert.ok(sessionId);

        await hub.close();
        assert.strictEqual(hub.isReady, false);
        hub.store.close();
        /** @type {ConversationHub & { __testDb?: import('better-sqlite3').Database }} */
        const testHub = hub;
        testHub.__testDb?.close();
    });
});

describe('ConversationHub facade methods (standalone)', () => {
    /** @type {ConversationHub} */
    let hub;

    beforeEach(async () => {
        hub = await createHub();
    });

    afterEach(() => {
        cleanupHub(hub);
    });

    it('createSession retorna hubSessionId', () => {
        const id = hub.createSession({ title: 'facade-test' });
        assert.ok(typeof id === 'string');
        assert.ok(id.length > 0);
    });

    it('pollUserMessages retorna array vazio por default', () => {
        const id = hub.createSession({ title: 'poll-test' });
        const msgs = hub.pollUserMessages(id);
        assert.ok(Array.isArray(msgs));
        assert.strictEqual(msgs.length, 0);
    });

    it('store getter retorna ConversationStore', () => {
        assert.ok(hub.store);
        assert.ok(typeof hub.store.getHubSession === 'function');
    });
});
