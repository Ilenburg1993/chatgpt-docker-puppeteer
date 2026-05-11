// @ts-check
/**
 * tests/unit/copilot/test_agent_messaging.spec.js
 *
 * F41.3: Testes unitários para agent-messaging.js (F38).
 */

import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { describe, it } from 'vitest';
import { AgentContext } from '../../../src/copilot/agent/agent-context.js';
import {
    answerPendingQuestion,
    enqueueTask,
    processQueue,
    sendMessage,
    sendMessageDialogBoot,
} from '../../../src/copilot/agent/messaging/agent-messaging.js';
import { requestUserInputTool } from '../../../src/copilot/tools/hook/hook-tools.js';

describe('agent-messaging › sendMessage', () => {
    /** @returns {{ ctx: AgentContext; host: EventEmitter & { emit: any } }} */
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
        ctx.messageQueue.drain(new Error('test cleanup'));
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
        ctx.messageQueue.drain(new Error('cleanup'));
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

    it('normaliza timeoutMs invalido como advisory desabilitado', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        enqueueTask(ctx, emitter, 'test', {
            timeoutMs: Number.NaN,
            resolve: () => {},
            reject: () => {},
        });

        const task = ctx.messageQueue.shift();
        assert.equal(task?.timeoutMs, null);
    });

    it('trata timeoutMs positivo finito como advisory não bloqueante', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        enqueueTask(ctx, emitter, 'test', {
            timeoutMs: 1234,
            resolve: () => {},
            reject: () => {},
        });

        const task = ctx.messageQueue.shift();
        assert.equal(task?.timeoutMs, null);
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
            resolve: (/** @type {string} */ v) => {
                resolved = v;
            },
            reject: () => {},
        });

        let answered = false;
        emitter.on('question.answered', () => {
            answered = true;
        });

        const result = answerPendingQuestion(ctx, emitter, 'my answer');

        assert.equal(result, true);
        assert.equal(resolved, 'my answer');
        assert.equal(ctx.pendingQuestion, null);
        assert.ok(answered);
    });

    it('retorna true quando responde request_user_input pendente mesmo sem ask_user vivo', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.pendingQuestion = null;

        const handler = /** @type {(args: { question: string }, context?: unknown) => Promise<any>} */ (
            /** @type {unknown} */ (requestUserInputTool.handler)
        );
        const pending = handler({ question: 'Qual próximo passo?' }, {});

        const result = answerPendingQuestion(ctx, emitter, 'seguir backlog');
        assert.equal(result, true);

        const resolved = await pending;
        assert.equal(resolved.status, 'resolved');
        assert.equal(resolved.answer, 'seguir backlog');
    });
});

describe('agent-messaging › processQueue', () => {
    it('processa a próxima tarefa da fila e resolve a promise', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.status = 'idle';
        ctx.session = /** @type {any} */ ({
            sessionId: 'test-session-id',
            on: () => () => {},
            sendAndWait: async () => ({ data: { content: 'pong' } }),
        });

        /** @type {string | null} */
        let startedTaskId = null;
        emitter.on('task.started', (/** @type {{ taskId?: string }} */ evt) => {
            startedTaskId = evt?.taskId ?? null;
        });

        const resultPromise = sendMessageDialogBoot(ctx, emitter, 'ping');
        processQueue(ctx, emitter, { tryReconnect: async () => false });

        const result = await resultPromise;
        assert.equal(result, 'pong');
        assert.equal(ctx.status, 'idle');
        assert.equal(ctx.sendCount, 1);
        assert.ok(typeof startedTaskId === 'string' && /** @type {string} */ (startedTaskId).startsWith('task-'));
    });

    it('não processa quando o agente não está idle', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.status = 'processing';
        ctx.session = /** @type {any} */ ({
            sessionId: 'test-session-idle',
            on: () => () => {},
            sendAndWait: async () => ({ data: { content: 'pong' } }),
        });
        const resultPromise = sendMessageDialogBoot(ctx, emitter, 'queued-but-not-processed');
        processQueue(ctx, emitter, { tryReconnect: async () => false });

        assert.equal(ctx.messageQueue.size, 1);

        const drained = ctx.messageQueue.drain(new Error('cleanup'));
        assert.equal(drained.length, 1);
        await assert.rejects(() => resultPromise);
    });

    it('não tenta reconectar quando session.error é rate_limit do SDK', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.status = 'idle';
        let sessionHandler = /** @type {((event: any) => void) | null} */ (null);
        ctx.session = /** @type {any} */ ({
            sessionId: 'sess-rate-limit',
            on: (/** @type {string | ((event: any) => void)} */ eventName, /** @type {unknown} */ handler) => {
                if (typeof eventName === 'function') {
                    sessionHandler = eventName;
                    return () => {};
                }
                return () => {};
            },
            send: async () => {
                sessionHandler?.({
                    type: 'session.error',
                    data: {
                        errorType: 'rate_limit',
                        message: 'Sorry, you hit a rate limit',
                    },
                });
            },
        });

        let reconnectCalls = 0;
        const resultPromise = sendMessageDialogBoot(ctx, emitter, 'boot');
        processQueue(ctx, emitter, {
            tryReconnect: async () => {
                reconnectCalls++;
                return true;
            },
        });

        await assert.rejects(() => resultPromise, /rate limit/i);
        assert.equal(reconnectCalls, 0);
        assert.equal(ctx.status, 'idle');
    });
});
