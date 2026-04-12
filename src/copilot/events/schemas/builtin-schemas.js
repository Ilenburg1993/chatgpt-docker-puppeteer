// @ts-check
/**
 * src/copilot/events/schemas/builtin-schemas.js — FAIXA-L18
 *
 * Schemas built-in para os principais tipos de evento do sistema.
 *
 * @module copilot/events/schemas/builtin-schemas
 */

/** @typedef {import('./registry.js').EventSchema} EventSchema */

/** @type {EventSchema[]} */
export const BUILTIN_SCHEMAS = [
    // ── Lifecycle ────────────────────────────────────────
    {
        type: 'agent:ready',
        required: ['type', 'timestamp'],
        description: 'Agent pronto e operacional',
    },
    {
        type: 'agent:before-stop',
        required: ['type', 'timestamp'],
        description: 'Sinal pré-stop do agent',
    },
    {
        type: 'agent:stopped',
        required: ['type', 'timestamp'],
        description: 'Agent parado',
    },
    {
        type: 'agent:shutdown',
        required: ['type', 'timestamp'],
        description: 'Shutdown completo',
    },
    {
        type: 'agent:error',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro genérico do agent',
    },

    // ── Session ──────────────────────────────────────────
    {
        type: 'agent:session:keepalive',
        required: ['type', 'timestamp'],
        description: 'Heartbeat da sessão ativa',
    },
    {
        type: 'agent:session:fatal',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro fatal de sessão',
    },

    // ── Task ─────────────────────────────────────────────
    {
        type: 'agent:task:started',
        required: ['type', 'timestamp'],
        description: 'Task iniciada',
    },
    {
        type: 'agent:task:completed',
        required: ['type', 'timestamp'],
        description: 'Task concluída com sucesso',
    },
    {
        type: 'agent:task:error',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro em task',
    },
    {
        type: 'agent:task:queued',
        required: ['type', 'timestamp'],
        description: 'Task enfileirada',
    },

    // ── Dialog ───────────────────────────────────────────
    {
        type: 'agent:dialog:turn_end',
        required: ['type', 'timestamp'],
        description: 'Fim de turno de diálogo',
    },
    {
        type: 'agent:dialog:turn_timeout',
        required: ['type', 'timestamp'],
        description: 'Timeout no turno de diálogo',
    },
    {
        type: 'agent:dialog:stalled',
        required: ['type', 'timestamp'],
        description: 'Diálogo estagnado',
    },

    // ── Tool ─────────────────────────────────────────────
    {
        type: 'agent:tool:start',
        required: ['type', 'timestamp'],
        fields: { tool: 'string' },
        description: 'Início de uso de ferramenta',
    },
    {
        type: 'agent:tool:end',
        required: ['type', 'timestamp'],
        fields: { tool: 'string' },
        description: 'Fim de uso de ferramenta',
    },
    {
        type: 'agent:tool:error',
        required: ['type', 'timestamp'],
        fields: { tool: 'string', message: 'string' },
        description: 'Erro em ferramenta',
    },

    // ── Streaming ────────────────────────────────────────
    {
        type: 'agent:streaming:token',
        required: ['type', 'timestamp'],
        description: 'Token recebido via streaming',
    },
    {
        type: 'agent:streaming:start',
        required: ['type', 'timestamp'],
        description: 'Início de streaming',
    },
    {
        type: 'agent:streaming:complete',
        required: ['type', 'timestamp'],
        description: 'Streaming concluído',
    },

    // ── Hook ─────────────────────────────────────────────
    {
        type: 'hook:registered',
        required: ['type', 'timestamp'],
        fields: { hookName: 'string' },
        description: 'Hook registrado',
    },
    {
        type: 'hook:error_occurred',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro em hook',
    },

    // ── Memory/Compaction ────────────────────────────────
    {
        type: 'memory:compaction_complete',
        required: ['type', 'timestamp'],
        description: 'Compactação de memória concluída',
    },
];
