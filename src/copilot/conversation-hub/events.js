// @ts-check
/**
 * src/copilot/conversation-hub/events.js
 *
 * F55/F314 — Constantes de eventos do Conversation Hub (socket namespaces).
 *
 * @module copilot/conversation-hub/events
 * @see EventBus
 */

/**
 * Eventos emitidos/consumidos pelo ConversationHub e seus socket namespaces.
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
