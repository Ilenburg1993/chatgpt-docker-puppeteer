// @ts-check
/**
 * tests/unit/copilot/test_agent_messaging.spec.js
 *
 * F41.3: Testes unitários para agent-messaging.js (F38).
 */

import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { AgentContext } from '../../../src/copilot/agent/agent-context.js';
import { sendMessage, sendMessageDialogBoot, enqueueTask, answerPendingQuestion } from '../../../src/copilot/agent/messaging/agent-messaging.js';

describe('agent-messaging › sendMessage', () => {
    /** @returns {{ ctx: AgentContext, host: EventEmitter & { emit: any } }} */
    function setup() {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.status = 'idle';
        return { ctx, host: emitter };
    }

    it('rejeita quando signal já está aborted', async () => {
        const { ctx, host } = setup();
        const ac = new AbortController();
        ac.abort();

        await assert.rejects(
            () => sendMessage(ctx, host, 'hello', { signal: ac.signal }),
            (/** @type {any} */ err) => err.name === 'AbortError',
        );
    });

    it('rejeita quando dialog loop está ativo', async () => {
        const { ctx, host } = setup();
        // Simular dialog loop ativo
        Object.defineProperty(ctx.dialogLoop, 'active', { get: () => true });

        await assert.rejects(
            () => sendMessage(ctx, host, 'hello'),
            (/** @type {any} */ err) => err.code === 'DIALOG_ACTIVE',
        );
    });

    it('enfileira task normalmente quando condições são atendidas', () => {
        const { ctx, host } = setup();
        const events = /** @type {string[]} */ ([]);
        host.on('task.queued', () => events.push('task.queued'));

        // sendMessage retorna uma promise que só resolve quando task é processada
        const promise = sendMessage(ctx, host, 'test msg');
        promise.catch(() => {}); // ignore unhandled rejection

        assert.equal(ctx.messageQueue.size, 1, 'messageQueue deve ter 1 task');
        assert.ok(events.includes('task.queued'), 'task.queued deve ser emitido');

        // Cleanup
        ctx.messageQueue.drain().forEach((t) => t.reject(new Error('test cleanup')));
    });
});

describe('agent-messaging › sendMessageDialogBoot', () => {
    it('enfileira sem guard de dialog loop ativo', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        Object.defineProperty(ctx.dialogLoop, 'active', { get: () => true });

        const events = /** @type {string[]} */ ([]);
        emitter.on('task.queued', () => events.push('task.queued'));

        // sendMessageDialogBoot NÃO verifica dialog loop
        const promise = sendMessageDialogBoot(ctx, emitter, 'boot message');

        assert.equal(ctx.messageQueue.size, 1);
        assert.ok(events.includes('task.queued'));

        // Cleanup
        ctx.messageQueue.drain().forEach((t) => t.reject(new Error('cleanup')));
        promise.catch(() => {}); // ignore rejection
    });
});

describe('agent-messaging › enqueueTask', () => {
    it('emite task.queued e enfileira', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        let taskId = '';
        emitter.on('task.queued', (/** @type {any} */ data) => {
            taskId = data.taskId;
        });

        enqueueTask(ctx, emitter, 'test', {
            resolve: () => {},
            reject: () => {},
        });

        assert.equal(ctx.messageQueue.size, 1);
        assert.ok(taskId.startsWith('task-'));
    });
});

describe('agent-messaging › answerPendingQuestion', () => {
    it('retorna false quando não há pergunta pendente', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.pendingQuestion = null;

        const result = answerPendingQuestion(ctx, emitter, 'answer');
        assert.equal(result, false);
    });

    it('resolve pergunta pendente e emite question.answered', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        let resolved = '';
        ctx.pendingQuestion = /** @type {any} */ ({
            resolve: (/** @type {string} */ v) => { resolved = v; },
            reject: () => {},
        });

        let answered = false;
        emitter.on('question.answered', () => { answered = true; });

        const result = answerPendingQuestion(ctx, emitter, 'my answer');

        assert.equal(result, true);
        assert.equal(resolved, 'my answer');
        assert.equal(ctx.pendingQuestion, null);
        assert.ok(answered);
    });
});
