// @ts-check
/**
 * src/copilot/events/hub-events.js
 *
 * Constantes de eventos do ConversationHub (socket namespaces, sessions, turns, user inject).
 *
 * Migrado de `conversation-hub/events.js` (FAIXA-2A). Consumidores devem importar de `#copilot/events`.
 *
 * @module copilot/events/hub-events
 * @see EventBus
 */

/**
 * Eventos emitidos/consumidos pelo ConversationHub e seus socket namespaces.
 *
 * @readonly
 */
export const HUB_EVENTS = /** @type {const} */ ({
    // ── socket lifecycle ──
    CONNECTION: 'connection',
    DISCONNECT: 'disconnect',

    // ── session management ──
    JOIN_SESSION: 'join:session',
    LEAVE_SESSION: 'leave:session',
    JOINED_SESSION: 'joined:session',
    SESSION_CREATED: 'session:created',
    SESSION_CLOSED: 'session:closed',
    SESSIONS_LIST: 'sessions:list',
    SESSIONS_LIST_RESULT: 'sessions:list:result',

    // ── turns ──
    TURN_DELTA: 'turn:delta',
    TURN_SENT: 'turn:sent',
    TURN_COMPLETE: 'turn:complete',
    TURN_USER_PENDING: 'turn:user_pending',
    TURNS_HISTORY: 'turns:history',
    TURNS_HISTORY_RESULT: 'turns:history:result',

    // ── user inject ──
    USER_INJECT: 'user:inject',
    USER_INJECTED: 'user:injected',
    INJECT_ACK: 'inject:ack',

    // ── errors ──
    HUB_ERROR: 'hub:error',
    ERROR_JOIN: 'error:join',
    ERROR_SESSIONS: 'error:sessions',
    ERROR_HISTORY: 'error:history',
    ERROR_INJECT: 'error:inject',
});

// ─── Constantes individuais (para bridge e subscribers) ──────────────────────

/** @readonly */
export const HUB_ERROR = 'hub:error';
/** @readonly */
export const HUB_SESSION_CREATED = 'session:created';
/** @readonly */
export const HUB_SESSION_CLOSED = 'session:closed';
/** @readonly */
export const HUB_TURN_SENT = 'turn:sent';
/** @readonly */
export const HUB_TURN_COMPLETE = 'turn:complete';
/** @readonly */
export const HUB_USER_INJECTED = 'user:injected';
/** @readonly */
export const HUB_TURN_DELTA = 'turn:delta';
/** @readonly */
export const HUB_TURN_USER_PENDING = 'turn:user_pending';
