// @ts-check
/**
 * tests/unit/copilot/test_webhooks.spec.js
 *
 * Testes unitários para o sistema de webhooks do AlwaysAliveAgent (Upgrade 3). Cobre a API pública de
 * registro/remoção/listagem de webhooks do agente.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeAll, afterEach } from 'vitest';

import { AlwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';

// ─────────────────────────────────────────────────────────────────────────────
// Suite principal
// ─────────────────────────────────────────────────────────────────────────────

describe('AlwaysAliveAgent › webhooks', () => {
    /** @type {AlwaysAliveAgent} */
    let agent;

    beforeAll(() => {
        agent = new AlwaysAliveAgent();
    });

    afterEach(() => {
        // Limpar webhooks entre testes
        for (const { id } of agent.listWebhooks()) {
            agent.unregisterWebhook(id);
        }
    });

    // ─── registerWebhook ───────────────────────────────────────────────────

    describe('registerWebhook()', () => {
        it('deve retornar objeto com id e url', () => {
            const result = agent.registerWebhook('http://test-hook.example.com:9000/hook');
            assert.ok(typeof result.id === 'string', 'id deve ser string');
            assert.equal(result.url, 'http://test-hook.example.com:9000/hook');
        });

        it('id deve começar com "wh_"', () => {
            const { id } = agent.registerWebhook('http://example.com/hook');
            assert.ok(id.startsWith('wh_'), `id deve iniciar com "wh_", recebido: ${id}`);
        });

        it('cada registro deve gerar um id único', () => {
            const r1 = agent.registerWebhook('http://a.com');
            const r2 = agent.registerWebhook('http://b.com');
            assert.notEqual(r1.id, r2.id, 'IDs devem ser distintos');
        });

        it('deve aceitar URLs https', () => {
            const { url } = agent.registerWebhook('https://secure.example.com/cb');
            assert.equal(url, 'https://secure.example.com/cb');
        });
    });

    // ─── listWebhooks ─────────────────────────────────────────────────────

    describe('listWebhooks()', () => {
        it('deve retornar array vazio quando não há webhooks', () => {
            const list = agent.listWebhooks();
            assert.ok(Array.isArray(list));
            assert.equal(list.length, 0);
        });

        it('deve listar o webhook recém-registrado', () => {
            const { id } = agent.registerWebhook('http://test-hook.example.com:8080/evt');
            const list = agent.listWebhooks();
            assert.equal(list.length, 1);
            assert.equal(list[0]?.id, id);
            assert.equal(list[0]?.url, 'http://test-hook.example.com:8080/evt');
        });

        it('deve listar múltiplos webhooks', () => {
            agent.registerWebhook('http://a.com');
            agent.registerWebhook('http://b.com');
            agent.registerWebhook('http://c.com');
            assert.equal(agent.listWebhooks().length, 3);
        });

        it('cada item deve ter as propriedades id e url', () => {
            agent.registerWebhook('http://x.com');
            const [item] = agent.listWebhooks();
            assert.ok(item !== undefined);
            assert.ok(Object.hasOwn(item, 'id'));
            assert.ok(Object.hasOwn(item, 'url'));
        });
    });

    // ─── unregisterWebhook ────────────────────────────────────────────────

    describe('unregisterWebhook()', () => {
        it('deve retornar true ao remover webhook existente', () => {
            const { id } = agent.registerWebhook('http://test-hook.example.com/hook');
            const removed = agent.unregisterWebhook(id);
            assert.equal(removed, true);
        });

        it('deve retornar false para id inexistente', () => {
            const removed = agent.unregisterWebhook('wh_nao_existe');
            assert.equal(removed, false);
        });

        it('webhook removido não deve aparecer em listWebhooks', () => {
            const { id } = agent.registerWebhook('http://tmp.com');
            agent.unregisterWebhook(id);
            const list = agent.listWebhooks();
            assert.ok(!list.some((w) => w.id === id), 'webhook removido não deve constar na lista');
        });

        it('deve remover apenas o webhook alvo, outros permanecem', () => {
            const r1 = agent.registerWebhook('http://keep.com');
            const r2 = agent.registerWebhook('http://remove.com');
            agent.unregisterWebhook(r2.id);
            const list = agent.listWebhooks();
            assert.equal(list.length, 1);
            assert.equal(list[0]?.id, r1.id);
        });

        it('remover mesmo id duas vezes retorna false na segunda chamada', () => {
            const { id } = agent.registerWebhook('http://once.com');
            assert.equal(agent.unregisterWebhook(id), true);
            assert.equal(agent.unregisterWebhook(id), false);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// G2-TEST-08/09: Validação SSRF em registerWebhook (G2-SEC-01)
// ─────────────────────────────────────────────────────────────────────────────

describe('AlwaysAliveAgent › webhooks: SSRF protection (G2-SEC-01)', () => {
    /** @type {import('../../../src/copilot/agent/always-alive.js').AlwaysAliveAgent} */
    let agent;

    beforeAll(async () => {
        const { AlwaysAliveAgent } = await import('../../../src/copilot/agent/always-alive.js');
        agent = new AlwaysAliveAgent();
    });

    it('deve bloquear localhost', () => {
        assert.throws(() => agent.registerWebhook('http://localhost/hook'), /loopback|privado|bloqueado/i);
    });

    it('deve bloquear 127.0.0.1', () => {
        assert.throws(() => agent.registerWebhook('http://127.0.0.1/hook'), /loopback|privado|bloqueado/i);
    });

    it('deve bloquear 10.0.0.1 (RFC-1918)', () => {
        assert.throws(() => agent.registerWebhook('http://10.0.0.1/hook'), /loopback|privado|bloqueado/i);
    });

    it('deve bloquear 192.168.1.1 (RFC-1918)', () => {
        assert.throws(() => agent.registerWebhook('http://192.168.1.1/hook'), /loopback|privado|bloqueado/i);
    });

    it('deve bloquear protocolo file://', () => {
        assert.throws(() => agent.registerWebhook('file:///etc/passwd'), /protocolo|inválida/i);
    });

    it('deve bloquear URL inválida', () => {
        assert.throws(() => agent.registerWebhook('not-a-url'), /inválida|invalid/i);
    });

    it('deve aceitar URL pública válida', () => {
        const entry = agent.registerWebhook('https://example.com/hook');
        assert.ok(entry.id.startsWith('wh_'));
        agent.unregisterWebhook(entry.id);
    });
});
