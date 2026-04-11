// @ts-check
/**
 * src/copilot/events/index.js
 *
 * SSOT para strings de eventos cross-module do sistema Copilot.
 *
 * Todos os subsistemas devem importar eventos daqui via `#copilot/events`.
 * Usar strings de evento inline (`'agent:ready'`) fora deste módulo é considerado
 * uma violação arquitetural (critério C11 — PARTE-22).
 *
 * **Regras:**
 * - Sem lógica: apenas `export const` com strings literais
 * - Nomes de constante em UPPER_SNAKE_CASE, agrupados por namespace
 * - Strings de evento no formato `namespace:ação` (hifens para separar palavras em `ação`)
 *
 * @module copilot/events
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

// ─── Agent dialog ─────────────────────────────────────────────────────────────

/** @readonly */
export const AGENT_DIALOG_LOOP_CHANGED = 'agent:dialog:loop:changed';
/** @readonly */
export const AGENT_DIALOG_TURN_TIMEOUT = 'agent:dialog.turn_timeout';

// ─── Hub (Conversation Hub) ───────────────────────────────────────────────────

/** @readonly */
export const HUB_ERROR = 'hub:error';
/** @readonly */
export const HUB_SESSION_CREATED = 'hub:session:created';
/** @readonly */
export const HUB_SESSION_CLOSED = 'hub:session:closed';
/** @readonly */
export const HUB_TURN_SENT = 'hub:turn:sent';
/** @readonly */
export const HUB_TURN_COMPLETE = 'hub:turn:complete';
/** @readonly */
export const HUB_USER_INJECTED = 'hub:user:injected';

// ─── Terminal ─────────────────────────────────────────────────────────────────

/** @readonly */
export const TERMINAL_STARTED = 'terminal:started';
/** @readonly */
export const TERMINAL_STOPPED = 'terminal:stopped';
/** @readonly */
export const TERMINAL_COMMAND = 'terminal:command';

// ─── Audit ────────────────────────────────────────────────────────────────────

/** @readonly */
export const AUDIT_ENTRY = 'audit:entry';
/** @readonly */
export const AUDIT_FLUSH = 'audit:flush';
/** @readonly */
export const AUDIT_LOG = 'audit:log';
/** @readonly */
export const AUDIT_QUICK = 'audit:quick';

// ─── Re-exports de types/events.js para compatibilidade ──────────────────────
export { EVENT_NAMES, EVENT_NAMESPACES } from '../types/events.js';

// ─── Grupos consolidados (para uso em switch/Map) ─────────────────────────────

/**
 * Todos os eventos de agente agrupados.
 *
 * @readonly
 */
export const AGENT_EVENTS = /** @type {const} */ ({
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
