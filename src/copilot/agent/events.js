// @ts-check
/**
 * @module copilot/agent/events
 * @file Constantes de eventos emitidos pelo AlwaysAliveAgent.
 *
 *   Centraliza os nomes de evento para que testes, bridges e consumidores possam subscribir sem depender de strings
 *   literais espalhadas.
 */

/**
 * Nomes canônicos de eventos emitidos por {@link AlwaysAliveAgent}.
 *
 * Use `AgentEventName` para obter o union type de todos os nomes válidos.
 */
export const AGENT_EVENTS = /** @type {const} */ ([
    'task.queued',
    'task.started',
    'task.completed',
    'task.error',
    'task.delta',
    'task.reasoning',
    'question.pending',
    'question.answered',
    'status',
    'stopped',
    'ready',
    'error',
    'session.compaction_start',
    'session.compaction_complete',
    'session.fatal',
    'session.usage',
    'session.token_budget_warning',
    'session.mode_changed',
    'dialog.ready',
    'dialog.reply',
    'dialog.stopped',
    'dialog.stalled',
    'dialog.paused',
    'dialog.resumed',
    'tool.execution.start',
    'tool.execution.complete',
    'dialog.turn_start',
    'dialog.turn_end',
    'session.history_synced',
    'before-stop',
    // GAP-SDK-04 (fix): event emitido pelo agent após compactação de contexto do SDK
    'context:compacted',
    // RF-PR-03: emitido quando assistant.usage é detectado (PR consumido)
    'pr.consumed',
    // RF-PR-05: emitido quando o modelo falha com rate_limit/quota e o fallback é aplicado
    'pr.fallback_model',
    // NEW-PAUSE: emitidos por pauseDialogLoop() e resumeDialogLoop()
    'permission.mode_changed',
]);

/**
 * Union type de todos os nomes de eventos do AlwaysAliveAgent.
 *
 * @example
 *     // → 'task.queued' | 'task.started' | 'task.completed' | ...
 *
 * @typedef {(typeof AGENT_EVENTS)[number]} AgentEventName
 */
