// @ts-check
/**
 * tests/unit/copilot/test_hub_orchestrator.spec.js
 *
 * Testes unitários do HubOrchestrator (Sprint Hub). Usa ConversationStore com DB in-memory + LlmBridgeClient mockado
 * via init(bridge).
 *
 * Cobertura:
 *
 * - createSession(): criação, evento session:created
 * - closeSession(): evento session:closed, status no store
 * - injectUserMessage(): evento user:injected, turn persistido
 * - pollUserMessages(): retorna pendentes, marca como lidas
 * - sendToLlmB(): turn LLM-A persistido, resposta LLM-B persistida, evento turn:complete
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { HubOrchestrator } from '../../../src/copilot/conversation-hub/orchestrator.js';
import { ConversationStore } from '../../../src/copilot/conversation-hub/store.js';
import { COPILOT_MIGRATIONS } from '../../../src/copilot/db/migrations.js';

/**
 * Aplica as migrations copilot a um banco in-memory de teste.
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

/** @type {import('better-sqlite3').Database} */
let testDb;

/** @type {ConversationStore} */
let store;

/** @type {HubOrchestrator} */
let orchestrator;

/** @type {{ chat: Function; chatStructured: Function }} */
const mockBridge = {
    chat: async (/** @type {any} */ _msg, /** @type {any} */ opts) => {
        opts?.onDelta?.('Resposta ');
        opts?.onDelta?.('mockada');
        return { response: 'Resposta mockada', durationMs: 50, raw: null, chunks: 2 };
    },
    chatStructured: async (/** @type {any} */ _input, /** @type {any} */ opts) => {
        opts?.onDelta?.('Resposta estruturada');
        return {
            response: 'Resposta estruturada',
            durationMs: 40,
            raw: { response: 'Resposta estruturada' },
            chunks: 1,
            structured: { responseType: 'diagnostic', output: 'ok' },
        };
    },
};

/** Mock mínimo do AlwaysAliveAgent */
const mockAgent = { sessionId: 'mock-sdk-session-id' };

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
    testDb = new Database(':memory:');
    applyCopilotMigrations(testDb);

    store = new ConversationStore();
    store.init(testDb);

    // Injetar bridge e agent mocks via parâmetros do construtor e init()
    orchestrator = new HubOrchestrator(store, mockAgent);
    orchestrator.init(/** @type {any} */ (mockBridge));
});

afterAll(() => {
    orchestrator?.destroy();
    testDb?.close();
});

// ─── createSession ────────────────────────────────────────────────────────────

describe('HubOrchestrator.createSession', () => {
    it('retorna hubSessionId string', () => {
        const id = orchestrator.createSession({ title: 'Test session A' });
        assert.ok(typeof id === 'string' && id.length > 0);
    });

    it('emite evento session:created', () => {
        /** @type {any} */
        let emitted = null;
        orchestrator.once('session:created', (d) => {
            emitted = d;
        });

        const id = orchestrator.createSession({ title: 'Evento test' });
        assert.ok(emitted !== null, 'evento session:created deve ser emitido');
        assert.equal(emitted?.hubSessionId, id);
    });

    it('persiste sessão no store', () => {
        const id = orchestrator.createSession({ title: 'Store persiste?' });
        const session = store.getHubSession(id);
        assert.ok(session !== null, 'sessão deve existir no store');
        assert.equal(session?.status, 'active');
    });
});

// ─── closeSession ─────────────────────────────────────────────────────────────

describe('HubOrchestrator.closeSession', () => {
    it('emite evento session:closed', () => {
        const id = orchestrator.createSession({ title: 'Para fechar' });

        /** @type {any} */
        let emitted = null;
        orchestrator.once('session:closed', (d) => {
            emitted = d;
        });

        orchestrator.closeSession(id);
        assert.ok(emitted !== null, 'evento session:closed deve ser emitido');
        assert.equal(emitted?.hubSessionId, id);
    });

    it('atualiza status para closed no store', () => {
        const id = orchestrator.createSession({ title: 'Close store test' });
        orchestrator.closeSession(id);

        const session = store.getHubSession(id);
        assert.equal(session?.status, 'closed');
    });
});

// ─── injectUserMessage ────────────────────────────────────────────────────────

describe('HubOrchestrator.injectUserMessage', () => {
    it('retorna turnId numérico', async () => {
        const sessionId = orchestrator.createSession();
        const tid = await orchestrator.injectUserMessage(sessionId, 'Olá, hub!');
        assert.equal(typeof tid, 'number');
        assert.ok(tid > 0);
    });

    it('emite evento user:injected', async () => {
        const sessionId = orchestrator.createSession();

        /** @type {any} */
        let emitted = null;
        orchestrator.once('user:injected', (d) => {
            emitted = d;
        });

        await orchestrator.injectUserMessage(sessionId, 'Teste evento inject');
        assert.ok(emitted !== null, 'evento user:injected deve ser emitido');
        assert.equal(emitted?.content, 'Teste evento inject');
    });

    it('persiste turn com role=user e user_read=0', async () => {
        const sessionId = orchestrator.createSession();
        const tid = await orchestrator.injectUserMessage(sessionId, 'Mensagem user');

        const turn = store.getTurn(tid);
        assert.equal(turn?.role, 'user');
        assert.equal(turn?.user_read, 0);
    });
});

// ─── pollUserMessages ─────────────────────────────────────────────────────────

describe('HubOrchestrator.pollUserMessages', () => {
    it('retorna mensagens pendentes e as marca como lidas', async () => {
        const sessionId = orchestrator.createSession();

        await orchestrator.injectUserMessage(sessionId, 'Pendente 1');
        await orchestrator.injectUserMessage(sessionId, 'Pendente 2');

        const msgs = orchestrator.pollUserMessages(sessionId);
        assert.ok(msgs.length >= 2, 'deve retornar pelo menos 2 mensagens');

        // Após poll, não devem mais aparecer como pendentes
        const second = orchestrator.pollUserMessages(sessionId);
        assert.equal(second.length, 0, 'não deve haver mais pendentes após poll');
    });

    it('retorna array vazio se não há pendentes', () => {
        const sessionId = orchestrator.createSession();
        const msgs = orchestrator.pollUserMessages(sessionId);
        assert.equal(msgs.length, 0);
    });
});

// ─── sendToLlmB ──────────────────────────────────────────────────────────────

describe('HubOrchestrator.sendToLlmB', () => {
    it('persiste turn de LLM-A e LLM-B, retorna OrchestratorResult', async () => {
        const sessionId = orchestrator.createSession({ title: 'Send LLM-B test' });

        const result = await orchestrator.sendToLlmB(sessionId, 'Qual o plano arquitetural?');

        assert.ok(result.turnId > 0, 'deve ter turnId');
        assert.ok(typeof result.content === 'string', 'deve ter content string');
        assert.ok(result.durationMs >= 0, 'deve ter durationMs >= 0');
        assert.equal(result.hubSessionId, sessionId);
        assert.ok(result.turnNumber > 0);

        // Verificar que o turn de LLM-B está no store
        const turn = store.getTurn(result.turnId);
        assert.equal(turn?.role, 'llm_b');
        assert.equal(turn?.content, result.content);

        // Verificar que o turn de LLM-A também foi salvo (turn_number = n-1)
        const allTurns = store.readTurns(sessionId);
        const llmATurns = allTurns.filter((t) => t.role === 'llm_a');
        assert.ok(llmATurns.length >= 1, 'deve ter pelo menos 1 turn de LLM-A');
    });

    it('emite evento turn:complete', async () => {
        const sessionId = orchestrator.createSession({ title: 'Evento turn:complete' });

        /** @type {any} */
        let emitted = null;
        orchestrator.once('turn:complete', (d) => {
            emitted = d;
        });

        await orchestrator.sendToLlmB(sessionId, 'Pergunta para evento');
        assert.ok(emitted !== null, 'evento turn:complete deve ser emitido');
        assert.equal(emitted?.hubSessionId, sessionId);
        assert.equal(emitted?.role, 'llm_b');
    });

    it('emite evento turn:sent antes de turn:complete', async () => {
        const sessionId = orchestrator.createSession();

        const order = /** @type {string[]} */ ([]);
        orchestrator.once('turn:sent', () => order.push('sent'));
        orchestrator.once('turn:complete', () => order.push('complete'));

        await orchestrator.sendToLlmB(sessionId, 'Ordem dos eventos');
        assert.deepEqual(order, ['sent', 'complete'], 'turn:sent deve preceder turn:complete');
    });
});

// ─── Serialização por sessão (mutex) ──────────────────────────────────────────

describe('HubOrchestrator.sendToLlmB serialização', () => {
    it('chamadas concorrentes para a mesma sessão executam em sequência', async () => {
        const order = /** @type {number[]} */ ([]);

        // Substitui o bridge por um que registra a ordem de execução com delay
        let callN = 0;
        const orderedBridge = /** @type {any} */ ({
            chat: async (/** @type {any} */ _msg, /** @type {any} */ opts) => {
                const n = ++callN;
                // Simula latência diferente: call 1 demora mais que call 2
                await new Promise((r) => setTimeout(r, n === 1 ? 30 : 5));
                order.push(n);
                opts?.onDelta?.(`chunk-${n}`);
                return { response: `resp-${n}`, durationMs: 10 };
            },
            chatStructured: async (/** @type {any} */ _input, /** @type {any} */ opts) => {
                const n = ++callN;
                await new Promise((r) => setTimeout(r, n === 1 ? 30 : 5));
                order.push(n);
                opts?.onDelta?.(`chunk-${n}`);
                return { response: `resp-${n}`, durationMs: 10, raw: null, structured: null };
            },
        });

        // Criar orquestrador isolado para este teste
        const db2 = new Database(':memory:');
        applyCopilotMigrations(db2);
        const store2 = new ConversationStore();
        store2.init(db2);
        const orch2 = new HubOrchestrator(store2, mockAgent);
        orch2.init(orderedBridge);
        const sid = orch2.createSession({ title: 'Serialized' });

        // Dispara 3 chamadas concorrentemente
        const [r1, r2, r3] = await Promise.all([
            orch2.sendToLlmB(sid, 'msg1', { useStructured: false }),
            orch2.sendToLlmB(sid, 'msg2', { useStructured: false }),
            orch2.sendToLlmB(sid, 'msg3', { useStructured: false }),
        ]);

        // Devem ter sido processadas em ordem (1, 2, 3) mesmo com latências diferentes
        assert.deepEqual(order, [1, 2, 3], 'deve serializar na ordem de enfileiramento');
        // Todas devem ter conteúdo
        assert.ok(r1.content.length > 0);
        assert.ok(r2.content.length > 0);
        assert.ok(r3.content.length > 0);

        orch2.destroy();
        db2.close();
    });

    it('emite turn:user_pending quando usuário injeta enquanto turn está em andamento', async () => {
        const db3 = new Database(':memory:');
        applyCopilotMigrations(db3);
        const store3 = new ConversationStore();
        store3.init(db3);

        // Bridge com delay para simular turn em andamento
        let resolveBridge = /** @type {((value?: any) => void) | null} */ (null);
        const delayedBridge = /** @type {any} */ ({
            chat: async (/** @type {any} */ _msg, /** @type {any} */ _opts) => {
                await new Promise((r) => {
                    resolveBridge = r;
                });
                return { response: 'resp', durationMs: 10 };
            },
            chatStructured: async () => ({ response: 'resp', durationMs: 10, raw: null, structured: null }),
        });

        const orch3 = new HubOrchestrator(store3, mockAgent);
        orch3.init(delayedBridge);
        const sid3 = orch3.createSession({ title: 'user_pending test' });

        const pendingEvents = /** @type {any[]} */ ([]);
        orch3.on('turn:user_pending', (e) => pendingEvents.push(e));

        // Inicia turn (fica bloqueado no bridge)
        const sendPromise = orch3.sendToLlmB(sid3, 'msg-lento', { useStructured: false });

        // Aguarda um tick para garantir que o turn entrou em andamento
        await new Promise((r) => setTimeout(r, 5));

        // Usuário injeta mensagem enquanto turn está em andamento
        await orch3.injectUserMessage(sid3, 'Mensagem urgente do usuário');

        // Deve ter emitido turn:user_pending
        assert.equal(pendingEvents.length, 1, 'deve emitir turn:user_pending');
        assert.equal(pendingEvents[0].hubSessionId, sid3);
        assert.ok(typeof pendingEvents[0].content === 'string');

        // Libera o bridge
        resolveBridge?.();
        await sendPromise;

        orch3.destroy();
        db3.close();
    });
});
