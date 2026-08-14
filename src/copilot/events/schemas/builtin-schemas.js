// @ts-check
/**
 * src/copilot/events/schemas/builtin-schemas.js — FAIXA-L18 / L29-L32
 *
 * Schemas built-in para TODOS os 122 tipos de evento bus SSOT do sistema. Cobertura: 100% dos bus events.
 *
 * @module copilot/events/schemas/builtin-schemas
 */

/** @typedef {import('./registry.js').EventSchema} EventSchema */

/** @type {EventSchema[]} */
export const BUILTIN_SCHEMAS = [
    // ═══════════════════════════════════════════════════════════════════
    // AGENT EVENTS (79)
    // ═══════════════════════════════════════════════════════════════════

    // ── Lifecycle ────────────────────────────────────────
    { type: 'agent:abort', required: ['type', 'timestamp'], description: 'Agent abortado forçadamente' },
    { type: 'agent:before-stop', required: ['type', 'timestamp'], description: 'Sinal pré-stop do agent' },
    {
        type: 'agent:error',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro genérico do agent',
    },
    { type: 'agent:ready', required: ['type', 'timestamp'], description: 'Agent pronto e operacional' },
    { type: 'agent:shutdown', required: ['type', 'timestamp'], description: 'Shutdown completo' },
    { type: 'agent:status', required: ['type', 'timestamp'], description: 'Status update do agent' },
    { type: 'agent:stopped', required: ['type', 'timestamp'], description: 'Agent parado' },

    // ── Assistant ────────────────────────────────────────
    {
        type: 'agent:assistant:intent',
        required: ['type', 'timestamp'],
        description: 'Intenção detectada do assistente',
    },
    {
        type: 'agent:assistant:reasoning_complete',
        required: ['type', 'timestamp'],
        description: 'Raciocínio do assistente concluído',
    },
    { type: 'agent:assistant:turn_end', required: ['type', 'timestamp'], description: 'Fim de turno do assistente' },
    {
        type: 'agent:assistant:turn_start',
        required: ['type', 'timestamp'],
        description: 'Início de turno do assistente',
    },

    // ── Background ───────────────────────────────────────
    { type: 'agent:background:completed', required: ['type', 'timestamp'], description: 'Tarefa background concluída' },
    { type: 'agent:background:idle', required: ['type', 'timestamp'], description: 'Agent background em idle' },

    // ── Context ──────────────────────────────────────────
    {
        type: 'agent:context:compacted',
        required: ['type', 'timestamp'],
        description: 'Contexto compactado com sucesso',
    },

    // ── Dialog ───────────────────────────────────────────
    {
        type: 'agent:dialog:boot_recovery',
        required: ['type', 'timestamp'],
        description: 'Recuperação de boot do dialog',
    },
    {
        type: 'agent:dialog:compaction:requested',
        required: ['type', 'timestamp'],
        description: 'Compactação do dialog solicitada',
    },
    { type: 'agent:dialog:delta', required: ['type', 'timestamp'], description: 'Delta incremental do dialog' },
    {
        type: 'agent:dialog:loop:changed',
        required: ['type', 'timestamp'],
        fields: { active: 'boolean' },
        description: 'Estado do dialog loop mudou (ativo/inativo)',
    },
    { type: 'agent:dialog:paused', required: ['type', 'timestamp'], description: 'Dialog pausado' },
    {
        type: 'agent:dialog:pre_stall_warning',
        required: ['type', 'timestamp'],
        fields: { stalledMs: 'number' },
        description: 'Alerta prévio de stall no dialog',
    },
    { type: 'agent:dialog:ready', required: ['type', 'timestamp'], description: 'Dialog pronto para interação' },
    { type: 'agent:dialog:reply', required: ['type', 'timestamp'], description: 'Resposta do dialog gerada' },
    { type: 'agent:dialog:resumed', required: ['type', 'timestamp'], description: 'Dialog retomado após pausa' },
    { type: 'agent:dialog:stalled', required: ['type', 'timestamp'], description: 'Diálogo estagnado' },
    { type: 'agent:dialog:stopped', required: ['type', 'timestamp'], description: 'Dialog encerrado' },
    { type: 'agent:dialog:turn_end', required: ['type', 'timestamp'], description: 'Fim de turno de diálogo' },
    { type: 'agent:dialog:turn_start', required: ['type', 'timestamp'], description: 'Início de turno do dialog' },
    { type: 'agent:dialog:turn_timeout', required: ['type', 'timestamp'], description: 'Timeout no turno de diálogo' },

    // ── Elicitation ──────────────────────────────────────
    {
        type: 'agent:elicitation:pending',
        required: ['type', 'timestamp'],
        description: 'Elicitação pendente de resposta do usuário',
    },

    // ── Emitter ──────────────────────────────────────────
    {
        type: 'agent:emitter:error',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro interno no emitter',
    },

    // ── Exit Plan Mode ───────────────────────────────────
    {
        type: 'agent:exit_plan_mode:completed',
        required: ['type', 'timestamp'],
        description: 'Saída do plan mode concluída',
    },

    // ── External Tool ────────────────────────────────────
    {
        type: 'agent:external_tool:completed',
        required: ['type', 'timestamp'],
        description: 'Ferramenta externa concluída',
    },

    // ── Handoff ──────────────────────────────────────────
    { type: 'agent:handoff:accepted', required: ['type', 'timestamp'], description: 'Handoff aceito' },
    {
        type: 'agent:handoff:received',
        required: ['type', 'timestamp'],
        description: 'Handoff recebido de outro agente',
    },
    {
        type: 'agent:handoff:rejected',
        required: ['type', 'timestamp'],
        fields: { rejectReason: 'string' },
        description: 'Handoff rejeitado',
    },

    // ── MCP ──────────────────────────────────────────────
    { type: 'agent:mcp:reconnected', required: ['type', 'timestamp'], description: 'MCP reconectado' },

    // ── Metrics ──────────────────────────────────────────
    { type: 'agent:metrics', required: ['type', 'timestamp'], description: 'Snapshot periódico de métricas do agente' },
    {
        type: 'agent:llm:usage',
        required: ['type', 'timestamp'],
        description: 'Telemetria de uso LLM por attribution/origem, tokens e AI usage; billing request-based é somente legacy',
    },

    // ── Pending Messages ─────────────────────────────────
    {
        type: 'agent:pending_messages:modified',
        required: ['type', 'timestamp'],
        description: 'Mensagens pendentes modificadas',
    },

    // ── Permission ───────────────────────────────────────
    {
        type: 'agent:permission:mode_changed',
        required: ['type', 'timestamp'],
        fields: { mode: 'string' },
        description: 'Modo de permissão alterado',
    },

    // ── PR ────────────────────────────────────────────────
    { type: 'agent:pr:consumed', required: ['type', 'timestamp'], description: 'PR consumido pelo agent' },
    {
        type: 'agent:pr:fallback_model',
        required: ['type', 'timestamp'],
        description: 'Fallback de modelo na geração de PR',
    },

    // ── Question ─────────────────────────────────────────
    {
        type: 'agent:question:answered',
        required: ['type', 'timestamp'],
        description: 'Pergunta respondida pelo usuário',
    },
    {
        type: 'agent:question:pending',
        required: ['type', 'timestamp'],
        description: 'Pergunta pendente para o usuário',
    },

    // ── Quota ────────────────────────────────────────────
    { type: 'agent:quota:warning', required: ['type', 'timestamp'], description: 'Aviso de cota próxima do limite' },

    // ── SDK ──────────────────────────────────────────────
    { type: 'agent:sdk:lifecycle', required: ['type', 'timestamp'], description: 'Evento de lifecycle do SDK' },

    // ── Session ──────────────────────────────────────────
    { type: 'agent:session:cleanup', required: ['type', 'timestamp'], description: 'Limpeza de sessão concluída' },
    {
        type: 'agent:session:compaction_complete',
        required: ['type', 'timestamp'],
        description: 'Compactação de sessão concluída',
    },
    {
        type: 'agent:session:compaction_start',
        required: ['type', 'timestamp'],
        description: 'Início de compactação de sessão',
    },
    {
        type: 'agent:session:context_changed',
        required: ['type', 'timestamp'],
        description: 'Contexto da sessão alterado',
    },
    {
        type: 'agent:session:error',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro de sessão',
    },
    {
        type: 'agent:session:fatal',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro fatal de sessão',
    },
    { type: 'agent:session:handoff', required: ['type', 'timestamp'], description: 'Handoff de sessão' },
    {
        type: 'agent:session:history_synced',
        required: ['type', 'timestamp'],
        description: 'Histórico de sessão sincronizado',
    },
    {
        type: 'agent:session:idle',
        required: ['type', 'timestamp'],
        description: 'Sessão ociosa, pronta para próximo comando',
    },
    { type: 'agent:session:info', required: ['type', 'timestamp'], description: 'Informação de sessão' },
    { type: 'agent:session:keepalive', required: ['type', 'timestamp'], description: 'Heartbeat da sessão ativa' },
    { type: 'agent:session:mode_changed', required: ['type', 'timestamp'], description: 'Modo da sessão alterado' },
    { type: 'agent:session:shutdown', required: ['type', 'timestamp'], description: 'Sessão entrando em shutdown' },
    {
        type: 'agent:session:snapshot_rewind',
        required: ['type', 'timestamp'],
        description: 'Rewind de snapshot da sessão',
    },
    { type: 'agent:session:task_complete', required: ['type', 'timestamp'], description: 'Task da sessão concluída' },
    { type: 'agent:session:title_changed', required: ['type', 'timestamp'], description: 'Título da sessão alterado' },
    {
        type: 'agent:session:token_budget_warning',
        required: ['type', 'timestamp'],
        description: 'Aviso de budget de tokens',
    },
    { type: 'agent:session:truncation', required: ['type', 'timestamp'], description: 'Truncamento de sessão' },
    { type: 'agent:session:usage', required: ['type', 'timestamp'], description: 'Relatório de uso da sessão' },
    {
        type: 'agent:session:workspace_file_changed',
        required: ['type', 'timestamp'],
        description: 'Arquivo do workspace alterado',
    },

    // ── Shell ────────────────────────────────────────────
    { type: 'agent:shell:completed', required: ['type', 'timestamp'], description: 'Comando shell concluído' },
    {
        type: 'agent:shell:detached_completed',
        required: ['type', 'timestamp'],
        description: 'Comando shell detached concluído',
    },

    // ── Steering ─────────────────────────────────────────
    { type: 'agent:steering:sent', required: ['type', 'timestamp'], description: 'Steering enviado ao agent' },

    // ── Subagent ─────────────────────────────────────────
    { type: 'agent:subagent:completed', required: ['type', 'timestamp'], description: 'Subagent concluiu execução' },
    {
        type: 'agent:subagent:failed',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Subagent falhou',
    },
    { type: 'agent:subagent:started', required: ['type', 'timestamp'], description: 'Subagent iniciado' },

    // ── System Message ───────────────────────────────────
    { type: 'agent:system:message', required: ['type', 'timestamp'], description: 'Mensagem de sistema do agent' },

    // ── Task ─────────────────────────────────────────────
    { type: 'agent:task:completed', required: ['type', 'timestamp'], description: 'Task concluída com sucesso' },
    { type: 'agent:task:delta', required: ['type', 'timestamp'], description: 'Delta incremental de task' },
    {
        type: 'agent:task:error',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro em task',
    },
    { type: 'agent:task:queued', required: ['type', 'timestamp'], description: 'Task enfileirada' },
    { type: 'agent:task:reasoning', required: ['type', 'timestamp'], description: 'Task em fase de raciocínio' },
    { type: 'agent:task:started', required: ['type', 'timestamp'], description: 'Task iniciada' },

    // ── Tool ─────────────────────────────────────────────
    {
        type: 'agent:tool:execution_complete',
        required: ['type', 'timestamp'],
        fields: { tool: 'string' },
        description: 'Execução de ferramenta concluída',
    },
    {
        type: 'agent:tool:execution_progress',
        required: ['type', 'timestamp'],
        fields: { tool: 'string' },
        description: 'Progresso de execução de ferramenta',
    },
    {
        type: 'agent:tool:execution_start',
        required: ['type', 'timestamp'],
        fields: { tool: 'string' },
        description: 'Início de execução de ferramenta',
    },

    // ═══════════════════════════════════════════════════════════════════
    // HOOK EVENTS (6)
    // ═══════════════════════════════════════════════════════════════════
    {
        type: 'hook:error_occurred',
        required: ['type', 'timestamp'],
        fields: { message: 'string' },
        description: 'Erro em hook',
    },
    { type: 'hook:post_tool_use', required: ['type', 'timestamp'], description: 'Hook pós-uso de tool' },
    { type: 'hook:pre_tool_use', required: ['type', 'timestamp'], description: 'Hook pré-uso de tool' },
    { type: 'hook:prompt_submitted', required: ['type', 'timestamp'], description: 'Hook de prompt submetido' },
    { type: 'hook:session_end', required: ['type', 'timestamp'], description: 'Hook de fim de sessão' },
    { type: 'hook:session_start', required: ['type', 'timestamp'], description: 'Hook de início de sessão' },

    // ═══════════════════════════════════════════════════════════════════
    // HUB EVENTS (8)
    // ═══════════════════════════════════════════════════════════════════
    {
        type: 'session:created',
        required: ['type', 'timestamp'],
        fields: { sessionId: 'string' },
        description: 'Sessão do ConversationHub criada',
    },
    {
        type: 'session:closed',
        required: ['type', 'timestamp'],
        fields: { sessionId: 'string' },
        description: 'Sessão do ConversationHub fechada',
    },
    { type: 'hub:error', required: ['type', 'timestamp'], fields: { message: 'string' }, description: 'Erro no hub' },
    { type: 'turn:complete', required: ['type', 'timestamp'], description: 'Turno completo no hub' },
    { type: 'turn:delta', required: ['type', 'timestamp'], description: 'Delta incremental do turno' },
    { type: 'turn:sent', required: ['type', 'timestamp'], description: 'Turno enviado' },
    { type: 'turn:user_pending', required: ['type', 'timestamp'], description: 'Turno pendente do usuário' },
    { type: 'user:injected', required: ['type', 'timestamp'], description: 'Mensagem do usuário injetada' },

    // ═══════════════════════════════════════════════════════════════════
    // TERMINAL EVENTS (7)
    // ═══════════════════════════════════════════════════════════════════
    { type: 'terminal:command', required: ['type', 'timestamp'], description: 'Comando executado no terminal' },
    { type: 'terminal:started', required: ['type', 'timestamp'], description: 'Terminal iniciado' },
    { type: 'terminal:stopped', required: ['type', 'timestamp'], description: 'Terminal parado' },
    { type: 'audit:entry', required: ['type', 'timestamp'], description: 'Entrada de auditoria registrada' },
    { type: 'audit:flush', required: ['type', 'timestamp'], description: 'Flush de auditoria' },
    { type: 'audit:log', required: ['type', 'timestamp'], description: 'Log de auditoria' },
    { type: 'audit:quick', required: ['type', 'timestamp'], description: 'Auditoria rápida' },

    // ═══════════════════════════════════════════════════════════════════
    // SYSTEM EVENTS (10)
    // ═══════════════════════════════════════════════════════════════════
    { type: 'config:changed', required: ['type', 'timestamp'], description: 'Configuração alterada' },
    { type: 'config:pinned_files:changed', required: ['type', 'timestamp'], description: 'Pinned files alterados' },
    { type: 'health:check', required: ['type', 'timestamp'], description: 'Health check do sistema' },
    { type: 'health:degraded', required: ['type', 'timestamp'], description: 'Estado de saúde degradado' },
    { type: 'health:recovered', required: ['type', 'timestamp'], description: 'Saúde do sistema recuperada' },
    { type: 'system:shutdown:complete', required: ['type', 'timestamp'], description: 'Shutdown graceful concluído' },
    { type: 'system:shutdown:started', required: ['type', 'timestamp'], description: 'Início do shutdown graceful' },
    { type: 'bridge:mcp:reconnected', required: ['type', 'timestamp'], description: 'Bridge MCP reconectado' },
    { type: 'bridge:nerv:connected', required: ['type', 'timestamp'], description: 'Bridge NERV conectado' },
    { type: 'bridge:nerv:disconnected', required: ['type', 'timestamp'], description: 'Bridge NERV desconectado' },

    // ═══════════════════════════════════════════════════════════════════
    // SERVICE EVENTS (5)
    // ═══════════════════════════════════════════════════════════════════
    {
        type: 'service:session:created',
        required: ['type', 'timestamp'],
        fields: { sessionId: 'string' },
        description: 'Sessão de serviço criada',
    },
    {
        type: 'service:session:disconnected',
        required: ['type', 'timestamp'],
        description: 'Sessão de serviço desconectada',
    },
    { type: 'service:session:message', required: ['type', 'timestamp'], description: 'Mensagem na sessão de serviço' },
    { type: 'service:session:resumed', required: ['type', 'timestamp'], description: 'Sessão de serviço retomada' },
    { type: 'service:tool:invoked', required: ['type', 'timestamp'], description: 'Ferramenta de serviço invocada' },

    // ═══════════════════════════════════════════════════════════════════
    // NERV EVENTS (5)
    // ═══════════════════════════════════════════════════════════════════
    { type: 'nerv:command:pause', required: ['type', 'timestamp'], description: 'Comando NERV: pause' },
    { type: 'nerv:command:received', required: ['type', 'timestamp'], description: 'Comando NERV recebido' },
    { type: 'nerv:command:restart', required: ['type', 'timestamp'], description: 'Comando NERV: restart' },
    { type: 'nerv:command:resume', required: ['type', 'timestamp'], description: 'Comando NERV: resume' },
    {
        type: 'nerv:command:send_message',
        required: ['type', 'timestamp'],
        description: 'Comando NERV: enviar mensagem',
    },
];
