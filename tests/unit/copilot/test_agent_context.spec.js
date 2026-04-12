// @ts-check
/**
 * tests/unit/copilot/test_agent_context.spec.js
 *
 * F41.1: Testes unitários para AgentContext (F35).
 */

import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { describe, it } from 'node:test';
import { AgentContext } from '../../../src/copilot/agent/agent-context.js';

describe('AgentContext', () => {
    it('construção com defaults popula campos essenciais', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        assert.equal(ctx.status, 'stopped');
        assert.equal(ctx.client, null);
        assert.equal(ctx.session, null);
        assert.equal(ctx.isReconnecting, false);
        assert.equal(ctx.isResumed, false);
        assert.equal(ctx.sendCount, 0);
        assert.equal(ctx.pendingQuestion, null);
        assert.equal(ctx.statusSnapshotCache, null);
        assert.equal(ctx.lastPrInfo, null);
        assert.equal(ctx.contextState, null);
        assert.equal(ctx.lastCheckpointPath, null);
        assert.equal(ctx.metricsTimer, null);
        assert.equal(ctx.mcpReconnectCancel, null);
        assert.equal(ctx.dialogLoopAttached, false);
        assert.equal(ctx.agentObserver, null);
        assert.ok(typeof ctx.model === 'string', 'model deve ser string');
    });

    it('construção com options.model personaliza modelo', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter, { model: 'gpt-4.1' });

        assert.equal(ctx.model, 'gpt-4.1');
    });

    it('construção com options.reasoningEffort personaliza reasoning', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter, { reasoningEffort: 'high' });

        assert.equal(ctx.reasoningEffort, 'high');
    });

    it('managers são instanciados automaticamente', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        assert.ok(ctx.dialogLoop, 'dialogLoop deve existir');
        assert.ok(ctx.messageQueue, 'messageQueue deve existir');
        assert.ok(ctx.webhooks, 'webhooks deve existir');
        assert.ok(ctx.permissions, 'permissions deve existir');
        assert.ok(ctx.toolsRegistry, 'toolsRegistry deve existir');
        assert.ok(ctx.keepalive, 'keepalive deve existir');
        assert.ok(ctx.handoff, 'handoff deve existir');
        assert.ok(ctx.messagesCache, 'messagesCache deve existir');
    });

    it('messageQueue.onEnqueue emite __processQueue no emitter', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        let emitted = false;
        emitter.on('__processQueue', () => {
            emitted = true;
        });

        // Enqueue dispara onEnqueue callback
        const task = {
            id: 'test-1',
            message: 'hello',
            resolve: () => {},
            reject: () => {},
            enqueuedAt: Date.now(),
        };
        ctx.messageQueue.enqueue(task);
        assert.ok(emitted, '__processQueue deve ser emitido quando task é enfileirada');
    });

    it('messageQueue.onChanged invalida statusSnapshotCache', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        // Simular cache existente
        ctx.statusSnapshotCache = /** @type {any} */ ({ snapshot: {}, at: Date.now() });
        assert.ok(ctx.statusSnapshotCache !== null);

        // Enqueue muda o estado da fila → onChanged deve invalidar cache
        const task = {
            id: 'test-2',
            message: 'hello',
            resolve: () => {},
            reject: () => {},
            enqueuedAt: Date.now(),
        };
        ctx.messageQueue.enqueue(task);
        assert.equal(ctx.statusSnapshotCache, null, 'statusSnapshotCache deve ser invalidado após enqueue');
    });

    it('setStatus muda status, invalida cache e emite evento', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        ctx.statusSnapshotCache = /** @type {any} */ ({ snapshot: {}, at: Date.now() });

        let emittedStatus = '';
        emitter.on('status', (s) => {
            emittedStatus = s;
        });

        ctx.setStatus('idle', emitter);

        assert.equal(ctx.status, 'idle');
        assert.equal(ctx.statusSnapshotCache, null);
        assert.equal(emittedStatus, 'idle');
    });
});
