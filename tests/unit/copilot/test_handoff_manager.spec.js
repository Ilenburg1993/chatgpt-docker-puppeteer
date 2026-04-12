// @ts-check
/**
 * tests/unit/copilot/test_handoff_manager.spec.js
 *
 * Testes unitários para F45.2: HandoffManager — gerenciamento de handoffs de sessão.
 */

import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

describe('HandoffManager', async () => {
    /** @type {typeof import('#copilot/agent/infra/handoff-manager').HandoffManager} */
    let HandoffManager;

    before(async () => {
        ({ HandoffManager } = await import('#copilot/agent/infra/handoff-manager'));
    });

    describe('receive()', () => {
        it('deve registrar um handoff e retornar HandoffRequest', () => {
            const mgr = new HandoffManager();
            const request = mgr.receive({ fromAgent: 'agent-a', toAgent: 'agent-b', reason: 'test' });
            assert.ok(request.id.startsWith('handoff-'));
            assert.equal(request.fromAgent, 'agent-a');
            assert.equal(request.toAgent, 'agent-b');
            assert.equal(request.reason, 'test');
            assert.equal(request.status, 'pending');
            assert.ok(request.receivedAt > 0);
        });

        it('deve emitir evento handoff.received', () => {
            const mgr = new HandoffManager();
            let received = false;
            mgr.on('handoff.received', () => {
                received = true;
            });
            mgr.receive({ fromAgent: 'a' });
            assert.ok(received);
        });

        it('deve usar defaults quando campos não informados', () => {
            const mgr = new HandoffManager();
            const request = mgr.receive({});
            assert.equal(request.fromAgent, 'unknown');
            assert.equal(request.toAgent, 'self');
        });
    });

    describe('accept()', () => {
        it('deve aceitar handoff pendente', () => {
            const mgr = new HandoffManager();
            const req = mgr.receive({ fromAgent: 'a' });
            const result = mgr.accept(req.id);
            assert.equal(result.accepted, true);
            assert.ok(result.completedAt > 0);
        });

        it('deve retornar erro para handoff inexistente', () => {
            const mgr = new HandoffManager();
            const result = mgr.accept('fake-id');
            assert.equal(result.accepted, false);
            assert.ok(result.error?.includes('não encontrado'));
        });

        it('deve emitir evento handoff.accepted', () => {
            const mgr = new HandoffManager();
            let accepted = false;
            mgr.on('handoff.accepted', () => {
                accepted = true;
            });
            const req = mgr.receive({ fromAgent: 'a' });
            mgr.accept(req.id);
            assert.ok(accepted);
        });

        it('deve mover da lista de pending para histórico', () => {
            const mgr = new HandoffManager();
            const req = mgr.receive({ fromAgent: 'a' });
            assert.equal(mgr.getPending().length, 1);
            mgr.accept(req.id);
            assert.equal(mgr.getPending().length, 0);
            assert.equal(mgr.getHistory().length, 1);
        });
    });

    describe('reject()', () => {
        it('deve rejeitar handoff pendente', () => {
            const mgr = new HandoffManager();
            const req = mgr.receive({ fromAgent: 'a' });
            const result = mgr.reject(req.id, 'não quero');
            assert.equal(result.accepted, false);
        });

        it('deve emitir evento handoff.rejected', () => {
            const mgr = new HandoffManager();
            let rejected = false;
            mgr.on('handoff.rejected', () => {
                rejected = true;
            });
            const req = mgr.receive({ fromAgent: 'a' });
            mgr.reject(req.id);
            assert.ok(rejected);
        });
    });

    describe('getPending() / getHistory()', () => {
        it('deve listar handoffs pendentes', () => {
            const mgr = new HandoffManager();
            mgr.receive({ fromAgent: 'a' });
            mgr.receive({ fromAgent: 'b' });
            assert.equal(mgr.getPending().length, 2);
        });

        it('deve retornar cópias (não referências)', () => {
            const mgr = new HandoffManager();
            mgr.receive({ fromAgent: 'a' });
            const pending1 = mgr.getPending();
            const pending2 = mgr.getPending();
            assert.notEqual(pending1, pending2);
        });

        it('deve limitar histórico ao maxHistory', () => {
            const mgr = new HandoffManager({ maxHistory: 3 });
            for (let i = 0; i < 5; i++) {
                const req = mgr.receive({ fromAgent: `agent-${i}` });
                mgr.accept(req.id);
            }
            assert.equal(mgr.getHistory().length, 3);
        });
    });
});
