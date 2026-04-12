// @ts-check
/**
 * src/copilot/events/index.js
 *
 * SSOT para strings de eventos cross-module do sistema Copilot.
 *
 * Este arquivo é o barrel central — re-exporta todos os eventos dos submodules:
 *
 * - `events/agent-events.js` — lifecycle, session, task, dialog, handoff
 * - `events/hook-events.js` — HookBus events
 * - `events/hub-events.js` — ConversationHub / Socket.IO events
 * - `events/terminal-events.js` — terminal + audit
 * - `events/system-events.js` — shutdown, config, health, bridges
 * - `events/service-events.js` — services (session, tool, conversation)
 * - `events/nerv-events.js` — mapeamento bidirecional EventBus ↔ NERV
 *
 * Todos os subsistemas devem importar eventos daqui via `#copilot/events`. Usar strings de evento inline
 * (`'agent:ready'`) fora deste módulo é considerado uma violação arquitetural (critério C11 — PARTE-22).
 *
 * @module copilot/events
 * @see EventBus
 */

// ─── Re-exports dos submodules (FAIXA-2A) ────────────────────────────────────

export {
    AGENT_ABORT,
    AGENT_ASSISTANT_INTENT,
    AGENT_ASSISTANT_REASONING_COMPLETE,
    AGENT_ASSISTANT_TURN_END,
    AGENT_ASSISTANT_TURN_START,
    AGENT_BACKGROUND_COMPLETED,
    AGENT_BACKGROUND_IDLE,
    AGENT_BEFORE_STOP,
    AGENT_CONTEXT_COMPACTED,
    AGENT_DIALOG_BOOT_RECOVERY,
    AGENT_DIALOG_COMPACTION_REQUESTED,
    // dialog
    AGENT_DIALOG_DELTA,
    AGENT_DIALOG_LOOP_CHANGED,
    AGENT_DIALOG_PAUSED,
    AGENT_DIALOG_READY,
    AGENT_DIALOG_REPLY,
    AGENT_DIALOG_RESUMED,
    AGENT_DIALOG_STALLED,
    AGENT_DIALOG_STOPPED,
    AGENT_DIALOG_TURN_END,
    AGENT_DIALOG_TURN_START,
    AGENT_DIALOG_TURN_TIMEOUT,
    AGENT_ELICITATION_PENDING,
    AGENT_EMITTER_ERROR,
    AGENT_ERROR,
    // grupos/arrays de classificação (array, para loop dinâmico)
    AGENT_EVENTS,
    AGENT_HANDOFF_ACCEPTED,
    // handoff
    AGENT_HANDOFF_RECEIVED,
    AGENT_HANDOFF_REJECTED,
    // lifecycle
    AGENT_MCP_RECONNECTED,
    AGENT_METRICS,
    AGENT_PERMISSION_MODE_CHANGED,
    AGENT_PR_CONSUMED,
    AGENT_PR_FALLBACK_MODEL,
    AGENT_QUESTION_ANSWERED,
    AGENT_QUESTION_PENDING,
    AGENT_QUOTA_WARNING,
    AGENT_READY,
    AGENT_SDK_LIFECYCLE,
    AGENT_SESSION_CLEANUP,
    AGENT_SESSION_COMPACTION_COMPLETE,
    AGENT_SESSION_COMPACTION_START,
    AGENT_SESSION_CONTEXT_CHANGED,
    AGENT_SESSION_ERROR,
    AGENT_SESSION_FATAL,
    AGENT_SESSION_HANDOFF,
    AGENT_SESSION_HISTORY_SYNCED,
    AGENT_SESSION_INFO,
    // session
    AGENT_SESSION_KEEPALIVE,
    AGENT_SESSION_MODE_CHANGED,
    AGENT_SESSION_SHUTDOWN,
    AGENT_SESSION_SNAPSHOT_REWIND,
    AGENT_SESSION_TASK_COMPLETE,
    AGENT_SESSION_TITLE_CHANGED,
    AGENT_SESSION_TOKEN_BUDGET_WARNING,
    AGENT_SESSION_TRUNCATION,
    AGENT_SESSION_USAGE,
    AGENT_SESSION_WORKSPACE_FILE_CHANGED,
    AGENT_SHELL_COMPLETED,
    AGENT_SHELL_DETACHED_COMPLETED,
    AGENT_SHUTDOWN,
    AGENT_STEERING_SENT,
    AGENT_STOPPED,
    AGENT_SUBAGENT_COMPLETED,
    AGENT_SUBAGENT_FAILED,
    AGENT_SUBAGENT_STARTED,
    AGENT_SYSTEM_MESSAGE,
    AGENT_TASK_COMPLETED,
    AGENT_TASK_DELTA,
    AGENT_TASK_ERROR,
    AGENT_TASK_QUEUED,
    AGENT_TASK_REASONING,
    // task
    AGENT_TASK_STARTED,
    AGENT_TOOL_EXECUTION_COMPLETE,
    AGENT_TOOL_EXECUTION_PROGRESS,
    // tool
    AGENT_TOOL_EXECUTION_START,
    DIALOG_LOOP_EVENTS,
    HIGH_FREQUENCY_EVENTS,
    PR_CONSUMING_EVENTS,
} from './agent-events.js';

export {
    HOOK_ERROR_OCCURRED,
    HOOK_POST_TOOL_USE,
    HOOK_PRE_TOOL_USE,
    HOOK_PROMPT_SUBMITTED,
    HOOK_SESSION_END,
    HOOK_SESSION_START,
} from './hook-events.js';

export {
    HUB_ERROR,
    HUB_EVENTS,
    HUB_SESSION_CLOSED,
    HUB_SESSION_CREATED,
    HUB_TURN_COMPLETE,
    HUB_TURN_DELTA,
    HUB_TURN_SENT,
    HUB_TURN_USER_PENDING,
    HUB_USER_INJECTED,
} from './hub-events.js';

export {
    AUDIT_ENTRY,
    AUDIT_FLUSH,
    AUDIT_LOG,
    AUDIT_QUICK,
    TERMINAL_COMMAND,
    TERMINAL_STARTED,
    TERMINAL_STOPPED,
} from './terminal-events.js';

export {
    BRIDGE_MCP_RECONNECTED,
    BRIDGE_NERV_CONNECTED,
    BRIDGE_NERV_DISCONNECTED,
    CONFIG_CHANGED,
    CONFIG_PINNED_FILES_CHANGED,
    HEALTH_CHECK,
    HEALTH_DEGRADED,
    HEALTH_RECOVERED,
    SYSTEM_SHUTDOWN_COMPLETE,
    SYSTEM_SHUTDOWN_STARTED,
} from './system-events.js';

export {
    SERVICE_SESSION_CREATED,
    SERVICE_SESSION_DISCONNECTED,
    SERVICE_SESSION_MESSAGE,
    SERVICE_SESSION_RESUMED,
    SERVICE_TOOL_INVOKED,
} from './service-events.js';

export {
    EVENTBUS_TO_NERV,
    NERV_COMMAND_PAUSE,
    NERV_COMMAND_RECEIVED,
    NERV_COMMAND_RESTART,
    NERV_COMMAND_RESUME,
    NERV_COMMAND_SEND_MESSAGE,
    NERV_COMMAND_TO_EVENTBUS,
} from './nerv-events.js';

// ─── Re-exports de types/events.js para compatibilidade ──────────────────────
export { EVENT_NAMES, EVENT_NAMESPACES } from '../types/events.js';

// ─── Grupos consolidados (para uso em switch/Map) ─────────────────────────────

import {
    AGENT_BEFORE_STOP,
    AGENT_DIALOG_LOOP_CHANGED,
    AGENT_DIALOG_TURN_TIMEOUT,
    AGENT_EMITTER_ERROR,
    AGENT_ERROR,
    AGENT_READY,
    AGENT_SESSION_FATAL,
    AGENT_SESSION_KEEPALIVE,
    AGENT_SHUTDOWN,
    AGENT_STOPPED,
    AGENT_TASK_DELTA,
    AGENT_TASK_ERROR,
    AGENT_TASK_STARTED,
} from './agent-events.js';

import {
    HUB_ERROR,
    HUB_SESSION_CLOSED,
    HUB_SESSION_CREATED,
    HUB_TURN_COMPLETE,
    HUB_TURN_SENT,
    HUB_USER_INJECTED,
} from './hub-events.js';

import {
    AUDIT_ENTRY,
    AUDIT_FLUSH,
    AUDIT_LOG,
    AUDIT_QUICK,
    TERMINAL_COMMAND,
    TERMINAL_STARTED,
    TERMINAL_STOPPED,
} from './terminal-events.js';

/**
 * Mapa de eventos de agente agrupados (para uso em switch/Map). Para o array de eventos do SDK (loop dinâmico de
 * listeners), use `AGENT_EVENTS`.
 *
 * @readonly
 */
export const AGENT_EVENTS_MAP = /** @type {const} */ ({
    READY: AGENT_READY,
    BEFORE_STOP: AGENT_BEFORE_STOP,
    STOPPED: AGENT_STOPPED,
    SHUTDOWN: AGENT_SHUTDOWN,
    ERROR: AGENT_ERROR,
    EMITTER_ERROR: AGENT_EMITTER_ERROR,
    SESSION_KEEPALIVE: AGENT_SESSION_KEEPALIVE,
    SESSION_FATAL: AGENT_SESSION_FATAL,
    TASK_STARTED: AGENT_TASK_STARTED,
    TASK_DELTA: AGENT_TASK_DELTA,
    TASK_ERROR: AGENT_TASK_ERROR,
    DIALOG_LOOP_CHANGED: AGENT_DIALOG_LOOP_CHANGED,
    DIALOG_TURN_TIMEOUT: AGENT_DIALOG_TURN_TIMEOUT,
});

/**
 * Todos os eventos de hub agrupados.
 *
 * @readonly
 */
export const HUB_EVENTS_MAP = /** @type {const} */ ({
    ERROR: HUB_ERROR,
    SESSION_CREATED: HUB_SESSION_CREATED,
    SESSION_CLOSED: HUB_SESSION_CLOSED,
    TURN_SENT: HUB_TURN_SENT,
    TURN_COMPLETE: HUB_TURN_COMPLETE,
    USER_INJECTED: HUB_USER_INJECTED,
});

/**
 * Todos os eventos de terminal agrupados.
 *
 * @readonly
 */
export const TERMINAL_EVENTS = /** @type {const} */ ({
    STARTED: TERMINAL_STARTED,
    STOPPED: TERMINAL_STOPPED,
    COMMAND: TERMINAL_COMMAND,
});

/**
 * Todos os eventos de audit agrupados.
 *
 * @readonly
 */
export const AUDIT_EVENTS = /** @type {const} */ ({
    ENTRY: AUDIT_ENTRY,
    FLUSH: AUDIT_FLUSH,
    LOG: AUDIT_LOG,
    QUICK: AUDIT_QUICK,
});
