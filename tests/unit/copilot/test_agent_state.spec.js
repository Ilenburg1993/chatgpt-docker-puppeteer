// @ts-check
/**
 * tests/unit/copilot/test_agent_state.spec.js
 *
 * F41.4: Testes unitários para agent-state.js (F39).
 */

import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { describe, it } from 'vitest';
import { AgentContext } from '../../../src/copilot/agent/agent-context.js';
import { getStatusSnapshot, listenerDiagnostics } from '../../../src/copilot/agent/state/agent-state.js';
import { AGENT_EVENTS } from '../../../src/copilot/events/agent-events.js';

describe('agent-state › getStatusSnapshot', () => {
    /**
     * @returns {{
     *     ctx: AgentContext;
     *     host: EventEmitter & { sessionId: string | null; listenerCount: (e: string | symbol) => number };
     * }}
     */
    function setup() {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.status = 'idle';
        const host = Object.assign(emitter, { sessionId: 'test-session-123' });
        return { ctx, host };
    }

    it('retorna snapshot com campos essenciais', () => {
        const { ctx, host } = setup();
        const snap = getStatusSnapshot(ctx, host);

        assert.equal(snap.status, 'idle');
        assert.equal(snap.sessionId, 'test-session-123');
        assert.equal(typeof snap.model, 'string');
        assert.equal(snap.queueSize, 0);
        assert.equal(snap.sendCount, 0);
        assert.equal(snap.isResumed, false);
    });

    it('retorna snapshot cacheado na segunda chamada (TTL)', () => {
        const { ctx, host } = setup();
        const snap1 = getStatusSnapshot(ctx, host);
        const snap2 = getStatusSnapshot(ctx, host);

        assert.strictEqual(snap1, snap2, 'snapshot deve ser cacheado');
        assert.ok(ctx.statusSnapshotCache, 'cache deve existir');
    });

    it('invalida cache quando statusSnapshotCache é zerado', () => {
        const { ctx, host } = setup();
        const snap1 = getStatusSnapshot(ctx, host);
        ctx.statusSnapshotCache = null;
        const snap2 = getStatusSnapshot(ctx, host);

        assert.notStrictEqual(snap1, snap2, 'novo snapshot deve ser gerado');
    });

    it('snapshot reflete mudança de status', () => {
        const { ctx, host } = setup();
        ctx.status = 'processing';
        ctx.statusSnapshotCache = null;
        const snap = getStatusSnapshot(ctx, host);

        assert.equal(snap.status, 'processing');
    });
});

describe('agent-state › listenerDiagnostics', () => {
    it('retorna contagem de listeners para cada AGENT_EVENT', () => {
        const emitter = new EventEmitter();
        const host = Object.assign(emitter, { sessionId: null });

        // Adicionar listeners em alguns eventos
        emitter.on('status', () => {});
        emitter.on('status', () => {});

        const diag = listenerDiagnostics(host);

        assert.ok(typeof diag === 'object', 'deve retornar objeto');
        // Verificar que todos os eventos estão presentes
        for (const evt of AGENT_EVENTS) {
            assert.ok(evt in diag, `evento '${evt}' deve estar no diagnóstico`);
            assert.ok(typeof diag[evt] === 'number', `contagem de '${evt}' deve ser número`);
        }
        assert.equal(diag['status'], 2, 'status deve ter 2 listeners');
    });

    it('retorna 0 para eventos sem listeners', () => {
        const emitter = new EventEmitter();
        const host = Object.assign(emitter, { sessionId: null });

        const diag = listenerDiagnostics(host);
        for (const evt of AGENT_EVENTS) {
            if (evt !== 'status') {
                assert.equal(diag[evt], 0, `${evt} deve ter 0 listeners`);
            }
        }
    });
});
