// @ts-check
/**
 * Contratos de cobertura dos adapters explícitos do terminal.
 *
 * O terminal só deve retransmitir via passthrough SSE eventos que ainda não tenham UX/SSE dedicada. Esta lista é a SSOT
 * local para impedir duplicidade entre adapters específicos, passthrough residual e eventos deliberadamente ignorados.
 *
 * @module copilot/terminal/event-adapter-events
 */

import { AGENT_EVENTS } from '#copilot/events';

/** @type {ReadonlySet<string>} */
export const TERMINAL_EXPLICIT_AGENT_EVENTS = new Set([
    'dialog.stalled',
    'dialog.reply',
    'dialog.loop.changed',
    'dialog.ready',
    'dialog.stopped',
    'dialog.pre_stall_warning',
    'dialog.recovery',
    'session.usage',
    'session.compaction_complete',
    'elicitation.pending',
    'elicitation.completed',
    'permission.requested',
    'permission.completed',
    'permission.mode_changed',
    'user_input.requested',
    'user_input.completed',
    'question.pending',
    'stopped',
    'tool.execution_start',
    'tool.execution_partial_result',
    'tool.execution_progress',
    'tool.execution_complete',
    'tool.user_requested',
    'session.error',
    'session.info',
    'session.warning',
    'session.model_changed',
    'session.title_changed',
    'session.context_changed',
    'session.mode_changed',
    'session.plan_changed',
    'session.tools_updated',
    'session.skills_loaded',
    'session.extensions_loaded',
    'session.mcp_servers_loaded',
    'session.background_tasks_changed',
    'session.task_complete',
    'session.truncation',
    'session.snapshot_rewind',
    'session.shutdown',
    'session.handoff',
    'session.workspace_file_changed',
    'hook.start',
    'hook.end',
    'sampling.requested',
    'sampling.completed',
    'commands.changed',
    'capabilities.changed',
    'exit_plan_mode.requested',
    'exit_plan_mode.completed',
    'auto_mode_switch.requested',
    'auto_mode_switch.completed',
    'session.compaction_start',
    'assistant.intent',
    'assistant.reasoning_complete',
    'agent.background.completed',
    'agent.background.idle',
    'agent.shell.completed',
    'agent.shell.detached_completed',
    'pr.consumed',
    'pr.fallback_model',
    'subagent.started',
    'subagent.completed',
    'subagent.failed',
    'ready',
    'session.fatal',
    'pending_messages.modified',
    'external_tool.requested',
    'external_tool.completed',
    'mcp.server.status_changed',
    'mcp.oauth.required',
    'mcp.oauth.completed',
    'task.delta',
    'task.completed',
    'task.error',
    'task.reasoning',
]);

/**
 * Eventos do agent que ainda precisam chegar ao SSE do terminal, mas semântica local rica ainda não possuem adapter
 * dedicado. Esta lista é a janela de transição restante; qualquer evento aqui deve ter owner explícito no roadmap.
 *
 * @type {ReadonlySet<string>}
 */
export const TERMINAL_AGENT_SSE_PASSTHROUGH_EVENTS = new Set([
    'dialog.boot_recovery',
    'dialog.paused',
    'dialog.resumed',
    'dialog.turn_end',
    'dialog.turn_start',
    'dialog.turn_timeout',
    'handoff.accepted',
    'handoff.received',
    'handoff.rejected',
    'mcp.reconnected',
    'question.answered',
    'quota.warning',
    'session.token_budget_warning',
    'system.message',
    'task.queued',
    'task.started',
]);

/**
 * @returns {Set<string>}
 */
export function createTerminalHandledAgentEventsSet() {
    return new Set(TERMINAL_EXPLICIT_AGENT_EVENTS);
}

/**
 * @returns {Set<string>}
 */
export function createTerminalPassthroughAgentEventsSet() {
    return new Set(TERMINAL_AGENT_SSE_PASSTHROUGH_EVENTS);
}

/**
 * Retorna os eventos do agent que ainda não têm coverage explícita nem passthrough permitido no terminal. Eles devem
 * ser tratados como ignorados localmente para evitar duplicidade/ruído no SSE.
 *
 * @returns {string[]}
 */
export function listTerminalIgnoredAgentEvents() {
    const explicit = TERMINAL_EXPLICIT_AGENT_EVENTS;
    const passthrough = TERMINAL_AGENT_SSE_PASSTHROUGH_EVENTS;
    return AGENT_EVENTS.filter((event) => !explicit.has(event) && !passthrough.has(event)).sort();
}
