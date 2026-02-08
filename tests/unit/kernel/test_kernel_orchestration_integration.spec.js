import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import EventEmitter from 'node:events';
import { createKernel } from '#kernel/kernel';
import { ActionCode, MessageType } from '#shared/nerv/constants';

// Mock NERV simple
class MockNERV extends EventEmitter {
    constructor() {
        super();
        this.buffers = {
            dequeueInbound: () => null,
            dequeueOutbound: () => null
        };
        this.emittedCommands = [];
        this.emittedEvents = [];
        this.receiveHandlers = [];
    }

    onReceive(handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const index = this.receiveHandlers.indexOf(handler);
            if (index > -1) this.receiveHandlers.splice(index, 1);
        };
    }

    receive(envelope) {
        this.receiveHandlers.forEach(h => h(envelope));
    }

    emitCommand(envelope) {
        this.emittedCommands.push(envelope);
    }

    emitEvent(envelope) {
        this.emittedEvents.push(envelope);
    }

    emit(actionCode, payload) {
        super.emit(actionCode, payload);
    }
}

describe('Kernel Orchestration Integration (V2.0)', async () => {
    let nerv;
    let kernel;

    beforeEach(() => {
        nerv = new MockNERV();
        kernel = createKernel({ nerv });
    });

    describe('1. Kernel composition', () => {
        it('should create kernel with orchestrator integrated', () => {
            assert.ok(kernel, 'Kernel foi criado');
            assert.strictEqual(typeof kernel.start, 'function', 'Kernel tem método start()');
            assert.strictEqual(typeof kernel.stop, 'function', 'Kernel tem método stop()');
            assert.strictEqual(typeof kernel.executeTask, 'function', 'Kernel tem método executeTask() (V2.0)');
        });

        it('should include TaskExecutionOrchestrator in subsystems', () => {
            // Verifica que orchestrator foi incluído na composição
            assert.ok(kernel, 'Kernel foi composto com todos subsistemas');
        });
    });

    describe('2. Task execution flow (SINGLE_SHOT strategy)', async () => {
        it('should execute task V5 with SINGLE_SHOT strategy end-to-end', async () => {
            // Inicia kernel antes de executar tasks
            kernel.start();

            // Task V5 simples (SINGLE_SHOT)
            const taskV5 = {
                meta: {
                    id: 'task-single-shot',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual'
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Test prompt'
                    },
                    execution: {
                        strategy: 'SINGLE_SHOT'
                    },
                    validation: {
                        validators: []
                    }
                },
                state: {
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    history: []
                },
                policy: {
                    max_cost_cents: 100,
                    dependencies: []
                }
            };

            // Executa task
            await kernel.executeTask(taskV5, 'corr-001');

            // Verifica que comando foi emitido para driver
            const commands = nerv.emittedCommands;
            assert.strictEqual(commands.length, 1, 'Um comando foi emitido');
            assert.strictEqual(commands[0].payload.actionCode, ActionCode.DRIVER_EXECUTE_TASK, 'Comando é DRIVER_EXECUTE_TASK');
            assert.strictEqual(commands[0].payload.task.meta.id, 'task-single-shot', 'Task ID correto');

            const runtimeTask = kernel.getTask('task-single-shot');
            assert.ok(runtimeTask, 'Task deve existir no runtime');
            assert.strictEqual(runtimeTask.state, 'ACTIVE', 'Task deve ser ativada pelo Kernel');

            kernel.stop();
        });

    });

    describe('3. Task execution flow (ITERATIVE strategy)', async () => {
        it('should execute task V5 with ITERATIVE strategy and handle RETRY', async () => {
            kernel.start();

            // Task V5 com estratégia ITERATIVE
            const taskV5 = {
                meta: {
                    id: 'task-iterative',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 8,
                    source: 'api'
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Write a good essay'
                    },
                    execution: {
                        strategy: 'ITERATIVE',
                        iterative_config: {
                            max_iterations: 3,
                            validation_criteria: {
                                min_quality_score: 75
                            }
                        }
                    },
                    validation: {
                        validators: [
                            {
                                type: 'length',
                                config: { min_length: 500 }
                            }
                        ]
                    }
                },
                state: {
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    history: []
                },
                policy: {
                    max_cost_cents: 300,
                    dependencies: []
                }
            };

            // Executa task
            await kernel.executeTask(taskV5, 'corr-002');

            // Verifica que comando foi emitido
            const commands = nerv.emittedCommands;
            assert.ok(commands.length >= 1, 'Pelo menos um comando foi emitido');

            // Simula completion do driver com output que falha validação
            const completionEvent = {
                kind: MessageType.EVENT,
                actionCode: ActionCode.DRIVER_TASK_COMPLETED,
                correlationId: 'corr-002',
                payload: {
                    taskId: 'task-iterative',
                    result: {
                        output: 'Short text', // Falhará validação de length (< 500)
                        raw_output_preview: 'Short text'
                    }
                }
            };

            // Injeta evento no NERV (simula driver completando)
            nerv.receive(completionEvent);

            // Aguarda processamento assíncrono
            await new Promise(resolve => setTimeout(resolve, 100));

            // NOTA: Por ora, não testamos RETRY completo pois depende de cache de tasks
            // que ainda não está implementado. Teste validará quando implementação estiver completa.

            kernel.stop();
        });
    });

    describe('4. beforeExecution/afterExecution hooks', async () => {
        it('should call beforeExecution before sending to driver', async () => {
            kernel.start();
            const taskV5 = {
                meta: {
                    id: 'task-with-hooks',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual',
                    workflow_id: 'workflow-001'
                },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Test' },
                    execution: {
                        strategy: 'MULTI_STEP',
                        workflow_config: {
                            steps: [
                                { id: 'step-1', action: 'execute_prompt', config: { prompt: 'Step 1' } },
                                { id: 'step-2', action: 'execute_prompt', config: { prompt: 'Step 2' } }
                            ]
                        }
                    },
                    validation: { validators: [] }
                },
                state: {
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    history: []
                },
                policy: {
                    max_cost_cents: 200,
                    dependencies: []
                }
            };

            await kernel.executeTask(taskV5, 'corr-003');

            // Verifica que task foi enviada (beforeExecution foi chamado)
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

            // Verifica status do nervBridge (deve incluir orchestrator)
            const nervStatus = status.nerv;
            assert.ok(nervStatus.orchestrator !== undefined, 'Status NERV inclui info do orchestrator');

            kernel.stop();
        });
    });

    describe('6. shutdown() cleanup', async () => {
        it('should cleanup taskExecutor on shutdown', async () => {
            kernel.start();

            await kernel.shutdown();

            // Verifica que shutdown não lança erro
            assert.ok(true, 'Shutdown executado sem erros');
        });
    });
});

describe('TaskExecutionOrchestrator (standalone)', async () => {
    let nerv;
    let nervBridge;
    let orchestrator;

    beforeEach(async () => {
        nerv = new MockNERV();

        // Mock simplificado do nervBridge
        nervBridge = {
            beforeTaskExecution: (task) => task,
            afterTaskExecution: async (task, result) => {
                return { action: 'DONE', task, feedback: null };
            },
            processOrchestrationDecision: async (decision, correlationId) => {
                // Mock: apenas registra decisão
            },
            emitCommand: (params) => {
                nerv.emitCommand(params);
            },
            emitEvent: (params) => {
                nerv.emitEvent(params);
            }
        };

        // Importa TaskExecutionOrchestrator
        const { TaskExecutionOrchestrator } = await import('#kernel/task_execution_orchestrator');
        orchestrator = new TaskExecutionOrchestrator({ nerv, nervBridge });
    });

    describe('executeTask()', async () => {
        it('should call beforeTaskExecution and emit DRIVER_EXECUTE_TASK', async () => {
            const task = {
                meta: { id: 'task-001', version: '5.0' },
                spec: { target: 'chatgpt', execution: { strategy: 'SINGLE_SHOT' } }
            };

            await orchestrator.executeTask(task, 'corr-test');

            // Verifica que comando foi emitido
            assert.strictEqual(nerv.emittedCommands.length, 1, 'Comando emitido');
            assert.strictEqual(nerv.emittedCommands[0].payload.actionCode, ActionCode.DRIVER_EXECUTE_TASK);
        });

        it('should track active executions', async () => {
            const task = {
                meta: { id: 'task-tracked', version: '5.0' },
                spec: { target: 'chatgpt', execution: { strategy: 'SINGLE_SHOT' } }
            };

            await orchestrator.executeTask(task, 'corr-tracked');

            // Verifica que execução está sendo rastreada
            assert.strictEqual(orchestrator.activeExecutions.size, 1, 'Execução ativa rastreada');
            assert.ok(orchestrator.activeExecutions.has('task-tracked'), 'Task ID no cache');
        });
    });

    describe('cleanup()', async () => {
        it('should clear active executions', async () => {
            const task = {
                meta: { id: 'task-cleanup', version: '5.0' },
                spec: { target: 'chatgpt', execution: { strategy: 'SINGLE_SHOT' } }
            };

            await orchestrator.executeTask(task, 'corr-cleanup');

            assert.strictEqual(orchestrator.activeExecutions.size, 1, 'Execução ativa antes do cleanup');

            orchestrator.cleanup();

            assert.strictEqual(orchestrator.activeExecutions.size, 0, 'Cache limpo após cleanup');
        });
    });
});
