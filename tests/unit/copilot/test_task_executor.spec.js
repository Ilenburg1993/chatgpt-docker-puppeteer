// @ts-check
/**
 * tests/unit/copilot/test_task_executor.spec.js
 *
 * Testes unitários comportamentais para a execução por tarefa do agente.
 *
 * O caminho legado `infra/task-executor.js` é preservado como shim de compatibilidade; a implementação canônica mora em
 * `agent/messaging/agent-messaging.js`.
 *
 * Cobre (G1-DX-01):
 *
 * - execução de task bem-sucedida
 * - AbortError não aciona tryReconnect (G1-BUG-03)
 * - erro de sessão + reconexão bem-sucedida renenfileira task
 * - erro de sessão + reconexão falha rejeita task
 * - max retries atingido após reconexões repetidas
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { executeTask } from '../../../src/copilot/agent/infra/task-executor.js';
import { executeTask as executeTaskCanonical } from '../../../src/copilot/agent/messaging/agent-messaging.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Cria uma task mock com resolve/reject controláveis.
 *
 * @param {object} [overrides]
 * @returns {import('../../../src/copilot/agent/messaging/agent-messaging.js').QueuedTask & { promise: Promise<any> }}
 */
function makeTask(overrides = {}) {
    /** @type {(v: any) => void} */
    let resolve = /** @type {any} */ (undefined);
    /** @type {(e: any) => void} */
    let reject = /** @type {any} */ (undefined);
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    /** @type {any} */
    const task = {
        id: 'task-test-001',
        message: 'Olá, agente!',
        enqueuedAt: Date.now(),
        resolve,
        reject,
        promise,
        ...overrides,
    };
    return task;
}

/**
 * Cria uma sessão mock que emite eventos básicos de ferramenta.
 *
 * @param {{ onSendAndWait?: (opts: any, timeout: number) => any }} [opts]
 */
function makeSession(opts = {}) {
    /** @type {Map<string, Function[]>} */
    const listeners = new Map();
    return {
        /** @param {string} event @param {Function} fn @returns {() => void} */
        on(event, fn) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)?.push(fn);
            // Retorna função de unsubscribe (necessário para task-executor.js)
            return () => this.off(event, fn);
        },
        /** @param {string} event @param {Function} fn */
        off(event, fn) {
            const arr = listeners.get(event);
            if (arr) {
                const idx = arr.indexOf(fn);
                if (idx !== -1) arr.splice(idx, 1);
            }
        },
        /** @param {string} event @param {any[]} args */
        emit(event, ...args) {
            listeners.get(event)?.forEach((fn) => fn(...args));
        },
        /** @param {any} _opts @param {number} _timeout */
        async sendAndWait(_opts, _timeout) {
            if (opts.onSendAndWait) return opts.onSendAndWait(_opts, _timeout);
            return { data: { content: 'Resposta mock do agente.' } };
        },
    };
}

/**
 * Invoca o executor canônico tratando a sessão mock como compatível para fins de teste.
 *
 * @param {ReturnType<typeof makeSession>} session
 * @param {ReturnType<typeof makeTask>} task
 * @param {ReturnType<typeof makeCallbacks> | Record<string, unknown>} callbacks
 * @returns {Promise<void>}
 */
function runExecuteTask(session, task, callbacks) {
    return executeTask(/** @type {any} */ (session), /** @type {any} */ (task), /** @type {any} */ (callbacks));
}

/**
 * Cria callbacks padrão para executeTask.
 *
 * Retorna objeto com campos extra (_statuses, _events) para inspeção nos testes.
 *
 * @param {object} [overrides]
 * @returns {import('../../../src/copilot/agent/messaging/agent-messaging.js').TaskExecutorCallbacks & {
 *     _statuses: string[];
 *     _events: [string, any][];
 * }}
 */
function makeCallbacks(overrides = {}) {
    const statuses = /** @type {string[]} */ ([]);
    const events = /** @type {[string, any][]} */ ([]);
    /** @type {any} */
    const cbs = {
        onDelta: (/** @type {string} */ _delta) => {},
        setStatus: (/** @type {string} */ s) => statuses.push(s),
        emit: (/** @type {string} */ e, /** @type {any} */ p) => events.push([e, p]),
        tryReconnect: async (/** @type {Error} */ _e) => false,
        scheduleNext: () => {},
        requeueTask: (/** @type {any} */ _t) => {},
        _statuses: statuses,
        _events: events,
        ...overrides,
    };
    return cbs;
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('task-executor › compat shim', () => {
    it('mantém o mesmo símbolo exportado pelo caminho canônico de messaging', () => {
        assert.strictEqual(executeTask, executeTaskCanonical);
    });
});

describe('task-executor › execução bem-sucedida', () => {
    it('deve resolver a task com o conteúdo da resposta do SDK', async () => {
        const task = makeTask();
        const session = makeSession({
            onSendAndWait: async () => ({ data: { content: 'Resposta correta.' } }),
        });
        const cbs = makeCallbacks();

        void runExecuteTask(session, task, cbs);
        const result = await task.promise;

        assert.strictEqual(result, 'Resposta correta.');
    });

    it('deve chamar setStatus("idle") após task bem-sucedida', async () => {
        const task = makeTask();
        const session = makeSession();
        const cbs = makeCallbacks();

        void runExecuteTask(session, task, cbs);
        await task.promise;

        assert.ok(
            cbs._statuses.includes('idle'),
            `setStatus('idle') deve ter sido chamado. Statuses: ${JSON.stringify(cbs._statuses)}`,
        );
    });

    it('deve emitir task.completed com o taskId correto', async () => {
        const task = makeTask({ id: 'task-abc-123' });
        const session = makeSession();
        const cbs = makeCallbacks();

        void runExecuteTask(session, task, cbs);
        await task.promise;

        const completed = cbs._events.find(([e]) => e === 'task.completed');
        assert.ok(completed, 'task.completed deve ser emitido');
        assert.strictEqual(completed[1].taskId, 'task-abc-123');
    });

    it('deve chamar scheduleNext após task bem-sucedida', async () => {
        const task = makeTask();
        const session = makeSession();
        const wrapper = { did: false };
        const cbs = makeCallbacks();
        // scheduleNext deve ser substituído antes de executeTask o desestruturar.
        const cbs2 = {
            ...cbs,
            scheduleNext: () => {
                wrapper.did = true;
            },
        };

        void runExecuteTask(session, task, cbs2);
        await task.promise;

        assert.ok(wrapper.did, 'scheduleNext deve ter sido chamado');
    });
});

describe('task-executor › AbortError não aciona reconexão (G1-BUG-03)', () => {
    it('deve rejeitar a task imediatamente sem chamar tryReconnect', async () => {
        const task = makeTask();
        const session = makeSession({
            onSendAndWait: async () => {
                throw new DOMException('Operação abortada', 'AbortError');
            },
        });
        let tryReconnectCalled = false;
        const cbs = makeCallbacks({
            tryReconnect: async () => {
                tryReconnectCalled = true;
                return false;
            },
        });

        void runExecuteTask(session, task, cbs);
        await assert.rejects(task.promise, (err) => {
            assert.ok(err instanceof DOMException);
            assert.strictEqual(err.name, 'AbortError');
            return true;
        });

        assert.strictEqual(tryReconnectCalled, false, 'tryReconnect NÃO deve ser chamado para AbortError');
    });

    it('deve emitir task.error com mensagem "AbortError" após AbortError', async () => {
        const task = makeTask();
        const session = makeSession({
            onSendAndWait: async () => {
                throw new DOMException('abort', 'AbortError');
            },
        });
        const cbs = makeCallbacks();

        void runExecuteTask(session, task, cbs);
        await task.promise.catch(() => {});

        const errorEvent = cbs._events.find(([e]) => e === 'task.error');
        assert.ok(errorEvent, 'task.error deve ser emitido');
        assert.strictEqual(errorEvent[1].error, 'AbortError');
    });
});

describe('task-executor › erro fatal não aciona reconexão (K3)', () => {
    it('deve rejeitar imediatamente quando o erro já é classificado como fatal', async () => {
        const task = makeTask();
        const fatalErr = Object.assign(new Error('sessão fatal'), { code: 'SESSION_FATAL' });
        const session = makeSession({
            onSendAndWait: async () => {
                throw fatalErr;
            },
        });
        let tryReconnectCalled = false;
        const cbs = makeCallbacks({
            tryReconnect: async () => {
                tryReconnectCalled = true;
                return false;
            },
        });

        void runExecuteTask(session, task, cbs);
        await assert.rejects(task.promise, /sessão fatal/);

        assert.strictEqual(tryReconnectCalled, false, 'tryReconnect não deve ser chamado para erro fatal');
    });
});

describe('task-executor › erro de sessão + reconexão', () => {
    it('deve reenfileirar task quando tryReconnect retorna true', async () => {
        const task = makeTask();
        const session = makeSession({
            onSendAndWait: async () => {
                throw new Error('Conexão perdida');
            },
        });
        let requeued = false;
        const cbs = makeCallbacks({
            tryReconnect: async () => true,
            requeueTask: () => {
                requeued = true;
                task.resolve('requeued');
            },
        });

        void runExecuteTask(session, task, cbs);
        const result = await task.promise;

        assert.ok(requeued, 'requeueTask deve ter sido chamado');
        assert.strictEqual(result, 'requeued');
    });

    it('deve rejeitar task quando tryReconnect retorna false', async () => {
        const task = makeTask();
        const session = makeSession({
            onSendAndWait: async () => {
                throw new Error('Falha permanente de rede');
            },
        });
        const cbs = makeCallbacks({ tryReconnect: async () => false });

        void runExecuteTask(session, task, cbs);
        await assert.rejects(task.promise, /Falha permanente de rede/);
    });

    it('deve emitir task.error quando tryReconnect retorna false', async () => {
        const task = makeTask({ id: 'err-task-789' });
        const session = makeSession({
            onSendAndWait: async () => {
                throw new Error('timeout na rede');
            },
        });
        const cbs = makeCallbacks({ tryReconnect: async () => false });

        void runExecuteTask(session, task, cbs);
        await task.promise.catch(() => {});

        const errorEvent = cbs._events.find(([e]) => e === 'task.error');
        assert.ok(errorEvent, 'task.error deve ser emitido');
        assert.strictEqual(errorEvent[1].taskId, 'err-task-789');
    });
});

describe('task-executor › max retries atingido', () => {
    it('deve rejeitar task após atingir MAX_TASK_RETRIES tentativas', async () => {
        const task = makeTask({ attempts: 2 }); // já com 2 tentativas
        const session = makeSession({
            onSendAndWait: async () => {
                throw new Error('falha repetida');
            },
        });
        const cbs = makeCallbacks({
            tryReconnect: async () => true, // reconexão sempre OK mas max retries atingido
        });

        void runExecuteTask(session, task, cbs);
        await assert.rejects(task.promise, /Máximo de 3 tentativas atingido/);
    });

    it('deve emitir task.error ao atingir max retries', async () => {
        const task = makeTask({ attempts: 2 });
        const session = makeSession({
            onSendAndWait: async () => {
                throw new Error('err');
            },
        });
        const cbs = makeCallbacks({ tryReconnect: async () => true });

        void runExecuteTask(session, task, cbs);
        await task.promise.catch(() => {});

        const errorEvent = cbs._events.find(([e]) => e === 'task.error');
        assert.ok(errorEvent, 'task.error deve ser emitido ao atingir max retries');
        assert.ok(
            errorEvent[1].error.includes('tentativas'),
            `Mensagem de erro deve mencionar tentativas: "${errorEvent[1].error}"`,
        );
    });
});

describe('task-executor › cleanup de listeners', () => {
    it('deve chamar scheduleNext mesmo quando task falha', async () => {
        const task = makeTask();
        const session = makeSession({
            onSendAndWait: async () => {
                throw new Error('falha');
            },
        });
        const wrapper = { did: false };
        const cbs = {
            ...makeCallbacks(),
            tryReconnect: async () => false,
            scheduleNext: () => {
                wrapper.did = true;
            },
        };

        void runExecuteTask(session, task, cbs);
        await task.promise.catch(() => {});

        assert.ok(wrapper.did, 'scheduleNext deve ser chamado mesmo em caso de erro (finally)');
    });
});
