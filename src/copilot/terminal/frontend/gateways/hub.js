// @ts-check
/**
 * @file Gateway: hub.
 *
 *   Wraps all conversation hub and store operations: hub readiness, initialization, session management, turns, memories,
 *   search, turn notifications and socket coupling. Isolates `#copilot/conversation-hub`.
 */

import { conversationHub, conversationStore } from '#copilot/conversation-hub';

// ---------------------------------------------------------------------------
// Hub readiness & init
// ---------------------------------------------------------------------------

/**
 * Indica se o hub conversacional está pronto.
 *
 * @returns {boolean}
 */
export function isTerminalHubReady() {
    return conversationHub.isReady;
}

/**
 * Inicializa o hub conversacional.
 *
 * @returns {Promise<void>}
 */
export async function initTerminalConversationHub() {
    await conversationHub.init();
}

// ---------------------------------------------------------------------------
// Store & orchestrator access
// ---------------------------------------------------------------------------

/**
 * Obtém o store canônico do hub.
 *
 * @returns {import('#copilot/conversation-hub').ConversationStore}
 */
export function readTerminalHubStore() {
    return conversationStore;
}

/**
 * Obtém o orchestrator canônico do hub.
 *
 * @returns {import('#copilot/conversation-hub').HubOrchestrator}
 */
export function readTerminalHubOrchestrator() {
    return conversationHub.orchestrator;
}

/**
 * Acopla Socket.IO ao hub inicializado.
 *
 * @param {import('socket.io').Server} io
 * @param {(
 *     io: import('socket.io').Server,
 *     orchestrator: import('#copilot/conversation-hub').HubOrchestrator,
 *     store: import('#copilot/conversation-hub').ConversationStore,
 * ) => void} [mountFn]
 * @returns {void}
 */
export function attachTerminalHubSocketIO(io, mountFn) {
    conversationHub.attachSocketIO(io, mountFn);
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

/**
 * Cria uma hub session para o terminal.
 *
 * @param {{ title?: string; sdkSessionId?: string; metadata?: object }} [opts]
 * @returns {string}
 */
export function createTerminalHubSession(opts = {}) {
    return conversationStore.createHubSession(opts);
}

/**
 * Lê uma hub session pelo ID.
 *
 * @param {string} hubSessionId
 * @returns {Record<string, unknown> | null}
 */
export function readTerminalHubSession(hubSessionId) {
    return conversationStore.getHubSession(hubSessionId);
}

/**
 * Lista hub sessions persistidas.
 *
 * @param {{ limit?: number; offset?: number }} [opts]
 * @returns {Record<string, unknown>[]}
 */
export function readTerminalHubSessions(opts = {}) {
    return conversationStore.listHubSessions({
        limit: opts.limit ?? 10,
        offset: opts.offset ?? 0,
    });
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/**
 * Lê turnos persistidos de uma hub session.
 *
 * @param {string} hubSessionId
 * @param {{ limit?: number; offset?: number }} [opts]
 * @returns {Record<string, unknown>[]}
 */
export function readTerminalHubTurns(hubSessionId, opts = {}) {
    if (typeof conversationStore.readTurns !== 'function') {
        return [];
    }
    return conversationStore.readTurns(hubSessionId, {
        limit: opts.limit ?? 20,
        offset: opts.offset ?? 0,
    });
}

/**
 * Conta quantos turnos existem em uma hub session.
 *
 * Mantém fallback defensivo para mocks/stores antigos que ainda não exponham `countTurns`.
 *
 * @param {string} hubSessionId
 * @returns {number}
 */
export function countTerminalHubTurns(hubSessionId) {
    if (typeof conversationStore.countTurns === 'function') {
        return Number(conversationStore.countTurns(hubSessionId) ?? 0);
    }
    return readTerminalHubTurns(hubSessionId, { limit: 9_999, offset: 0 }).length;
}

/**
 * Busca um turno do hub pelo ID.
 *
 * @param {number} turnId
 * @returns {Record<string, unknown> | null}
 */
export function readTerminalHubTurn(turnId) {
    return conversationStore.getTurn(turnId);
}

/**
 * Persiste uma mensagem sistêmica do terminal no hub.
 *
 * @param {string} hubSessionId
 * @param {string} content
 * @returns {Promise<number>}
 */
export async function writeTerminalHubSystemTurn(hubSessionId, content) {
    return conversationStore.writeTurn(hubSessionId, { role: 'user', content });
}

/**
 * Emite uma notificação de turno do terminal para o hub/orchestrator.
 *
 * @param {string} hubSessionId
 * @param {{ turnId: number; role: 'user' | 'llm_a'; content: string; turnNumber: number; source?: string }} userTurn
 * @param {{ turnId: number; content: string; turnNumber: number; durationMs: number }} llmBTurn
 * @returns {void}
 */
export function notifyTerminalHubTurn(hubSessionId, userTurn, llmBTurn) {
    conversationHub.notifyTerminalTurn(hubSessionId, userTurn, llmBTurn);
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

/**
 * Recupera memórias persistidas no hub.
 *
 * @param {{ tag?: string; search?: string; limit?: number }} [opts]
 * @returns {Record<string, unknown>[]}
 */
export function readTerminalHubMemories(opts = {}) {
    return conversationStore.recallMemories({
        ...(opts.tag ? { tag: opts.tag } : {}),
        ...(opts.search ? { search: opts.search } : {}),
        limit: opts.limit ?? 10,
    });
}

/**
 * Persiste uma memória no hub.
 *
 * @param {{ tag: string; content: string; hubSessionId?: string | null }} payload
 * @returns {string}
 */
export function storeTerminalHubMemory(payload) {
    return conversationStore.storeMemory({
        tag: payload.tag,
        content: payload.content,
        ...(payload.hubSessionId ? { hubSessionId: payload.hubSessionId } : {}),
    });
}

/**
 * Remove uma memória do hub pelo ID.
 *
 * @param {string} memoryId
 * @returns {boolean}
 */
export function deleteTerminalHubMemory(memoryId) {
    return conversationStore.deleteMemory(memoryId);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Indica se a busca FTS do hub está disponível.
 *
 * @returns {boolean}
 */
export function canSearchTerminalHubTurns() {
    return Boolean(conversationHub.isReady && conversationHub.store);
}

/**
 * Busca full-text em turnos persistidos do hub.
 *
 * @param {{ query: string; limit: number; hubSessionId?: string }} opts
 * @returns {Record<string, unknown>[]}
 */
export function searchTerminalHubTurns(opts) {
    if (!conversationHub.isReady || !conversationHub.store) {
        return [];
    }
    return conversationHub.store.searchTurns(opts);
}
