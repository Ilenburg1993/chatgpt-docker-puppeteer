// @ts-check
/**
 * @module copilot/presentation/conversation-hub
 * @file Superfície compartilhada de handlers de sessions, turns, memory e hub-health consumida por server e terminal.
 *
 *   Este módulo existe para reduzir o papel de `terminal/handlers/dialog.js` como pseudo-camada comum do runtime. Server
 *   e terminal passam a consumir a mesma SSOT de presentation para operações ligadas ao `ConversationHub`.
 */

import { conversationHub, conversationStore } from '#copilot/conversation-hub';
import { getHubSessionId, toError } from '#copilot/core';

/**
 * @typedef {import('./types.js').HandlerResult} HandlerResult
 */

/** Statuses válidos para filtragem de sessions do hub. */
export const VALID_HUB_SESSION_STATUS = /** @type {const} */ (['active', 'closed', 'error']);

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
                status: /** @type {import('../conversation-hub/store-helpers.js').HubSessionStatus} */ (status),
            }),
        };
        const sessions = conversationStore.listHubSessions(opts);
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
        const turns = conversationStore.readTurns(sessionId, { limit, offset });
        const totalCount = conversationStore.countTurns(sessionId);
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
        const id = conversationStore.storeMemory({
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
        const memories = conversationStore.recallMemories({
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
        const deleted = conversationStore.deleteMemory(memoryId);
        return { status: deleted ? 200 : 404, cors: true, body: { ok: deleted, id: memoryId } };
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
        const activeSessions = conversationStore.countHubSessions({ status: 'active' });
        const totalSessions = conversationStore.countHubSessions();
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
