// @ts-check
/**
 * @module copilot/conversation-hub/broadcast
 * @file Funções de broadcast do namespace Socket.IO do ConversationHub.
 *
 *   A instância do namespace é injetada por `server/socket/hub-ns.js` após a montagem, invertendo a dependência: server →
 *   conversation-hub (direção correta).
 *
 *   Faixa 3.1 extra: resolve conversation-hub → server layer violation (não-AC-1).
 *
 *   src/copilot/conversation-hub/broadcast.js
 */

/** @type {import('socket.io').Namespace | null} */
let _copilotNamespace = null;

/**
 * Injeta a instância do namespace Socket.IO. Chamado por `server/socket/hub-ns.js::mountCopilotNamespace()` após
 * criação do namespace.
 *
 * @param {import('socket.io').Namespace | null} ns - Namespace /copilot montado, ou null ao desmontar.
 * @returns {void}
 */
export function setCopilotNamespace(ns) {
    _copilotNamespace = ns;
}

/**
 * Emite um evento para todos os clients conectados ao namespace /copilot.
 *
 * @param {string} event - Nome do evento Socket.IO.
 * @param {unknown} payload - Payload do evento.
 * @returns {void}
 */
export function broadcastGlobal(event, payload) {
    if (!_copilotNamespace) return;
    _copilotNamespace.emit(event, payload);
}

/**
 * Emite um evento para todos os clients de uma sessão específica (room = hubSessionId).
 *
 * @param {string} hubSessionId - ID da sessão hub (usado como nome de sala Socket.IO).
 * @param {string} event - Nome do evento Socket.IO.
 * @param {unknown} payload - Payload do evento.
 * @returns {void}
 */
export function broadcastToSession(hubSessionId, event, payload) {
    if (!_copilotNamespace) return;
    _copilotNamespace.to(hubSessionId).emit(event, payload);
}
