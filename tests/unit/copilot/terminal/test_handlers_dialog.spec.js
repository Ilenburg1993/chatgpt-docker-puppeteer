// @ts-check
/**
 * tests/unit/copilot/terminal/test_handlers_dialog.spec.js
 *
 * Testes para handlers/dialog.js — endpoints de sessions, turns, memory, hub-health.
 * Usa in-memory SQLite para testar integração real com ConversationStore.
 */

import { createRequire } from 'node:module';
import { ConversationStore } from '../../../../src/copilot/conversation-hub/store.js';
import { COPILOT_MIGRATIONS } from '../../../../src/copilot/db/migrations.js';

const require = createRequire(import.meta.url);

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
        else if (typeof m.upFn === 'function') m.upFn(db);
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

// Mock conversationStore using vi.fn-based passthroughs
vi.mock('#copilot/conversation-hub/store', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
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

vi.mock('#copilot/conversation-hub/hub', () => ({
    conversationHub: hubRef,
}));

// Import handlers DEPOIS dos mocks
const {
    handleListSessions,
    handleListTurns,
    handleStoreMemory,
    handleRecallMemories,
    handleDeleteMemory,
    handleHubHealth,
} = await import('../../../../src/copilot/terminal/handlers/dialog.js');

describe('handlers/dialog — sessions', () => {
    beforeEach(() => {
        const Database = require('better-sqlite3');
        testDb = new Database(':memory:');
        applyCopilotMigrations(testDb);
        store = new ConversationStore();
        store.init(testDb);
        _storeRef.current = store;
    });

    afterEach(() => {
        testDb?.close();
    });

    it('handleListSessions retorna lista vazia inicialmente', () => {
        const result = handleListSessions();
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(Array.isArray(result.body.sessions)).toBe(true);
    });

    it('handleListSessions retorna sessions criadas', () => {
        store.createHubSession({ title: 'test-session' });
        const result = handleListSessions({ limit: 10, offset: 0 });
        expect(result.body.sessions.length).toBeGreaterThanOrEqual(1);
    });

    it('handleListSessions rejeita status inválido', () => {
        const result = handleListSessions({ status: 'invalid' });
        expect(result.status).toBe(400);
        expect(result.body.ok).toBe(false);
    });
});

describe('handlers/dialog — turns', () => {
    beforeEach(() => {
        const Database = require('better-sqlite3');
        testDb = new Database(':memory:');
        applyCopilotMigrations(testDb);
        store = new ConversationStore();
        store.init(testDb);
        _storeRef.current = store;
    });

    afterEach(() => {
        testDb?.close();
    });

    it('handleListTurns retorna lista vazia para session inexistente', () => {
        const result = handleListTurns({ sessionId: 'non-existent' });
        expect(result.status).toBe(200);
        expect(result.body.turns).toEqual([]);
        expect(result.body.totalCount).toBe(0);
    });

    it('handleListTurns retorna turns de session real', async () => {
        const sessionId = store.createHubSession({ title: 'test-session' });
        await store.writeTurn(sessionId, {
            role: 'user',
            content: 'hello',
        });
        const result = handleListTurns({ sessionId });
        expect(result.body.turns.length).toBe(1);
        expect(result.body.totalCount).toBe(1);
    });
});

describe('handlers/dialog — memory', () => {
    beforeEach(() => {
        const Database = require('better-sqlite3');
        testDb = new Database(':memory:');
        applyCopilotMigrations(testDb);
        store = new ConversationStore();
        store.init(testDb);
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
        expect(storeResult.status).toBe(201);
        expect(storeResult.body.ok).toBe(true);

        const recallResult = handleRecallMemories({ tag: 'unit-test' });
        expect(recallResult.status).toBe(200);
        expect(recallResult.body.memories.length).toBeGreaterThanOrEqual(1);
    });

    it('handleDeleteMemory remove memória existente', () => {
        const storeResult = handleStoreMemory({ content: 'to delete' });
        const memoryId = storeResult.body.id;

        const deleteResult = handleDeleteMemory({ memoryId });
        expect(deleteResult.status).toBe(200);
        expect(deleteResult.body.ok).toBe(true);
    });

    it('handleDeleteMemory retorna 404 para id inexistente', () => {
        const result = handleDeleteMemory({ memoryId: 'fake-id' });
        expect(result.status).toBe(404);
        expect(result.body.ok).toBe(false);
    });
});

describe('handlers/dialog — hub-health', () => {
    beforeEach(() => {
        const Database = require('better-sqlite3');
        testDb = new Database(':memory:');
        applyCopilotMigrations(testDb);
        store = new ConversationStore();
        store.init(testDb);
        _storeRef.current = store;
    });

    afterEach(() => {
        testDb?.close();
    });

    it('handleHubHealth retorna ok com contadores', () => {
        const result = handleHubHealth();
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(result.body.dbResponsive).toBe(true);
        expect(typeof result.body.activeSessions).toBe('number');
        expect(typeof result.body.totalSessions).toBe('number');
    });
});
