// @ts-check
/**
 * src/copilot/agent/facades/sdk/client.js
 *
 * Sub-facade: operações de client SDK — criação, ciclo de vida, autenticação, eventos de lifecycle e handles.
 *
 * @module copilot/agent/facades/sdk/client
 */

import {
    checkAuthStatus,
    createCopilotClient,
    disconnectSessionSafe,
    LIFECYCLE_EVENTS,
    modelsList,
    onLifecycleEvents,
    raceEvents,
    SESSION_LIFECYCLE_EVENTS,
    toolsList,
} from '#copilot/sdk';
import {
    getClientRef,
    getPermissionHandlerRef,
    getSdkElicitationRef,
    getSessionRef,
    getToolRegistryRef,
    hasRpcNamespace,
    requireClient,
} from './ctx-refs.js';

/**
 * @typedef {import('#copilot/agent/types').AgentSdkHandles} AgentSdkHandles
 *
 * @typedef {import('#copilot/agent/types').AgentSdkAccessSnapshot} AgentSdkAccessSnapshot
 */

/**
 * @param {import('#copilot/sdk/types').CopilotClientOptions} [options]
 * @returns {import('#copilot/sdk/types').CopilotClient}
 */
export function createAgentSdkClient(options) {
    return createCopilotClient(options);
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @returns {Promise<void>}
 */
export async function ensureAgentSdkClientStarted(client) {
    if (typeof client?.getState === 'function' && client.getState() === 'connected') {
        return;
    }
    await client.start();
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @returns {Promise<{ message: string; timestamp: number; protocolVersion?: number }>}
 */
export async function pingAgentSdkClient(client) {
    return client.ping();
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @returns {Promise<Error[]>}
 */
export async function stopAgentSdkClient(client) {
    return client.stop();
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @returns {Promise<Awaited<ReturnType<typeof checkAuthStatus>>>}
 */
export async function checkAgentSdkAuthStatus(client) {
    return checkAuthStatus(client);
}

/**
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @returns {Promise<void>}
 */
export async function disconnectAgentSdkSession(session) {
    await disconnectSessionSafe(session);
}

/**
 * @param {import('node:events').EventEmitter} emitter
 * @param {string[]} events
 * @param {{ timeoutMs?: number; signal?: AbortSignal; timeoutError?: string }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof raceEvents>>>}
 */
export async function raceAgentSdkEvents(emitter, events, options) {
    return raceEvents(emitter, events, options);
}

/**
 * @returns {{ CREATED: string; UPDATED: string; DELETED: string }}
 */
export function getAgentSdkLifecycleEvents() {
    return LIFECYCLE_EVENTS;
}

/**
 * @returns {{ CREATED: string; UPDATED: string; DELETED: string }}
 */
export function getAgentSdkSessionLifecycleEvents() {
    return SESSION_LIFECYCLE_EVENTS;
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {(event: { type: string; sessionId?: string }) => void} onEvent
 * @returns {() => void}
 */
export function observeAgentSdkSessionLifecycle(client, onEvent) {
    return onLifecycleEvents(
        {
            [LIFECYCLE_EVENTS.CREATED]: (evt) => {
                const payload = /** @type {{ sessionId?: string }} */ (/** @type {unknown} */ (evt));
                onEvent({
                    type: SESSION_LIFECYCLE_EVENTS.CREATED,
                    ...(typeof payload?.sessionId === 'string' ? { sessionId: payload.sessionId } : {}),
                });
            },
            [LIFECYCLE_EVENTS.DELETED]: (evt) => {
                const payload = /** @type {{ sessionId?: string }} */ (/** @type {unknown} */ (evt));
                onEvent({
                    type: SESSION_LIFECYCLE_EVENTS.DELETED,
                    ...(typeof payload?.sessionId === 'string' ? { sessionId: payload.sessionId } : {}),
                });
            },
            [LIFECYCLE_EVENTS.UPDATED]: (evt) => {
                const payload = /** @type {{ sessionId?: string }} */ (/** @type {unknown} */ (evt));
                onEvent({
                    type: SESSION_LIFECYCLE_EVENTS.UPDATED,
                    ...(typeof payload?.sessionId === 'string' ? { sessionId: payload.sessionId } : {}),
                });
            },
        },
        client,
    );
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {(event: { type: string; sessionId?: string }) => void} onEvent
 * @returns {() => void}
 */
export function attachAgentSdkBootLifecycleBridge(client, onEvent) {
    return observeAgentSdkSessionLifecycle(client, onEvent);
}

/**
 * @param {Record<string, (event: unknown) => void>} handlers
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @returns {() => void}
 */
export function onAgentSdkLifecycleEvents(handlers, client) {
    return onLifecycleEvents(handlers, client);
}

/**
 * Retorna os handles crus do SDK atualmente vinculados ao agent.
 *
 * @param {unknown} ctx
 * @returns {AgentSdkHandles}
 */
export function getSdkHandles(ctx) {
    const client = getClientRef(ctx);
    const session = getSessionRef(ctx);
    return {
        client,
        session,
        serverRpc: client?.rpc ?? null,
        sessionRpc: session?.rpc ?? null,
        workspacePath: session?.workspacePath ?? null,
    };
}

/**
 * @param {unknown} ctx
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
    const permissionHandler = getPermissionHandlerRef(ctx);
    const toolRegistry = getToolRegistryRef(ctx);

    if (typeof permissionHandler !== 'function') missingResources.push('permissionHandler');
    if (!toolRegistry) missingResources.push('toolRegistry');

    const resources = {
        clientAvailable: Boolean(handles.client),
        sessionAvailable: Boolean(handles.session),
        serverRpcAvailable: Boolean(handles.serverRpc),
        sessionRpcAvailable: Boolean(handles.sessionRpc),
        workspacePathAvailable: typeof handles.workspacePath === 'string' && handles.workspacePath.length > 0,
        permissionHandlerAvailable: typeof permissionHandler === 'function',
        userInputHandlerAvailable: true,
        hooksAvailable: true,
        toolRegistryAvailable: Boolean(toolRegistry),
        modelSwitchAvailable: typeof handles.session?.setModel === 'function',
        abortAvailable: typeof handles.session?.abort === 'function',
        sessionLogAvailable: typeof handles.session?.log === 'function',
        historyAvailable: typeof handles.session?.getMessages === 'function',
        serverModelsListAvailable:
            typeof handles.serverRpc === 'object' && hasRpcNamespace(handles.serverRpc, 'models'),
        serverToolsListAvailable: typeof handles.serverRpc === 'object' && hasRpcNamespace(handles.serverRpc, 'tools'),
        quotaAvailable: typeof handles.serverRpc === 'object' && hasRpcNamespace(handles.serverRpc, 'account'),
        lastSessionLookupAvailable: typeof handles.client?.getLastSessionId === 'function',
        foregroundControlAvailable:
            typeof handles.client?.getForegroundSessionId === 'function' &&
            typeof handles.client?.setForegroundSessionId === 'function',
        workspaceRpcAvailable:
            hasRpcNamespace(handles.sessionRpc, 'workspaces') || hasRpcNamespace(handles.sessionRpc, 'workspace'),
        compactionAvailable:
            hasRpcNamespace(handles.sessionRpc, 'history') || hasRpcNamespace(handles.sessionRpc, 'compaction'),
        shellAvailable: hasRpcNamespace(handles.sessionRpc, 'shell'),
        uiElicitationAvailable: hasRpcNamespace(handles.sessionRpc, 'ui'),
        uiApiAvailable: Boolean(handles.session?.ui),
        uiElicitationCapabilityAvailable: Boolean(handles.session?.capabilities?.ui?.elicitation),
        uiConfirmAvailable:
            typeof handles.session?.ui?.confirm === 'function' ||
            Boolean(handles.session?.ui?.elicitation) ||
            hasRpcNamespace(handles.sessionRpc, 'ui'),
        uiSelectAvailable:
            typeof handles.session?.ui?.select === 'function' ||
            Boolean(handles.session?.ui?.elicitation) ||
            hasRpcNamespace(handles.sessionRpc, 'ui'),
        uiInputAvailable:
            typeof handles.session?.ui?.input === 'function' ||
            Boolean(handles.session?.ui?.elicitation) ||
            hasRpcNamespace(handles.sessionRpc, 'ui'),
        elicitationProviderAvailable: typeof getSdkElicitationRef(ctx)?.handler === 'function',
        pendingCommandsAvailable: hasRpcNamespace(handles.sessionRpc, 'commands'),
        pendingPermissionsAvailable: hasRpcNamespace(handles.sessionRpc, 'permissions'),
        pendingToolsAvailable: hasRpcNamespace(handles.sessionRpc, 'tools'),
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
 * @param {unknown} ctx
 * @returns {Promise<{ message: string; timestamp: number; protocolVersion?: number }>}
 */
export async function pingSdk(ctx) {
    return requireClient(ctx, 'pingSdk').ping();
}

/**
 * @param {unknown} ctx
 * @returns {Promise<import('#copilot/sdk/types').GetStatusResponse>}
 */
export async function getSdkStatus(ctx) {
    return requireClient(ctx, 'getSdkStatus').getStatus();
}

/**
 * @param {unknown} ctx
 * @returns {Promise<import('#copilot/sdk/types').GetAuthStatusResponse>}
 */
export async function getSdkAuthStatus(ctx) {
    return requireClient(ctx, 'getSdkAuthStatus').getAuthStatus();
}

/**
 * @param {unknown} ctx
 * @returns {Promise<Awaited<ReturnType<typeof modelsList>>>}
 */
export async function listSdkModels(ctx) {
    return modelsList(requireClient(ctx, 'listSdkModels'));
}

/**
 * @param {unknown} ctx
 * @param {{ model?: string }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof toolsList>>>}
 */
export async function listSdkBuiltInTools(ctx, options) {
    return toolsList(requireClient(ctx, 'listSdkBuiltInTools'), options);
}
