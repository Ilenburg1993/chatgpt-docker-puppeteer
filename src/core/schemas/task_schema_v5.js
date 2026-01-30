/* ==========================================================================
   src/core/schemas/task_schema_v5.js
   Audit Level: 100 — Mission Orchestration Schema (V5 Autonomous Platform)
   Status: PRODUCTION READY
   Responsabilidade: Definição técnica da Unidade Atômica de Trabalho V5.
                     Suporta execução autônoma de missões complexas com iteração,
                     validação, context flow e orquestração multi-step.

   Breaking Changes from V4:
   - spec.execution: Nova seção com estratégias de execução
   - spec.validation: Expandida com validators array
   - spec.context_config: Gerenciamento de contexto entre steps
   - policy.workflow_policy: Políticas de workflow (budget, quality threshold)
   - state.workflow_state: Estado de execução de workflow
   - state.iteration_state: Estado de execução iterativa
   - state.quality_metrics: Métricas de qualidade
   - state.cost_tracking: Rastreamento de custos
   - result.subtask_results: Resultados de subtasks
   - result.validation_results: Resultados de validação
========================================================================== */

const { z } = require('zod');

const {
    CONNECTION_MODES: CONNECTION_MODES
} = require('../constants/browser.js');

const {
    ID_SCHEMA,
    TIMESTAMP_SCHEMA,
    CLEAN_STRING_SCHEMA,
    PRIORITY_SCHEMA,
    SOURCE_SCHEMA,
    STATUS_SCHEMA
} = require('./shared_types');

/**
 * 1. MetaSchema V5: Identidade e Rastreabilidade + Hierarquia de Missões.
 */
const MetaSchemaV5 = z.object({
    id: ID_SCHEMA,
    project_id: ID_SCHEMA.default('default'),
    parent_id: ID_SCHEMA.optional(), // Hierarchical tasks
    workflow_id: ID_SCHEMA.optional(), // Workflow grouping (NOVO V5)
    mission_id: ID_SCHEMA.optional(), // Mission grouping (NOVO V5)
    correlation_id: ID_SCHEMA.optional(),
    version: z.literal('5.0'), // Version bump
    created_at: TIMESTAMP_SCHEMA,
    priority: PRIORITY_SCHEMA,
    source: SOURCE_SCHEMA,
    tags: z.array(z.string()).default([])
});

/**
 * 2. SpecSchema V5: A Intenção + Estratégias de Execução.
 */
const SpecSchemaV5 = z.object({
    target: z.enum(['chatgpt', 'gemini', 'claude', 'ollama', 'auto']),
    model: z.string().default(CONNECTION_MODES.AUTO),

    payload: z.object({
        system_message: CLEAN_STRING_SCHEMA.default(''),
        user_message: CLEAN_STRING_SCHEMA,
        context: z.any().optional() // Pode conter objetos complexos (previous results, external data)
    }),

    parameters: z
        .object({
            temperature: z.number().min(0).max(2).default(0.7),
            max_tokens: z.number().int().positive().optional(),
            top_p: z.number().min(0).max(1).optional(),
            frequency_penalty: z.number().min(-2).max(2).optional(),
            presence_penalty: z.number().min(-2).max(2).optional(),
            stop_sequences: z.array(z.string()).default([])
        })
        .default({}),

    // ==========================================
    // NOVO V5: Execution Configuration
    // ==========================================
    execution: z
        .object({
            strategy: z
                .enum([
                    'SINGLE_SHOT', // Executa 1x sem validação (default V4 behavior)
                    'ITERATIVE', // Executa → Valida → Retry com feedback (até max_iterations)
                    'MULTI_STEP', // Executa workflow com múltiplos steps
                    'TREE_OF_THOUGHT', // Gera N branches, avalia, escolhe melhor
                    'CHAIN_OF_THOUGHT' // Reasoning explícito step-by-step
                ])
                .default('SINGLE_SHOT'),

            // Config para estratégia ITERATIVE
            iterative_config: z
                .object({
                    max_iterations: z.number().int().positive().default(3),
                    validation_criteria: z
                        .object({
                            validators: z.array(z.string()).default([]), // ['regex', 'schema', 'llm_judge']
                            min_quality_score: z.number().min(0).max(100).default(70),
                            custom_validator: z.any().optional() // Função customizada
                        })
                        .optional(),
                    convergence_detection: z.boolean().default(true) // Detecta quando output estabiliza
                })
                .optional(),

            // Config para estratégia MULTI_STEP
            workflow_config: z
                .object({
                    steps: z.array(
                        z.object({
                            id: z.string(),
                            name: z.string(),
                            description: z.string().optional(),
                            action: z.enum([
                                'execute_prompt', // Executa LLM com prompt
                                'validate', // Valida output de step anterior
                                'branch', // Decisão condicional
                                'loop', // Repete step N vezes
                                'spawn_subtask' // Cria nova task (fork)
                            ]),
                            config: z.any(), // Step-specific config
                            dependencies: z.array(z.string()).default([]), // Step IDs que devem completar primeiro
                            on_failure: z.enum(['retry', 'skip', 'abort']).default('abort')
                        })
                    ),
                    max_subtasks: z.number().int().positive().default(50),
                    subtask_concurrency: z.number().int().positive().default(3)
                })
                .optional(),

            // Config para estratégia TREE_OF_THOUGHT
            tree_config: z
                .object({
                    num_branches: z.number().int().min(2).max(10).default(3),
                    evaluation_criteria: z.string(), // Critérios para avaliar cada branch
                    selection_strategy: z.enum(['best', 'combine', 'vote']).default('best')
                })
                .optional()
        })
        .default({ strategy: 'SINGLE_SHOT' }),

    // ==========================================
    // NOVO V5: Validation Rules Expandidas
    // ==========================================
    validation: z
        .object({
            validators: z
                .array(
                    z.object({
                        type: z.enum([
                            'regex', // Valida com regex pattern
                            'schema', // Valida com Zod schema
                            'length', // Valida min/max length
                            'format', // Valida formato (JSON, markdown, etc)
                            'llm_judge', // LLM-as-judge (qualidade semântica)
                            'custom' // Função customizada
                        ]),
                        config: z.any() // Validator-specific config
                    })
                )
                .default([]),
            on_validation_failure: z.enum(['retry', 'abort', 'manual_review']).default('retry'),

            // Mantém campos V4 para compatibilidade
            min_length: z.number().default(10),
            required_format: z.enum(['text', 'json', 'markdown', 'code']).default('text'),
            required_pattern: z.string().optional(),
            forbidden_terms: z.array(z.string()).default([])
        })
        .default({}),

    // ==========================================
    // NOVO V5: Context Management
    // ==========================================
    context_config: z
        .object({
            inject_previous_results: z.boolean().default(false), // Injeta outputs de steps anteriores
            context_window_strategy: z.enum(['full', 'chunked', 'summarized']).default('full'),
            max_context_tokens: z.number().int().positive().optional(),
            memory_keys: z.array(z.string()).default([]) // Keys para buscar de long-term memory
        })
        .optional(),

    // Mantém config V4 para compatibilidade
    config: z
        .object({
            reset_context: z.boolean().default(false),
            require_history: z.boolean().default(true),
            output_format: z.enum(['markdown', 'json', 'raw']).default('markdown')
        })
        .default({})
});

/**
 * 3. PolicySchema V5: O SLA e Regras de Execução + Workflow Policies.
 */
const PolicySchemaV5 = z.object({
    max_attempts: z.number().int().min(1).default(3),
    timeout_ms: z.union([z.number(), z.literal(CONNECTION_MODES.AUTO)]).default(CONNECTION_MODES.AUTO),
    dependencies: z.array(ID_SCHEMA).default([]),
    execute_after: TIMESTAMP_SCHEMA.nullable().default(null),
    priority_weight: z.number().default(1.0),

    // ==========================================
    // NOVO V5: Workflow Policies
    // ==========================================
    workflow_policy: z
        .object({
            max_execution_time_ms: z.number().int().positive().optional(), // Timeout total do workflow
            budget_limit_usd: z.number().positive().optional(), // Limite de custo
            quality_threshold: z.number().min(0).max(100).optional() // Score mínimo para aprovar
        })
        .optional()
});

/**
 * 4. StateSchema V5: Telemetria e Histórico Vivo + Workflow State + Quality Metrics.
 */
const StateSchemaV5 = z.object({
    status: STATUS_SCHEMA,
    progress_estimate: z.number().min(0).max(100).default(0),
    worker_id: z.string().nullable().default(null),
    attempts: z.number().int().nonnegative().default(0),
    started_at: TIMESTAMP_SCHEMA.nullable().default(null),
    completed_at: TIMESTAMP_SCHEMA.nullable().default(null),
    paused_at: TIMESTAMP_SCHEMA.nullable().optional(), // NOVO V5: Para pausar missões
    last_error: z.string().nullable().default(null),

    // ==========================================
    // NOVO V5: Workflow State
    // ==========================================
    workflow_state: z
        .object({
            current_step_index: z.number().int().nonnegative().default(0),
            completed_steps: z.array(z.string()).default([]), // Step IDs completados
            failed_steps: z.array(z.string()).default([]), // Step IDs que falharam
            accumulated_context: z.any().optional() // Resultados de steps anteriores (injeta em próximos)
        })
        .optional(),

    // ==========================================
    // NOVO V5: Iteration State
    // ==========================================
    iteration_state: z
        .object({
            current_iteration: z.number().int().nonnegative().default(0),
            iterations_history: z
                .array(
                    z.object({
                        iteration: z.number(),
                        output: z.string(),
                        quality_score: z.number().optional(),
                        validation_result: z.any().optional()
                    })
                )
                .default([])
        })
        .optional(),

    // ==========================================
    // NOVO V5: Quality Metrics
    // ==========================================
    quality_metrics: z
        .object({
            overall_score: z.number().min(0).max(100).optional(),
            coherence_score: z.number().min(0).max(100).optional(),
            accuracy_score: z.number().min(0).max(100).optional(),
            goal_alignment_score: z.number().min(0).max(100).optional(),
            validation_passed: z.boolean().optional()
        })
        .optional(),

    // ==========================================
    // NOVO V5: Cost Tracking
    // ==========================================
    cost_tracking: z
        .object({
            input_tokens: z.number().int().nonnegative().default(0),
            output_tokens: z.number().int().nonnegative().default(0),
            total_tokens: z.number().int().nonnegative().default(0),
            cost_usd: z.number().nonnegative().default(0),
            model_used: z.string().optional()
        })
        .optional(),

    // Mantém metrics V4
    metrics: z
        .object({
            duration_ms: z.number().default(0),
            token_estimate: z.number().default(0),
            event_loop_lag_ms: z.number().default(0)
        })
        .default({}),

    // Mantém history V4
    history: z
        .array(
            z.object({
                ts: TIMESTAMP_SCHEMA,
                event: z.string(),
                msg: z.string().optional(),
                evidence: z.any().optional()
            })
        )
        .default([])
});

/**
 * 5. ResultSchema V5: O Produto Final + Subtask Results + Validation Results.
 */
const ResultSchemaV5 = z.object({
    file_path: z.string().nullable().default(null),
    session_url: z.string().url().nullable().default(null),
    finish_reason: z.enum(['stop', 'length', 'content_filter', 'error', 'manual', 'unknown']).default('unknown'),
    raw_output_preview: z.string().optional(),

    // ==========================================
    // NOVO V5: Subtask Results
    // ==========================================
    subtask_results: z
        .array(
            z.object({
                subtask_id: ID_SCHEMA,
                status: z.string(),
                output: z.string().optional(),
                quality_score: z.number().optional()
            })
        )
        .default([]),

    // ==========================================
    // NOVO V5: Validation Results
    // ==========================================
    validation_results: z
        .array(
            z.object({
                validator_type: z.string(),
                passed: z.boolean(),
                score: z.number().optional(),
                feedback: z.string().optional()
            })
        )
        .default([])
});

/**
 * TASK_SCHEMA_V5: O Contrato Mestre V5 para Missões Autônomas.
 */
const TaskSchemaV5 = z
    .object({
        meta: MetaSchemaV5,
        spec: SpecSchemaV5,
        policy: PolicySchemaV5,
        state: StateSchemaV5,
        result: ResultSchemaV5
    })
    .passthrough();

module.exports = {
    TaskSchemaV5,
    MetaSchemaV5,
    SpecSchemaV5,
    PolicySchemaV5,
    StateSchemaV5,
    ResultSchemaV5
};
