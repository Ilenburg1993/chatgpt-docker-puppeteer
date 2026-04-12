// @ts-check
/**
 * src/copilot/events/index.js
 *
 * SSOT para strings de eventos cross-module do sistema Copilot.
 *
 * Este arquivo é o barrel central — re-exporta todos os eventos dos submodules:
 *   - `events/agent-events.js` — lifecycle, session, task, dialog, handoff
 *   - `events/hook-events.js`  — HookBus events
 *   - `events/hub-events.js`   — ConversationHub / Socket.IO events
 *   - `events/terminal-events.js` — terminal + audit
 *   - `events/system-events.js`   — shutdown, config, health, bridges
 *
 * Todos os subsistemas devem importar eventos daqui via `#copilot/events`. Usar strings de evento inline
 * (`'agent:ready'`) fora deste módulo é considerado uma violação arquitetural (critério C11 — PARTE-22).
 *
 * @module copilot/events
 * @see EventBus
 */

// ─── Re-exports dos submodules (FAIXA-2A) ────────────────────────────────────

export {
    // lifecycle
    AGENT_READY,
    AGENT_BEFORE_STOP,
    AGENT_STOPPED,
    AGENT_SHUTDOWN,
    AGENT_ERROR,
    AGENT_EMITTER_ERROR,
    // session
    AGENT_SESSION_KEEPALIVE,
    AGENT_SESSION_FATAL,
    // task
    AGENT_TASK_STARTED,
    AGENT_TASK_DELTA,
    AGENT_TASK_ERROR,
    // dialog
    AGENT_DIALOG_LOOP_CHANGED,
    AGENT_DIALOG_TURN_TIMEOUT,
    AGENT_DIALOG_STALLED,
    AGENT_DIALOG_PAUSED,
    AGENT_DIALOG_RESUMED,
    AGENT_DIALOG_STOPPED,
    AGENT_DIALOG_REPLY,
    AGENT_DIALOG_COMPACTION_REQUESTED,
    // handoff
    AGENT_HANDOFF_RECEIVED,
    AGENT_HANDOFF_ACCEPTED,
    AGENT_HANDOFF_REJECTED,
    // grupos/arrays de classificação (array, para loop dinâmico)
    AGENT_EVENTS,
    PR_CONSUMING_EVENTS,
    DIALOG_LOOP_EVENTS,
    HIGH_FREQUENCY_EVENTS,
} from './agent-events.js';

export {
    HOOK_PRE_TOOL_USE,
    HOOK_POST_TOOL_USE,
    HOOK_PROMPT_SUBMITTED,
    HOOK_SESSION_START,
    HOOK_SESSION_END,
    HOOK_ERROR_OCCURRED,
} from './hook-events.js';

export {
    HUB_EVENTS,
    HUB_ERROR,
    HUB_SESSION_CREATED,
    HUB_SESSION_CLOSED,
    HUB_TURN_SENT,
    HUB_TURN_COMPLETE,
    HUB_USER_INJECTED,
    HUB_TURN_DELTA,
    HUB_TURN_USER_PENDING,
} from './hub-events.js';

export {
    TERMINAL_STARTED,
    TERMINAL_STOPPED,
    TERMINAL_COMMAND,
    AUDIT_ENTRY,
    AUDIT_FLUSH,
    AUDIT_LOG,
    AUDIT_QUICK,
} from './terminal-events.js';

export {
    SYSTEM_SHUTDOWN_STARTED,
    SYSTEM_SHUTDOWN_COMPLETE,
    CONFIG_PINNED_FILES_CHANGED,
    CONFIG_CHANGED,
    HEALTH_CHECK,
    HEALTH_DEGRADED,
    HEALTH_RECOVERED,
    BRIDGE_MCP_RECONNECTED,
    BRIDGE_NERV_CONNECTED,
    BRIDGE_NERV_DISCONNECTED,
} from './system-events.js';

// ─── Re-exports de types/events.js para compatibilidade ──────────────────────
export { EVENT_NAMES, EVENT_NAMESPACES } from '../types/events.js';

// ─── Grupos consolidados (para uso em switch/Map) ─────────────────────────────

import {
    AGENT_READY,
    AGENT_BEFORE_STOP,
    AGENT_STOPPED,
    AGENT_SHUTDOWN,
    AGENT_ERROR,
    AGENT_EMITTER_ERROR,
    AGENT_SESSION_KEEPALIVE,
    AGENT_SESSION_FATAL,
    AGENT_TASK_STARTED,
    AGENT_TASK_DELTA,
    AGENT_TASK_ERROR,
    AGENT_DIALOG_LOOP_CHANGED,
    AGENT_DIALOG_TURN_TIMEOUT,
} from './agent-events.js';

import {
    HUB_ERROR,
    HUB_SESSION_CREATED,
    HUB_SESSION_CLOSED,
    HUB_TURN_SENT,
    HUB_TURN_COMPLETE,
    HUB_USER_INJECTED,
} from './hub-events.js';

import { TERMINAL_STARTED, TERMINAL_STOPPED, TERMINAL_COMMAND } from './terminal-events.js';
import { AUDIT_ENTRY, AUDIT_FLUSH, AUDIT_LOG, AUDIT_QUICK } from './terminal-events.js';

/**
 * Mapa de eventos de agente agrupados (para uso em switch/Map).
 * Para o array de eventos do SDK (loop dinâmico de listeners), use `AGENT_EVENTS`.
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
