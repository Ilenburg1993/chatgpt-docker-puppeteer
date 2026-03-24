// @ts-check
/**
 * tests/unit/copilot/test_conversation_store.spec.js
 *
 * Testes unitários do ConversationStore (Sprint Hub). Usa better-sqlite3 in-memory via dbOverride em store.init(db).
 *
 * Cobertura:
 *
 * - createHubSession(): criação com título e sem título
 * - getHubSession(): existente e inexistente
 * - updateSdkSession(): atualização do sdkSessionId
 * - closeHubSession(): status → 'closed'
 * - listHubSessions(): paginado, filtro por status
 * - writeTurn(): llm_a, llm_b, user com turn_number sequencial
 * - readTurns(): paginado, after, todos
 * - countTurns(): contagem exata
 * - getTurn(): por id
 * - injectUserMessage(): user_read=0
 * - getPendingUserMessages(): apenas não lidas
 * - markUserMessageRead(): user_read=1
 * - markAllUserMessagesRead(): marca todas
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, describe, it } from 'node:test';
import { ConversationStore } from '../../../src/copilot/conversation-hub/store.js';

const require = createRequire(import.meta.url);

/** @type {import('better-sqlite3').Database} */
let testDb;

/** @type {ConversationStore} */
let store;

// ─── Setup ────────────────────────────────────────────────────────────────────

before(() => {
    // DB in-memory — injeta no store via dbOverride para não tocar em maestro.sqlite
    const Database = require('better-sqlite3');
    testDb = new Database(':memory:');
    store = new ConversationStore();
    store.init(testDb);
});

after(() => {
    testDb?.close();
});

// ─── createHubSession ─────────────────────────────────────────────────────────

describe('ConversationStore.createHubSession', () => {
    it('cria sessão com UUID e status=active', () => {
        const id = store.createHubSession({ title: 'Teste básico' });
        assert.ok(typeof id === 'string' && id.length > 0, 'deve retornar string não-vazia');

        const session = store.getHubSession(id);
        assert.ok(session !== null);
        assert.equal(session?.status, 'active');
        assert.equal(session?.title, 'Teste básico');
        assert.ok(session?.created_at > 0);
        assert.ok(session?.updated_at > 0);
    });

    it('usa título padrão quando não informado', () => {
        const id = store.createHubSession();
        const session = store.getHubSession(id);
        assert.ok(session?.title.length > 0, 'deve ter título não-vazio');
    });

    it('persiste sdkSessionId', () => {
        const id = store.createHubSession({ sdkSessionId: 'sdk-abc-123' });
        const session = store.getHubSession(id);
        assert.equal(session?.sdk_session_id, 'sdk-abc-123');
    });
});

// ─── getHubSession / inexistente ──────────────────────────────────────────────

describe('ConversationStore.getHubSession', () => {
    it('retorna null para id inexistente', () => {
        const result = store.getHubSession('nao-existe-xyz');
        assert.equal(result, null);
    });
});

// ─── updateSdkSession ─────────────────────────────────────────────────────────

describe('ConversationStore.updateSdkSession', () => {
    it('atualiza sdk_session_id', () => {
        const id = store.createHubSession({ title: 'SDK update test' });
        store.updateSdkSession(id, 'sdk-novo-456');
        const session = store.getHubSession(id);
        assert.equal(session?.sdk_session_id, 'sdk-novo-456');
    });
});

// ─── closeHubSession ─────────────────────────────────────────────────────────

describe('ConversationStore.closeHubSession', () => {
    it('altera status para closed', () => {
        const id = store.createHubSession({ title: 'Para fechar' });
        store.closeHubSession(id);
        const session = store.getHubSession(id);
        assert.equal(session?.status, 'closed');
    });
});

// ─── listHubSessions ─────────────────────────────────────────────────────────

describe('ConversationStore.listHubSessions', () => {
    it('retorna sessões paginadas', () => {
        // Garantir pelo menos 3 sessões
        store.createHubSession({ title: 'List A' });
        store.createHubSession({ title: 'List B' });
        store.createHubSession({ title: 'List C' });

        const sessions = store.listHubSessions({ limit: 2 });
        assert.ok(sessions.length <= 2, 'não deve ultrapassar o limite');
    });

    it('filtra por status', () => {
        const id = store.createHubSession({ title: 'Para listar como closed' });
        store.closeHubSession(id);

        const closed = store.listHubSessions({ status: 'closed' });
        assert.ok(
            closed.every((s) => s.status === 'closed'),
            'todas devem ser closed',
        );

        const active = store.listHubSessions({ status: 'active' });
        assert.ok(
            active.every((s) => s.status === 'active'),
            'todas devem ser active',
        );
    });
});

// ─── writeTurn + readTurns ────────────────────────────────────────────────────

describe('ConversationStore.writeTurn / readTurns', () => {
    /** @type {string} */
    let sessionId;

    before(async () => {
        sessionId = store.createHubSession({ title: 'Sessão de turns' });
    });

    it('registra turn_number sequencial', () => {
        const t1 = store.writeTurn(sessionId, { role: 'llm_a', content: 'Pergunta 1' });
        const t2 = store.writeTurn(sessionId, { role: 'llm_b', content: 'Resposta 1' });
        const t3 = store.writeTurn(sessionId, { role: 'llm_a', content: 'Pergunta 2' });

        const turn1 = store.getTurn(t1);
        const turn2 = store.getTurn(t2);
        const turn3 = store.getTurn(t3);

        assert.equal(turn1?.turn_number, 1);
        assert.equal(turn2?.turn_number, 2);
        assert.equal(turn3?.turn_number, 3);
    });

    it('readTurns retorna em ordem crescente', () => {
        const turns = store.readTurns(sessionId);
        for (let i = 1; i < turns.length; i++) {
            assert.ok(turns[i].turn_number >= turns[i - 1].turn_number, 'deve crescer');
        }
    });

    it('readTurns com after filtra ids menores', () => {
        // Turn IDs são autoincrement — pegar o primeiro e filtrar
        const all = store.readTurns(sessionId);
        if (all.length < 2) return; // skip se menos de 2

        const firstId = all[0].id;
        const filtered = store.readTurns(sessionId, { after: firstId });
        assert.ok(
            filtered.every((t) => t.id > firstId),
            'todos devem ter id > firstId',
        );
    });

    it('readTurns respeita limit', () => {
        const turns = store.readTurns(sessionId, { limit: 1 });
        assert.ok(turns.length <= 1);
    });

    it('persiste conteúdo structured como JSON', () => {
        const structured = { responseType: 'diagnostic', output: 'ok' };
        const tid = store.writeTurn(sessionId, {
            role: 'llm_b',
            content: 'raw content',
            structured,
        });
        const turn = store.getTurn(tid);
        assert.ok(turn?.structured !== null);
        const parsed = JSON.parse(turn?.structured ?? '{}');
        assert.equal(parsed.responseType, 'diagnostic');
    });
});

// ─── countTurns ──────────────────────────────────────────────────────────────

describe('ConversationStore.countTurns', () => {
    it('conta corretamente os turns de uma sessão', () => {
        const id = store.createHubSession({ title: 'Count test' });
        assert.equal(store.countTurns(id), 0, 'nova sessão deve ter 0 turns');

        store.writeTurn(id, { role: 'llm_a', content: 'a' });
        store.writeTurn(id, { role: 'llm_b', content: 'b' });
        assert.equal(store.countTurns(id), 2);
    });
});

// ─── injectUserMessage + pollPendingUserMessages ──────────────────────────────

describe('ConversationStore mensagens do usuário', () => {
    /** @type {string} */
    let sessionId;

    before(async () => {
        sessionId = store.createHubSession({ title: 'User messages test' });
    });

    it('injectUserMessage cria turn com user_read=0', () => {
        const tid = store.injectUserMessage(sessionId, 'Mensagem do usuário 1');
        const turn = store.getTurn(tid);

        assert.equal(turn?.role, 'user');
        assert.equal(turn?.content, 'Mensagem do usuário 1');
        assert.equal(turn?.user_read, 0);
    });

    it('writeTurn com role=llm_a cria user_read=1', () => {
        const tid = store.writeTurn(sessionId, { role: 'llm_a', content: 'response' });
        const turn = store.getTurn(tid);
        assert.equal(turn?.user_read, 1);
    });

    it('getPendingUserMessages retorna apenas user_read=0', () => {
        // Injetar mais uma mensagem não lida
        store.injectUserMessage(sessionId, 'Mensagem do usuário 2');

        const pending = store.getPendingUserMessages(sessionId);
        assert.ok(pending.length >= 1, 'deve ter pelo menos 1 mensagem pendente');
        assert.ok(
            pending.every((m) => m.user_read === 0),
            'todas devem ser user_read=0',
        );
        assert.ok(
            pending.every((m) => m.role === 'user'),
            'todas devem ser role=user',
        );
    });

    it('markUserMessageRead altera user_read=1', () => {
        const tid = store.injectUserMessage(sessionId, 'Para marcar como lida');
        store.markUserMessageRead(tid);
        const turn = store.getTurn(tid);
        assert.equal(turn?.user_read, 1);
    });

    it('markAllUserMessagesRead marca todas como lidas', () => {
        store.injectUserMessage(sessionId, 'Não lida A');
        store.injectUserMessage(sessionId, 'Não lida B');

        const countBefore = store.getPendingUserMessages(sessionId).length;
        assert.ok(countBefore >= 2);

        const changed = store.markAllUserMessagesRead(sessionId);
        assert.ok(changed >= 2);

        const pendingAfter = store.getPendingUserMessages(sessionId);
        assert.equal(pendingAfter.length, 0);
    });
});
