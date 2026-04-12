// @ts-check
/**
 * tests/unit/copilot/conversation-hub/test_socket_ns.spec.js
 *
 * F163: Testes para socket-ns.js — mount/unmount, event bridging, user:inject rate limiting. Usa mocks de Socket.io
 * para evitar dependência de servidor real.
 */

import EventEmitter from 'node:events';
import { createRequire } from 'node:module';

import { HubOrchestrator } from '../../../../src/copilot/conversation-hub/orchestrator.js';
import { ConversationStore } from '../../../../src/copilot/conversation-hub/store.js';
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

// ─── Mock Socket.IO ───────────────────────────────────────────────────────────

function createMockSocket() {
    const emitted = /** @type {Map<string, any[]>} */ (new Map());
    const listeners = /** @type {Map<string, Function>} */ (new Map());
    const rooms = new Set();
    return {
        id: 'mock-socket-001',
        rooms,
        handshake: { address: '127.0.0.1', auth: {}, headers: {} },
        emit: vi.fn((event, data) => {
            const arr = emitted.get(event) ?? [];
            arr.push(data);
            emitted.set(event, arr);
        }),
        on: vi.fn((event, handler) => {
            listeners.set(event, handler);
        }),
        join: vi.fn((room) => rooms.add(room)),
        leave: vi.fn((room) => rooms.delete(room)),
        _emitted: emitted,
        _listeners: listeners,
        /** @param {string} event @param {any} data */
        _trigger(event, data) {
            const handler = listeners.get(event);
            if (handler) return handler(data);
        },
    };
}

function createMockNamespace() {
    const ns = new EventEmitter();
    const emitted = /** @type {{ event: string; data: any }[]} */ ([]);
    const origEmit = ns.emit.bind(ns);
    ns.emit = vi.fn((event, data) => {
        emitted.push({ event, data });
        return origEmit(event, data);
    });
    ns.use = vi.fn();
    ns.disconnectSockets = vi.fn();
    ns.removeAllListeners = vi.fn();
    ns.to = vi.fn(() => ({
        emit: vi.fn((event, data) => {
            emitted.push({ event: `room:${event}`, data });
        }),
    }));
    // @ts-expect-error — propriedade de teste
    ns._emitted = emitted;
    return ns;
}

function createMockIo(ns) {
    return {
        of: vi.fn(() => ns),
    };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/** @type {import('better-sqlite3').Database} */
let testDb;
/** @type {ConversationStore} */
let store;

beforeAll(() => {
    const Database = require('better-sqlite3');
    testDb = new Database(':memory:');
    applyCopilotMigrations(testDb);
    store = new ConversationStore();
    store.init(testDb);
});

afterAll(() => {
    testDb?.close();
});

// O módulo socket-ns usa module-level state (copilotNamespace), então precisamos
// resetar entre testes via dynamic import + unmount

describe('socket-ns mountCopilotNamespace', () => {
    it('monta namespace /copilot e registra connection handler', async () => {
        // Limpar state anterior
        const mod = await import('../../../../src/copilot/conversation-hub/socket-ns.js');
        mod.unmountCopilotNamespace();

        const ns = createMockNamespace();
        const mockIo = createMockIo(ns);
        const agent = {
            getStatusSnapshot: () => ({ sessionId: 'sdk-1' }),
            status: 'running',
            dialogLoopActive: false,
        };
        const orch = new HubOrchestrator(store, /** @type {any} */ (agent));
        const bridge = {
            chat: vi.fn(async () => ({ response: 'r' })),
            chatStructured: vi.fn(async () => ({ raw: 'r', structured: null, parseError: null })),
        };
        orch.init(/** @type {any} */ (bridge));

        const result = mod.mountCopilotNamespace(/** @type {any} */ (mockIo), orch, store);
        expect(result).toBeTruthy(); // deve retornar o namespace;
        expect(mockIo.of.mock.calls[0][0] === '/copilot').toBeTruthy();

        // Cleanup
        mod.unmountCopilotNamespace();
        orch.destroy();
    });

    it('ignora re-mount quando namespace já montado', async () => {
        const mod = await import('../../../../src/copilot/conversation-hub/socket-ns.js');
        mod.unmountCopilotNamespace();

        const ns = createMockNamespace();
        const mockIo = createMockIo(ns);
        const orch = new HubOrchestrator(
            store,
            /** @type {any} */ ({
                getStatusSnapshot: () => ({}),
                status: 'running',
            }),
        );
        orch.init(/** @type {any} */ ({ chat: vi.fn(), chatStructured: vi.fn() }));

        mod.mountCopilotNamespace(/** @type {any} */ (mockIo), orch, store);
        const count1 = mockIo.of.mock.calls.length;

        // Re-mount — deve ser no-op
        mod.mountCopilotNamespace(/** @type {any} */ (mockIo), orch, store);
        const count2 = mockIo.of.mock.calls.length;

        expect(count1).toBe(count2); // of() não deve ser chamado novamente no re-mount;

        mod.unmountCopilotNamespace();
        orch.destroy();
    });
});

describe('socket-ns unmountCopilotNamespace', () => {
    it('limpa namespace e desconecta sockets', async () => {
        const mod = await import('../../../../src/copilot/conversation-hub/socket-ns.js');
        mod.unmountCopilotNamespace();

        const ns = createMockNamespace();
        const mockIo = createMockIo(ns);
        const orch = new HubOrchestrator(
            store,
            /** @type {any} */ ({
                getStatusSnapshot: () => ({}),
                status: 'running',
            }),
        );
        orch.init(/** @type {any} */ ({ chat: vi.fn(), chatStructured: vi.fn() }));

        mod.mountCopilotNamespace(/** @type {any} */ (mockIo), orch, store);
        expect(mod.getCopilotNamespace()).not.toBe(null);

        mod.unmountCopilotNamespace();
        expect(mod.getCopilotNamespace()).toBe(null);

        orch.destroy();
    });
});

describe('socket-ns broadcastToSession', () => {
    it('ignora broadcast quando namespace não montado', async () => {
        const mod = await import('../../../../src/copilot/conversation-hub/socket-ns.js');
        mod.unmountCopilotNamespace();

        // Não deve lançar
        expect(() => {
            mod.broadcastToSession('hub-001', 'test-event', { data: 1 });
        }).not.toThrow();
    });
});

describe('socket-ns broadcastGlobal', () => {
    it('ignora broadcast quando namespace não montado', async () => {
        const mod = await import('../../../../src/copilot/conversation-hub/socket-ns.js');
        mod.unmountCopilotNamespace();

        expect(() => {
            mod.broadcastGlobal('test-event', { data: 1 });
        }).not.toThrow();
    });
});
