// @ts-check
/**
 * tests/unit/copilot/conversation-hub/test_orchestrator.spec.js
 *
 * F161: Testes para HubOrchestrator — lifecycle, session management, sendToLlmB, user messages, mutex serialization,
 * event emission, error paths.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';

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

/**
 * Cria um mock agent mínimo para uso nos testes.
 *
 * @param {object} [overrides]
 * @returns {import('../../../../src/copilot/conversation-hub/orchestrator.js').AgentLike}
 */
function createMockAgent(overrides = {}) {
    return {
        getStatusSnapshot: () => ({ sessionId: 'sdk-test-001', status: 'running' }),
        dialogLoopActive: false,
        status: 'running',
        ...overrides,
    };
}

/**
 * Cria um mock bridge (LlmBridgeClient).
 *
 * @param {object} [overrides]
 */
function createMockBridge(overrides = {}) {
    return {
        chat: vi.fn(async () => ({ response: 'mock response' })),
        chatStructured: vi.fn(async () => ({
            raw: 'structured response',
            structured: { action: 'test' },
            parseError: null,
        })),
        ...overrides,
    };
}

/** @type {import('better-sqlite3').Database} */
let testDb;
/** @type {ConversationStore} */
let store;

before(() => {
    const Database = require('better-sqlite3');
    testDb = new Database(':memory:');
    applyCopilotMigrations(testDb);
    store = new ConversationStore();
    store.init(testDb);
});

after(() => {
    testDb?.close();
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

describe('HubOrchestrator lifecycle', () => {
    it('init restaura turn counters de sessões ativas', () => {
        // Criar uma sessão com turns via store
        const sessionId = store.createHubSession({ title: 'Lifecycle test' });
        store.writeTurn(sessionId, { role: 'user', content: 'msg1' });
        store.writeTurn(sessionId, { role: 'llm_b', content: 'msg2' });

        const orch = new HubOrchestrator(store, createMockAgent());
        orch.init(/** @type {any} */ (createMockBridge()));
        orch.destroy(); // cleanup
    });

    it('destroy limpa todos os recursos', () => {
        const orch = new HubOrchestrator(store, createMockAgent());
        orch.init(/** @type {any} */ (createMockBridge()));

        let eventFired = false;
        orch.on('session:created', () => {
            eventFired = true;
        });
        orch.destroy();

        // Após destroy, listeners foram removidos
        orch.emit('session:created', {});
        assert.ok(!eventFired, 'Listener deve ser removido após destroy');
    });
});

// ─── Session Management ───────────────────────────────────────────────────────

describe('HubOrchestrator session management', () => {
    /** @type {HubOrchestrator} */
    let orch;

    beforeEach(() => {
        orch = new HubOrchestrator(store, createMockAgent());
        orch.init(/** @type {any} */ (createMockBridge()));
    });

    afterEach(() => {
        orch.destroy();
    });

    it('createSession retorna hubSessionId e emite session:created', () => {
        const events = /** @type {any[]} */ ([]);
        orch.on('session:created', (d) => events.push(d));

        const id = orch.createSession({ title: 'Test Session' });
        assert.ok(typeof id === 'string');
        assert.ok(id.length > 0);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].hubSessionId, id);
    });

    it('closeSession emite session:closed', () => {
        const events = /** @type {any[]} */ ([]);
        orch.on('session:closed', (d) => events.push(d));

        const id = orch.createSession();
        orch.closeSession(id);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].hubSessionId, id);
    });

    it('closeSession impede novos sendToLlmB', async () => {
        const id = orch.createSession();
        orch.closeSession(id);

        await assert.rejects(
            () => orch.sendToLlmB(id, 'hello'),
            (err) => /** @type {Error} */ (err).message.includes('encerrada'),
        );
    });

    it('listSessions retorna sessões do store', () => {
        orch.createSession({ title: 'list-test' });
        const sessions = orch.listSessions();
        assert.ok(sessions.length >= 1);
    });
});

// ─── sendToLlmB ───────────────────────────────────────────────────────────────

describe('HubOrchestrator sendToLlmB', () => {
    it('send string message via simple chat e emite turn:sent + turn:complete', async () => {
        const orch = new HubOrchestrator(store, createMockAgent());
        const bridge = createMockBridge();
        orch.init(/** @type {any} */ (bridge));

        const sentEvents = /** @type {any[]} */ ([]);
        const completeEvents = /** @type {any[]} */ ([]);
        orch.on('turn:sent', (d) => sentEvents.push(d));
        orch.on('turn:complete', (d) => completeEvents.push(d));

        const id = orch.createSession();
        const result = await orch.sendToLlmB(id, 'hello');

        assert.ok(result.turnId > 0);
        assert.strictEqual(result.content, 'mock response');
        assert.strictEqual(result.hubSessionId, id);
        assert.ok(result.durationMs >= 0);

        assert.strictEqual(sentEvents.length, 1);
        assert.strictEqual(sentEvents[0].role, 'llm_a');
        assert.strictEqual(completeEvents.length, 1);
        assert.strictEqual(completeEvents[0].role, 'llm_b');

        orch.destroy();
    });

    it('send structured message via chatStructured', async () => {
        const orch = new HubOrchestrator(store, createMockAgent());
        const bridge = createMockBridge();
        orch.init(/** @type {any} */ (bridge));

        const id = orch.createSession();
        const result = await orch.sendToLlmB(id, { text: 'structured' }, { useStructured: true });

        assert.strictEqual(result.content, 'structured response');
        assert.deepStrictEqual(result.structured, { action: 'test' });
        assert.ok(bridge.chatStructured.mock.calls.length >= 1);

        orch.destroy();
    });

    it('send via dialog loop quando dialogLoopActive=true', async () => {
        const agent = createMockAgent({
            dialogLoopActive: true,
            sendDialogTurn: vi.fn(async () => 'dialog response'),
            on: vi.fn(),
            off: vi.fn(),
        });
        const orch = new HubOrchestrator(store, agent);
        orch.init(/** @type {any} */ (createMockBridge()));

        const id = orch.createSession();
        const result = await orch.sendToLlmB(id, 'hello');
        assert.strictEqual(result.content, 'dialog response');

        orch.destroy();
    });

    it('persiste erro como turn de LLM-B quando bridge lança', async () => {
        const bridge = createMockBridge({
            chat: vi.fn(async () => {
                throw new Error('bridge failure');
            }),
        });
        const orch = new HubOrchestrator(store, createMockAgent());
        orch.init(/** @type {any} */ (bridge));

        const errorEvents = /** @type {any[]} */ ([]);
        orch.on('error', (d) => errorEvents.push(d));

        const id = orch.createSession();
        await assert.rejects(
            () => orch.sendToLlmB(id, 'will fail'),
            (err) => /** @type {Error} */ (err).message.includes('bridge failure'),
        );

        assert.strictEqual(errorEvents.length, 1);

        // Verificar que o erro está persistido como turn
        const turns = orch.readHistory(id);
        const errorTurn = turns.find((t) => t.content.includes('[ERRO]'));
        assert.ok(errorTurn, 'Turn de erro deve existir no histórico');

        orch.destroy();
    });

    it('lança quando orchestrator não foi inicializado (sem bridge)', async () => {
        const orch = new HubOrchestrator(store, createMockAgent());
        // Não chama init()
        const id = store.createHubSession({ title: 'no-init' });
        await assert.rejects(
            () => orch.sendToLlmB(id, 'hello'),
            (err) => /** @type {Error} */ (err).message.includes('inicializado'),
        );
        orch.destroy();
    });

    it('lança quando agente está parado', async () => {
        const agent = createMockAgent({ status: 'stopped' });
        const orch = new HubOrchestrator(store, agent);
        orch.init(/** @type {any} */ (createMockBridge()));

        const id = orch.createSession();
        await assert.rejects(
            () => orch.sendToLlmB(id, 'hello'),
            (err) => /** @type {Error} */ (err).message.includes('ativo'),
        );

        orch.destroy();
    });
});

// ─── User Messages ────────────────────────────────────────────────────────────

describe('HubOrchestrator user messages', () => {
    /** @type {HubOrchestrator} */
    let orch;

    beforeEach(() => {
        orch = new HubOrchestrator(store, createMockAgent());
        orch.init(/** @type {any} */ (createMockBridge()));
    });

    afterEach(() => {
        orch.destroy();
    });

    it('injectUserMessage persiste e emite user:injected', async () => {
        const events = /** @type {any[]} */ ([]);
        orch.on('user:injected', (d) => events.push(d));

        const sessionId = orch.createSession();
        const turnId = await orch.injectUserMessage(sessionId, 'Olá do usuário');

        assert.ok(turnId > 0);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].content, 'Olá do usuário');
    });

    it('pollUserMessages retorna pendentes e marca como lidas', async () => {
        const sessionId = orch.createSession();
        await orch.injectUserMessage(sessionId, 'Mensagem 1');
        await orch.injectUserMessage(sessionId, 'Mensagem 2');

        const msgs = orch.pollUserMessages(sessionId);
        assert.strictEqual(msgs.length, 2);

        // Após poll, não deve ter mais pendentes
        const again = orch.pollUserMessages(sessionId);
        assert.strictEqual(again.length, 0);
    });
});

// ─── notifyTerminalTurn ──────────────────────────────────────────────────────

describe('HubOrchestrator notifyTerminalTurn', () => {
    it('emite turn:sent e turn:complete sem persistir', () => {
        const orch = new HubOrchestrator(store, createMockAgent());
        orch.init(/** @type {any} */ (createMockBridge()));

        const sentEvents = /** @type {any[]} */ ([]);
        const completeEvents = /** @type {any[]} */ ([]);
        orch.on('turn:sent', (d) => sentEvents.push(d));
        orch.on('turn:complete', (d) => completeEvents.push(d));

        orch.notifyTerminalTurn(
            'hub-001',
            { turnId: 1, role: 'user', content: 'user msg', turnNumber: 1 },
            { turnId: 2, content: 'llm response', turnNumber: 2, durationMs: 100 },
        );

        assert.strictEqual(sentEvents.length, 1);
        assert.strictEqual(sentEvents[0].source, 'terminal');
        assert.strictEqual(completeEvents.length, 1);
        assert.strictEqual(completeEvents[0].source, 'terminal');

        orch.destroy();
    });
});

// ─── readHistory / listSessions ──────────────────────────────────────────────

describe('HubOrchestrator history', () => {
    it('readHistory retorna turns da sessão', async () => {
        const orch = new HubOrchestrator(store, createMockAgent());
        orch.init(/** @type {any} */ (createMockBridge()));

        const id = orch.createSession();
        await orch.sendToLlmB(id, 'msg for history');

        const history = orch.readHistory(id);
        assert.ok(history.length >= 2, 'Deve ter turn de LLM-A e LLM-B');

        orch.destroy();
    });
});
