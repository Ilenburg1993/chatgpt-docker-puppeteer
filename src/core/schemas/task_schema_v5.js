// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { z } from 'zod';
import { CONNECTION_MODES } from '../constants/browser.js';

import {
    ID_SCHEMA,
    TIMESTAMP_SCHEMA,
    CLEAN_STRING_SCHEMA,
    PRIORITY_SCHEMA,
    SOURCE_SCHEMA,
    STATUS_SCHEMA,
} from './shared_types.js';

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
 * 1.5 ExecutionSchemaV5: Contexto de Execução (NOVO - Unified V5)
 *
 * Captura contexto completo de execução: driver usado, ambiente, retry telemetry.
 * Preenchido automaticamente pelo BaseDriver e ExecutionEngine.
 */
const ExecutionSchemaV5 = z.object({
    // Driver context
    driver: z.object({
        type: z.string().default('Unknown'),                                // 'ChatGPTDriver', 'GeminiDriver'
        version: z.string().default('1.0'),                                 // Driver version (ex: '2.0')
        connection_mode: z.enum(['launcher', 'external', 'auto']).default('auto'),
        browser_pool_health: z.enum(['stable', 'degraded', 'circuit_open', 'unknown']).default('unknown')
    }).default({}),

    // Environment context
    environment: z.object({
        platform: z.string().default(process.platform),                    // 'linux', 'win32', 'darwin'
        node_version: z.string().default(process.version),                 // 'v24.0.0'
        container: z.boolean().default(false),                             // true se Docker
        chrome_version: z.string().default('unknown')                      // '120.0.6099.109'
    }).default({}),

    // Retry telemetry (agregado Driver + Kernel)
    retry: z.object({
        tactical_attempts: z.number().int().nonnegative().default(0),     // Driver retry (operações browser)
        strategic_attempts: z.number().int().nonnegative().default(0),    // Kernel retry (reagendamento task)
        errors_recovered: z.array(z.string()).default([]),                // Lista de erros recuperados
        total_backoff_ms: z.number().nonnegative().default(0)             // Tempo total aguardado entre retries
    }).default({})
}).default({});

/**
 * 1.6 MissionSchemaV5: Mission System Context (NOVO - Unified V5)
 *
 * Suporte completo para Mission System: agrupa tasks em workflows,
 * permite context flow entre steps, checkpoint recovery.
 */
const MissionSchemaV5 = z.object({
    mission_id: z.string().nullable().default(null),                       // ID da missão
    step_id: z.string().nullable().default(null),                          // ID do step no workflow
    step_index: z.number().int().nonnegative().default(0),                 // Posição no workflow (0-based)
    step_dependencies: z.array(z.string()).default([]),                    // Steps que devem completar antes
    mission_context: z.object({}).passthrough().default({}),               // Contexto acumulado (outputs de steps anteriores)
    is_checkpoint: z.boolean().default(false)                              // Step é checkpoint para recovery?
}).default({});

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
            accumulated_context: z.any().optional(), // Resultados de steps anteriores (injeta em próximos)
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
                        validation_result: z.any().optional(),
                    })
                )
                .default([]),
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
            validation_passed: z.boolean().optional(),
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
            model_used: z.string().optional(),
        })
        .optional(),

    // ==========================================
    // EXPANDIDO V5: Metrics (V4 + Phases + Perception)
    // ==========================================
    metrics: z
        .object({
            // V4 fields (mantidos)
            duration_ms: z.number().default(0),
            token_estimate: z.number().default(0),
            event_loop_lag_ms: z.number().default(0),

            // NOVO V5: Phase breakdown (telemetria detalhada)
            phases: z
                .object({
                    preparation_ms: z.number().default(0), // Tempo preparando contexto
                    execution_ms: z.number().default(0), // Tempo executando (Driver)
                    validation_ms: z.number().default(0), // Tempo validando (LLM-judge)
                    storage_ms: z.number().default(0), // Tempo salvando resultado
                })
                .default({}),

            // NOVO V5: Perception telemetry (ChatGPT loop específico)
            perception: z
                .object({
                    cycles: z.number().int().default(0), // Quantos ciclos de percepção
                    stable_cycles: z.number().int().default(0), // Quantos ciclos estáveis (sem mudança)
                    continuations: z.number().int().default(0), // Auto-continuações (Continue generating)
                    thought_blocks_pruned: z.number().int().default(0), // o1/o3 reasoning blocks removidos
                })
                .default({}),
        })
        .default({}),

    // ==========================================
    // EXPANDIDO V5: History (V4 array + Summary)
    // ==========================================
    history: z
        .object({
            events: z
                .array(
                    z.object({
                        ts: TIMESTAMP_SCHEMA,
                        event: z.string(),
                        msg: z.string().optional(),
                        evidence: z.any().optional(),
                    })
                )
                .default([]),

            // NOVO V5: Summary (agregações úteis para análise rápida)
	            summary: z
	                .object({
	                    total_events: z.number().int().default(0),
	                    errors_count: z.number().int().default(0),
	                    warnings_count: z.number().int().default(0),
	                    retry_count: z.number().int().default(0),
	                    // Zod v4: record(keyType, valueType)
	                    phase_durations: z.record(z.string(), z.number()).default(/** @type {Record<string, number>} */ ({})), // { 'preparation': 1200, 'execution': 3400, ... }
	                })
	                .default({}),
	        })
	        .default({ events: [], summary: {} }),
});

/**
 * 5. ResultSchema V5: O Produto Final + Multi-formato + Metadata + Validation.
 */
const ResultSchemaV5 = z.object({
    // ==========================================
    // NOVO V5: Multi-format Storage (Response Capture V2 preparado)
    // ==========================================
    storage: z
        .object({
            text_file: z.string().nullable().default(null), // .txt (compatibilidade V4)
            markdown_file: z.string().nullable().default(null), // .md (estruturado)
            json_file: z.string().nullable().default(null), // .json (dados estruturados)
            html_file: z.string().nullable().default(null), // .html (renderizável)
        })
        .default({}),

    // ==========================================
    // NOVO V5: Generation Metadata (Response Capture V2 preparado)
    // ==========================================
    generation: z
        .object({
            model: z.string().default('unknown'), // 'gpt-5.2', 'gpt-5-mini', ou outros LLMs
            started_at: TIMESTAMP_SCHEMA.nullable().default(null),
            completed_at: TIMESTAMP_SCHEMA.nullable().default(null),
            duration_ms: z.number().default(0),
            tokens_estimate: z.number().default(0),
            continuations: z.number().int().default(0), // Auto-continuações
            thought_blocks_pruned: z.number().int().default(0), // o1/o3 reasoning removido
            retry_attempts: z.number().int().default(0), // Tentativas de retry (Driver)
        })
        .default({}),

    // ==========================================
    // NOVO V5: LLM-as-Judge Validation (Fase Posterior - Preparado)
    // ==========================================
    validation: z
        .object({
            completeness: z.object({
                score: z.number().min(0).max(100), // 0-100
                reasoning: z.string(),
                is_complete: z.boolean(),
            }),
            relevance: z.object({
                score: z.number().min(0).max(100),
                reasoning: z.string(),
                is_relevant: z.boolean(),
            }),
            quality: z.object({
                score: z.number().min(0).max(100),
                reasoning: z.string(),
                overall_score: z.number().min(0).max(100),
            }),
            recommendation: z.enum(['ACCEPT', 'RETRY', 'MANUAL_REVIEW']),
        })
        .nullable()
        .default(null), // null = validação não executada (fase posterior)

    // ==========================================
    // NOVO V5: Preview Estruturado
    // ==========================================
    preview: z
        .object({
            text: z.string().default(''), // Primeiros 500 chars (compatibilidade)
            sections_count: z.number().int().default(0), // Quantas seções (headings)
            code_blocks_count: z.number().int().default(0), // Quantos code blocks
            links_count: z.number().int().default(0), // Quantos links
            images_count: z.number().int().default(0), // Quantas imagens
        })
        .default({}),

    // ==========================================
    // V4 fields (mantidos para compatibilidade)
    // ==========================================
    file_path: z.string().nullable().default(null), // DEPRECATED: usar storage.text_file
    session_url: z.string().url().nullable().default(null),
    finish_reason: z.enum(['stop', 'length', 'content_filter', 'error', 'manual', 'unknown']).default('unknown'),
    raw_output_preview: z.string().optional(), // DEPRECATED: usar preview.text

    // ==========================================
    // Mission System: Subtask Results (mantido)
    // ==========================================
    subtask_results: z
        .array(
            z.object({
                subtask_id: ID_SCHEMA,
                status: z.string(),
                output: z.string().optional(),
                quality_score: z.number().optional(),
            })
        )
        .default([]),

    // ==========================================
    // Mission System: Validation Results (mantido)
    // ==========================================
    validation_results: z
        .array(
            z.object({
                validator_type: z.string(),
                passed: z.boolean(),
                score: z.number().optional(),
                feedback: z.string().optional(),
            })
        )
        .default([]),
});

/**
 * TASK_SCHEMA_V5: O Contrato Mestre V5 (Unified - Fevereiro 2026)
 *
 * Combina:
 * - Mission System (workflow, iteration, validation)
 * - Execution Context (driver, environment, retry)
 * - Result V2 (multi-formato, metadata, LLM-judge preparado)
 */
const TaskSchemaV5 = z
    .object({
        meta: MetaSchemaV5,
        spec: SpecSchemaV5,
        policy: PolicySchemaV5,
        execution: ExecutionSchemaV5, // NOVO V5 (Unified)
        mission: MissionSchemaV5, // NOVO V5 (Unified)
        state: StateSchemaV5,
        result: ResultSchemaV5,
    })
    .passthrough();

export { TaskSchemaV5, MetaSchemaV5, SpecSchemaV5, PolicySchemaV5, ExecutionSchemaV5, MissionSchemaV5, StateSchemaV5, ResultSchemaV5 };
