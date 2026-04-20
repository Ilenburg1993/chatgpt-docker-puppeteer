// @ts-check
/**
 * src/copilot/events/emitter-events.js — FAIXA-L19
 *
 * Constantes para eventos internos do Agent EventEmitter (always-alive). Estes são os nomes usados em
 * `emitter.emit('name')` e `emitter.on('name')`. Eventos estritamente internos podem usar `Symbol` para evitar colisão
 * acidental com consumidores externos.
 *
 * NOTA: Diferente das constantes de agent-events.js (que são SSOT do EventBus com namespace `agent:*`), estas são os
 * nomes _internos_ do emitter pattern do AlwaysAliveAgent. O bridgeEmitter em `always-alive.js` mapeia estes para os
 * SSOT do EventBus.
 *
 * **Convenção de naming (Faixa 3.4)**:
 *
 * - Eventos de **EventBus** (cross-module) usam separador `:` → `agent:ready`, `hooks:pre_tool_use`
 * - Eventos de **EventEmitter** (local/interno) usam separador `.` → `session.keepalive`, `dialog.ready`
 * - Eventos lifecycle simples (sem namespace) são plain strings → `ready`, `error`, `stopped`
 *
 * Essa distinção é intencional: o `bridgeEmitter()` converte `.` local → `:` EventBus automaticamente.
 *
 * @module copilot/events/emitter-events
 */

// ── Lifecycle ────────────────────────────────────────────────
export const EMITTER_READY = 'ready';
export const EMITTER_BEFORE_STOP = 'before-stop';
export const EMITTER_ERROR = 'error';
export const EMITTER_STOPPED = 'stopped';
export const EMITTER_STATUS = 'status';

// ── Session ──────────────────────────────────────────────────
export const EMITTER_SESSION_KEEPALIVE = 'session.keepalive';
export const EMITTER_SESSION_FATAL = 'session.fatal';
export const EMITTER_SESSION_ERROR = 'session.error';
export const EMITTER_SESSION_CLEANUP = 'session.cleanup';
export const EMITTER_SESSION_IDLE = 'session.idle';
export const EMITTER_SESSION_USAGE = 'session.usage';
export const EMITTER_SESSION_COMPACTION_START = 'session.compaction_start';
export const EMITTER_SESSION_COMPACTION_COMPLETE = 'session.compaction_complete';
export const EMITTER_SESSION_TOKEN_BUDGET_WARNING = 'session.token_budget_warning';

// ── Dialog ───────────────────────────────────────────────────
export const EMITTER_DIALOG_LOOP_CHANGED = 'dialog.loop.changed';
export const EMITTER_DIALOG_READY = 'dialog.ready';
export const EMITTER_DIALOG_REPLY = 'dialog.reply';
export const EMITTER_DIALOG_STALLED = 'dialog.stalled';
export const EMITTER_DIALOG_STOPPED = 'dialog.stopped';
export const EMITTER_DIALOG_BOOT_RECOVERY = 'dialog.boot_recovery';

// ── Dialog Loop Internal ─────────────────────────────────────
export const EMITTER_LOOP_CHANGED = 'changed';
export const EMITTER_LOOP_STALLED = 'stalled';
export const EMITTER_LOOP_PRE_STALL_WARNING = 'pre_stall_warning';
export const EMITTER_LOOP_TURN_TIMEOUT = 'turn_timeout';
export const EMITTER_LOOP_PAUSED = 'paused';
export const EMITTER_LOOP_RESUMED = 'resumed';
export const EMITTER_LOOP_REPLY = 'reply';
export const EMITTER_LOOP_READY = 'ready';
export const EMITTER_LOOP_STOPPED = 'stopped';
export const EMITTER_LOOP_COMPACTION_REQUESTED = 'compaction.requested';

// ── Turn ─────────────────────────────────────────────────────
export const EMITTER_TURN_START = 'turn_start';
export const EMITTER_TURN_END = 'turn_end';

// ── Task ─────────────────────────────────────────────────────
export const EMITTER_TASK_STARTED = 'task.started';
export const EMITTER_TASK_DELTA = 'task.delta';
export const EMITTER_TASK_ERROR = 'task.error';
export const EMITTER_TASK_COMPLETED = 'task.completed';
export const EMITTER_TASK_QUEUED = 'task.queued';
export const EMITTER_TASK_REASONING = 'task.reasoning';

// ── Tool ─────────────────────────────────────────────────────
export const EMITTER_TOOL_EXECUTION_START = 'tool.execution_start';
export const EMITTER_TOOL_EXECUTION_PROGRESS = 'tool.execution_progress';
export const EMITTER_TOOL_EXECUTION_COMPLETE = 'tool.execution_complete';

// ── Question/Answer ──────────────────────────────────────────
export const EMITTER_QUESTION_PENDING = 'question.pending';
export const EMITTER_QUESTION_ANSWERED = 'question.answered';

// ── Permission ───────────────────────────────────────────────
export const EMITTER_PERMISSION_MODE_CHANGED = 'permission.mode_changed';

// ── Internal ─────────────────────────────────────────────────
export const EMITTER_PROCESS_QUEUE = Symbol('agent.process_queue');

// ── Handoff ──────────────────────────────────────────────────
export const EMITTER_HANDOFF_RECEIVED = 'handoff.received';
export const EMITTER_HANDOFF_ACCEPTED = 'handoff.accepted';
export const EMITTER_HANDOFF_REJECTED = 'handoff.rejected';

// ── Subagent ─────────────────────────────────────────────────
export const EMITTER_SUBAGENT_STARTED = 'subagent.started';
export const EMITTER_SUBAGENT_COMPLETED = 'subagent.completed';
export const EMITTER_SUBAGENT_FAILED = 'subagent.failed';

// ── Assistant ────────────────────────────────────────────────
export const EMITTER_ASSISTANT_INTENT = 'assistant.intent';
export const EMITTER_ASSISTANT_STREAMING_DELTA = 'assistant.streaming_delta';

// ── Steering ─────────────────────────────────────────────────
export const EMITTER_STEERING_SENT = 'steering.sent';

// ── SDK/Boot ─────────────────────────────────────────────────
export const EMITTER_SDK_LIFECYCLE = 'sdk.lifecycle';
export const EMITTER_AGENT_METRICS = 'agent.metrics';
export const EMITTER_MCP_RECONNECTED = 'mcp.reconnected';
export const EMITTER_QUOTA_WARNING = 'quota.warning';
