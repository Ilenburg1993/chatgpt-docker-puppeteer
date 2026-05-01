// @ts-check
/**
 * Contratos de cobertura dos adapters explícitos do terminal.
 *
 * O fallback SSE só deve retransmitir eventos que não tenham UX/SSE dedicado. Esta lista é a SSOT local para impedir
 * duplicidade entre adapters específicos e fallback genérico.
 *
 * @module copilot/terminal/event-adapter-events
 */

/** @type {ReadonlySet<string>} */
export const TERMINAL_EXPLICIT_AGENT_EVENTS = new Set([
    'dialog.stalled',
    'dialog.reply',
    'dialog.loop.changed',
    'dialog.ready',
    'dialog.stopped',
    'session.usage',
    'session.compaction_complete',
    'elicitation.pending',
    'elicitation.completed',
    'permission.requested',
    'permission.completed',
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
    'exit_plan_mode.completed',
    'session.compaction_start',
    'assistant.intent',
    'assistant.reasoning_complete',
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
 * @returns {Set<string>}
 */
export function createTerminalHandledAgentEventsSet() {
    return new Set(TERMINAL_EXPLICIT_AGENT_EVENTS);
}
