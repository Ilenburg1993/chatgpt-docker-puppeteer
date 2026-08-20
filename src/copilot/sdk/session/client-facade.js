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
import { createSession, deleteSession, disconnectSession, resumeOrCreate } from './lifecycle.js';
import { logSwallowed } from '#copilot/core/error-handlers';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 *
 * @typedef {import('./lifecycle.js').SessionCreateOptions} SessionCreateOptions
 *
 * @typedef {import('./lifecycle.js').SessionResult<CopilotSession>} SessionResult
 */

// ─── quickSession ─────────────────────────────────────────────────────────────

/**
 * Cria uma sessão pronta para uso em uma única chamada. Internamente: getClient() → buildSessionConfig(opts) →
 * createSession(client, opts).
 *
 * @example
 *     ```js
 *     import { quickSession } from '#copilot/sdk';
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

/**
 * Cria uma sessão temporária, executa um callback e garante cleanup por `Symbol.asyncDispose` quando disponível.
 *
 * @template T
 * @param {Partial<SessionCreateOptions>} opts
 * @param {(result: SessionResult) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function withSession(opts, fn) {
    if (typeof fn !== 'function') {
        throw new TypeError('[sdk/client-facade] withSession requer callback fn');
    }
    const result = await quickSession(opts);
    try {
        return await fn(result);
    } finally {
        const disposable = /** @type {{ [Symbol.asyncDispose]?: () => Promise<void> }} */ (result.session);
        const asyncDispose = disposable[Symbol.asyncDispose];
        if (typeof asyncDispose === 'function') {
            await asyncDispose.call(result.session);
        } else {
            await quickDisconnect(result.session);
        }
    }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} label
 * @returns {Promise<T>}
 */
function withCleanupTimeout(promise, timeoutMs, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const timeout = setTimeout(() => reject(new Error(`[sdk/client-facade] ${label} excedeu ${timeoutMs}ms`)), timeoutMs);
            timeout.unref?.();
        }),
    ]);
}

/**
 * @param {unknown} error
 * @param {string} context
 * @returns {Promise<void>}
 */
async function forceStopAfterEphemeralCleanupFailure(error, context) {
    logSwallowed(error, context);
    try {
        await forceStopClient();
    } catch (forceStopError) {
        logSwallowed(forceStopError, `${context}.forceStopClient`);
    }
}

/**
 * Cria uma sessão de sonda e remove também o estado persistido ao terminar.
 *
 * `disconnect()` sozinho só solta o handle em memória; probes de catálogo/modelo não devem deixar sessões temporárias
 * no inventário operacional que o operador retomará depois.
 *
 * @template T
 * @param {Partial<SessionCreateOptions>} opts
 * @param {(result: SessionResult) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function withEphemeralSession(opts, fn) {
    if (typeof fn !== 'function') {
        throw new TypeError('[sdk/client-facade] withEphemeralSession requer callback fn');
    }
    const client = await getClient();
    const result = await createSession(client, /** @type {SessionCreateOptions} */ (opts));
    try {
        return await fn(result);
    } finally {
        const disposable = /** @type {{ [Symbol.asyncDispose]?: () => Promise<void> }} */ (result.session);
        const asyncDispose = disposable[Symbol.asyncDispose];
        try {
            if (typeof asyncDispose === 'function') {
                await withCleanupTimeout(asyncDispose.call(result.session), 10_000, 'asyncDispose ephemeral session');
            } else {
                await withCleanupTimeout(disconnectSession(result.session), 10_000, 'disconnect ephemeral session');
            }
        } catch (error) {
            await forceStopAfterEphemeralCleanupFailure(error, 'sdk.client-facade.withEphemeralSession.cleanup');
        } finally {
            try {
                await withCleanupTimeout(deleteSession(client, result.sessionId), 10_000, 'delete ephemeral session');
            } catch (error) {
                await forceStopAfterEphemeralCleanupFailure(error, 'sdk.client-facade.withEphemeralSession.delete');
            }
        }
    }
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
