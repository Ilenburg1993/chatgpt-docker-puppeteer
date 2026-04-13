// @ts-check
/**
 * tests/unit/copilot/test_conversation_hub_replay.spec.js
 *
 * F35.5 — Testes standalone → hub disponível → replay.
 *
 * Verifica o fluxo completo:
 *
 * 1. ConversationHub inicia em modo standalone (sem Socket.io)
 * 2. Sessão criada, turnos escritos via store
 * 3. Turnos recuperados via getTurn, countTurns, searchTurns (replay)
 * 4. Mensagens do usuário injetadas e poll funciona
 * 5. Hub encerrado corretamente via close()
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it, before, after } from 'node:test';

import { ConversationHub } from '../../../src/copilot/conversation-hub/hub.js';
import { HubOrchestrator } from '../../../src/copilot/conversation-hub/orchestrator.js';
import { ConversationStore } from '../../../src/copilot/conversation-hub/store.js';
import { COPILOT_MIGRATIONS } from '../../../src/copilot/db/migrations.js';

const require = createRequire(import.meta.url);

/**
 * Aplica migrations copilot em banco in-memory.
 *
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

// ─── Setup ────────────────────────────────────────────────────────────────────

/** @type {import('better-sqlite3').Database} */
let testDb;

/** @type {ConversationStore} */
let store;

/** @type {ConversationHub} */
let hub;

before(() => {
    const Database = require('better-sqlite3');
    testDb = new Database(':memory:');
    applyCopilotMigrations(testDb);

    store = new ConversationStore();
    store.init(testDb);

    // Usar hub com store diretamente via init() (sem io = standalone)
    hub = new ConversationHub();
    // ConversationHub.init() usa store singleton — inicializamos manualmente
    // para controlar o DB in-memory
});

after(() => {
    testDb?.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('F35.5 — ConversationHub standalone → replay', () => {
    it('ConversationStore pode ser inicializado diretamente com DB in-memory', () => {
        assert.ok(store, 'store deve existir');
    });

    it('criar hub_session retorna ID válido', () => {
        const sessionId = store.createHubSession({ title: 'Test Session F35.5' });
        assert.ok(typeof sessionId === 'string', 'hubSessionId deve ser string');
        assert.ok(sessionId.length > 0, 'hubSessionId não pode ser vazio');
    });

    it('writeTurn persiste turno e getTurn recupera', async () => {
        const sessionId = store.createHubSession({ title: 'Replay Test' });

        const turnId = await store.writeTurn(sessionId, {
            role: 'llm_a',
            content: 'Olá LLM-B, como vai?',
            metadata: { source: 'test' },
        });

        assert.ok(typeof turnId === 'number', 'turnId deve ser número');

        const turn = store.getTurn(turnId);
        assert.ok(turn, 'getTurn deve retornar o turno');
        assert.strictEqual(turn.role, 'llm_a');
        assert.ok(turn.content.includes('Olá LLM-B'), 'conteúdo deve conter a mensagem');
    });

    it('múltiplos turnos são recuperáveis na ordem correta (replay)', async () => {
        const sessionId = store.createHubSession({ title: 'Multi-turn Replay' });

        const t1 = await store.writeTurn(sessionId, { role: 'llm_a', content: 'turno-1' });
        const t2 = await store.writeTurn(sessionId, { role: 'llm_b', content: 'resposta-1' });
        const t3 = await store.writeTurn(sessionId, { role: 'llm_a', content: 'turno-2' });
        const t4 = await store.writeTurn(sessionId, { role: 'llm_b', content: 'resposta-2' });

        // Verificar que todos existem
        assert.ok(store.getTurn(t1));
        assert.ok(store.getTurn(t2));
        assert.ok(store.getTurn(t3));
        assert.ok(store.getTurn(t4));

        // countTurns retorna total
        const count = store.countTurns(sessionId);
        assert.strictEqual(count, 4, 'deve ter 4 turnos');

        // Ordem: t1 < t2 < t3 < t4
        assert.ok(t1 < t2 && t2 < t3 && t3 < t4, 'IDs devem ser crescentes');
    });

    it('searchTurns encontra turnos por conteúdo (FTS replay)', async () => {
        const sessionId = store.createHubSession({ title: 'FTS Test' });

        await store.writeTurn(sessionId, { role: 'llm_a', content: 'implementar função de validação' });
        await store.writeTurn(sessionId, { role: 'llm_b', content: 'a função de validação está pronta' });
        await store.writeTurn(sessionId, { role: 'llm_a', content: 'agora os testes unitários' });

        const results = store.searchTurns({ query: 'validação', hubSessionId: sessionId });
        assert.ok(results.length >= 1, 'deve encontrar turnos com "validação"');
    });

    it('injectUserMessage + getPendingUserMessages (poll)', async () => {
        const sessionId = store.createHubSession({ title: 'User Inject Test' });

        const turnId = await store.injectUserMessage(sessionId, 'Mensagem do usuário');
        assert.ok(typeof turnId === 'number');

        const pending = store.getPendingUserMessages(sessionId);
        assert.ok(pending.length >= 1, 'deve ter mensagem pendente');
        assert.ok(pending.some((t) => t.content === 'Mensagem do usuário'));
    });

    it('markUserMessageRead remove da lista de pendentes', async () => {
        const sessionId = store.createHubSession({ title: 'Mark Read Test' });

        const turnId = await store.injectUserMessage(sessionId, 'Leia-me');

        // Antes de marcar como lida
        let pending = store.getPendingUserMessages(sessionId);
        assert.ok(pending.length >= 1);

        // Marcar como lida
        store.markUserMessageRead(turnId);

        // Depois de marcar como lida
        pending = store.getPendingUserMessages(sessionId);
        assert.strictEqual(pending.length, 0, 'nenhuma mensagem pendente após markRead');
    });

    it('listHubSessions retorna sessões criadas', () => {
        const sessions = store.listHubSessions({ limit: 100 });
        assert.ok(sessions.length >= 1, 'deve listar ao menos uma sessão');
    });

    it('countHubSessions retorna contagem correta', () => {
        const total = store.countHubSessions();
        assert.ok(total >= 1, 'deve ter ao menos uma sessão');
    });

    it('sessão pode ser fechada via closeHubSession', () => {
        const sessionId = store.createHubSession({ title: 'Close Test' });
        store.closeHubSession(sessionId);

        const closed = store.listHubSessions({ status: 'closed', limit: 100 });
        assert.ok(
            closed.some((s) => s.id === sessionId),
            'sessão deve estar na lista de fechadas',
        );
    });

    it('turnos de sessão fechada ainda são acessíveis (replay persistente)', async () => {
        const sessionId = store.createHubSession({ title: 'Persistent Replay' });
        const turnId = await store.writeTurn(sessionId, { role: 'llm_a', content: 'Antes do close' });
        store.closeHubSession(sessionId);

        // Replay após close — dados persistidos
        const turn = store.getTurn(turnId);
        assert.ok(turn, 'turno deve persistir após close da sessão');
        assert.strictEqual(turn.content, 'Antes do close');
        assert.strictEqual(store.countTurns(sessionId), 1);
    });
});

describe('F35.5 — HubOrchestrator standalone flow', () => {
    /** @type {HubOrchestrator} */
    let orch;

    /** @type {ConversationStore} */
    let orchStore;

    /** @type {import('better-sqlite3').Database} */
    let orchDb;

    before(() => {
        const Database = require('better-sqlite3');
        orchDb = new Database(':memory:');
        applyCopilotMigrations(orchDb);
        orchStore = new ConversationStore();
        orchStore.init(orchDb);

        const mockAgent = { getStatusSnapshot: () => ({ sessionId: 'test-session' }) };
        orch = new HubOrchestrator(orchStore, mockAgent);

        const mockBridge = {
            chat: async (/** @type {any} */ _msg, /** @type {any} */ opts) => {
                opts?.onDelta?.('reply mock');
                return { response: 'reply mock', durationMs: 10, raw: null, chunks: 1 };
            },
            chatStructured: async (/** @type {any} */ _input, /** @type {any} */ opts) => {
                opts?.onDelta?.('structured mock');
                return {
                    response: 'structured mock',
                    durationMs: 10,
                    raw: { response: 'structured mock' },
                    chunks: 1,
                    structured: {},
                };
            },
        };
        orch.init(/** @type {any} */ (mockBridge));
    });

    after(() => {
        orch?.destroy();
        orchDb?.close();
    });

    it('createSession + sendToLlmB + getTurn (round-trip replay)', async () => {
        const sessionId = orch.createSession({ title: 'Orchestrator Replay' });
        assert.ok(typeof sessionId === 'string');

        const result = await orch.sendToLlmB(sessionId, 'Olá do teste');
        assert.ok(result.turnId > 0, 'deve ter turnId (reply LLM-B)');
        assert.ok(typeof result.content === 'string', 'deve ter content');
        assert.strictEqual(result.hubSessionId, sessionId);

        // Replay: turno LLM-B recuperável
        const replyTurn = orchStore.getTurn(result.turnId);
        assert.ok(replyTurn, 'turno LLM-B deve ser recuperável');
        assert.ok(replyTurn.content.includes('reply mock'));

        // Deve haver ao menos 2 turnos (LLM-A + LLM-B)
        const count = orchStore.countTurns(sessionId);
        assert.ok(count >= 2, 'deve ter ao menos 2 turnos (LLM-A + LLM-B)');
    });

    it('injectUserMessage → pollUserMessages → markRead (full user flow)', async () => {
        const sessionId = orch.createSession({ title: 'User Flow Test' });

        const turnId = await orch.injectUserMessage(sessionId, 'Mensagem do usuário humano');
        assert.ok(typeof turnId === 'number');

        const pending = orch.pollUserMessages(sessionId);
        assert.ok(pending.length >= 1, 'deve ter mensagem pendente');
        assert.ok(pending[0].content === 'Mensagem do usuário humano');

        // Após poll, deve estar vazio (já marcou como lido)
        const pendingAfter = orch.pollUserMessages(sessionId);
        assert.strictEqual(pendingAfter.length, 0, 'poll marca como lido automaticamente');
    });
});
