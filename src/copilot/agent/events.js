// @ts-check
/**
 * @module copilot/agent/events
 * @file Constantes de eventos emitidos pelo AlwaysAliveAgent.
 *
 *   Centraliza os nomes de evento para que testes, bridges e consumidores possam subscribir sem depender de strings
 *   literais espalhadas. Manter esta lista sincronizada com os `emit()` em `always-alive.js`, `dialog-loop-manager.js`
 *   e `task-executor.js`.
 */

/**
 * Nomes canônicos de eventos emitidos por {@link AlwaysAliveAgent}.
 *
 * Use `AgentEventName` para obter o union type de todos os nomes válidos.
 *
 * Grupos de eventos:
 *
 * - **task.***: ciclo de vida de uma tarefa individual (enqueued → started → completed | error).
 * - **session.***: eventos do ciclo de vida da sessão SDK (compaction, usage, billing, fatal).
 * - **dialog.***: ciclo de vida do dialog loop (LLM-B ↔ SDK).
 * - **tool.***: execução de ferramentas pelo SDK durante um turno.
 * - **question.pending / question.answered / status / stopped / ready / error**: controle de estado de alto nível do
 *   agente.
 * - **pr.consumed / pr.fallback_model / permission.mode_changed**: métricas e controle de permissões.
 * - **context:compacted**: emitido após compactação de contexto local.
 * - **before-stop**: emitido antes de `stop()` iniciar o dreno da fila.
 */
export const AGENT_EVENTS = /** @type {const} */ ([
    // ── task ──────────────────────────────────────────────────────────────
    'task.queued',
    'task.started',
    'task.completed',
    'task.error',
    'task.delta',
    'task.reasoning',
    // ── questions / state ─────────────────────────────────────────────────
    'question.pending',
    'question.answered',
    'status',
    'stopped',
    'ready',
    'error',
    'before-stop',
    // ── session ───────────────────────────────────────────────────────────
    'session.compaction_start',
    'session.compaction_complete',
    'session.fatal',
    'session.usage',
    'session.token_budget_warning',
    'session.mode_changed',
    'session.history_synced',
    // ── dialog loop ───────────────────────────────────────────────────────
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
    // ── tool execution ────────────────────────────────────────────────────
    'tool.execution.start',
    'tool.execution.complete',
    // ── PR / permission ───────────────────────────────────────────────────
    'pr.consumed',
    'pr.fallback_model',
    'permission.mode_changed',
    // ── context ───────────────────────────────────────────────────────────
    'context:compacted',
    // G2-DX-17: evento de métricas periódicas (cadência configurável por consumidor)
    'agent.metrics',
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
