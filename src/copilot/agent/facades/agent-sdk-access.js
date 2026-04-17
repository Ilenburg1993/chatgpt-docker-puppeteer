// @ts-check
/**
 * src/copilot/agent/facades/agent-sdk-access.js
 *
 * Facade canônica de acesso à superfície do SDK a partir do `AlwaysAliveAgent`.
 *
 * Objetivo: concentrar em um ponto único o acesso aos handles crus (`client`, `session`, `serverRpc`, `sessionRpc`) e
 * às operações de alto valor do SDK (status/auth/sessions/foreground/custom agents), evitando que cada caller precise
 * conhecer a topologia interna do `AgentContext`.
 *
 * @module copilot/agent/facades/agent-sdk-access
 * @see EventBus
 */

import { SessionError } from '#copilot/core';
import { deselectAgent, getCurrentAgent, listAgents, reloadAgents, selectAgent } from '#copilot/sdk';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {import('../types.js').AgentSdkHandles} AgentSdkHandles
 *
 * @typedef {import('../types.js').AgentSdkAccessSnapshot} AgentSdkAccessSnapshot
 *
 * @typedef {import('#copilot/sdk/types').SessionListFilter} SessionListFilter
 */

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {boolean}
 */
function hasRpcNamespace(value, key) {
    return Boolean(value && typeof value === 'object' && Reflect.get(value, key));
}

/**
 * @param {AgentContext} ctx
 * @param {string} caller
 * @returns {import('#copilot/sdk/types').CopilotClient}
 */
function requireClient(ctx, caller) {
    const client = ctx.client;
    if (!client) {
        throw new SessionError(`[AlwaysAlive] ${caller}: client SDK indisponível.`, 'SDK_CLIENT_UNAVAILABLE');
    }
    return client;
}

/**
 * @param {AgentContext} ctx
 * @param {string} caller
 * @returns {import('#copilot/sdk/types').CopilotSession}
 */
function requireSession(ctx, caller) {
    const session = ctx.session;
    if (!session) {
        throw new SessionError(`[AlwaysAlive] ${caller}: sessão SDK indisponível.`, 'SDK_SESSION_UNAVAILABLE');
    }
    return session;
}

/**
 * Retorna os handles crus do SDK atualmente vinculados ao agent.
 *
 * @param {AgentContext} ctx
 * @returns {AgentSdkHandles}
 */
export function getSdkHandles(ctx) {
    const client = ctx.client ?? null;
    const session = ctx.session ?? null;
    return {
        client,
        session,
        serverRpc: client?.rpc ?? null,
        sessionRpc: session?.rpc ?? null,
        workspacePath: session?.workspacePath ?? null,
    };
}

/**
 * Snapshot verificável da cobertura de recursos SDK disponíveis ao runtime atual do agent.
 *
 * @param {AgentContext} ctx
 * @returns {AgentSdkAccessSnapshot}
 */
export function getSdkResourceSnapshot(ctx) {
    const handles = getSdkHandles(ctx);
    /** @type {string[]} */
    const missingResources = [];

    if (!handles.client) missingResources.push('client');
    if (!handles.session) missingResources.push('session');
    if (!handles.serverRpc) missingResources.push('serverRpc');
    if (!handles.sessionRpc) missingResources.push('sessionRpc');
    if (typeof ctx.permissions?.handler !== 'function') missingResources.push('permissionHandler');
    if (!ctx.toolsRegistry) missingResources.push('toolRegistry');

    const resources = {
        clientAvailable: Boolean(handles.client),
        sessionAvailable: Boolean(handles.session),
        serverRpcAvailable: Boolean(handles.serverRpc),
        sessionRpcAvailable: Boolean(handles.sessionRpc),
        workspacePathAvailable: typeof handles.workspacePath === 'string' && handles.workspacePath.length > 0,
        permissionHandlerAvailable: typeof ctx.permissions?.handler === 'function',
        userInputHandlerAvailable: true,
        hooksAvailable: true,
        toolRegistryAvailable: Boolean(ctx.toolsRegistry),
        modelSwitchAvailable: typeof handles.session?.setModel === 'function',
        abortAvailable: typeof handles.session?.abort === 'function',
        sessionLogAvailable: typeof handles.session?.log === 'function',
        historyAvailable: typeof handles.session?.getMessages === 'function',
        lastSessionLookupAvailable: typeof handles.client?.getLastSessionId === 'function',
        foregroundControlAvailable:
            typeof handles.client?.getForegroundSessionId === 'function' &&
            typeof handles.client?.setForegroundSessionId === 'function',
        customAgentsAvailable: hasRpcNamespace(handles.sessionRpc, 'agent'),
        experimentalAgentsAvailable: hasRpcNamespace(handles.sessionRpc, 'agent'),
        skillsAvailable: hasRpcNamespace(handles.sessionRpc, 'skills'),
        mcpAvailable: hasRpcNamespace(handles.sessionRpc, 'mcp'),
        pluginsAvailable: hasRpcNamespace(handles.sessionRpc, 'plugins'),
        extensionsAvailable: hasRpcNamespace(handles.sessionRpc, 'extensions'),
        fleetAvailable: hasRpcNamespace(handles.sessionRpc, 'fleet'),
    };

    return {
        handles,
        resources,
        missingResources,
        allCoreResourcesAvailable:
            resources.clientAvailable &&
            resources.sessionAvailable &&
            resources.serverRpcAvailable &&
            resources.sessionRpcAvailable &&
            resources.permissionHandlerAvailable &&
            resources.toolRegistryAvailable,
        allRuntimeResourcesAvailable: missingResources.length === 0,
    };
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<{ message: string; timestamp: number; protocolVersion?: number }>}
 */
export async function pingSdk(ctx) {
    return requireClient(ctx, 'pingSdk').ping();
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<import('#copilot/sdk/types').GetStatusResponse>}
 */
export async function getSdkStatus(ctx) {
    return requireClient(ctx, 'getSdkStatus').getStatus();
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<import('#copilot/sdk/types').GetAuthStatusResponse>}
 */
export async function getSdkAuthStatus(ctx) {
    return requireClient(ctx, 'getSdkAuthStatus').getAuthStatus();
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<string | undefined>}
 */
export async function getLastSdkSessionId(ctx) {
    return requireClient(ctx, 'getLastSdkSessionId').getLastSessionId();
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<string | undefined>}
 */
export async function getForegroundSdkSessionId(ctx) {
    return requireClient(ctx, 'getForegroundSdkSessionId').getForegroundSessionId();
}

/**
 * @param {AgentContext} ctx
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function setForegroundSdkSessionId(ctx, sessionId) {
    await requireClient(ctx, 'setForegroundSdkSessionId').setForegroundSessionId(sessionId);
}

/**
 * @param {AgentContext} ctx
 * @param {SessionListFilter} [filter]
 * @returns {Promise<import('#copilot/sdk/types').SessionMetadata[]>}
 */
export async function listSdkSessions(ctx, filter) {
    return requireClient(ctx, 'listSdkSessions').listSessions(filter);
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<Awaited<ReturnType<typeof listAgents>>>}
 */
export async function listSdkAgents(ctx) {
    return listAgents(requireSession(ctx, 'listSdkAgents'));
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<Awaited<ReturnType<typeof getCurrentAgent>>>}
 */
export async function getCurrentSdkAgent(ctx) {
    return getCurrentAgent(requireSession(ctx, 'getCurrentSdkAgent'));
}

/**
 * @param {AgentContext} ctx
 * @param {string} name
 * @returns {Promise<Awaited<ReturnType<typeof selectAgent>>>}
 */
export async function selectSdkAgent(ctx, name) {
    return selectAgent(requireSession(ctx, 'selectSdkAgent'), name);
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<Awaited<ReturnType<typeof deselectAgent>>>}
 */
export async function deselectSdkAgent(ctx) {
    return deselectAgent(requireSession(ctx, 'deselectSdkAgent'));
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<Awaited<ReturnType<typeof reloadAgents>>>}
 */
export async function reloadSdkAgents(ctx) {
    return reloadAgents(requireSession(ctx, 'reloadSdkAgents'));
}
