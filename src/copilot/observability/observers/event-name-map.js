// @ts-check
/**
 * src/copilot/observability/observers/event-name-map.js
 *
 * FAIXA-L14 — Mapeamento de nomes de eventos do agent EventEmitter para constantes SSOT do EventBus.
 *
 * Usado pelo `agent-event-observer.js` no modo `attachToBus()` para traduzir os event names internos (ex:
 * `'dialog.turn_start'`) para os types do EventBus (ex: `'agent:dialog:turn_start'`).
 *
 * @module copilot/observability/observers/event-name-map
 * @see EventBus
 */

import {
    AGENT_AUTO_MODE_SWITCH_COMPLETED,
    AGENT_AUTO_MODE_SWITCH_REQUESTED,
    AGENT_BACKGROUND_COMPLETED,
    AGENT_BACKGROUND_IDLE,
    AGENT_BEFORE_STOP,
    AGENT_CAPABILITIES_CHANGED,
    AGENT_COMMANDS_CHANGED,
    AGENT_CONTEXT_COMPACTED,
    AGENT_DIALOG_LOOP_CHANGED,
    AGENT_DIALOG_PAUSED,
    AGENT_DIALOG_READY,
    AGENT_DIALOG_RECOVERY,
    AGENT_DIALOG_REPLY,
    AGENT_DIALOG_RESUMED,
    AGENT_DIALOG_STALLED,
    AGENT_DIALOG_STOPPED,
    AGENT_DIALOG_TURN_END,
    AGENT_DIALOG_TURN_START,
    AGENT_DIALOG_TURN_TIMEOUT,
    AGENT_EMITTER_ERROR,
    AGENT_ERROR,
    AGENT_EXIT_PLAN_MODE_COMPLETED,
    AGENT_EXIT_PLAN_MODE_REQUESTED,
    AGENT_EXTERNAL_TOOL_COMPLETED,
    AGENT_HOOK_END,
    AGENT_HOOK_START,
    AGENT_METRICS,
    AGENT_PENDING_MESSAGES_MODIFIED,
    AGENT_PERMISSION_MODE_CHANGED,
    AGENT_PR_CONSUMED,
    AGENT_PR_FALLBACK_MODEL,
    AGENT_QUESTION_ANSWERED,
    AGENT_QUESTION_PENDING,
    AGENT_READY,
    AGENT_SAMPLING_COMPLETED,
    AGENT_SAMPLING_REQUESTED,
    AGENT_SESSION_COMPACTION_COMPLETE,
    AGENT_SESSION_COMPACTION_START,
    AGENT_SESSION_FATAL,
    AGENT_SESSION_HISTORY_SYNCED,
    AGENT_SESSION_INFO,
    AGENT_SESSION_MODE_CHANGED,
    AGENT_SESSION_SNAPSHOT_REWIND,
    AGENT_SESSION_TITLE_CHANGED,
    AGENT_SESSION_TOKEN_BUDGET_WARNING,
    AGENT_SESSION_USAGE,
    AGENT_SESSION_WORKSPACE_FILE_CHANGED,
    AGENT_SHELL_COMPLETED,
    AGENT_SHELL_DETACHED_COMPLETED,
    AGENT_STATUS,
    AGENT_STOPPED,
    AGENT_SYSTEM_MESSAGE,
    AGENT_TASK_COMPLETED,
    AGENT_TASK_DELTA,
    AGENT_TASK_ERROR,
    AGENT_TASK_QUEUED,
    AGENT_TASK_REASONING,
    AGENT_TASK_STARTED,
    AGENT_TOOL_EXECUTION_COMPLETE,
    AGENT_TOOL_EXECUTION_PROGRESS,
    AGENT_TOOL_EXECUTION_START,
} from '#copilot/events';

/**
 * Mapa de nomes de eventos do agent EventEmitter → constantes SSOT do EventBus.
 *
 * As chaves são os event names usados em `agent.emit('nome', payload)` e `agent.on('nome', handler)`. Os valores são as
 * strings canônicas emitidas no EventBus via `bridgeEmitter`.
 *
 * @type {Record<string, string>}
 */
export const EMITTER_TO_BUS_TYPE = {
    // ── Lifecycle ─────────────────────────────────────────────────────────────
    ready: AGENT_READY,
    'before-stop': AGENT_BEFORE_STOP,
    stopped: AGENT_STOPPED,
    status: AGENT_STATUS,
    error: AGENT_ERROR,
    'emitter.error': AGENT_EMITTER_ERROR,

    // ── Dialog ────────────────────────────────────────────────────────────────
    'dialog.turn_start': AGENT_DIALOG_TURN_START,
    'dialog.turn_end': AGENT_DIALOG_TURN_END,
    'dialog.turn_timeout': AGENT_DIALOG_TURN_TIMEOUT,
    'dialog.stalled': AGENT_DIALOG_STALLED,
    'dialog.loop.changed': AGENT_DIALOG_LOOP_CHANGED,
    'dialog.ready': AGENT_DIALOG_READY,
    'dialog.reply': AGENT_DIALOG_REPLY,
    'dialog.recovery': AGENT_DIALOG_RECOVERY,
    'dialog.stopped': AGENT_DIALOG_STOPPED,
    'dialog.paused': AGENT_DIALOG_PAUSED,
    'dialog.resumed': AGENT_DIALOG_RESUMED,

    // ── Task ──────────────────────────────────────────────────────────────────
    'task.queued': AGENT_TASK_QUEUED,
    'task.started': AGENT_TASK_STARTED,
    'task.completed': AGENT_TASK_COMPLETED,
    'task.error': AGENT_TASK_ERROR,
    'task.delta': AGENT_TASK_DELTA,
    'task.reasoning': AGENT_TASK_REASONING,

    // ── Tool ──────────────────────────────────────────────────────────────────
    'tool.execution_start': AGENT_TOOL_EXECUTION_START,
    'tool.execution_complete': AGENT_TOOL_EXECUTION_COMPLETE,
    'tool.execution_progress': AGENT_TOOL_EXECUTION_PROGRESS,

    // ── Session ───────────────────────────────────────────────────────────────
    'session.fatal': AGENT_SESSION_FATAL,
    'session.compaction_start': AGENT_SESSION_COMPACTION_START,
    'session.compaction_complete': AGENT_SESSION_COMPACTION_COMPLETE,
    'session.usage': AGENT_SESSION_USAGE,
    'session.token_budget_warning': AGENT_SESSION_TOKEN_BUDGET_WARNING,
    'session.mode_changed': AGENT_SESSION_MODE_CHANGED,
    'session.history_synced': AGENT_SESSION_HISTORY_SYNCED,
    'session.info': AGENT_SESSION_INFO,
    'session.title_changed': AGENT_SESSION_TITLE_CHANGED,
    'session.snapshot_rewind': AGENT_SESSION_SNAPSHOT_REWIND,
    'session.workspace_file_changed': AGENT_SESSION_WORKSPACE_FILE_CHANGED,

    // ── Question ──────────────────────────────────────────────────────────────
    'question.pending': AGENT_QUESTION_PENDING,
    'question.answered': AGENT_QUESTION_ANSWERED,

    // ── Permission ────────────────────────────────────────────────────────────
    'permission.mode_changed': AGENT_PERMISSION_MODE_CHANGED,

    // ── PR / Model ────────────────────────────────────────────────────────────
    'pr.consumed': AGENT_PR_CONSUMED,
    'pr.fallback_model': AGENT_PR_FALLBACK_MODEL,

    // ── Context ───────────────────────────────────────────────────────────────
    'context:compacted': AGENT_CONTEXT_COMPACTED,

    // ── Agent misc ────────────────────────────────────────────────────────────
    'agent.metrics': AGENT_METRICS,
    'system.message': AGENT_SYSTEM_MESSAGE,
    'hook.start': AGENT_HOOK_START,
    'hook.end': AGENT_HOOK_END,
    'sampling.requested': AGENT_SAMPLING_REQUESTED,
    'sampling.completed': AGENT_SAMPLING_COMPLETED,
    'commands.changed': AGENT_COMMANDS_CHANGED,
    'capabilities.changed': AGENT_CAPABILITIES_CHANGED,
    'agent.background.completed': AGENT_BACKGROUND_COMPLETED,
    'agent.background.idle': AGENT_BACKGROUND_IDLE,
    'agent.shell.completed': AGENT_SHELL_COMPLETED,
    'agent.shell.detached_completed': AGENT_SHELL_DETACHED_COMPLETED,

    // ── FAIXA-L14 additions ───────────────────────────────────────────────────
    'pending_messages.modified': AGENT_PENDING_MESSAGES_MODIFIED,
    'exit_plan_mode.requested': AGENT_EXIT_PLAN_MODE_REQUESTED,
    'exit_plan_mode.completed': AGENT_EXIT_PLAN_MODE_COMPLETED,
    'auto_mode_switch.requested': AGENT_AUTO_MODE_SWITCH_REQUESTED,
    'auto_mode_switch.completed': AGENT_AUTO_MODE_SWITCH_COMPLETED,
    'external_tool.completed': AGENT_EXTERNAL_TOOL_COMPLETED,
};
