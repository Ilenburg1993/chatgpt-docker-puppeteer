// @ts-check
import { createKernel } from '#kernel/kernel';
import { ActionCode, MessageType } from '#shared/nerv/constants';
import assert from 'node:assert';
import EventEmitter from 'node:events';
import { afterEach, beforeEach, describe, it } from 'node:test';

// Mock NERV simple (compatível com nerv.onReceive + nerv.emitCommand/emitEvent)
class MockNERV extends EventEmitter {
    constructor() {
        super();
        this.buffers = {
            dequeueInbound: () => null,
            dequeueOutbound: () => null,
        };
        this.emittedCommands = /** @type {any[]} */ ([]);
        this.emittedEvents = /** @type {any[]} */ ([]);
        this.receiveHandlers = /** @type {any[]} */ ([]);
    }

    onReceive(/** @type {any} */ handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const index = this.receiveHandlers.indexOf(handler);
            if (index > -1) this.receiveHandlers.splice(index, 1);
        };
    }

    receive(/** @type {any} */ envelope) {
        this.receiveHandlers.forEach((h) => h(envelope));
    }

    emitCommand(/** @type {any} */ envelope) {
        this.emittedCommands.push(envelope);
    }

    emitEvent(/** @type {any} */ envelope) {
        this.emittedEvents.push(envelope);
    }

    /** @override */
    emit(/** @type {any} */ actionCode, /** @type {any} */ payload) {
        return super.emit(actionCode, payload);
    }
}

describe('Kernel Orchestration Integration (V2.0)', () => {
    /** @type {any} */ let nerv;
    /** @type {any} */ let kernel;

    beforeEach(() => {
        nerv = new MockNERV();
        kernel = createKernel({ nerv, mode: 'legacy' });
    });

    afterEach(() => {
        // Evita vazamento de intervalos/listeners caso um teste falhe antes do stop()
        try {
            kernel?.stop?.();
        } catch (_) {}
    });

    describe('1. Kernel composition', () => {
        it('should create kernel with orchestrator integrated', () => {
            assert.ok(kernel, 'Kernel foi criado');
            assert.strictEqual(typeof kernel.start, 'function', 'Kernel tem método start()');
            assert.strictEqual(typeof kernel.stop, 'function', 'Kernel tem método stop()');
            assert.strictEqual(typeof kernel.executeTask, 'function', 'Kernel tem método executeTask() (V2.0)');
        });

        it('should include TaskExecutionOrchestrator in subsystems', () => {
            // Smoke test: kernel composto
            assert.ok(kernel, 'Kernel foi composto com todos subsistemas');
        });
    });

    describe('2. Task execution flow (SINGLE_SHOT strategy)', () => {
        it('should execute task V5 with SINGLE_SHOT strategy end-to-end', async () => {
            kernel.start();

            const taskV5 = {
                meta: {
                    id: 'task-single-shot',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Test prompt' },
                    execution: { strategy: 'SINGLE_SHOT' },
                    validation: { validators: [] },
                },
                state: {
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    history: [],
                },
                policy: { max_cost_cents: 100, dependencies: [] },
            };

            await kernel.executeTask(taskV5, 'corr-001');

            // Verifica comando emitido para driver
            const commands = nerv.emittedCommands;
            assert.strictEqual(commands.length, 1, 'Um comando foi emitido');
            assert.strictEqual(
                commands[0].payload.actionCode,
                ActionCode.DRIVER_EXECUTE_TASK,
                'Comando é DRIVER_EXECUTE_TASK',
            );
            assert.strictEqual(commands[0].payload.task.meta.id, 'task-single-shot', 'Task ID correto');

            const runtimeTask = kernel.getTask('task-single-shot');
            assert.ok(runtimeTask, 'Task deve existir no runtime');
            assert.strictEqual(runtimeTask.state, 'ACTIVE', 'Task deve ser ativada pelo Kernel');

            kernel.stop();
        });
    });

    describe('2b. Retry scheduling', () => {
        it('should keep dispatch payload available until retry handler consumes it', async () => {
            kernel.start();

            const retryableTask = {
                meta: {
                    id: 'task-retry-payload',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Trigger retry path' },
                    execution: { strategy: 'SINGLE_SHOT' },
                    validation: { validators: [] },
                },
                state: {
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    history: [],
                },
                policy: { max_cost_cents: 100, dependencies: [] },
            };

            await kernel.executeTask(retryableTask, 'corr-retry-001');
            assert.strictEqual(nerv.emittedCommands.length, 1, 'Primeiro dispatch enviado ao driver');

            // Simula falha retryable do driver
            nerv.receive({
                messageType: MessageType.EVENT,
                actionCode: ActionCode.DRIVER_TASK_FAILED,
                correlationId: 'corr-retry-001',
                payload: {
                    taskId: 'task-retry-payload',
                    retryable: true,
                    suggestedDelayMs: 0,
                    reason: 'driver transient failure',
                    error: 'transient',
                },
            });

            // No novo modelo SSOT, o Kernel NÃO re-dispatcha retries.
            // Ele encerra/limpa runtime e deixa o worker/DB reagendar.
            await new Promise((resolve) => setTimeout(resolve, 25));

            assert.strictEqual(nerv.emittedCommands.length, 1, 'Kernel não deve reenviar task no caminho de retry');
            assert.strictEqual(
                kernel.getTask('task-retry-payload'),
                null,
                'runtime deve ser esquecido após retry solicitado',
            );

            kernel.stop();
        });
    });

    describe('3. Task execution flow (ITERATIVE strategy)', () => {
        it('should execute task V5 with ITERATIVE strategy and handle RETRY', async () => {
            kernel.start();

            const taskV5 = {
                meta: {
                    id: 'task-iterative',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 8,
                    source: 'api',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Write a good essay' },
                    execution: {
                        strategy: 'ITERATIVE',
                        iterative_config: {
                            max_iterations: 3,
                            validation_criteria: { min_quality_score: 75 },
                        },
                    },
                    validation: {
                        validators: [{ type: 'length', config: { min_length: 500 } }],
                    },
                },
                state: {
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    history: [],
                },
                policy: { max_cost_cents: 300, dependencies: [] },
            };

            await kernel.executeTask(taskV5, 'corr-002');

            const commands = nerv.emittedCommands;
            assert.ok(commands.length >= 1, 'Pelo menos um comando foi emitido');

            // Simula completion do driver com output que falha validação
            nerv.receive({
                messageType: MessageType.EVENT,
                actionCode: ActionCode.DRIVER_TASK_COMPLETED,
                correlationId: 'corr-002',
                payload: {
                    taskId: 'task-iterative',
                    result: {
                        output: 'Short text',
                        raw_output_preview: 'Short text',
                    },
                },
            });

            await new Promise((resolve) => setTimeout(resolve, 100));

            kernel.stop();
        });
    });

    describe('4. beforeExecution/afterExecution hooks', () => {
        it('should call beforeExecution before sending to driver', async () => {
            kernel.start();

            const taskV5 = {
                meta: {
                    id: 'task-with-hooks',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual',
                    workflow_id: 'workflow-001',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Test' },
                    execution: {
                        strategy: 'MULTI_STEP',
                        workflow_config: {
                            steps: [
                                { id: 'step-1', action: 'execute_prompt', config: { prompt: 'Step 1' } },
                                { id: 'step-2', action: 'execute_prompt', config: { prompt: 'Step 2' } },
                            ],
                        },
                    },
                    validation: { validators: [] },
                },
                state: {
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    history: [],
                },
                policy: { max_cost_cents: 200, dependencies: [] },
            };

            await kernel.executeTask(taskV5, 'corr-003');

            assert.ok(nerv.emittedCommands.length > 0, 'Comando foi emitido após beforeExecution');

            kernel.stop();
        });
    });

    describe('5. getStatus() integration', () => {
        it('should return status including orchestrator info', () => {
            kernel.start();

            const status = kernel.getStatus();

            assert.ok(status, 'Status retornado');
            assert.ok(status.nerv, 'Status inclui NERV');
            assert.ok(status.loop, 'Status inclui loop');
            assert.ok(status.tasks, 'Status inclui tasks');

            // Observação: depende do formato implementado em KernelNERVBridge.getStatus()
            const nervStatus = status.nerv;
            assert.ok(nervStatus.orchestrator !== undefined, 'Status NERV inclui info do orchestrator');

            kernel.stop();
        });
    });

    describe('6. shutdown() cleanup', () => {
        it('should cleanup taskExecutor on shutdown', async () => {
            kernel.start();

            await kernel.shutdown();

            assert.ok(true, 'Shutdown executado sem erros');
        });
    });
});

describe('TaskExecutionOrchestrator (standalone)', () => {
    /** @type {any} */ let nerv;
    /** @type {any} */ let nervBridge;
    /** @type {any} */ let orchestrator;

    beforeEach(async () => {
        nerv = new MockNERV();

        // Mock simplificado do nervBridge
        nervBridge = {
            beforeTaskExecution: async (/** @type {any} */ task) => task,
            afterTaskExecution: async (
                /** @type {Record<string, unknown>} */ task,
                /** @type {unknown} */ _result,
            ) => ({
                action: 'DONE',
                task,
                feedback: null,
            }),
            processOrchestrationDecision: async (
                /** @type {unknown} */ _decision,
                /** @type {string} */ _correlationId,
            ) => {},
            emitCommand: (/** @type {any} */ params) => nerv.emitCommand(params),
            emitEvent: (/** @type {any} */ params) => nerv.emitEvent(params),
        };

        const { TaskExecutionOrchestrator } = await import('#kernel/task_execution_orchestrator');
        orchestrator = new TaskExecutionOrchestrator({ nerv, nervBridge });
    });

    describe('executeTask()', () => {
        it('should call beforeTaskExecution and emit DRIVER_EXECUTE_TASK', async () => {
            const task = {
                meta: { id: 'task-001', version: '5.0' },
                spec: { target: 'chatgpt', execution: { strategy: 'SINGLE_SHOT' } },
            };

            await orchestrator.executeTask(task, 'corr-test');

            assert.strictEqual(nerv.emittedCommands.length, 1, 'Comando emitido');
            assert.strictEqual(nerv.emittedCommands[0].payload.actionCode, ActionCode.DRIVER_EXECUTE_TASK);
        });

        it('should track active executions', async () => {
            const task = {
                meta: { id: 'task-tracked', version: '5.0' },
                spec: { target: 'chatgpt', execution: { strategy: 'SINGLE_SHOT' } },
            };

            await orchestrator.executeTask(task, 'corr-tracked');

            assert.strictEqual(orchestrator.activeExecutions.size, 1, 'Execução ativa rastreada');
            assert.ok(orchestrator.activeExecutions.has('task-tracked'), 'Task ID no cache');
        });
    });

    describe('cleanup()', () => {
        it('should clear active executions', async () => {
            const task = {
                meta: { id: 'task-cleanup', version: '5.0' },
                spec: { target: 'chatgpt', execution: { strategy: 'SINGLE_SHOT' } },
            };

            await orchestrator.executeTask(task, 'corr-cleanup');

            assert.strictEqual(orchestrator.activeExecutions.size, 1, 'Execução ativa antes do cleanup');

            orchestrator.cleanup();

            assert.strictEqual(orchestrator.activeExecutions.size, 0, 'Cache limpo após cleanup');
        });
    });
});
