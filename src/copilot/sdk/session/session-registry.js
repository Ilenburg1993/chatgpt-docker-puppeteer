// @ts-check
/**
 * @module copilot/sdk/session/session-registry
 * @file Registry canônico de sessões SDK ativas no processo.
 *
 *   Mantém o estado de sessões dentro da fronteira `sdk/session`, onde ele é consumido e governado pelo
 *   `CopilotClientManager`. O registry default preserva a fachada pública do client; runtimes isolados podem injetar
 *   instâncias próprias para evitar acoplamento por estado global.
 */

/** @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession */

/**
 * @typedef {Object} SessionEntry
 * @property {CopilotSession} session
 * @property {string} model
 * @property {number} createdAt
 * @property {number} messagesCount
 */

/**
 * @typedef {Object} SdkSessionRegistry
 * @property {(
 *     session: CopilotSession,
 *     opts?: { model?: string; createdAt?: number; messagesCount?: number },
 * ) => SessionEntry} register
 * @property {(sessionId: string) => SessionEntry | undefined} get
 * @property {() => ({ sessionId: string } & SessionEntry)[]} list
 * @property {(sessionId: string) => boolean} remove
 * @property {(sessionId: string) => number} incrementMessageCount
 * @property {() => number} count
 * @property {() => void} clear
 */

/**
 * Cria um registry isolado de sessões SDK ativas.
 *
 * @returns {SdkSessionRegistry}
 */
export function createSdkSessionRegistry() {
    /** @type {Map<string, SessionEntry>} */
    const sessions = new Map();

    return {
        register(session, opts = {}) {
            const entry = {
                session,
                model: opts.model ?? 'unknown',
                createdAt: opts.createdAt ?? Date.now(),
                messagesCount: opts.messagesCount ?? 0,
            };
            sessions.set(session.sessionId, entry);
            return entry;
        },
        get(sessionId) {
            return sessions.get(sessionId);
        },
        list() {
            return Array.from(sessions.entries()).map(([sessionId, entry]) => ({ sessionId, ...entry }));
        },
        remove(sessionId) {
            return sessions.delete(sessionId);
        },
        incrementMessageCount(sessionId) {
            const entry = sessions.get(sessionId);
            if (!entry) return 0;
            entry.messagesCount += 1;
            return entry.messagesCount;
        },
        count() {
            return sessions.size;
        },
        clear() {
            sessions.clear();
        },
    };
}

export const defaultSdkSessionRegistry = createSdkSessionRegistry();

/**
 * @param {CopilotSession} session
 * @param {{ model?: string; createdAt?: number; messagesCount?: number }} [opts]
 * @returns {SessionEntry}
 */
export function registerActiveSdkSession(session, opts = {}) {
    return defaultSdkSessionRegistry.register(session, opts);
}

/**
 * @param {string} sessionId
 * @returns {SessionEntry | undefined}
 */
export function getActiveSdkSession(sessionId) {
    return defaultSdkSessionRegistry.get(sessionId);
}

/**
 * @returns {({ sessionId: string } & SessionEntry)[]}
 */
export function listActiveSdkSessions() {
    return defaultSdkSessionRegistry.list();
}

/**
 * @param {string} sessionId
 * @returns {boolean}
 */
export function removeActiveSdkSession(sessionId) {
    return defaultSdkSessionRegistry.remove(sessionId);
}

/**
 * @param {string} sessionId
 * @returns {number}
 */
export function incrementActiveSdkSessionMessageCount(sessionId) {
    return defaultSdkSessionRegistry.incrementMessageCount(sessionId);
}

/**
 * @returns {number}
 */
export function getActiveSdkSessionCount() {
    return defaultSdkSessionRegistry.count();
}

/**
 * @returns {void}
 */
export function clearActiveSdkSessions() {
    defaultSdkSessionRegistry.clear();
}
