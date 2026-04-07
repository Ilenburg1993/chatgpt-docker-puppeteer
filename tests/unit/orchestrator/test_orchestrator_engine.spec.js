// @ts-check
import { STATUS_VALUES } from '#core/constants/tasks';
import { OrchestratorEngine } from '#orchestrator/orchestrator_engine';
import { ValidationService } from '#orchestrator/validation/validation_service';
import assert from 'node:assert';

describe('ValidationService', () => {
    /** @type {any} */ let validationService;
    /** @type {any} */ let mockNerv;

    beforeEach(() => {
        mockNerv = {
            emit: () => {}, // Mock NERV
            events: [],
        };
        mockNerv.emit = (/** @type {any} */ event, /** @type {any} */ payload) => {
            mockNerv.events.push({ event, payload });
        };

        validationService = new ValidationService({ nerv: mockNerv });
    });

    describe('Regex Validator', () => {
        it('deve validar output com regex pattern', async () => {
            const output = 'Hello World 123';
            const result = await validationService.validate(output, {
                validators: [
                    {
                        type: 'regex',
                        config: { pattern: '\\d+' }, // Tem números
                    },
                ],
            });

            assert.ok(result.passed, 'Deve passar validação');
            assert.strictEqual(result.overall_score, 100);
            assert.strictEqual(result.validation_results.length, 1);
            assert.strictEqual(result.validation_results[0].validator_type, 'regex');
        });

        it('deve falhar se pattern não match', async () => {
            const output = 'Hello World';
            const result = await validationService.validate(output, {
                validators: [
                    {
                        type: 'regex',
                        config: { pattern: '\\d+' }, // Não tem números
                    },
                ],
            });

            assert.ok(!result.passed, 'Deve falhar validação');
            assert.strictEqual(result.overall_score, 0);
            assert.ok(result.issues.length > 0);
        });
    });

    describe('Length Validator', () => {
        it('deve validar comprimento mínimo', async () => {
            const output = 'Hello World';
            const result = await validationService.validate(output, {
                validators: [
                    {
                        type: 'length',
                        config: { min_length: 5, max_length: 100 },
                    },
                ],
            });

            assert.ok(result.passed, 'Deve passar validação');
            assert.strictEqual(result.overall_score, 100);
        });

        it('deve falhar se output muito curto', async () => {
            const output = 'Hi';
            const result = await validationService.validate(output, {
                validators: [
                    {
                        type: 'length',
                        config: { min_length: 10 },
                    },
                ],
                criteria: { min_quality_score: 70 },
            });

            assert.ok(!result.passed, 'Deve falhar validação');
            assert.strictEqual(result.overall_score, 0);
        });
    });

    describe('Schema Validator (JSON)', () => {
        it('deve validar JSON válido', async () => {
            const output = JSON.stringify({ name: 'Test', value: 42 });
            const result = await validationService.validate(output, {
                validators: [
                    {
                        type: 'schema',
                        config: {},
                    },
                ],
            });

            assert.ok(result.passed, 'Deve passar validação');
            assert.strictEqual(result.overall_score, 100);
        });

        it('deve falhar se JSON inválido', async () => {
            const output = '{ invalid json }';
            const result = await validationService.validate(output, {
                validators: [
                    {
                        type: 'schema',
                        config: {},
                    },
                ],
            });

            assert.ok(!result.passed, 'Deve falhar validação');
        });
    });

    describe('Múltiplos Validators', () => {
        it('deve executar múltiplos validators e calcular score médio', async () => {
            const output = JSON.stringify({ data: '123' });
            const result = await validationService.validate(output, {
                validators: [
                    { type: 'schema', config: {} }, // Score 100
                    { type: 'length', config: { min_length: 5 } }, // Score 100
                    { type: 'regex', config: { pattern: '\\d+' } }, // Score 100
                ],
                criteria: { min_quality_score: 70 },
            });

            assert.ok(result.passed, 'Deve passar todos validators');
            assert.strictEqual(result.overall_score, 100); // Média de 3x100
            assert.strictEqual(result.validation_results.length, 3);
        });

        it('deve falhar se algum validator falhar', async () => {
            const output = 'Short'; // Muito curto
            const result = await validationService.validate(output, {
                validators: [
                    { type: 'length', config: { min_length: 100 } }, // Falha
                    { type: 'regex', config: { pattern: '.*' } }, // Passa
                ],
                criteria: { min_quality_score: 70 },
            });

            assert.ok(!result.passed, 'Deve falhar validação');
            assert.ok(result.issues.length > 0);
        });
    });

    describe('LLM-as-Judge Validator (Stub)', () => {
        it('deve retornar score simulado', async () => {
            const output = 'This is a high quality response with good coherence and accuracy.';
            const result = await validationService.validate(output, {
                validators: [
                    {
                        type: 'llm_judge',
                        config: { min_quality_score: 70 },
                    },
                ],
                criteria: { min_quality_score: 70 },
            });

            // Bypass determinístico: não pontua, mas não deve bloquear fluxo.
            assert.strictEqual(result.overall_score, 100);
            assert.strictEqual(result.validation_results.length, 1);
            assert.strictEqual(result.validation_results[0].score, null);
            assert.strictEqual(result.validation_results[0].passed, true);
            assert.ok(result.validation_results[0].strengths);
            assert.ok(result.validation_results[0].suggestions);
            assert.ok(result.passed, 'bypass llm_judge não deve reprovar validação');
        });
    });
});

describe('OrchestratorEngine', () => {
    /** @type {any} */ let orchestrator;
    /** @type {any} */ let mockNerv;

    beforeEach(() => {
        mockNerv = {
            events: [],
            emit: function (/** @type {any} */ event, /** @type {any} */ payload) {
                this.events.push({ event, payload });
            },
        };

        orchestrator = new OrchestratorEngine({ nerv: mockNerv });
    });

    describe('shouldOrchestrate', () => {
        it('deve retornar false para SINGLE_SHOT', () => {
            const task = {
                meta: { id: 'task-1' },
                spec: {
                    execution: { strategy: 'SINGLE_SHOT' },
                },
            };

            assert.strictEqual(orchestrator.shouldOrchestrate(task), false);
        });

        it('deve retornar true para ITERATIVE', () => {
            const task = {
                meta: { id: 'task-2' },
                spec: {
                    execution: { strategy: 'ITERATIVE' },
                },
            };

            assert.strictEqual(orchestrator.shouldOrchestrate(task), true);
        });

        it('deve retornar true para MULTI_STEP', () => {
            const task = {
                meta: { id: 'task-3' },
                spec: {
                    execution: { strategy: 'MULTI_STEP' },
                },
            };

            assert.strictEqual(orchestrator.shouldOrchestrate(task), true);
        });
    });

    describe('beforeExecution', () => {
        it('deve inicializar iteration state para ITERATIVE', async () => {
            const task = {
                meta: { id: 'task-iter', version: '5.0' },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Test' },
                    execution: {
                        strategy: 'ITERATIVE',
                        iterative_config: { max_iterations: 3 },
                    },
                },
                state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                policy: {},
                result: {},
            };

            const result = await orchestrator.beforeExecution(task);

            assert.ok(result.state.iteration_state, 'Deve ter iteration_state');
            assert.strictEqual(result.state.iteration_state.current_iteration, 0);
            assert.ok(orchestrator.activeIterations.has('task-iter'));

            // Verifica evento NERV
            const startEvent = mockNerv.events.find((/** @type {any} */ e) => e.event === 'ORCHESTRATION_STARTED');
            assert.ok(startEvent, 'Deve emitir ORCHESTRATION_STARTED');
            assert.strictEqual(startEvent.payload.strategy, 'ITERATIVE');
        });

        it('deve inicializar workflow state para MULTI_STEP', async () => {
            const task = {
                meta: { id: 'task-workflow', workflow_id: 'workflow-1', version: '5.0' },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Test' },
                    execution: {
                        strategy: 'MULTI_STEP',
                        workflow_config: {
                            steps: [
                                {
                                    id: 'step-1',
                                    name: 'Step 1',
                                    action: 'execute_prompt',
                                    config: {},
                                    dependencies: [],
                                },
                            ],
                        },
                    },
                },
                state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                policy: {},
                result: {},
            };

            const result = await orchestrator.beforeExecution(task);

            assert.ok(result.state.workflow_state, 'Deve ter workflow_state');
            assert.strictEqual(result.state.workflow_state.current_step_index, 0);
            assert.ok(orchestrator.activeWorkflows.has('workflow-1'));
        });
    });

    describe('afterExecution - SINGLE_SHOT', () => {
        it('deve retornar DONE imediatamente', async () => {
            const task = {
                meta: { id: 'task-single' },
                spec: {
                    execution: { strategy: 'SINGLE_SHOT' },
                },
            };

            const executionResult = {
                output: 'Response from LLM',
            };

            const decision = await orchestrator.afterExecution(task, executionResult);

            assert.strictEqual(decision.action, 'DONE');
            assert.strictEqual(decision.feedback, null);

            // Verifica evento NERV
            const completeEvent = mockNerv.events.find((/** @type {any} */ e) => e.event === 'ORCHESTRATION_COMPLETED');
            assert.ok(completeEvent, 'Deve emitir ORCHESTRATION_COMPLETED');
        });
    });

    describe('afterExecution - ITERATIVE', () => {
        it('deve retornar DONE se validação passar na primeira iteração', async () => {
            const task = {
                meta: { id: 'task-iter-pass', version: '5.0' },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Write a good response' },
                    execution: {
                        strategy: 'ITERATIVE',
                        iterative_config: {
                            max_iterations: 3,
                            validation_criteria: { min_quality_score: 70 },
                        },
                    },
                    validation: {
                        validators: [{ type: 'length', config: { min_length: 10 } }],
                    },
                },
                state: { status: STATUS_VALUES.RUNNING, attempts: 1 },
                policy: {},
                result: {},
            };

            // Inicializa iteration state
            const preparedTask = await orchestrator.beforeExecution(task);

            const executionResult = {
                output: 'This is a good response with sufficient length and quality',
            };

            const decision = await orchestrator.afterExecution(preparedTask, executionResult);

            assert.strictEqual(decision.action, 'DONE', 'Deve retornar DONE');
            assert.ok(preparedTask.state.quality_metrics, 'Deve ter quality_metrics');
            assert.strictEqual(preparedTask.state.quality_metrics.validation_passed, true);
        });

        it('deve retornar RETRY se validação falhar mas ainda tem iterações', async () => {
            const task = {
                meta: { id: 'task-iter-retry', version: '5.0' },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Write' },
                    execution: {
                        strategy: 'ITERATIVE',
                        iterative_config: {
                            max_iterations: 3,
                            validation_criteria: { min_quality_score: 70 },
                        },
                    },
                    validation: {
                        validators: [
                            { type: 'length', config: { min_length: 100 } }, // Output não vai passar
                        ],
                    },
                },
                state: { status: STATUS_VALUES.RUNNING, attempts: 1 },
                policy: {},
                result: {},
            };

            const preparedTask = await orchestrator.beforeExecution(task);

            const executionResult = {
                output: 'Short', // Muito curto
            };

            const decision = await orchestrator.afterExecution(preparedTask, executionResult);

            assert.strictEqual(decision.action, 'RETRY', 'Deve retornar RETRY');
            assert.ok(decision.feedback, 'Deve ter feedback');
            assert.ok(decision.feedback.includes('Iteration'), 'Feedback deve mencionar iteração');
        });

        it('deve retornar DONE se atingir max_iterations', async () => {
            const task = {
                meta: { id: 'task-iter-max', version: '5.0' },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Write' },
                    execution: {
                        strategy: 'ITERATIVE',
                        iterative_config: {
                            max_iterations: 2, // Apenas 2 iterações
                            validation_criteria: { min_quality_score: 70 },
                        },
                    },
                    validation: {
                        validators: [
                            { type: 'length', config: { min_length: 1000 } }, // Impossível passar
                        ],
                    },
                },
                state: { status: STATUS_VALUES.RUNNING, attempts: 1 },
                policy: {},
                result: {},
            };

            const preparedTask = await orchestrator.beforeExecution(task);

            // Iteração 1: Falha
            let executionResult = { output: 'Short 1' };
            let decision = await orchestrator.afterExecution(preparedTask, executionResult);
            assert.strictEqual(decision.action, 'RETRY');

            // Iteração 2: Falha (última)
            executionResult = { output: 'Short 2' };
            decision = await orchestrator.afterExecution(preparedTask, executionResult);
            assert.strictEqual(decision.action, 'DONE', 'Deve retornar DONE após max_iterations');
            assert.ok(decision.feedback.includes('Max iterations'), 'Feedback deve mencionar max iterations');
        });
    });

    describe('afterExecution - MULTI_STEP', () => {
        it('deve retornar NEXT_STEP e preparar próximo step', async () => {
            const task = {
                meta: { id: 'task-multi', workflow_id: 'workflow-multi', version: '5.0' },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Execute step 1' },
                    execution: {
                        strategy: 'MULTI_STEP',
                        workflow_config: {
                            steps: [
                                {
                                    id: 'step-1',
                                    name: 'Step 1',
                                    action: 'execute_prompt',
                                    config: { prompt: 'Do step 1' },
                                    dependencies: [],
                                },
                                {
                                    id: 'step-2',
                                    name: 'Step 2',
                                    action: 'execute_prompt',
                                    config: { prompt: 'Do step 2 with {step-1}' },
                                    dependencies: ['step-1'],
                                },
                            ],
                        },
                    },
                },
                state: { status: STATUS_VALUES.RUNNING, attempts: 1 },
                policy: {},
                result: {},
            };

            const preparedTask = await orchestrator.beforeExecution(task);

            // Executa step 1
            const executionResult = {
                output: 'Result from step 1',
            };

            const decision = await orchestrator.afterExecution(preparedTask, executionResult);

            assert.strictEqual(decision.action, 'NEXT_STEP', 'Deve retornar NEXT_STEP');
            assert.ok(decision.nextStep, 'Deve ter nextStep');
            assert.strictEqual(decision.nextStep.id, 'step-2');
            assert.ok(decision.feedback, 'Deve ter prompt do próximo step');
            assert.ok(decision.feedback.includes('Result from step 1'), 'Deve injetar contexto do step anterior');

            // Verifica state
            assert.ok(preparedTask.state.workflow_state.completed_steps.includes('step-1'));
            assert.strictEqual(preparedTask.state.workflow_state.current_step_index, 1);
        });

        it('deve retornar DONE quando todos steps completarem', async () => {
            const task = {
                meta: { id: 'task-multi-done', workflow_id: 'workflow-done', version: '5.0' },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Test' },
                    execution: {
                        strategy: 'MULTI_STEP',
                        workflow_config: {
                            steps: [
                                {
                                    id: 'step-1',
                                    name: 'Only Step',
                                    action: 'execute_prompt',
                                    config: { prompt: 'Do it' },
                                    dependencies: [],
                                },
                            ],
                        },
                    },
                },
                state: { status: STATUS_VALUES.RUNNING, attempts: 1 },
                policy: {},
                result: {},
            };

            const preparedTask = await orchestrator.beforeExecution(task);

            const executionResult = { output: 'Done!' };
            const decision = await orchestrator.afterExecution(preparedTask, executionResult);

            assert.strictEqual(decision.action, 'DONE', 'Deve retornar DONE quando workflow completo');
            assert.ok(decision.feedback.includes('Workflow completed'));
        });
    });

    describe('Cleanup', () => {
        it('deve limpar states ao chamar cleanup', async () => {
            const task1 = {
                meta: { id: 'task-1' },
                spec: { execution: { strategy: 'ITERATIVE' } },
                state: {},
            };
            const task2 = {
                meta: { id: 'task-2', workflow_id: 'wf-1' },
                spec: { execution: { strategy: 'MULTI_STEP', workflow_config: { steps: [] } } },
                state: {},
            };

            await orchestrator.beforeExecution(task1);
            await orchestrator.beforeExecution(task2);

            assert.ok(orchestrator.activeIterations.size > 0);
            assert.ok(orchestrator.activeWorkflows.size > 0);

            orchestrator.cleanup();

            assert.strictEqual(orchestrator.activeIterations.size, 0);
            assert.strictEqual(orchestrator.activeWorkflows.size, 0);
        });
    });
});
