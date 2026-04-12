// @ts-check
/**
 * src/copilot/events/agent-events.js
 *
 * Constantes de eventos do AlwaysAliveAgent e subsistemas relacionados (task, session, dialog, tool, handoff).
 *
 * Migrado de `core/events.js` (FAIXA-2A). Consumidores devem importar de `#copilot/events`.
 *
 * @module copilot/events/agent-events
 * @see EventBus
 */

// ─── Agent lifecycle ──────────────────────────────────────────────────────────

/** @readonly */
export const AGENT_READY = 'agent:ready';
/** @readonly */
export const AGENT_BEFORE_STOP = 'agent:before-stop';
/** @readonly */
export const AGENT_STOPPED = 'agent:stopped';
/** @readonly */
export const AGENT_SHUTDOWN = 'agent:shutdown';
/** @readonly */
export const AGENT_ERROR = 'agent:error';
/** @readonly */
export const AGENT_EMITTER_ERROR = 'agent:emitter.error';

// ─── Agent session ────────────────────────────────────────────────────────────

/** @readonly */
export const AGENT_SESSION_KEEPALIVE = 'agent:session:keepalive';
/** @readonly */
export const AGENT_SESSION_FATAL = 'agent:session.fatal';

// ─── Agent task ───────────────────────────────────────────────────────────────

/** @readonly */
export const AGENT_TASK_STARTED = 'agent:task:started';
/** @readonly */
export const AGENT_TASK_DELTA = 'agent:task:delta';
/** @readonly */
export const AGENT_TASK_ERROR = 'agent:task.error';
/** @readonly */
export const AGENT_TASK_COMPLETED = 'agent:task:completed';
/** @readonly */
export const AGENT_TASK_QUEUED = 'agent:task:queued';
/** @readonly */
export const AGENT_TASK_REASONING = 'agent:task:reasoning';

// ─── Agent dialog ─────────────────────────────────────────────────────────────

/** @readonly */
export const AGENT_DIALOG_LOOP_CHANGED = 'agent:dialog:loop:changed';
/** @readonly */
export const AGENT_DIALOG_TURN_TIMEOUT = 'agent:dialog.turn_timeout';
/** @readonly */
export const AGENT_DIALOG_STALLED = 'agent:dialog:stalled';
/** @readonly */
export const AGENT_DIALOG_PAUSED = 'agent:dialog:paused';
/** @readonly */
export const AGENT_DIALOG_RESUMED = 'agent:dialog:resumed';
/** @readonly */
export const AGENT_DIALOG_STOPPED = 'agent:dialog:stopped';
/** @readonly */
export const AGENT_DIALOG_REPLY = 'agent:dialog:reply';
/** @readonly */
export const AGENT_DIALOG_COMPACTION_REQUESTED = 'agent:dialog:compaction:requested';
/** @readonly */
export const AGENT_DIALOG_TURN_START = 'agent:dialog:turn_start';
/** @readonly */
export const AGENT_DIALOG_TURN_END = 'agent:dialog:turn_end';
/** @readonly */
export const AGENT_DIALOG_READY = 'agent:dialog:ready';

// ─── Agent tool ───────────────────────────────────────────────────────────────

/** @readonly */
export const AGENT_TOOL_EXECUTION_START = 'agent:tool:execution_start';
/** @readonly */
export const AGENT_TOOL_EXECUTION_COMPLETE = 'agent:tool:execution_complete';
/** @readonly */
export const AGENT_TOOL_EXECUTION_PROGRESS = 'agent:tool:execution_progress';

// ─── Agent session (extended) ─────────────────────────────────────────────────

/** @readonly */
export const AGENT_SESSION_COMPACTION_START = 'agent:session:compaction_start';
/** @readonly */
export const AGENT_SESSION_COMPACTION_COMPLETE = 'agent:session:compaction_complete';
/** @readonly */
export const AGENT_SESSION_USAGE = 'agent:session:usage';
/** @readonly */
export const AGENT_SESSION_TOKEN_BUDGET_WARNING = 'agent:session:token_budget_warning';
/** @readonly */
export const AGENT_SESSION_MODE_CHANGED = 'agent:session:mode_changed';
/** @readonly */
export const AGENT_SESSION_HISTORY_SYNCED = 'agent:session:history_synced';
/** @readonly */
export const AGENT_SESSION_INFO = 'agent:session:info';
/** @readonly */
export const AGENT_SESSION_TITLE_CHANGED = 'agent:session:title_changed';
/** @readonly */
export const AGENT_SESSION_SNAPSHOT_REWIND = 'agent:session:snapshot_rewind';
/** @readonly */
export const AGENT_SESSION_WORKSPACE_FILE_CHANGED = 'agent:session:workspace_file_changed';

// ─── Agent misc ───────────────────────────────────────────────────────────────

/** @readonly */
export const AGENT_CONTEXT_COMPACTED = 'agent:context:compacted';
/** @readonly */
export const AGENT_METRICS = 'agent:metrics';
/** @readonly */
export const AGENT_PERMISSION_MODE_CHANGED = 'agent:permission:mode_changed';
/** @readonly */
export const AGENT_PR_CONSUMED = 'agent:pr:consumed';
/** @readonly */
export const AGENT_PR_FALLBACK_MODEL = 'agent:pr:fallback_model';
/** @readonly */
export const AGENT_QUESTION_PENDING = 'agent:question:pending';
/** @readonly */
export const AGENT_QUESTION_ANSWERED = 'agent:question:answered';
/** @readonly */
export const AGENT_SYSTEM_MESSAGE = 'agent:system:message';

// ─── Agent handoff ────────────────────────────────────────────────────────────

/** @readonly */
export const AGENT_HANDOFF_RECEIVED = 'agent:handoff:received';
/** @readonly */
export const AGENT_HANDOFF_ACCEPTED = 'agent:handoff:accepted';
/** @readonly */
export const AGENT_HANDOFF_REJECTED = 'agent:handoff:rejected';

// ─── Grupos consolidados ──────────────────────────────────────────────────────

/**
 * Array completo de nomes de eventos emitidos pelo AlwaysAliveAgent.
 *
 * Migrado de `core/events.js`. Mantido para compatibilidade com consumidores que iteram via loop. Inclui todos os
 * eventos internos (incluindo strings legadas sem prefixo `agent:`).
 *
 * @type {readonly string[]}
 * @readonly
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
    'agent.metrics',
    // ── background agents e shells ─────────────────────────────────────
    'agent.background.completed',
    'agent.background.idle',
    'agent.shell.completed',
    'agent.shell.detached_completed',
    // ── sessão, comandos, plan mode ─────────────────────────────────────
    'session.title_changed',
    'session.workspace_file_changed',
    'session.info',
    'session.snapshot_rewind',
    'tool.execution_progress',
    'system.message',
    'pending_messages.modified',
    'exit_plan_mode.completed',
    'external_tool.completed',
    // ── streaming & SDK responses ────────────────────────────────────────
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
    // ── agent lifecycle (F55) ─────────────────────────────────────────────
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
 * @typedef {(typeof AGENT_EVENTS)[number]} AgentEventName
 */

/**
 * Eventos que indicam consumo de Premium Requests (via sendMessage).
 *
 * @type {ReadonlySet<string>}
 */
export const PR_CONSUMING_EVENTS = /** @type {ReadonlySet<string>} */ (
    new Set(['task.started', 'task.completed', 'task.error', 'pr.consumed'])
);

/**
 * Eventos do dialog loop que NÃO consomem Premium Requests.
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
 * Conjunto de eventos de alta frequência (hot-path) emitidos a cada turno ou frame de streaming.
 *
 * @type {ReadonlySet<AgentEventName>}
 */
export const HIGH_FREQUENCY_EVENTS = /** @type {ReadonlySet<AgentEventName>} */ (
    new Set(['task.delta', 'task.reasoning', 'session.usage', 'dialog.turn_start', 'dialog.turn_end'])
);
