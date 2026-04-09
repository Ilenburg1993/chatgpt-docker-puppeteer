// @ts-check
/**
 * tests/unit/copilot/conversation-hub/test_hub.spec.js
 *
 * F165: Testes para hub.js — ConversationHub singleton facade.
 * Testa initStandalone (sem Socket.io), lifecycle, facade methods, isReady, stop, close.
 */

import assert from 'node:assert/strict';

import { ConversationHub } from '../../../../src/copilot/conversation-hub/hub.js';

// ─── Helper ──────────────────────────────────────────────────────────────

/** Helper para criar instância não-singleton com initStandalone */
function createHub() {
    const hub = new ConversationHub();
    hub.initStandalone();
    return hub;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('ConversationHub lifecycle', () => {
    it('initStandalone marca isReady=true', () => {
        const hub = createHub();
        assert.strictEqual(hub.isReady, true);
        hub.stop();
    });

    it('initStandalone é idempotente', () => {
        const hub = new ConversationHub();
        hub.initStandalone();
        hub.initStandalone(); // should be no-op
        assert.strictEqual(hub.isReady, true);
        hub.stop();
    });

    it('orchestrator getter lança antes de init', () => {
        const hub = new ConversationHub();
        assert.throws(() => hub.orchestrator, /Não inicializado/);
    });

    it('stop reseta isReady para false', () => {
        const hub = createHub();
        assert.strictEqual(hub.isReady, true);
        hub.stop();
        assert.strictEqual(hub.isReady, false);
    });

    it('close é no-op se não inicializado', async () => {
        const hub = new ConversationHub();
        await hub.close(); // deve não lançar
        assert.strictEqual(hub.isReady, false);
    });

    it('close fecha sessões ativas e para o hub', async () => {
        const hub = createHub();
        // Criar uma sessão ativa
        const sessionId = hub.createSession({ title: 'close-test' });
        assert.ok(sessionId);

        await hub.close();
        assert.strictEqual(hub.isReady, false);
    });
});

describe('ConversationHub facade methods (standalone)', () => {
    /** @type {ConversationHub} */
    let hub;

    beforeEach(() => {
        hub = createHub();
    });

    afterEach(() => {
        hub.stop();
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
