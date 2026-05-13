// @ts-check
/**
 * @module copilot/presentation/conversation-hub
 * @file Superfície compartilhada de handlers de sessions, turns, memory e hub-health consumida por server e terminal.
 *
 *   Este módulo existe para reduzir o papel de `terminal/handlers/dialog.js` como pseudo-camada comum do runtime. Server
 *   e terminal passam a consumir a mesma SSOT de presentation para operações ligadas ao `ConversationHub`.
 */

import { CONVERSATION_STORE, conversationHub, conversationStore } from '#copilot/conversation-hub';
import { container, getHubSessionId, getSharedSdkSessionId, toError } from '#copilot/core';

/**
 * @typedef {import('../contracts/index.js').HandlerResult} HandlerResult
 */

/** Statuses válidos para filtragem de sessions do hub. */
export const VALID_HUB_SESSION_STATUS = /** @type {const} */ (['active', 'closed', 'error']);

/**
 * @returns {import('../../conversation-hub/store.js').ConversationStore}
 */
function getConversationStore() {
    return container.has(CONVERSATION_STORE) ? container.resolve(CONVERSATION_STORE) : conversationStore;
}

/**
 * Lista hub_sessions persistidas.
 *
 * @param {{ limit?: number; offset?: number; status?: string }} [params]
 * @returns {HandlerResult}
 */
export function handleListSessions({ limit = 20, offset = 0, status } = {}) {
    if (status !== undefined && !VALID_HUB_SESSION_STATUS.some((valid) => valid === status)) {
        return { status: 400, body: { ok: false, error: `status inválido: "${status}". Use: active, closed, error` } };
    }
    try {
        const opts = {
            limit: isNaN(limit) ? 20 : limit,
            offset: isNaN(offset) ? 0 : offset,
            ...(status !== undefined && {
                status: /** @type {import('../../conversation-hub/store-helpers.js').HubSessionStatus} */ (status),
            }),
        };
        const sessions = getConversationStore().listHubSessions(opts);
        return { status: 200, cors: true, body: { ok: true, sessions, current: getHubSessionId() } };
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
    }
}

/**
 * Retorna os turnos de uma sessão específica.
 *
 * @param {Record<string, unknown>} params
 * @returns {HandlerResult}
 */
export function handleListTurns(params) {
    const sessionId = typeof params['sessionId'] === 'string' ? params['sessionId'] : '';
    const rawLimit = params['limit'];
    const rawOffset = params['offset'];
    const limit = typeof rawLimit === 'number' && !isNaN(rawLimit) ? rawLimit : 50;
    const offset = typeof rawOffset === 'number' && !isNaN(rawOffset) ? rawOffset : 0;
    try {
        const store = getConversationStore();
        const turns = store.readTurns(sessionId, { limit, offset });
        const totalCount = store.countTurns(sessionId);
        return { status: 200, cors: true, body: { ok: true, turns, sessionId, totalCount } };
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
    }
}

/**
 * Armazena uma memória semântica.
 *
 * @param {{ content?: string; tag?: string; hubSessionId?: string | null }} body
 * @returns {HandlerResult}
 */
export function handleStoreMemory(body) {
    if (!body?.content) {
        return { status: 400, body: { ok: false, error: '"content" obrigatório' } };
    }
    try {
        const hubSessionId = typeof body.hubSessionId === 'string' ? body.hubSessionId : getHubSessionId();
        const id = getConversationStore().storeMemory({
            content: body.content,
            tag: body.tag ?? 'geral',
            ...(hubSessionId ? { hubSessionId } : {}),
        });
        return { status: 201, body: { ok: true, id } };
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
    }
}

/**
 * Recupera memórias semânticas.
 *
 * @param {{ tag?: string | null; search?: string | null; limit?: number }} [params]
 * @returns {HandlerResult}
 */
export function handleRecallMemories({ tag, search, limit = 20 } = {}) {
    try {
        const memories = getConversationStore().recallMemories({
            ...(tag ? { tag } : {}),
            ...(search ? { search } : {}),
            limit: isNaN(/** @type {number} */ (limit)) ? 20 : /** @type {number} */ (limit),
        });
        return { status: 200, cors: true, body: { ok: true, memories } };
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
    }
}

/**
 * Remove uma memória semântica.
 *
 * @param {{ memoryId: string }} params
 * @returns {HandlerResult}
 */
export function handleDeleteMemory({ memoryId }) {
    try {
        const deleted = getConversationStore().deleteMemory(memoryId);
        return { status: deleted ? 200 : 404, cors: true, body: { ok: deleted, id: memoryId } };
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
    }
}

/**
 * Retorna uma hub session específica.
 *
 * @param {{ sessionId?: string }} params
 * @returns {HandlerResult}
 */
export function handleGetHubSession({ sessionId = '' } = {}) {
    if (!sessionId) {
        return { status: 400, body: { ok: false, error: 'sessionId obrigatório' } };
    }
    try {
        const session = getConversationStore().getHubSession(sessionId);
        if (!session) {
            return { status: 404, body: { ok: false, error: `Session não encontrada: ${sessionId}` } };
        }
        return { status: 200, body: { ok: true, session } };
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
    }
}

/**
 * Cria uma nova hub session.
 *
 * @param {{ body?: { title?: string; sdkSessionId?: string; metadata?: Record<string, unknown> } }} params
 * @returns {HandlerResult}
 */
export function handleCreateHubSession({ body = {} } = {}) {
    const { title, sdkSessionId, metadata } = body;
    try {
        /** @type {{ title?: string; sdkSessionId?: string; metadata?: object }} */
        const hubOpts = {};
        if (title) hubOpts.title = title;
        if (sdkSessionId) {
            hubOpts.sdkSessionId = sdkSessionId;
        } else {
            const activeSdkSessionId = getSharedSdkSessionId();
            if (activeSdkSessionId) hubOpts.sdkSessionId = activeSdkSessionId;
        }
        if (metadata) hubOpts.metadata = metadata;

        const id = getConversationStore().createHubSession(hubOpts);
        return { status: 201, body: { ok: true, id } };
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
    }
}

/**
 * Fecha uma hub session existente.
 *
 * @param {{ sessionId?: string }} params
 * @returns {HandlerResult}
 */
export function handleCloseHubSession({ sessionId = '' } = {}) {
    if (!sessionId) {
        return { status: 400, body: { ok: false, error: 'sessionId obrigatório' } };
    }
    try {
        const store = getConversationStore();
        const existing = store.getHubSession(sessionId);
        if (!existing) {
            return { status: 404, body: { ok: false, error: `Session não encontrada: ${sessionId}` } };
        }
        store.closeHubSession(sessionId);
        return { status: 200, body: { ok: true, closed: sessionId } };
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
    }
}

/**
 * Executa verificação simples de responsividade do `ConversationHub` e seu store.
 *
 * @returns {HandlerResult}
 */
export function handleHubHealth() {
    if (!conversationHub.isReady) {
        return { status: 503, body: { ok: false, error: 'ConversationHub não inicializado' } };
    }
    try {
        const store = getConversationStore();
        const activeSessions = store.countHubSessions({ status: 'active' });
        const totalSessions = store.countHubSessions();
        return {
            status: 200,
            body: {
                ok: true,
                dbResponsive: true,
                activeSessions,
                totalSessions,
            },
        };
    } catch (e) {
        return { status: 503, body: { ok: false, error: toError(e).message ?? String(e), dbResponsive: false } };
    }
}
