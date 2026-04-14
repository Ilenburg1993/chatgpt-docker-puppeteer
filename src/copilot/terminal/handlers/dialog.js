// @ts-check
/**
 * src/copilot/terminal/handlers-dialog.js
 *
 * Handlers para endpoints de sessão, memória e turnos do ConversationHub.
 *
 * @module copilot/terminal/handlers-dialog
 * @see EventBus
 * @see module:copilot/terminal/route-table
 */

import { CONVERSATION_STORE, HUB } from '#copilot/conversation-hub';
import { container } from '#copilot/core';
import { getHubSessionId } from '../state.js';

/**
 * @typedef {import('./shared.js').HandlerResult} HandlerResult
 */

// ─── GET /sessions ────────────────────────────────────────────────────────────

/**
 * Lista hub_sessions persistidas.
 *
 * @param {{ limit?: number; offset?: number; status?: string }} [params]
 * @returns {HandlerResult}
 */
export function handleListSessions({ limit = 20, offset = 0, status } = {}) {
    // T-25: validar status contra valores permitidos pelo schema HubSessionStatus
    const VALID_STATUS = new Set(['active', 'closed', 'error']);
    if (status !== undefined && !VALID_STATUS.has(status)) {
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
        const sessions = container.resolve(CONVERSATION_STORE).listHubSessions(opts);
        return { status: 200, cors: true, body: { ok: true, sessions, current: getHubSessionId() } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /sessions/:id/turns ──────────────────────────────────────────────────

/**
 * Retorna os turnos de uma sessão específica.
 *
 * @param {{ sessionId: string; limit?: number; offset?: number }} params
 * @returns {HandlerResult}
 */
export function handleListTurns({ sessionId, limit = 50, offset = 0 }) {
    try {
        const turns = container.resolve(CONVERSATION_STORE).readTurns(sessionId, {
            limit: isNaN(limit) ? 50 : limit,
            offset: isNaN(offset) ? 0 : offset,
        });
        // T-26 fix: incluir totalCount para paginação correta no cliente
        const totalCount = container.resolve(CONVERSATION_STORE).countTurns(sessionId);
        return { status: 200, cors: true, body: { ok: true, turns, sessionId, totalCount } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── POST /memory ─────────────────────────────────────────────────────────────

/**
 * Armazena uma memória semântica.
 *
 * @param {{ content?: string; tag?: string }} body
 * @returns {HandlerResult}
 */
export function handleStoreMemory(body) {
    if (!body?.content) {
        return { status: 400, body: { ok: false, error: '"content" obrigatório' } };
    }
    try {
        const _hubSessionId = getHubSessionId();
        const id = container.resolve(CONVERSATION_STORE).storeMemory({
            content: body.content,
            tag: body.tag ?? 'geral',
            ...(_hubSessionId ? { hubSessionId: _hubSessionId } : {}),
        });
        return { status: 201, body: { ok: true, id } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /memory ──────────────────────────────────────────────────────────────

/**
 * Recupera memórias semânticas.
 *
 * @param {{ tag?: string | null; search?: string | null; limit?: number }} [params]
 * @returns {HandlerResult}
 */
export function handleRecallMemories({ tag, search, limit = 20 } = {}) {
    try {
        const memories = container.resolve(CONVERSATION_STORE).recallMemories({
            ...(tag ? { tag } : {}),
            ...(search ? { search } : {}),
            limit: isNaN(/** @type {number} */ (limit)) ? 20 : /** @type {number} */ (limit),
        });
        return { status: 200, cors: true, body: { ok: true, memories } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── DELETE /memory/:id ───────────────────────────────────────────────────────

/**
 * Remove uma memória semântica.
 *
 * @param {{ memoryId: string }} params
 * @returns {HandlerResult}
 */
export function handleDeleteMemory({ memoryId }) {
    try {
        const deleted = container.resolve(CONVERSATION_STORE).deleteMemory(memoryId);
        return { status: deleted ? 200 : 404, cors: true, body: { ok: deleted, id: memoryId } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /hub-health ─────────────────────────────────────────────────────────

/**
 * Executa `SELECT 1` no banco para confirmar que está responsivo. Retorna `{ ok: true }` se o DB responder, `{ ok:
 * false }` com erro descritivo caso contrário.
 *
 * @returns {HandlerResult}
 */
export function handleHubHealth() {
    if (!container.resolve(HUB).isReady) {
        return { status: 503, body: { ok: false, error: 'ConversationHub não inicializado' } };
    }
    try {
        // T-08: usar countHubSessions (COUNT(*)) em vez de listHubSessions({limit:1000}).length — O(1) com índice
        const activeSessions = container.resolve(CONVERSATION_STORE).countHubSessions({ status: 'active' });
        const totalSessions = container.resolve(CONVERSATION_STORE).countHubSessions();
        return {
            status: 200,
            body: {
                ok: true,
                dbResponsive: true,
                activeSessions,
                totalSessions,
            },
        };
    } catch (/** @type {any} */ e) {
        return { status: 503, body: { ok: false, error: e?.message ?? String(e), dbResponsive: false } };
    }
}
