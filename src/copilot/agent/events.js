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
    'session.mode_changed',
    'dialog.ready',
    'dialog.reply',
    'dialog.stopped',
    'dialog.stalled',
    'tool.execution.start',
    'tool.execution.complete',
]);

/**
 * Union type de todos os nomes de eventos do AlwaysAliveAgent.
 *
 * @example
 *     // → 'task.queued' | 'task.started' | 'task.completed' | ...
 *
 * @typedef {(typeof AGENT_EVENTS)[number]} AgentEventName
 */
