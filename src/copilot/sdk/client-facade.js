// @ts-check
/**
 * src/copilot/sdk/client-facade.js
 *
 * Facade de alto nível que unifica Client + Session + Config em operações simples de uma chamada. Reduz boilerplate ao
 * combinar getClient(), buildSessionConfig() e createSession() em um único fluxo.
 *
 * @module copilot/sdk/client-facade
 * @see EventBus
 * @see module:copilot/sdk/client
 * @see module:copilot/sdk/session
 * @see module:copilot/sdk/config
 */

import { forceStopClient, getClient, getClientState, stopClient } from './client.js';
import { createSession, disconnectSession, resumeOrCreate } from './session.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 *
 * @typedef {import('./session.js').SessionCreateOptions} SessionCreateOptions
 *
 * @typedef {import('./session.js').SessionResult} SessionResult
 */

// ─── quickSession ─────────────────────────────────────────────────────────────

/**
 * Cria uma sessão pronta para uso em uma única chamada. Internamente: getClient() → buildSessionConfig(opts) →
 * createSession(client, opts).
 *
 * @example
 *     ```js
 *     import { quickSession } from '#copilot/sdk/client-facade';
 *     const { session, sessionId } = await quickSession({ model: 'claude-4' });
 *     const reply = await session.sendAndWait({ prompt: 'Hello!' });
 *     ```;
 *
 * @param {Partial<SessionCreateOptions>} [opts={}] - Opções parciais; project defaults preenchem o restante. Default is
 *   `{}`
 * @returns {Promise<SessionResult>}
 * @throws {Error} Se o client ou a criação de sessão falharem
 */
export async function quickSession(opts = {}) {
    const client = await getClient();
    return createSession(client, /** @type {SessionCreateOptions} */ (opts));
}

// ─── quickResume ──────────────────────────────────────────────────────────────

/**
 * Retoma uma sessão existente ou cria uma nova se a sessão expirou. Combina getClient() + resumeOrCreate() em uma única
 * chamada.
 *
 * @param {string | null | undefined} sessionId - ID da sessão a retomar (null/undefined = criar nova)
 * @param {Partial<SessionCreateOptions>} [opts={}] - Opções parciais. Default is `{}`
 * @returns {Promise<SessionResult>}
 */
export async function quickResume(sessionId, opts = {}) {
    const client = await getClient();
    return resumeOrCreate(client, sessionId, /** @type {SessionCreateOptions} */ (opts));
}

// ─── quickDisconnect ──────────────────────────────────────────────────────────

/**
 * Desconecta uma sessão ativa de forma segura (sem remover do servidor).
 *
 * @param {CopilotSession} session - Sessão a desconectar
 * @returns {Promise<void>}
 */
export async function quickDisconnect(session) {
    await disconnectSession(session);
}

// ─── ensureClient ─────────────────────────────────────────────────────────────

/**
 * Garante que o client está conectado, retornando-o. Wrapper semântico para `getClient()` — útil em contextos onde a
 * nomenclatura "ensure" é mais clara que "get".
 *
 * @returns {Promise<import('@github/copilot-sdk').CopilotClient>}
 */
export async function ensureClient() {
    return getClient();
}

// ─── shutdownClient ───────────────────────────────────────────────────────────

/**
 * Desliga o client de forma graceful. Wrapper semântico para `stopClient()`.
 *
 * @param {{ force?: boolean }} [options={}] - Se force=true, usa forceStop sem cleanup. Default is `{}`
 * @returns {Promise<Error[]>} Erros encontrados durante shutdown (vazio = sucesso)
 */
export async function shutdownClient(options = {}) {
    if (options.force) {
        await forceStopClient();
        return [];
    }
    return stopClient();
}

// ─── isClientReady ────────────────────────────────────────────────────────────

/**
 * Verifica se o client está conectado e pronto para uso.
 *
 * @returns {boolean}
 */
export function isClientReady() {
    return getClientState() === 'connected';
}

// ─── getDefaults ──────────────────────────────────────────────────────────────

/**
 * Retorna os project defaults — alias para `getProjectDefaults()` da config.
 *
 * @returns {Partial<SessionConfig>}
 */
export { getProjectDefaults as getDefaults } from './config.js';

// ─── buildConfig ──────────────────────────────────────────────────────────────

/**
 * Alias para `buildSessionConfig()` — constrói SessionConfig com merge de defaults.
 */
export { buildSessionConfig as buildConfig } from './config.js';
