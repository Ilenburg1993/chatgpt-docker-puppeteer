// @ts-check
/**
 * tests/unit/copilot/terminal/test_handlers_dialog.spec.js
 *
 * Testes para handlers/dialog.js — endpoints de sessions, turns, memory, hub-health. Usa in-memory SQLite para testar
 * integração real com ConversationStore.
 */

import { adaptBetterSqliteDatabase, COPILOT_MIGRATIONS } from '#copilot/infra/public/testing/database/sqlite';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationStore } from '../../../../src/copilot/conversation-hub/store.js';

/**
 * @param {import('better-sqlite3').Database} db
 */
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
        else if (typeof m.upFn === 'function') m.upFn(adaptBetterSqliteDatabase(db));
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)').run(
            m.version,
            m.name,
            Date.now(),
        );
    }
}

/** @type {import('better-sqlite3').Database} */
let testDb;

/** @type {ConversationStore} */
let store;

const { _storeRef, hubRef } = vi.hoisted(() => ({
    /** @type {{ current: any }} */
    _storeRef: { current: null },
    hubRef: { isReady: true },
}));

// Mock the canonical conversation-hub surface used by presentation/conversation.
vi.mock('#copilot/conversation-hub', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        conversationHub: hubRef,
        conversationStore: {
            listHubSessions: vi.fn((...args) => _storeRef.current?.listHubSessions(...args)),
            readTurns: vi.fn((...args) => _storeRef.current?.readTurns(...args)),
            countTurns: vi.fn((...args) => _storeRef.current?.countTurns(...args)),
            storeMemory: vi.fn((...args) => _storeRef.current?.storeMemory(...args)),
            recallMemories: vi.fn((...args) => _storeRef.current?.recallMemories(...args)),
            deleteMemory: vi.fn((...args) => _storeRef.current?.deleteMemory(...args)),
            countHubSessions: vi.fn((...args) => _storeRef.current?.countHubSessions(...args)),
            createHubSession: vi.fn((...args) => _storeRef.current?.createHubSession(...args)),
            syncTurn: vi.fn((...args) => _storeRef.current?.syncTurn(...args)),
        },
    };
});

// Import handlers DEPOIS dos mocks
const {
    handleListSessions,
    handleListTurns,
    handleStoreMemory,
    handleRecallMemories,
    handleDeleteMemory,
    handleHubHealth,
} = await import('../../../../src/copilot/terminal/handlers/dialog.js');

/** @template T @param {{ body: unknown }} result @returns {T} */
const bodyOf = (result) => /** @type {T} */ (result.body);

describe('handlers/dialog — sessions', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyCopilotMigrations(testDb);
        store = new ConversationStore();
        store.init(adaptBetterSqliteDatabase(testDb));
        _storeRef.current = store;
    });

    afterEach(() => {
        testDb?.close();
    });

    it('handleListSessions retorna lista vazia inicialmente', () => {
        const result = handleListSessions();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.sessions)).toBe(true);
    });

    it('handleListSessions retorna sessions criadas', () => {
        store.createHubSession({ title: 'test-session' });
        const result = handleListSessions({ limit: 10, offset: 0 });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(body.sessions.length).toBeGreaterThanOrEqual(1);
    });

    it('handleListSessions rejeita status inválido', () => {
        const result = handleListSessions({ status: 'invalid' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(400);
        expect(body.ok).toBe(false);
    });
});

describe('handlers/dialog — turns', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyCopilotMigrations(testDb);
        store = new ConversationStore();
        store.init(adaptBetterSqliteDatabase(testDb));
        _storeRef.current = store;
    });

    afterEach(() => {
        testDb?.close();
    });

    it('handleListTurns retorna lista vazia para session inexistente', () => {
        const result = handleListTurns({ sessionId: 'non-existent' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.turns).toEqual([]);
        expect(body.totalCount).toBe(0);
    });

    it('handleListTurns retorna turns de session real', async () => {
        const sessionId = store.createHubSession({ title: 'test-session' });
        await store.writeTurn(sessionId, {
            role: 'user',
            content: 'hello',
        });
        const result = handleListTurns({ sessionId });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(body.turns.length).toBe(1);
        expect(body.totalCount).toBe(1);
    });
});

describe('handlers/dialog — memory', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyCopilotMigrations(testDb);
        store = new ConversationStore();
        store.init(adaptBetterSqliteDatabase(testDb));
        _storeRef.current = store;
    });

    afterEach(() => {
        testDb?.close();
    });

    it('handleStoreMemory rejeita body sem content', () => {
        const result = handleStoreMemory({});
        expect(result.status).toBe(400);
    });

    it('handleStoreMemory cria e handleRecallMemories recupera', () => {
        const storeResult = handleStoreMemory({ content: 'test memory', tag: 'unit-test' });
        const storeBody = bodyOf(/** @type {{ body: any }} */ (storeResult));
        expect(storeResult.status).toBe(201);
        expect(storeBody.ok).toBe(true);

        const recallResult = handleRecallMemories({ tag: 'unit-test' });
        const recallBody = bodyOf(/** @type {{ body: any }} */ (recallResult));
        expect(recallResult.status).toBe(200);
        expect(recallBody.memories.length).toBeGreaterThanOrEqual(1);
    });

    it('handleDeleteMemory remove memória existente', () => {
        const storeResult = handleStoreMemory({ content: 'to delete' });
        const storeBody = bodyOf(/** @type {{ body: any }} */ (storeResult));
        const memoryId = storeBody.id;

        const deleteResult = handleDeleteMemory({ memoryId });
        const deleteBody = bodyOf(/** @type {{ body: any }} */ (deleteResult));
        expect(deleteResult.status).toBe(200);
        expect(deleteBody.ok).toBe(true);
    });

    it('handleDeleteMemory retorna 404 para id inexistente', () => {
        const result = handleDeleteMemory({ memoryId: 'fake-id' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(404);
        expect(body.ok).toBe(false);
    });
});

describe('handlers/dialog — hub-health', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyCopilotMigrations(testDb);
        store = new ConversationStore();
        store.init(adaptBetterSqliteDatabase(testDb));
        _storeRef.current = store;
    });

    afterEach(() => {
        testDb?.close();
    });

    it('handleHubHealth retorna ok com contadores', () => {
        const result = handleHubHealth();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.dbResponsive).toBe(true);
        expect(typeof body.activeSessions).toBe('number');
        expect(typeof body.totalSessions).toBe('number');
    });
});
