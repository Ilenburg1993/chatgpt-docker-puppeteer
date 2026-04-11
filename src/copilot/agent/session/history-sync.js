// @ts-check
/**
 * src/copilot/agent/session/history-sync.js
 *
 * Sincronização de histórico SDK → ConversationStore e cache de mensagens.
 *
 * Extraído do AlwaysAliveAgent (F32) como funções puras sem estado próprio.
 *
 * @module copilot/agent/session/history-sync
 */

import { log } from '#copilot/observability';

/**
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 */

/**
 * @typedef {{
 *     syncFromSdkHistory: (
 *         hubSessionId: string,
 *         sessionId: string,
 *         messages: { id?: string; type: string; content: string; createdAt?: number }[],
 *     ) => { synced: number; skipped: number };
 * }} ConversationStoreLike
 */

/**
 * Sincroniza o histórico SDK → ConversationStore (SQLite) após reconexão.
 *
 * Chamado de forma assíncrona (fire-and-forget) no `start()` quando `isResumed=true` para não bloquear o startup.
 * Falhas são logadas como WARN e não propagadas.
 *
 * @param {CopilotSession} session
 * @param {(event: string, payload?: unknown) => boolean} emit
 * @param {{ getHubSessionId: () => string | null; conversationStore: ConversationStoreLike }} deps
 * @returns {Promise<void>}
 */
export async function syncSdkHistory(session, emit, deps) {
    try {
        const hubSessionId = deps.getHubSessionId();
        if (!hubSessionId) return;
        const sdkSession = /** @type {{ getMessages?: () => Promise<unknown[]> }} */ (session);
        if (typeof sdkSession.getMessages !== 'function') {
            log(
                'WARN',
                '[AlwaysAlive] sdkSession.getMessages() não disponível nesta versão do SDK — histórico não sincronizado.',
            );
            return;
        }
        const messages = await sdkSession.getMessages();
        if (!Array.isArray(messages) || messages.length === 0) return;
        const { synced, skipped } = deps.conversationStore.syncFromSdkHistory(
            hubSessionId,
            session.sessionId,
            /** @type {{ id?: string; type: string; content: string; createdAt?: number }[]} */ (messages),
        );
        if (synced > 0) {
            log(
                'INFO',
                `[AlwaysAlive] ${synced} turnos SDK sincronizados com o ConversationStore (${skipped} ignorados).`,
            );
            emit('session.history_synced', { hubSessionId, sessionId: session.sessionId, synced, skipped });
        }
    } catch (/** @type {any} */ err) {
        log('WARN', `[AlwaysAlive] syncSdkHistory falhou (não crítico): ${err.message}`);
        emit('session.history_synced', { ok: false, error: err.message });
    }
}

/**
 * Cache de mensagens da sessão SDK com TTL.
 */
export class SessionMessagesCache {
    /** @type {unknown[] | null} */
    #cache = null;

    /** @type {number} */
    #cacheAt = 0;

    /** @type {number} */
    #ttlMs;

    /**
     * @param {number} ttlMs — TTL em ms (padrão do config)
     */
    constructor(ttlMs) {
        this.#ttlMs = ttlMs;
    }

    /** Invalida o cache (ex.: reconexão). */
    invalidate() {
        this.#cache = null;
    }

    /**
     * Retorna o histórico de mensagens da sessão SDK ativa com cache.
     *
     * @param {CopilotSession | null} session
     * @returns {Promise<unknown[]>}
     */
    async get(session) {
        if (!session) return [];
        const now = Date.now();
        if (this.#cache !== null && now - this.#cacheAt < this.#ttlMs) {
            return this.#cache;
        }
        try {
            const messages = await session.getMessages();
            this.#cache = messages;
            this.#cacheAt = now;
            return messages;
        } catch {
            return [];
        }
    }
}
