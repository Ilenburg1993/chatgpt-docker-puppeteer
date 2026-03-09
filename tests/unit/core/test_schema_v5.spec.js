// @ts-check
import { TaskSchemaV5 } from '#core/schemas/task_schema_v5';
import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
    autoMigrateTask,
    downgradeV5toV4,
    isV4Task,
    isV5Task,
    migrateBatchV4toV5,
    migrateTaskV4toV5,
    validateV5Task,
} from '#core/schemas/migrator_v4_to_v5';

import { STATUS_VALUES } from '#core/constants/tasks';

describe('Task Schema V5 Validation', () => {
    describe('Validação de tasks V5 válidas', () => {
        it('deve validar task V5 SINGLE_SHOT completa', () => {
            const taskV5 = {
                meta: {
                    id: 'task-v5-001',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                    tags: ['v5-test'],
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Test V5 SINGLE_SHOT',
                    },
                    execution: {
                        strategy: 'SINGLE_SHOT',
                    },
                },
                policy: {
                    max_attempts: 3,
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0,
                },
                result: {
                    file_path: null,
                    session_url: null,
                    finish_reason: 'unknown',
                },
            };

            const resultado = TaskSchemaV5.parse(taskV5);

            assert.ok(resultado, 'Task V5 SINGLE_SHOT deve passar');
            assert.strictEqual(resultado.meta.version, '5.0');
            assert.strictEqual(resultado.spec.execution.strategy, 'SINGLE_SHOT');
        });

        it('deve validar task V5 ITERATIVE com config completo', () => {
            const taskV5 = {
                meta: {
                    id: 'task-v5-iterative',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 7,
                    source: 'api',
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Write a high quality chapter',
                    },
                    execution: {
                        strategy: 'ITERATIVE',
                        iterative_config: {
                            max_iterations: 3,
                            validation_criteria: {
                                validators: ['llm_judge'],
                                min_quality_score: 75,
                            },
                            convergence_detection: true,
                        },
                    },
                    validation: {
                        validators: [
                            {
                                type: 'llm_judge',
                                config: { criteria: 'coherence,accuracy,depth' },
                            },
                        ],
                        on_validation_failure: 'retry',
                    },
                },
                policy: {
                    max_attempts: 3,
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0,
                    iteration_state: {
                        current_iteration: 0,
                        iterations_history: [],
                    },
                },
                result: {
                    file_path: null,
                    finish_reason: 'unknown',
                    validation_results: [],
                },
            };

            const resultado = TaskSchemaV5.parse(taskV5);

            assert.ok(resultado, 'Task V5 ITERATIVE deve passar');
            assert.strictEqual(resultado.spec.execution.strategy, 'ITERATIVE');
            assert.strictEqual(resultado.spec.execution.iterative_config.max_iterations, 3);
            assert.strictEqual(resultado.spec.execution.iterative_config.validation_criteria.min_quality_score, 75);
            assert.ok(resultado.spec.validation.validators.length > 0);
        });

        it('deve validar task V5 MULTI_STEP com workflow', () => {
            const taskV5 = {
                meta: {
                    id: 'task-v5-workflow',
                    workflow_id: 'workflow-001',
                    mission_id: 'mission-book',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 8,
                    source: 'self_generated', // mission_manager não existe no enum, usando self_generated
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Execute workflow step 1',
                    },
                    execution: {
                        strategy: 'MULTI_STEP',
                        workflow_config: {
                            steps: [
                                {
                                    id: 'step-1',
                                    name: 'Generate outline',
                                    action: 'execute_prompt',
                                    config: { prompt: 'Create outline' },
                                    dependencies: [],
                                    on_failure: 'abort',
                                },
                                {
                                    id: 'step-2',
                                    name: 'Write chapter 1',
                                    action: 'execute_prompt',
                                    config: { prompt: 'Write chapter based on {step-1}' },
                                    dependencies: ['step-1'],
                                    on_failure: 'retry',
                                },
                            ],
                            max_subtasks: 50,
                            subtask_concurrency: 3,
                        },
                    },
                    context_config: {
                        inject_previous_results: true,
                        context_window_strategy: 'chunked',
                        max_context_tokens: 8000,
                    },
                },
                policy: {
                    max_attempts: 3,
                    workflow_policy: {
                        max_execution_time_ms: 3600000,
                        budget_limit_usd: 10.0,
                        quality_threshold: 75,
                    },
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0,
                    workflow_state: {
                        current_step_index: 0,
                        completed_steps: [],
                        failed_steps: [],
                        accumulated_context: {},
                    },
                },
                result: {
                    file_path: null,
                    finish_reason: 'unknown',
                    subtask_results: [],
                },
            };

            const resultado = TaskSchemaV5.parse(taskV5);

            assert.ok(resultado, 'Task V5 MULTI_STEP deve passar');
            assert.strictEqual(resultado.meta.workflow_id, 'workflow-001');
            assert.strictEqual(resultado.meta.mission_id, 'mission-book');
            assert.strictEqual(resultado.spec.execution.strategy, 'MULTI_STEP');
            assert.strictEqual(resultado.spec.execution.workflow_config.steps.length, 2);
            assert.strictEqual(resultado.spec.context_config.inject_previous_results, true);
            assert.strictEqual(resultado.policy.workflow_policy.budget_limit_usd, 10.0);
        });

        it('deve validar task V5 com quality_metrics e cost_tracking', () => {
            const taskV5 = {
                meta: {
                    id: 'task-v5-metrics',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Test with metrics',
                    },
                    execution: {
                        strategy: 'SINGLE_SHOT',
                    },
                },
                policy: {
                    max_attempts: 3,
                },
                state: {
                    status: STATUS_VALUES.DONE,
                    attempts: 1,
                    quality_metrics: {
                        overall_score: 85,
                        coherence_score: 90,
                        accuracy_score: 80,
                        goal_alignment_score: 85,
                        validation_passed: true,
                    },
                    cost_tracking: {
                        input_tokens: 1500,
                        output_tokens: 2500,
                        total_tokens: 4000,
                        cost_usd: 0.12,
                        model_used: 'gpt-4o',
                    },
                },
                result: {
                    file_path: '/results/task-v5-metrics.txt',
                    finish_reason: 'stop',
                },
            };

            const resultado = TaskSchemaV5.parse(taskV5);

            assert.ok(resultado, 'Task V5 com metrics deve passar');
            assert.strictEqual(resultado.state.quality_metrics.overall_score, 85);
            assert.strictEqual(resultado.state.cost_tracking.total_tokens, 4000);
            assert.strictEqual(resultado.state.cost_tracking.cost_usd, 0.12);
        });
    });

    describe('Validação de tasks V5 inválidas', () => {
        it('deve rejeitar estratégia de execução inválida', () => {
            const taskInvalida = {
                meta: {
                    id: 'task-invalid',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Test',
                    },
                    execution: {
                        strategy: 'INVALID_STRATEGY', // Inválida!
                    },
                },
                policy: {
                    max_attempts: 3,
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0,
                },
                result: {},
            };

            assert.throws(() => {
                TaskSchemaV5.parse(taskInvalida);
            }, 'Deve rejeitar estratégia inválida');
        });

        it('deve rejeitar target inválido', () => {
            const taskInvalida = {
                meta: {
                    id: 'task-bad-target',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: {
                    target: 'invalid_target', // Não está no enum!
                    payload: {
                        user_message: 'Test',
                    },
                },
                policy: {},
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0,
                },
                result: {},
            };

            assert.throws(() => {
                TaskSchemaV5.parse(taskInvalida);
            }, 'Deve rejeitar target inválido');
        });
    });
});

describe('Migrator V4 → V5', () => {
    describe('Detecção de versão', () => {
        it('deve detectar task V4', () => {
            const taskV4 = {
                meta: {
                    id: 'task-001',
                    version: '4.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Test' },
                },
                policy: {},
                state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                result: {},
            };

            assert.ok(isV4Task(taskV4), 'Deve detectar task V4');
            assert.ok(!isV5Task(taskV4), 'Não deve detectar como V5');
        });

        it('deve detectar task V5', () => {
            const taskV5 = {
                meta: {
                    id: 'task-002',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Test' },
                    execution: { strategy: 'SINGLE_SHOT' },
                },
                policy: {},
                state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                result: {},
            };

            assert.ok(isV5Task(taskV5), 'Deve detectar task V5');
            assert.ok(!isV4Task(taskV5), 'Não deve detectar como V4');
        });
    });

    describe('Migração V4 → V5', () => {
        it('deve migrar task V4 simples para V5', () => {
            const taskV4 = {
                meta: {
                    id: 'task-migrate',
                    version: '4.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Migrate me!',
                    },
                    validation: {
                        min_length: 10,
                        required_format: 'text',
                    },
                },
                policy: {
                    max_attempts: 3,
                    timeout_ms: 120000,
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0,
                },
                result: {
                    file_path: null,
                },
            };

            const taskV5 = migrateTaskV4toV5(taskV4);

            assert.ok(taskV5, 'Migração deve retornar task');
            assert.strictEqual(taskV5.meta.version, '5.0', 'Versão deve ser 5.0');
            assert.strictEqual(taskV5.meta.id, 'task-migrate', 'ID deve ser preservado');
            assert.strictEqual(taskV5.spec.target, 'chatgpt', 'Target deve ser preservado');

            // Novos campos V5
            assert.strictEqual(taskV5.spec.execution.strategy, 'SINGLE_SHOT', 'Deve ter estratégia SINGLE_SHOT');
            assert.ok(Array.isArray(taskV5.spec.validation.validators), 'Deve ter array de validators');
            assert.strictEqual(taskV5.spec.validation.validators.length, 0, 'Validators deve estar vazio');
            assert.strictEqual(taskV5.spec.validation.on_validation_failure, 'retry');

            // Campos V4 preservados
            assert.strictEqual(taskV5.spec.validation.min_length, 10, 'min_length V4 deve ser preservado');
            assert.strictEqual(taskV5.policy.max_attempts, 3, 'max_attempts deve ser preservado');

            // Novos campos V5 com valores undefined/null apropriados
            assert.strictEqual(taskV5.meta.workflow_id, undefined);
            assert.strictEqual(taskV5.meta.mission_id, undefined);
            assert.strictEqual(taskV5.spec.context_config, undefined);
            assert.strictEqual(taskV5.policy.workflow_policy, undefined);
            assert.strictEqual(taskV5.state.paused_at, null);
            assert.strictEqual(taskV5.state.workflow_state, undefined);
            assert.strictEqual(taskV5.state.iteration_state, undefined);

            // Valida schema V5
            const validacao = validateV5Task(taskV5);
            assert.ok(validacao, 'Task migrada deve ser V5 válida');
        });

        it('deve retornar task V5 sem modificação se já for V5', () => {
            const taskV5Original = {
                meta: {
                    id: 'task-already-v5',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Already V5' },
                    execution: { strategy: 'SINGLE_SHOT' },
                },
                policy: {},
                state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                result: {},
            };

            const taskV5Resultado = migrateTaskV4toV5(taskV5Original);

            assert.strictEqual(taskV5Resultado.meta.version, '5.0');
            assert.strictEqual(taskV5Resultado.spec.execution.strategy, 'SINGLE_SHOT');
        });
    });

    describe('Migração em batch', () => {
        it('deve migrar múltiplas tasks V4 para V5', () => {
            const tasksV4 = [
                {
                    meta: {
                        id: 'batch-1',
                        version: '4.0',
                        created_at: new Date().toISOString(),
                        priority: 5,
                        source: 'api',
                    },
                    spec: { target: 'chatgpt', payload: { user_message: 'Task 1' } },
                    policy: {},
                    state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                    result: {},
                },
                {
                    meta: {
                        id: 'batch-2',
                        version: '4.0',
                        created_at: new Date().toISOString(),
                        priority: 5,
                        source: 'api',
                    },
                    spec: { target: 'gemini', payload: { user_message: 'Task 2' } },
                    policy: {},
                    state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                    result: {},
                },
            ];

            const tasksV5 = migrateBatchV4toV5(tasksV4);

            assert.strictEqual(tasksV5.length, 2, 'Deve retornar 2 tasks');
            assert.strictEqual(tasksV5[0].meta.version, '5.0');
            assert.strictEqual(tasksV5[1].meta.version, '5.0');
            assert.strictEqual(tasksV5[0].spec.execution.strategy, 'SINGLE_SHOT');
            assert.strictEqual(tasksV5[1].spec.execution.strategy, 'SINGLE_SHOT');
        });

        it('deve lidar com mix de V4 e V5 em batch', () => {
            const tasksMix = [
                {
                    meta: {
                        id: 'mix-v4',
                        version: '4.0',
                        created_at: new Date().toISOString(),
                        priority: 5,
                        source: 'api',
                    },
                    spec: { target: 'chatgpt', payload: { user_message: 'V4' } },
                    policy: {},
                    state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                    result: {},
                },
                {
                    meta: {
                        id: 'mix-v5',
                        version: '5.0',
                        created_at: new Date().toISOString(),
                        priority: 5,
                        source: 'api',
                    },
                    spec: { target: 'gemini', payload: { user_message: 'V5' }, execution: { strategy: 'SINGLE_SHOT' } },
                    policy: {},
                    state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                    result: {},
                },
            ];

            const resultado = migrateBatchV4toV5(tasksMix);

            assert.strictEqual(resultado.length, 2);
            assert.ok(
                resultado.every((t) => t.meta.version === '5.0'),
                'Todas devem ser V5',
            );
        });
    });

    describe('Auto-migration', () => {
        it('deve auto-migrar task V4 transparentemente', () => {
            const taskV4 = {
                meta: {
                    id: 'auto-migrate',
                    version: '4.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: { target: 'chatgpt', payload: { user_message: 'Auto migrate' } },
                policy: {},
                state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                result: {},
            };

            const resultado = autoMigrateTask(taskV4);

            assert.strictEqual(resultado.meta.version, '5.0');
            assert.strictEqual(resultado.spec.execution.strategy, 'SINGLE_SHOT');
        });

        it('deve auto-migrar task sem versão (legacy)', () => {
            const taskLegacy = {
                meta: {
                    id: 'legacy-task',
                    // Sem version!
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: { target: 'chatgpt', payload: { user_message: 'Legacy' } },
                policy: {},
                state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                result: {},
            };

            const resultado = autoMigrateTask(taskLegacy);

            assert.strictEqual(resultado.meta.version, '5.0');
        });

        it('deve retornar task V5 sem modificação', () => {
            const taskV5 = {
                meta: {
                    id: 'already-v5',
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: { target: 'chatgpt', payload: { user_message: 'V5' }, execution: { strategy: 'ITERATIVE' } },
                policy: {},
                state: { status: STATUS_VALUES.PENDING, attempts: 0 },
                result: {},
            };

            const resultado = autoMigrateTask(taskV5);

            assert.strictEqual(resultado.meta.version, '5.0');
            assert.strictEqual(resultado.spec.execution.strategy, 'ITERATIVE');
        });
    });

    describe('Downgrade V5 → V4', () => {
        it('deve fazer downgrade de V5 para V4 (com perda de dados)', () => {
            const taskV5 = {
                meta: {
                    id: 'downgrade-test',
                    version: '5.0',
                    workflow_id: 'workflow-001',
                    mission_id: 'mission-001',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { user_message: 'Downgrade me' },
                    execution: { strategy: 'ITERATIVE' },
                    context_config: { inject_previous_results: true },
                },
                policy: {
                    workflow_policy: { budget_limit_usd: 10 },
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0,
                    workflow_state: { current_step_index: 5 },
                },
                result: {
                    subtask_results: [],
                },
            };

            const taskV4 = downgradeV5toV4(taskV5);

            assert.strictEqual(taskV4.meta.version, '4.0');
            assert.strictEqual(taskV4.meta.id, 'downgrade-test');

            // Campos V5 removidos
            assert.strictEqual(taskV4.meta.workflow_id, undefined);
            assert.strictEqual(taskV4.meta.mission_id, undefined);
            assert.strictEqual(taskV4.spec.execution, undefined);
            assert.strictEqual(taskV4.spec.context_config, undefined);
            assert.strictEqual(taskV4.policy.workflow_policy, undefined);
            assert.strictEqual(taskV4.state.workflow_state, undefined);
            assert.strictEqual(taskV4.result.subtask_results, undefined);
        });
    });
});
