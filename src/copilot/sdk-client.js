// @ts-check
/**
 * src/copilot/sdk-client.js
 *
 * Gerenciador do cliente Copilot SDK — singleton compartilhado entre sdk-api.js e outros consumidores internos.
 *
 * Responsabilidades:
 *
 * - Manter uma instância única de CopilotClient conectada ao CLI
 * - Gerenciar o registry em memória de sessões ativas (sessionId → CopilotSession)
 * - Expor API para criar, retomar, desconectar e listar sessões
 * - Expor o client bruto para operações avançadas (ping, listModels, getAuthStatus, etc.)
 *
 * @module copilot/sdk-client
 */

import { log } from '#core/logger';
import { CopilotClient, approveAll } from '@github/copilot-sdk';

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

/** @type {CopilotClient | null} */
let _client = null;

/** @type {boolean} */
let _starting = false;

/** @type {Map<string, SessionEntry>} */
const _sessions = new Map();

// ─── Funções de bootstrap ────────────────────────────────────────────────────

/**
 * Retorna (ou cria) a instância singleton de CopilotClient já conectada.
 *
 * @returns {Promise<CopilotClient>}
 */
export async function getClient() {
    if (_client && _client.getState() === 'connected') {
        return _client;
    }

    if (_starting) {
        // Aguarda até o cliente estar pronto (poll leve)
        await new Promise((resolve) => {
            const interval = setInterval(() => {
                if (!_starting) {
                    clearInterval(interval);
                    resolve(undefined);
                }
            }, 100);
        });
        if (_client) return _client;
    }

    _starting = true;
    try {
        log('INFO', '[sdk-client] Iniciando CopilotClient...');
        const client = new CopilotClient();
        await client.start();
        _client = client;
        log('INFO', '[sdk-client] CopilotClient conectado.');
        return client;
    } finally {
        _starting = false;
    }
}

/**
 * Para o cliente e limpa todas as sessões do registry.
 *
 * @returns {Promise<void>}
 */
export async function stopClient() {
    if (!_client) return;
    log('INFO', '[sdk-client] Parando CopilotClient...');
    _sessions.clear();
    const errors = await _client.stop();
    if (errors.length > 0) {
        log('WARN', `[sdk-client] Erros ao parar: ${errors.map((e) => e.message).join(', ')}`);
    }
    _client = null;
}

/**
 * Estado atual da conexão do client.
 *
 * @returns {ConnectionState | 'not_started'}
 */
export function getClientState() {
    return _client?.getState() ?? 'not_started';
}

// ─── Gerenciamento de sessões ────────────────────────────────────────────────

/**
 * Cria uma nova sessão no cliente SDK e registra na memória.
 *
 * onPermissionRequest é sempre `approveAll` por padrão — o chamador pode sobrescrever via config.
 *
 * @param {Partial<SessionConfig> & { model: string }} config
 * @returns {Promise<CopilotSession>}
 */
export async function createSdkSession(config) {
    const client = await getClient();
    const fullConfig = /** @type {SessionConfig} */ ({
        onPermissionRequest: approveAll,
        ...config,
    });
    const session = await client.createSession(fullConfig);
    _sessions.set(session.sessionId, {
        session,
        model: config.model,
        createdAt: Date.now(),
        messagesCount: 0,
    });
    log('INFO', `[sdk-client] Sessão criada: ${session.sessionId} (modelo: ${config.model})`);
    return session;
}

/**
 * Retoma uma sessão existente no cliente SDK e registra na memória.
 *
 * @param {string} sessionId
 * @param {Partial<ResumeSessionConfig>} [config]
 * @returns {Promise<CopilotSession>}
 */
export async function resumeSdkSession(sessionId, config = {}) {
    // Se já está ativa no registry, retorna existente
    const existing = _sessions.get(sessionId);
    if (existing) {
        log('INFO', `[sdk-client] Sessão ${sessionId} já está ativa no registry.`);
        return existing.session;
    }

    const client = await getClient();
    const fullConfig = /** @type {ResumeSessionConfig} */ ({
        onPermissionRequest: approveAll,
        ...config,
    });
    const session = await client.resumeSession(sessionId, fullConfig);
    _sessions.set(session.sessionId, {
        session,
        model: config.model ?? 'unknown',
        createdAt: Date.now(),
        messagesCount: 0,
    });
    log('INFO', `[sdk-client] Sessão retomada: ${session.sessionId}`);
    return session;
}

/**
 * Desconecta uma sessão ativa e remove do registry.
 *
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function disconnectSdkSession(sessionId) {
    const entry = _sessions.get(sessionId);
    if (!entry) {
        log('WARN', `[sdk-client] disconnectSdkSession: sessão ${sessionId} não está no registry.`);
        return;
    }
    try {
        await entry.session.disconnect();
    } catch (/** @type {any} */ e) {
        log('WARN', `[sdk-client] Erro ao desconectar sessão ${sessionId}: ${e.message}`);
    }
    _sessions.delete(sessionId);
    log('INFO', `[sdk-client] Sessão ${sessionId} desconectada e removida do registry.`);
}

/**
 * Retorna a sessão ativa de um ID (registry em memória).
 *
 * @param {string} sessionId
 * @returns {SessionEntry | undefined}
 */
export function getSdkSession(sessionId) {
    return _sessions.get(sessionId);
}

/**
 * Retorna todas as entradas de sessão ativas no registry em memória.
 *
 * @returns {({ sessionId: string } & SessionEntry)[]}
 */
export function listActiveSessions() {
    return Array.from(_sessions.entries()).map(([sessionId, entry]) => ({
        sessionId,
        ...entry,
    }));
}

/**
 * Incrementa o contador de mensagens de uma sessão.
 *
 * @param {string} sessionId
 * @returns {void}
 */
export function incrementMessageCount(sessionId) {
    const entry = _sessions.get(sessionId);
    if (entry) entry.messagesCount += 1;
}
