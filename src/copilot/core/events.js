// @ts-check
/**
 * @module copilot/core/agent-events
 * @file Constantes de eventos emitidos pelo AlwaysAliveAgent.
 * @deprecated FAIXA-2B: Importar de `#copilot/events` (via `events/agent-events.js`) em vez deste módulo. Este arquivo
 *   é mantido para compatibilidade retroativa e será removido em versão futura. Consumidores atuais:
 *   `agent/state/agent-state.js`, `api/bridge/stream.js`, `terminal/terminal-agent-wiring.js`.
 *
 *   Originalmente em `agent/events.js` — movido para `core/` (R9) para eliminar a dependência invertida `core/ → agent/`.
 * @see EventBus
 */

/**
 * Nomes canônicos de eventos emitidos por {@link AlwaysAliveAgent}.
 *
 * Use `AgentEventName` para obter o union type de todos os nomes válidos.
 *
 * Grupos de eventos:
 *
 * - **task.***: ciclo de vida de uma tarefa individual (enqueued → started → completed | error). ⚠️ **Consome Premium
 *   Requests** — cada task usa `sendMessage()`.
 * - **session.***: eventos do ciclo de vida da sessão SDK (compaction, usage, billing, fatal). ℹ️ **Não consome PR** —
 *   são eventos de infraestrutura/observabilidade.
 * - **dialog.***: ciclo de vida do dialog loop (LLM-B ↔ SDK). ✅ **Não consome PR** — usa `dialogTurn()` (dialog mode),
 *   que é free.
 * - **tool.***: execução de ferramentas pelo SDK durante um turno. ℹ️ **Não consome PR isoladamente** — acontece dentro
 *   de um turno já em curso.
 * - **question.pending / question.answered / status / stopped / ready / error**: controle de estado de alto nível do
 *   agente. ℹ️ **Não consome PR** — eventos de estado.
 * - **pr.consumed / pr.fallback_model / permission.mode_changed**: métricas e controle de permissões. ℹ️ **Tracking** —
 *   `pr.consumed` é emitido APÓS consumo para observabilidade.
 * - **context:compacted**: emitido após compactação de contexto local.
 * - **before-stop**: emitido antes de `stop()` iniciar o dreno da fila.
 *
 * **PR Consumption Summary:**
 *
 * - `sendMessage()` → consome 1 PR por chamada (task.started/completed/error).
 * - `dialogTurn()` → NÃO consome PR (dialog.reply, dialog.turn_start/end, etc.).
 * - Dialog loop events são SEMPRE free e devem ser o padrão para interação contínua.
 *
 * **Convenção de naming (Fase BG):** todos os eventos usam underscore como separador dentro de grupos (ex.:
 * `tool.execution_start`, `session.mode_changed`). Hífens são reservados para `before-stop` (legado). Dot (`.`) separa
 * grupo do nome, e `context:` usa dois-pontos por razões históricas.
 */
export const AGENT_EVENTS = /** @type {const} */ ([
    // ── task (⚠️ CONSOME PR via sendMessage) ───────────────────────────
    'task.queued',
    'task.started',
    'task.completed',
    'task.error',
    'task.delta',
    'task.reasoning',
    // ── questions / state (não consome PR) ────────────────────────────
    'question.pending',
    'question.answered',
    'status',
    'stopped',
    'ready',
    'error',
    'before-stop',
    // ── session (não consome PR — observabilidade) ─────────────────────
    'session.compaction_start',
    'session.compaction_complete',
    'session.fatal',
    'session.usage',
    'session.token_budget_warning',
    'session.mode_changed',
    'session.history_synced',
    // ── dialog loop (✅ NÃO consome PR — usa dialogTurn) ────────────────
    'dialog.ready',
    'dialog.reply',
    'dialog.stopped',
    'dialog.stalled',
    'dialog.paused',
    'dialog.resumed',
    'dialog.loop.changed',
    'dialog.turn_start',
    'dialog.turn_end',
    // G2-ARCH-17: dialog.turn_timeout emitido quando o boot ou um turno expira sem resposta
    'dialog.turn_timeout',
    // ── tool execution (não consome PR isoladamente) ───────────────────
    'tool.execution_start',
    'tool.execution_complete',
    // ── PR / permission (tracking — pr.consumed emitido APÓS consumo) ──
    'pr.consumed',
    'pr.fallback_model',
    'permission.mode_changed',
    // ── context ───────────────────────────────────────────────────────────
    'context:compacted',
    // G2-DX-17: evento de métricas periódicas (cadência configurável por consumidor)
    'agent.metrics',
    // ── Fase BJ: background agents e shells (via system.notification kind) ──
    'agent.background.completed',
    'agent.background.idle',
    'agent.shell.completed',
    'agent.shell.detached_completed',
    // ── Fase BD: eventos de sessão, comandos, plan mode ────────────────────
    'session.title_changed',
    'session.workspace_file_changed',
    'session.info',
    'session.snapshot_rewind',
    'tool.execution_progress',
    'system.message',
    'pending_messages.modified',
    'exit_plan_mode.completed',
    'external_tool.completed',
    // ── Fase SE: eventos de streaming & SDK responses (STREAMING-EVENTS-AUDIT) ──
    'assistant.intent',
    'assistant.reasoning_complete',
    'session.context_changed',
    'abort',
    'steering.sent',
    'elicitation.pending',
    'elicitation.answered',
    'subagent.started',
    'subagent.completed',
    'subagent.failed',
    // ── F55: agent lifecycle events (boot, cleanup, handoff) ──────────────
    'sdk.lifecycle',
    'session.cleanup',
    'session.keepalive',
    'mcp.reconnected',
    'quota.warning',
    'dialog.boot_recovery',
    'dialog.compaction.requested',
    'dialog.pre_stall_warning',
    'handoff.accepted',
    'handoff.received',
    'handoff.rejected',
]);

/**
 * Union type de todos os nomes de eventos do AlwaysAliveAgent.
 *
 * @example
 *     // → 'task.queued' | 'task.started' | 'task.completed' | ...
 *
 * @typedef {(typeof AGENT_EVENTS)[number]} AgentEventName
 */

/**
 * Eventos que indicam consumo de Premium Requests (via sendMessage).
 *
 * Usado para auditoria, billing e para garantir que dialog loop events (free) nunca sejam confundidos com task events
 * (PR-consuming).
 *
 * @type {ReadonlySet<string>}
 */
export const PR_CONSUMING_EVENTS = /** @type {ReadonlySet<string>} */ (
    new Set(['task.started', 'task.completed', 'task.error', 'pr.consumed'])
);

/**
 * Eventos do dialog loop que NÃO consomem Premium Requests.
 *
 * Usa dialogTurn() internamente — free e seguro para interação contínua.
 *
 * @type {ReadonlySet<string>}
 */
export const DIALOG_LOOP_EVENTS = /** @type {ReadonlySet<string>} */ (
    new Set([
        'dialog.ready',
        'dialog.reply',
        'dialog.stopped',
        'dialog.stalled',
        'dialog.paused',
        'dialog.resumed',
        'dialog.loop.changed',
        'dialog.turn_start',
        'dialog.turn_end',
        'dialog.turn_timeout',
        'dialog.boot_recovery',
        'dialog.compaction.requested',
        'dialog.pre_stall_warning',
    ])
);

/**
 * G2-DX-16: Conjunto de eventos de alta frequência (hot-path) emitidos a cada turno ou frame de streaming.
 *
 * Consumidores que processam todos os eventos via `on()` genérico podem usar esta lista para filtrar eventos que não
 * precisam ser roteados por bridges/SSE que não requerem streaming granular.
 *
 * @type {ReadonlySet<AgentEventName>}
 */
export const HIGH_FREQUENCY_EVENTS = /** @type {ReadonlySet<AgentEventName>} */ (
    new Set(['task.delta', 'task.reasoning', 'session.usage', 'dialog.turn_start', 'dialog.turn_end'])
);

// ─── FAIXA-2B: Re-exports individuais via SSOT (forward-compat) ──────────────
// Os consumers que já importam de `#copilot/events` recebem as mesmas constantes.
// Futuramente, quando AGENT_EVENTS migrar para importar de `#copilot/events`, este arquivo pode ser
// substituído por um simples thin re-export.
export {
    AGENT_BEFORE_STOP,
    AGENT_ERROR,
    AGENT_HANDOFF_ACCEPTED,
    AGENT_HANDOFF_RECEIVED,
    AGENT_HANDOFF_REJECTED,
    AGENT_READY,
    AGENT_SHUTDOWN,
    AGENT_STOPPED,
} from '../events/agent-events.js';
