// @ts-check
/**
 * src/copilot/agent/session/history/history-sync.js
 *
 * Sincronização de histórico SDK → ConversationStore e cache de mensagens.
 *
 * Extraído do AlwaysAliveAgent (F32) como funções puras sem estado próprio.
 *
 * @module copilot/agent/session/history-sync
 * @see EventBus
 */

import { withAgentErrorPolicy } from '../../error-policy.js';
import { canReadAgentSdkSessionMessages, readAgentSdkSessionMessages } from '../../facades/agent-sdk-runtime.js';
import { log } from '../../ports/logging-port.js';

const DEFAULT_MESSAGES_CACHE_MAX_ITEMS = 1_000;

/**
 * @param {unknown} err
 * @returns {string}
 */
function getRootErrorMessage(err) {
    if (err instanceof Error) {
        const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (err));
        const cause = raw['cause'];
        if (cause instanceof Error && typeof cause.message === 'string' && cause.message.length > 0) {
            return cause.message;
        }
        return err.message;
    }
    return String(err);
}

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
 * @typedef {{
 *     hubSessionId: string | null;
 *     synced: number;
 *     skipped: number;
 *     unavailableReason: 'hub_session_missing' | 'sdk_getMessages_unavailable' | null;
 * }} SessionHistorySyncResult
 */

/**
 * @param {CopilotSession} session
 * @param {{ getHubSessionId: () => string | null; conversationStore: ConversationStoreLike }} deps
 * @returns {Promise<SessionHistorySyncResult>}
 */
async function runSdkHistorySync(session, deps) {
    const hubSessionId = deps.getHubSessionId();
    if (!hubSessionId) {
        return { hubSessionId: null, synced: 0, skipped: 0, unavailableReason: 'hub_session_missing' };
    }

    if (!canReadAgentSdkSessionMessages(session)) {
        return {
            hubSessionId,
            synced: 0,
            skipped: 0,
            unavailableReason: 'sdk_getMessages_unavailable',
        };
    }

    const messages = await readAgentSdkSessionMessages(session);
    if (!Array.isArray(messages) || messages.length === 0) {
        return { hubSessionId, synced: 0, skipped: 0, unavailableReason: null };
    }

    const { synced, skipped } = deps.conversationStore.syncFromSdkHistory(
        hubSessionId,
        session.sessionId,
        /** @type {{ id?: string; type: string; content: string; createdAt?: number }[]} */ (
            /** @type {unknown} */ (messages)
        ),
    );

    return { hubSessionId, synced, skipped, unavailableReason: null };
}

/**
 * Sincroniza o histórico SDK → ConversationStore (SQLite) após reconexão.
 *
 * Chamado de forma assíncrona (fire-and-forget) no `start()` quando `isResumed=true` para não bloquear o startup.
 * Falhas são logadas como WARN e não propagadas.
 *
 * @param {CopilotSession} session
 * @param {(event: string, payload?: unknown) => boolean} emit
 * @param {{ getHubSessionId: () => string | null; conversationStore: ConversationStoreLike }} deps
 * @param {{
 *     label?: string;
 *     phase?: string;
 *     taskId?: string;
 * }} [policy]
 * @returns {Promise<import('../../error-policy.js').AgentPolicyResult<SessionHistorySyncResult>>}
 */
export async function syncSdkHistory(session, emit, deps, policy = {}) {
    const label = policy.label ?? 'session.history.sync';
    const result = await withAgentErrorPolicy(() => runSdkHistorySync(session, deps), {
        label,
        phase: policy.phase ?? 'resume',
        ...(policy.taskId !== undefined ? { taskId: policy.taskId } : {}),
        sessionId: session.sessionId,
        onError: (error, disposition, context) => {
            const rootMessage = getRootErrorMessage(error);
            log('WARN', `[AlwaysAlive] ${context.label ?? label} falhou (${disposition}): ${rootMessage}`);
            emit('session.history_synced', {
                ok: false,
                error: rootMessage,
                disposition,
                sessionId: session.sessionId,
            });
        },
    });

    if (!result.ok) {
        return result;
    }

    if (result.value.unavailableReason === 'sdk_getMessages_unavailable') {
        log(
            'WARN',
            '[AlwaysAlive] Leitura de histórico indisponível nesta versão do SDK — histórico não sincronizado.',
        );
        return result;
    }

    if (result.value.synced > 0 && result.value.hubSessionId) {
        log(
            'INFO',
            `[AlwaysAlive] ${result.value.synced} turnos SDK sincronizados com o ConversationStore (${result.value.skipped} ignorados).`,
        );
        emit('session.history_synced', {
            hubSessionId: result.value.hubSessionId,
            sessionId: session.sessionId,
            synced: result.value.synced,
            skipped: result.value.skipped,
        });
    }

    return result;
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

    /** @type {number} */
    #maxItems;

    /**
     * @param {number} ttlMs — TTL em ms (padrão do config)
     * @param {{ maxItems?: number }} [opts]
     */
    constructor(ttlMs, opts = {}) {
        this.#ttlMs = ttlMs;
        this.#maxItems = Math.max(1, Math.trunc(opts.maxItems ?? DEFAULT_MESSAGES_CACHE_MAX_ITEMS));
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
            const messages = await readAgentSdkSessionMessages(session);
            this.#cache = messages.length > this.#maxItems ? messages.slice(-this.#maxItems) : messages;
            this.#cacheAt = now;
            return this.#cache;
        } catch {
            return [];
        }
    }
}
