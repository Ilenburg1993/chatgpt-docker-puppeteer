/* ==========================================================================
   src/core/schemas/task_schema.js
   Audit Level: 100 — Industrial Hardening (Task V4 Gold Standard)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Definição técnica da Unidade Atômica de Trabalho.
                     Garante integridade total entre Maestro, Driver e Dashboard.
========================================================================== */

const { z } = require('zod');
const {
    ID_SCHEMA,
    TIMESTAMP_SCHEMA,
    CLEAN_STRING_SCHEMA,
    PRIORITY_SCHEMA,
    SOURCE_SCHEMA,
    STATUS_SCHEMA
} = require('./shared_types');

/**
 * 1. MetaSchema: Identidade e Rastreabilidade.
 */
const MetaSchema = z.object({
    id: ID_SCHEMA,
    project_id: ID_SCHEMA.default('default'),
    parent_id: ID_SCHEMA.optional(),      // Para árvores de tarefas
    correlation_id: ID_SCHEMA.optional(), // Para agrupamento de fluxos
    version: z.string().default('4.0'),
    created_at: TIMESTAMP_SCHEMA,
    priority: PRIORITY_SCHEMA,
    source: SOURCE_SCHEMA,
    tags: z.array(z.string()).default([])
});

/**
 * 2. SpecSchema: A Intenção (O que deve ser feito).
 */
const SpecSchema = z.object({
    target: z.string().min(1), // Ex: 'chatgpt', 'gemini'
    model: z.string().default('auto'),

    payload: z.object({
        system_message: CLEAN_STRING_SCHEMA.default(''),
        user_message: CLEAN_STRING_SCHEMA, // Sanitização automática via shared_types
        context: z.string().optional()     // Buffer para injeções manuais
    }),

    parameters: z.object({
        temperature: z.number().min(0).max(2).default(0.7),
        max_tokens: z.number().optional(),
        top_p: z.number().optional(),
        stop_sequences: z.array(z.string()).default([])
    }).default({}),

    // Regras de validação específicas para esta tarefa
    validation: z.object({
        min_length: z.number().default(10),
        required_format: z.enum(['text', 'json', 'markdown', 'code']).default('text'),
        required_pattern: z.string().optional(), // Regex para o Validator
        forbidden_terms: z.array(z.string()).default([])
    }).default({}),

    config: z.object({
        reset_context: z.boolean().default(false),
        require_history: z.boolean().default(true),
        output_format: z.enum(['markdown', 'json', 'raw']).default('markdown')
    }).default({})
});

/**
 * 3. PolicySchema: O SLA e Regras de Execução.
 */
const PolicySchema = z.object({
    max_attempts: z.number().int().min(1).default(3),
    timeout_ms: z.union([z.number(), z.literal('auto')]).default('auto'),
    dependencies: z.array(ID_SCHEMA).default([]),
    execute_after: TIMESTAMP_SCHEMA.nullable().default(null),
    priority_weight: z.number().default(1.0)
});

/**
 * 4. StateSchema: Telemetria e Histórico Vivo.
 */
const StateSchema = z.object({
    status: STATUS_SCHEMA,
    progress_estimate: z.number().min(0).max(100).default(0),
    worker_id: z.string().nullable().default(null),
    attempts: z.number().int().nonnegative().default(0),
    started_at: TIMESTAMP_SCHEMA.nullable().default(null),
    completed_at: TIMESTAMP_SCHEMA.nullable().default(null),
    last_error: z.string().nullable().default(null),

    metrics: z.object({
        duration_ms: z.number().default(0),
        token_estimate: z.number().default(0),
        event_loop_lag_ms: z.number().default(0)
    }).default({}),

    // Log de eventos da tarefa (Audit Trail)
    history: z.array(z.object({
        ts: TIMESTAMP_SCHEMA,
        event: z.string(),
        msg: z.string().optional(),
        evidence: z.any().optional() // Para metadados do Triage
    })).default([])
});

/**
 * 5. ResultSchema: O Produto Final.
 */
const ResultSchema = z.object({
    file_path: z.string().nullable().default(null),
    session_url: z.string().url().nullable().default(null),
    finish_reason: z.enum(['stop', 'length', 'content_filter', 'error', 'manual', 'unknown']).default('unknown'),
    raw_output_preview: z.string().optional()
});

/**
 * TASK_SCHEMA: O Contrato Mestre V4 Gold.
 */
const TaskSchema = z.object({
    meta: MetaSchema,
    spec: SpecSchema,
    policy: PolicySchema,
    state: StateSchema,
    result: ResultSchema
}).passthrough();

module.exports = {
    TaskSchema,
    MetaSchema,
    SpecSchema,
    PolicySchema,
    StateSchema,
    ResultSchema
};