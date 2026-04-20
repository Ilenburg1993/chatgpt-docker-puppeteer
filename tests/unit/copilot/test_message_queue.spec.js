// @ts-check
/**
 * tests/unit/copilot/test_message_queue.spec.js
 *
 * Testes unitários para src/copilot/agent/message-queue.js.
 *
 * Cobre:
 *
 * - G2-TEST-12: enqueue() com AbortSignal já abortado → rejeita imediatamente
 * - G2-TEST-13: drain() com múltiplas tarefas → todas rejeitadas com erro de shutdown
 * - enqueue() com sinal abortado após enqueue → remove da fila e rejeita
 * - enqueue() com fila cheia → lança SessionError QUEUE_FULL
 * - unshift() reinsere no início da fila
 * - shift() retorna e remove o primeiro item
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { MessageQueue } from '../../../src/copilot/agent/infra/message-queue.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _taskSeq = 0;

/**
 * Cria uma AgentTask mock com resolve/reject rastreáveis.
 *
 * @param {object} [overrides]
 * @returns {{
 *     task: import('../../../src/copilot/agent/infra/message-queue.js').AgentTask;
 *     resolved: { value: string | null };
 *     rejected: { error: Error | null };
 * }}
 */
function makeTask(overrides = {}) {
    /** @type {{ value: string | null }} */
    const resolved = { value: null };
    /** @type {{ error: Error | null }} */
    const rejected = { error: null };
    const task = /** @type {any} */ ({
        id: `task-${++_taskSeq}`,
        message: 'test message',
        enqueuedAt: Date.now(),
        resolve: (/** @type {string} */ v) => {
            resolved.value = v;
        },
        reject: (/** @type {Error} */ e) => {
            rejected.error = e;
        },
        ...overrides,
    });
    return { task, resolved, rejected };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MessageQueue', () => {
    // ---------------------------------------------------------------------------
    // G2-TEST-12: enqueue() com sinal já abortado
    // ---------------------------------------------------------------------------
    describe('enqueue() com AbortSignal já abortado (G2-TEST-12)', () => {
        it('rejeita imediatamente com AbortError e não adiciona à fila', () => {
            const q = new MessageQueue();
            const controller = new AbortController();
            controller.abort();

            const { task, rejected } = makeTask();
            q.enqueue(task, { signal: controller.signal });

            assert.equal(q.size, 0, 'fila deve estar vazia');
            assert.ok(rejected.error, 'tarefa deve ter sido rejeitada');
            assert.equal(rejected.error?.name, 'AbortError');
        });
    });

    // ---------------------------------------------------------------------------
    // AbortSignal abortado após enqueue
    // ---------------------------------------------------------------------------
    describe('enqueue() com sinal abortado após enqueue', () => {
        it('remove da fila e rejeita quando o sinal é disparado', () => {
            const q = new MessageQueue();
            const controller = new AbortController();

            const { task, rejected } = makeTask();
            q.enqueue(task, { signal: controller.signal });
            assert.equal(q.size, 1, 'tarefa deve estar na fila');

            controller.abort();

            assert.equal(q.size, 0, 'tarefa deve ter sido removida');
            assert.ok(rejected.error, 'tarefa deve ter sido rejeitada');
            assert.equal(rejected.error?.name, 'AbortError');
        });
    });

    // ---------------------------------------------------------------------------
    // G2-TEST-13: drain() com múltiplas tarefas
    // ---------------------------------------------------------------------------
    describe('drain() com múltiplas tarefas (G2-TEST-13)', () => {
        it('drena e rejeita todas as tarefas pendentes com o erro fornecido', () => {
            const q = new MessageQueue();
            const tasks = [makeTask(), makeTask(), makeTask()];

            for (const { task } of tasks) {
                q.enqueue(task);
            }
            assert.equal(q.size, 3);

            const shutdownError = new Error('Agente parado durante shutdown.');
            const drained = q.drain(shutdownError);

            assert.equal(drained.length, 3, 'drain deve retornar todas as tarefas');
            assert.equal(q.size, 0, 'fila deve estar vazia após drain');

            for (const { rejected } of tasks) {
                assert.ok(rejected.error, 'cada tarefa deve ter sido rejeitada');
                assert.ok(rejected.error?.message.includes('Agente parado'));
            }
        });

        it('drain() com fila vazia retorna array vazio', () => {
            const q = new MessageQueue();
            const drained = q.drain(new Error('shutdown'));
            assert.equal(drained.length, 0);
        });
    });

    // ---------------------------------------------------------------------------
    // shift() e unshift()
    // ---------------------------------------------------------------------------
    describe('shift() e unshift()', () => {
        it('shift() retorna o primeiro item e reduz o tamanho', () => {
            const q = new MessageQueue();
            const { task: t1 } = makeTask({ message: 'first' });
            const { task: t2 } = makeTask({ message: 'second' });
            q.enqueue(t1);
            q.enqueue(t2);

            const shifted = q.shift();
            assert.equal(shifted?.message, 'first');
            assert.equal(q.size, 1);
        });

        it('shift() em fila vazia retorna undefined', () => {
            const q = new MessageQueue();
            assert.equal(q.shift(), undefined);
        });

        it('unshift() reinsere no início da fila', () => {
            const q = new MessageQueue();
            const { task: t1 } = makeTask({ message: 'original' });
            const { task: t2 } = makeTask({ message: 'reinserted' });
            q.enqueue(t1);
            q.unshift(t2);

            const first = q.shift();
            assert.equal(first?.message, 'reinserted');
        });
    });

    // ---------------------------------------------------------------------------
    // onEnqueue callback
    // ---------------------------------------------------------------------------
    describe('callbacks', () => {
        it('onEnqueue é chamado ao enfileirar', () => {
            let called = 0;
            const q = new MessageQueue({ onEnqueue: () => called++ });
            const { task } = makeTask();
            q.enqueue(task);
            assert.equal(called, 1);
        });

        it('onChanged é chamado ao enfileirar e ao remover', () => {
            let changed = 0;
            const q = new MessageQueue({ onChanged: () => changed++ });
            const { task } = makeTask();
            q.enqueue(task);
            assert.equal(changed, 1, 'enqueue deve disparar onChanged');
            q.shift();
            assert.equal(changed, 2, 'shift deve disparar onChanged');
        });
    });

    // ---------------------------------------------------------------------------
    // FIFO order
    // ---------------------------------------------------------------------------
    describe('FIFO', () => {
        it('enqueue + shift mantém ordem FIFO', () => {
            const q = new MessageQueue();
            const { task: t1 } = makeTask({ message: 'first' });
            const { task: t2 } = makeTask({ message: 'second' });
            const { task: t3 } = makeTask({ message: 'third' });
            q.enqueue(t1);
            q.enqueue(t2);
            q.enqueue(t3);
            assert.equal(q.shift()?.message, 'first');
            assert.equal(q.shift()?.message, 'second');
            assert.equal(q.shift()?.message, 'third');
        });

        it('size reflete o número de itens na fila', () => {
            const q = new MessageQueue();
            assert.equal(q.size, 0);
            const { task } = makeTask();
            q.enqueue(task);
            assert.equal(q.size, 1);
            q.shift();
            assert.equal(q.size, 0);
        });
    });

    // ---------------------------------------------------------------------------
    // MAX_QUEUE_SIZE
    // ---------------------------------------------------------------------------
    describe('MAX_QUEUE_SIZE', () => {
        it('lança QUEUE_FULL ao exceder limite', () => {
            const q = new MessageQueue();
            // MAX_QUEUE_SIZE default from env.js; enqueue até estourar
            let thrown = false;
            for (let i = 0; i < 200; i++) {
                try {
                    const { task } = makeTask();
                    q.enqueue(task);
                } catch (/** @type {any} */ err) {
                    assert.equal(err.code, 'QUEUE_FULL');
                    thrown = true;
                    break;
                }
            }
            assert.ok(thrown, 'deveria ter lançado QUEUE_FULL');
        });
    });
});
