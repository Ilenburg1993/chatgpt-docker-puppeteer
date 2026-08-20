// @ts-check
/**
 * @module copilot/event-handlers/catch-all
 * @see EventBus
 * F62.9: Catch-all para eventos genuinamente não tratados por nenhum módulo do sistema.
 */

import { onAllSessionEvents } from '#copilot/events/sdk-events';
import { log } from '#copilot/observability';

/**
 * G2-PERF-02: Set de eventos SDK conhecidos como constante de módulo para evitar realocação.
 *
 * @type {ReadonlySet<string>}
 */
export const KNOWN_SDK_EVENTS = new Set([
    // ── Gerenciados pelo event-collector.js (53+ handlers) ──────────────────────
    'abort',
    'assistant.intent',
    'assistant.message',
    'assistant.message_start',
    'assistant.message_delta',
    'assistant.reasoning_delta',
    'assistant.turn_end',
    'assistant.turn_start',
    'assistant.usage',
    'command.execute',
    'elicitation.completed',
    'elicitation.requested',
    'exit_plan_mode.requested',
    'external_tool.requested',
    'hook.end',
    'hook.start',
    'mcp.oauth_completed',
    'mcp.oauth_required',
    'model.call_failure',
    'permission.completed',
    'permission.requested',
    'session.background_tasks_changed',
    'session.compaction_complete',
    'session.compaction_start',
    'session.context_changed',
    'session.custom_agents_updated',
    'session.custom_notification',
    'session.error',
    'session.extensions.attachments_pushed',
    'session.extensions_loaded',
    'session.handoff',
    'session.idle',
    'session.mcp_servers_loaded',
    'session.mcp_server_status_changed',
    'session.mode_changed',
    'session.model_change',
    'session.plan_changed',
    'session.autopilot_objective_changed',
    'session.remote_steerable_changed',
    'session.schedule_created',
    'session.schedule_cancelled',
    'session.resume',
    'session.shutdown',
    'session.skills_loaded',
    'session.start',
    'session.task_complete',
    'session.tools_updated',
    'session.truncation',
    'session.usage_info',
    'session.warning',
    'skill.invoked',
    'subagent.completed',
    'subagent.deselected',
    'subagent.failed',
    'subagent.selected',
    'subagent.started',
    'system.notification',
    'extension_context',
    'new_inbox_message',
    'tool.execution_progress',
    'tool.user_requested',
    'user_input.completed',
    'user_input.requested',
    'user.message',
    // ── Gerenciados pelo task-executor.js (por-tarefa) ──────────────────────────
    'assistant.streaming_delta',
    'tool.execution_complete',
    'tool.execution_partial_result',
    'tool.execution_start',
    // ── Cobertos parcialmente (Fases BI-BK) ─────────────────────────────────────
    'session.info',
    'session.snapshot_rewind',
    'session.title_changed',
    'session.workspace_file_changed',
    'system.message',
    'command.completed',
    'command.queued',
    'commands.changed',
    'capabilities.changed',
    'exit_plan_mode.completed',
    'auto_mode_switch.requested',
    'auto_mode_switch.completed',
    'external_tool.completed',
    'pending_messages.modified',
    'assistant.reasoning',
    'sampling.requested',
    'sampling.completed',
]);

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @returns {() => void}
 */
export function wireCatchAll(session) {
    return onAllSessionEvents(session, (evt) => {
        const e = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
        const kind = /** @type {string} */ (e['kind'] ?? e['type'] ?? 'unknown');
        if (KNOWN_SDK_EVENTS.has(kind)) return;
        log('WARN', `[AlwaysAlive] Evento SDK desconhecido: kind=${kind} — SDK pode ter sido atualizado`);
    });
}
