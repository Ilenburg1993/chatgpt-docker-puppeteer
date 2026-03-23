// @ts-check
/**
 * src/copilot/sdk-client.js
 *
 * Fachada de compatibilidade retroativa sobre src/copilot/lib/client.js. Todos os consumers existentes continuam
 * funcionando sem alteração; a lógica real foi movida inteiramente para lib/client.js no Sprint 11.
 *
 * Mapeamento de nomes: getClient() → lib/client.getClient() stopClient() → lib/client.stopClient() (retorna Error[])
 * getClientState() → lib/client.getClientState() createSdkSession() → lib/client.createClientSession()
 * resumeSdkSession() → lib/client.resumeClientSession() disconnectSdkSession() → lib/client.disconnectClientSession()
 * getSdkSession() → lib/client.getClientSession() listActiveSessions() → lib/client.listActiveClientSessions()
 * incrementMessageCount()→ lib/client.incrementSessionMessageCount()
 *
 * @module copilot/sdk-client
 */

import {
    createClientSession,
    disconnectClientSession,
    getActiveSessionCount,
    getAuthStatus,
    getClient,
    getClientSession,
    getClientState,
    getClientStatus,
    incrementSessionMessageCount,
    listActiveClientSessions,
    listAllClientSessions,
    listAvailableModels,
    pingClient,
    resumeClientSession,
    stopClient,
} from '#copilot/lib/client';
import { approveAll } from '@github/copilot-sdk';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 *
 * @typedef {import('@github/copilot-sdk').ResumeSessionConfig} ResumeSessionConfig
 *
 * @typedef {import('@github/copilot-sdk').SessionMetadata} SessionMetadata
 *
 * @typedef {import('@github/copilot-sdk').SessionListFilter} SessionListFilter
 *
 * @typedef {import('@github/copilot-sdk').ModelInfo} ModelInfo
 *
 * @typedef {import('@github/copilot-sdk').GetStatusResponse} GetStatusResponse
 *
 * @typedef {import('@github/copilot-sdk').GetAuthStatusResponse} GetAuthStatusResponse
 *
 * @typedef {import('@github/copilot-sdk').ConnectionState} ConnectionState
 */

/**
 * @typedef {Object} SessionEntry
 * @property {CopilotSession} session - Sessão ativa
 * @property {string} model - Modelo utilizado
 * @property {number} createdAt - Timestamp de criação local
 * @property {number} messagesCount - Total de mensagens enviadas
 */

// ─── Re-exports diretos (mesmos nomes) ──────────────────────────────────────

export {
    getActiveSessionCount,
    getAuthStatus,
    getClient,
    getClientState,
    getClientStatus,
    listAllClientSessions,
    listAvailableModels,
    pingClient,
    stopClient,
};

// ─── Aliases de compatibilidade ──────────────────────────────────────────────

/**
 * Cria uma nova sessão no cliente SDK e registra na memória.
 *
 * @param {Partial<SessionConfig> & { model: string }} config
 * @returns {Promise<CopilotSession>}
 */
export async function createSdkSession(config) {
    const fullConfig = /** @type {SessionConfig} */ ({
        onPermissionRequest: approveAll,
        ...config,
    });
    return createClientSession(fullConfig);
}

/**
 * Retoma uma sessão existente no cliente SDK e registra na memória.
 *
 * @param {string} sessionId
 * @param {Partial<ResumeSessionConfig>} [config]
 * @returns {Promise<CopilotSession>}
 */
export async function resumeSdkSession(sessionId, config = {}) {
    // Se já está ativa no registry, a lib/client.js cuida de retornar a existente
    const fullConfig = /** @type {ResumeSessionConfig} */ ({
        onPermissionRequest: approveAll,
        ...config,
    });
    return resumeClientSession(sessionId, fullConfig);
}

/**
 * Desconecta uma sessão ativa e remove do registry.
 *
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function disconnectSdkSession(sessionId) {
    await disconnectClientSession(sessionId);
}

/**
 * Retorna a sessão ativa de um ID (registry em memória).
 *
 * @param {string} sessionId
 * @returns {object | undefined}
 */
export function getSdkSession(sessionId) {
    return getClientSession(sessionId);
}

/**
 * Retorna todas as entradas de sessão ativas no registry em memória.
 *
 * @returns {object[]}
 */
export function listActiveSessions() {
    return listActiveClientSessions();
}

/**
 * Incrementa o contador de mensagens de uma sessão.
 *
 * @param {string} sessionId
 * @returns {void}
 */
export function incrementMessageCount(sessionId) {
    incrementSessionMessageCount(sessionId);
}
