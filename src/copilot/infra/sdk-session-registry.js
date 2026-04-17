// @ts-check
/**
 * @module copilot/infra/sdk-session-registry
 * @file Registry canônico de sessões SDK ativas no processo.
 *
 *   D1.1/D1.2: move o estado `_sessions` para fora do wrapper `sdk/session/client.js`, preservando a API pública exposta
 *   via `#copilot/sdk` e reduzindo o statefulness do módulo de wrapper.
 */

/** @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession */

/**
 * @typedef {Object} SessionEntry
 * @property {CopilotSession} session
 * @property {string} model
 * @property {number} createdAt
 * @property {number} messagesCount
 */

/** @type {Map<string, SessionEntry>} */
const _activeSdkSessions = new Map();

/**
 * @param {CopilotSession} session
 * @param {{ model?: string; createdAt?: number; messagesCount?: number }} [opts]
 * @returns {SessionEntry}
 */
export function registerActiveSdkSession(session, opts = {}) {
    const entry = {
        session,
        model: opts.model ?? 'unknown',
        createdAt: opts.createdAt ?? Date.now(),
        messagesCount: opts.messagesCount ?? 0,
    };
    _activeSdkSessions.set(session.sessionId, entry);
    return entry;
}

/**
 * @param {string} sessionId
 * @returns {SessionEntry | undefined}
 */
export function getActiveSdkSession(sessionId) {
    return _activeSdkSessions.get(sessionId);
}

/**
 * @returns {({ sessionId: string } & SessionEntry)[]}
 */
export function listActiveSdkSessions() {
    return Array.from(_activeSdkSessions.entries()).map(([sessionId, entry]) => ({ sessionId, ...entry }));
}

/**
 * @param {string} sessionId
 * @returns {boolean}
 */
export function removeActiveSdkSession(sessionId) {
    return _activeSdkSessions.delete(sessionId);
}

/**
 * @param {string} sessionId
 * @returns {number}
 */
export function incrementActiveSdkSessionMessageCount(sessionId) {
    const entry = _activeSdkSessions.get(sessionId);
    if (!entry) return 0;
    entry.messagesCount += 1;
    return entry.messagesCount;
}

/**
 * @returns {number}
 */
export function getActiveSdkSessionCount() {
    return _activeSdkSessions.size;
}

/**
 * @returns {void}
 */
export function clearActiveSdkSessions() {
    _activeSdkSessions.clear();
}
