// @ts-check
/**
 * src/copilot/agent/facades/sdk/ctx-refs.js
 *
 * Helpers internos de extração de refs do AgentContext para os sub-facades do SDK. NÃO publicado no index.js — uso
 * exclusivo interno dentro de `facades/sdk/`.
 *
 * @module copilot/agent/facades/sdk/ctx-refs
 */

import { AgentSessionError } from '#copilot/agent/errors';

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {boolean}
 */
export function hasRpcNamespace(value, key) {
    return Boolean(value && typeof value === 'object' && Reflect.get(value, key));
}

/**
 * @param {unknown} ctx
 * @returns {import('#copilot/sdk/types').CopilotClient | null}
 */
export function getClientRef(ctx) {
    const safeCtx = /** @type {any} */ (ctx);
    if (typeof safeCtx?.getClientSnapshot === 'function') {
        return /** @type {import('#copilot/sdk/types').CopilotClient | null} */ (safeCtx.getClientSnapshot());
    }
    return /** @type {import('#copilot/sdk/types').CopilotClient | null} */ (
        safeCtx?.ioState?.client ?? safeCtx?.client ?? null
    );
}

/**
 * @param {unknown} ctx
 * @returns {import('#copilot/sdk/types').CopilotSession | null}
 */
export function getSessionRef(ctx) {
    const safeCtx = /** @type {any} */ (ctx);
    if (typeof safeCtx?.getSessionSnapshot === 'function') {
        return /** @type {import('#copilot/sdk/types').CopilotSession | null} */ (safeCtx.getSessionSnapshot());
    }
    return /** @type {import('#copilot/sdk/types').CopilotSession | null} */ (
        safeCtx?.sessionState?.session ?? safeCtx?.session ?? null
    );
}

/**
 * @param {unknown} ctx
 * @returns {import('#copilot/sdk/types').PermissionHandler | null}
 */
export function getPermissionHandlerRef(ctx) {
    const safeCtx = /** @type {any} */ (ctx);
    if (typeof safeCtx?.getPermissionHandlerSnapshot === 'function') {
        return /** @type {import('#copilot/sdk/types').PermissionHandler | null} */ (
            safeCtx.getPermissionHandlerSnapshot()
        );
    }
    return /** @type {import('#copilot/sdk/types').PermissionHandler | null} */ (safeCtx?.permissions?.handler ?? null);
}

/**
 * @param {unknown} ctx
 * @returns {import('#copilot/sdk/types').ToolRegistry | null}
 */
export function getToolRegistryRef(ctx) {
    const safeCtx = /** @type {any} */ (ctx);
    if (typeof safeCtx?.getToolRegistrySnapshot === 'function') {
        return /** @type {import('#copilot/sdk/types').ToolRegistry | null} */ (safeCtx.getToolRegistrySnapshot());
    }
    return /** @type {import('#copilot/sdk/types').ToolRegistry | null} */ (safeCtx?.toolsRegistry ?? null);
}

/**
 * @param {unknown} ctx
 * @param {string} caller
 * @returns {import('#copilot/sdk/types').CopilotClient}
 */
export function requireClient(ctx, caller) {
    const client = getClientRef(ctx);
    if (!client) {
        throw new AgentSessionError(`[AlwaysAlive] ${caller}: client SDK indisponível.`, 'SDK_CLIENT_UNAVAILABLE');
    }
    return client;
}

/**
 * @param {unknown} ctx
 * @param {string} caller
 * @returns {import('#copilot/sdk/types').CopilotSession}
 */
export function requireSession(ctx, caller) {
    const session = getSessionRef(ctx);
    if (!session) {
        throw new AgentSessionError(`[AlwaysAlive] ${caller}: sessão SDK indisponível.`, 'SDK_SESSION_UNAVAILABLE');
    }
    return session;
}

/**
 * @typedef {{
 *     handler?: import('#copilot/sdk/types').ElicitationHandler;
 *     listPending?: (opts?: { sessionId?: string }) => any[];
 *     getPending?: (id: string) => any;
 *     resolvePending?: (id: string, result: import('#copilot/sdk/types').ElicitationResult) => boolean;
 * }} SdkElicitationRef
 */

/**
 * @param {unknown} ctx
 * @returns {SdkElicitationRef | null}
 */
export function getSdkElicitationRef(ctx) {
    const safeCtx = /** @type {any} */ (ctx);
    return /** @type {SdkElicitationRef | null} */ (safeCtx?.sdkElicitation ?? null);
}
