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
import {
    accountGetQuota,
    checkAuthStatus,
    commandsHandlePending,
    compactionCompact,
    createCopilotClient,
    createQuotaMonitor,
    createRegistry,
    createSession,
    deleteSession,
    deselectAgent,
    disconnectSessionSafe,
    getConfiguredSessionFsHandler,
    getCurrentAgent,
    getSdkRecoveryPolicy,
    getSessionCapabilities,
    getToolsConfig,
    isExperimentalEnabled,
    isSdkQuotaOrRateLimitError,
    isSessionUiElicitationAvailable,
    LIFECYCLE_EVENTS,
    listAgents,
    listModels,
    listSessions,
    loadToolsConfigAsync,
    modelRegistry,
    modelsList,
    modelStatsTracker,
    onLifecycleEvents,
    permissionsHandlePending,
    pickDefined,
    raceEvents,
    reloadAgents,
    resumeOrCreate,
    selectAgent,
    SESSION_LIFECYCLE_EVENTS,
    sessionUiConfirm,
    sessionUiElicitation,
    sessionUiInput,
    sessionUiSelect,
    shellExec,
    shellKill,
    toolsHandlePendingCall,
    toolsList,
    uiElicitation,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
} from '#copilot/sdk';
export { canReadAgentSdkSessionMessages, readAgentSdkSessionMessages } from './agent-sdk-runtime.js';

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
 * @returns {import('#copilot/sdk/types').CopilotClient | null}
 */
function getClientRef(ctx) {
    if (typeof ctx.getClientSnapshot === 'function') return ctx.getClientSnapshot();
    const compat = /** @type {{ client?: unknown; ioState?: { client?: unknown } }} */ (ctx);
    return /** @type {import('#copilot/sdk/types').CopilotClient | null} */ (
        compat.ioState?.client ?? compat.client ?? null
    );
}

/**
 * @param {AgentContext} ctx
 * @returns {import('#copilot/sdk/types').CopilotSession | null}
 */
function getSessionRef(ctx) {
    if (typeof ctx.getSessionSnapshot === 'function') return ctx.getSessionSnapshot();
    const compat = /** @type {{ session?: unknown; sessionState?: { session?: unknown } }} */ (ctx);
    return /** @type {import('#copilot/sdk/types').CopilotSession | null} */ (
        compat.sessionState?.session ?? compat.session ?? null
    );
}

/**
 * @param {AgentContext} ctx
 * @returns {import('#copilot/sdk/types').PermissionHandler | null}
 */
function getPermissionHandlerRef(ctx) {
    if (typeof ctx.getPermissionHandlerSnapshot === 'function') return ctx.getPermissionHandlerSnapshot();
    const compat = /** @type {{ permissions?: { handler?: unknown } }} */ (ctx);
    return /** @type {import('#copilot/sdk/types').PermissionHandler | null} */ (compat.permissions?.handler ?? null);
}

/**
 * @param {AgentContext} ctx
 * @returns {import('#copilot/sdk/tools-registry').ToolRegistry | null}
 */
function getToolRegistryRef(ctx) {
    if (typeof ctx.getToolRegistrySnapshot === 'function') return ctx.getToolRegistrySnapshot();
    const compat = /** @type {{ toolsRegistry?: unknown }} */ (ctx);
    return /** @type {import('#copilot/sdk/tools-registry').ToolRegistry | null} */ (compat.toolsRegistry ?? null);
}

/**
 * @param {AgentContext} ctx
 * @param {string} caller
 * @returns {import('#copilot/sdk/types').CopilotClient}
 */
function requireClient(ctx, caller) {
    const client = getClientRef(ctx);
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
    const session = getSessionRef(ctx);
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
 * Cria um novo client SDK usando a fábrica canônica do wrapper.
 *
 * @param {import('#copilot/sdk/types').CopilotClientOptions} [options]
 * @returns {import('#copilot/sdk/types').CopilotClient}
 */
export function createAgentSdkClient(options) {
    return createCopilotClient(options);
}

/**
 * Garante que um client SDK esteja explicitamente conectado antes de uso no lifecycle do agent.
 *
 * Regra arquitetural: módulos de `agent/lifecycle/*` tratam `CopilotClient` como handle opaco e delegam
 * `start/ping/stop` a esta façade, evitando espalhar semântica vendor-level por múltiplos callers do runtime.
 *
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
 * Executa `client.ping()` pela fronteira canônica do runtime do agent.
 *
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @returns {Promise<{ message: string; timestamp: number; protocolVersion?: number }>}
 */
export async function pingAgentSdkClient(client) {
    return client.ping();
}

/**
 * Executa `client.stop()` pela fronteira canônica do runtime do agent.
 *
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @returns {Promise<Error[]>}
 */
export async function stopAgentSdkClient(client) {
    return client.stop();
}

/**
 * Lê o estado de autenticação do usuário no SDK.
 *
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @returns {Promise<Awaited<ReturnType<typeof checkAuthStatus>>>}
 */
export async function checkAgentSdkAuthStatus(client) {
    return checkAuthStatus(client);
}

/**
 * Desconecta uma sessão SDK ativa com fallback seguro.
 *
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @returns {Promise<void>}
 */
export async function disconnectAgentSdkSession(session) {
    await disconnectSessionSafe(session);
}

/**
 * Aguarda a primeira ocorrência entre múltiplos eventos em um EventEmitter.
 *
 * @param {import('node:events').EventEmitter} emitter
 * @param {string[]} events
 * @param {{ timeoutMs?: number; signal?: AbortSignal; timeoutError?: string }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof raceEvents>>>}
 */
export async function raceAgentSdkEvents(emitter, events, options) {
    return raceEvents(emitter, events, options);
}

/**
 * Cria o registry canônico de tools do SDK para o runtime do agent.
 *
 * @returns {import('#copilot/sdk/tools-registry').ToolRegistry}
 */
export function createAgentSdkToolsRegistry() {
    return createRegistry();
}

/**
 * Lê a configuração efetiva de tools carregada no wrapper SDK.
 *
 * @returns {{ denylist: string[]; allowlist: string[] | null }}
 */
export function getAgentSdkToolsConfig() {
    return getToolsConfig();
}

/**
 * Lê os metadados do model registry canônico do SDK.
 *
 * @param {string} modelId
 * @returns {{
 *     costTier?: string;
 *     speedTier?: string;
 *     contextWindow?: number;
 *     supportsReasoning?: boolean;
 *     supportsVision?: boolean;
 * } | null}
 */
export function readAgentSdkModelRegistryEntry(modelId) {
    const rawMeta = modelRegistry.get(modelId);
    return rawMeta
        ? {
              costTier: rawMeta.costTier,
              speedTier: rawMeta.speedTier,
              contextWindow: rawMeta.contextWindow,
              supportsReasoning: rawMeta.supportsReasoning,
              supportsVision: rawMeta.supportsVision,
          }
        : null;
}

/**
 * Lista o catálogo de modelos conhecido pelo SDK (sem depender de sessão/contexto).
 *
 * @returns {Promise<import('#copilot/sdk/types').ModelInfo[]>}
 */
export async function listAgentSdkCatalogModels() {
    return listModels();
}

/**
 * Retorna estatísticas agregadas de uso de modelos coletadas pelo SDK wrapper.
 *
 * @returns {ReturnType<typeof modelStatsTracker.allStats>}
 */
export function readAgentSdkModelStats() {
    return modelStatsTracker.allStats();
}

/**
 * @param {Parameters<typeof isExperimentalEnabled>[0]} featureName
 * @returns {boolean}
 */
export function isAgentSdkExperimentalEnabled(featureName) {
    return isExperimentalEnabled(featureName);
}

/**
 * Exposição controlada do tracker de modelos para consumidores de observabilidade do runtime.
 *
 * @returns {{
 *     record: (
 *         model: string,
 *         stats: { latencyMs: number; success: boolean; inputTokens?: number; outputTokens?: number },
 *     ) => void;
 * }}
 */
export function getAgentSdkModelStatsTracker() {
    return modelStatsTracker;
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
 * Observa os eventos de lifecycle do client SDK e os normaliza para o contrato interno de sessão do agent.
 *
 * Regra arquitetural: callers de `agent/*` não devem conhecer a dupla `LIFECYCLE_EVENTS` + `SESSION_LIFECYCLE_EVENTS`
 * nem refazer esse mapeamento por conta própria.
 *
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
 * Acopla o lifecycle vanilla do SDK ao boot/runtime do agent por uma superfície semântica específica de boot.
 *
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
 * @param {import('#copilot/sdk/quota-monitor').QuotaMonitorOptions} options
 * @returns {import('#copilot/sdk/quota-monitor').QuotaMonitor}
 */
export function createAgentSdkQuotaMonitor(options) {
    return createQuotaMonitor(options);
}

/**
 * Inicia o quota monitor do SDK já configurado e pronto para uso pelo runtime do agent.
 *
 * Regra arquitetural: módulos de `agent/session/*` decidem o que fazer com warnings/updates, mas a criação/start do
 * monitor vanilla passa por esta façade canônica.
 *
 * @param {{
 *     client: import('#copilot/sdk/types').CopilotClient;
 *     intervalMs: number;
 *     warningThreshold: number;
 *     onWarning?: (quotaId: string, snapshot: import('#copilot/sdk/quota-monitor').QuotaSnapshot) => void;
 *     onUpdate?: (snapshots: Record<string, import('#copilot/sdk/quota-monitor').QuotaSnapshot>) => void;
 * }} options
 * @returns {import('#copilot/sdk/quota-monitor').QuotaMonitor}
 */
export function startAgentSdkQuotaMonitor(options) {
    const monitor = createQuotaMonitor(options);
    monitor.start();
    return monitor;
}

/**
 * Inicia o quota monitor vanilla pela semântica de boot do runtime do agent.
 *
 * @param {{
 *     client: import('#copilot/sdk/types').CopilotClient;
 *     intervalMs: number;
 *     warningThreshold: number;
 *     onWarning?: (quotaId: string, snapshot: import('#copilot/sdk/quota-monitor').QuotaSnapshot) => void;
 *     onUpdate?: (snapshots: Record<string, import('#copilot/sdk/quota-monitor').QuotaSnapshot>) => void;
 * }} options
 * @returns {import('#copilot/sdk/quota-monitor').QuotaMonitor}
 */
export function startAgentSdkBootQuotaBridge(options) {
    return startAgentSdkQuotaMonitor(options);
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {SessionListFilter} [filter]
 * @returns {Promise<import('#copilot/sdk/types').SessionMetadata[]>}
 */
export async function listAgentSdkSessionsByClient(client, filter) {
    return listSessions(client, filter);
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function deleteAgentSdkSessionByClient(client, sessionId) {
    await deleteSession(client, sessionId);
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {Record<string, unknown>} options
 * @returns {Promise<Awaited<ReturnType<typeof createSession>>>}
 */
export async function createAgentSdkSessionByClient(client, options) {
    return createSession(client, options);
}

/**
 * @returns {import('#copilot/sdk/types').CreateSessionFsHandler | undefined}
 */
export function getAgentConfiguredSessionFsHandler() {
    return getConfiguredSessionFsHandler();
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAgentSdkQuotaOrRateLimitError(error) {
    return isSdkQuotaOrRateLimitError(error);
}

/**
 * @param {unknown} error
 * @param {'connection' | 'session'} [scope]
 * @returns {import('#copilot/sdk/types').SdkRecoveryPolicy}
 */
export function getAgentSdkRecoveryPolicy(error, scope) {
    return getSdkRecoveryPolicy(error, scope);
}

/** @type {string} */
export const AGENT_SDK_DEFAULT_MODEL = 'gpt-5-mini';

/**
 * @returns {Promise<void>}
 */
export async function loadAgentSdkToolsConfigAsync() {
    await loadToolsConfigAsync();
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} value
 * @returns {Partial<T>}
 */
export function pickDefinedAgentSdkOptions(value) {
    return /** @type {Partial<T>} */ (pickDefined(value));
}

/**
 * @param {AgentContext} ctx
 * @returns {{
 *     handler?: import('#copilot/sdk/types').ElicitationHandler;
 *     listPending?: (opts?: { sessionId?: string }) => import('../../hooks/elicitation.js').QueuedElicitationEntry[];
 *     getPending?: (id: string) => import('../../hooks/elicitation.js').QueuedElicitationEntry | null;
 *     resolvePending?: (id: string, result: import('#copilot/sdk/types').ElicitationResult) => boolean;
 * } | null}
 */
function getSdkElicitationRef(ctx) {
    const compat = /** @type {{ sdkElicitation?: unknown }} */ (ctx);
    const elicitationRef = /**
     * @type {{
     *     handler?: import('#copilot/sdk/types').ElicitationHandler;
     *     listPending?: (opts?: { sessionId?: string }) => import('../../hooks/elicitation.js').QueuedElicitationEntry[];
     *     getPending?: (id: string) => import('../../hooks/elicitation.js').QueuedElicitationEntry | null;
     *     resolvePending?: (id: string, result: import('#copilot/sdk/types').ElicitationResult) => boolean;
     * } | null}
     */ (compat.sdkElicitation ?? null);
    return elicitationRef;
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {string | null | undefined} sessionId
 * @param {Record<string, unknown>} options
 * @returns {Promise<Awaited<ReturnType<typeof resumeOrCreate>>>}
 */
export async function resumeOrCreateAgentSdkSession(client, sessionId, options) {
    return resumeOrCreate(client, sessionId ?? null, options);
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
 * @returns {Promise<Awaited<ReturnType<typeof modelsList>>>}
 */
export async function listSdkModels(ctx) {
    return modelsList(requireClient(ctx, 'listSdkModels'));
}

/**
 * @param {AgentContext} ctx
 * @param {{ model?: string }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof toolsList>>>}
 */
export async function listSdkBuiltInTools(ctx, options) {
    return toolsList(requireClient(ctx, 'listSdkBuiltInTools'), options);
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<Awaited<ReturnType<typeof accountGetQuota>>>}
 */
export async function getSdkQuota(ctx) {
    return accountGetQuota(requireClient(ctx, 'getSdkQuota'));
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
 * @returns {Promise<Awaited<ReturnType<typeof workspaceListFiles>>>}
 */
export async function listSdkWorkspaceFiles(ctx) {
    return workspaceListFiles(requireSession(ctx, 'listSdkWorkspaceFiles'));
}

/**
 * @param {AgentContext} ctx
 * @param {string} path
 * @returns {Promise<Awaited<ReturnType<typeof workspaceReadFile>>>}
 */
export async function readSdkWorkspaceFile(ctx, path) {
    return workspaceReadFile(requireSession(ctx, 'readSdkWorkspaceFile'), path);
}

/**
 * @param {AgentContext} ctx
 * @param {string} path
 * @param {string} content
 * @returns {Promise<Awaited<ReturnType<typeof workspaceCreateFile>>>}
 */
export async function createSdkWorkspaceFile(ctx, path, content) {
    return workspaceCreateFile(requireSession(ctx, 'createSdkWorkspaceFile'), path, content);
}

/**
 * @param {AgentContext} ctx
 * @returns {Promise<Awaited<ReturnType<typeof compactionCompact>>>}
 */
export async function compactSdkSession(ctx) {
    return compactionCompact(requireSession(ctx, 'compactSdkSession'));
}

/**
 * @param {AgentContext} ctx
 * @param {string} message
 * @param {object} requestedSchema
 * @returns {Promise<Awaited<ReturnType<typeof uiElicitation>>>}
 */
export async function requestSdkElicitation(ctx, message, requestedSchema) {
    const session = requireSession(ctx, 'requestSdkElicitation');
    if (session.ui || session.capabilities?.ui?.elicitation) {
        return sessionUiElicitation(session, {
            message,
            requestedSchema: /** @type {import('#copilot/sdk/types').ElicitationSchema} */ (
                /** @type {unknown} */ (requestedSchema)
            ),
        });
    }
    return uiElicitation(session, message, requestedSchema);
}

/**
 * @param {AgentContext} ctx
 * @returns {import('#copilot/sdk/types').SessionCapabilities}
 */
export function getSdkSessionCapabilities(ctx) {
    return getSessionCapabilities(requireSession(ctx, 'getSdkSessionCapabilities'));
}

/**
 * @param {AgentContext} ctx
 * @returns {boolean}
 */
export function isSdkSessionUiElicitationAvailable(ctx) {
    return isSessionUiElicitationAvailable(requireSession(ctx, 'isSdkSessionUiElicitationAvailable'));
}

/**
 * @param {AgentContext} ctx
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function confirmSdkSessionUi(ctx, message) {
    return sessionUiConfirm(requireSession(ctx, 'confirmSdkSessionUi'), message);
}

/**
 * @param {AgentContext} ctx
 * @param {string} message
 * @param {string[]} options
 * @returns {Promise<string | null>}
 */
export async function selectSdkSessionUi(ctx, message, options) {
    return sessionUiSelect(requireSession(ctx, 'selectSdkSessionUi'), message, options);
}

/**
 * @param {AgentContext} ctx
 * @param {string} message
 * @param {import('#copilot/sdk/types').InputOptions} [options]
 * @returns {Promise<string | null>}
 */
export async function inputSdkSessionUi(ctx, message, options) {
    return sessionUiInput(requireSession(ctx, 'inputSdkSessionUi'), message, options);
}

/**
 * @param {AgentContext} ctx
 * @param {string} [sessionId]
 * @returns {import('../../hooks/elicitation.js').QueuedElicitationEntry[]}
 */
export function listPendingSdkElicitations(ctx, sessionId) {
    return getSdkElicitationRef(ctx)?.listPending?.({ ...(sessionId ? { sessionId } : {}) }) ?? [];
}

/**
 * @param {AgentContext} ctx
 * @param {string} id
 * @returns {import('../../hooks/elicitation.js').QueuedElicitationEntry | null}
 */
export function getPendingSdkElicitation(ctx, id) {
    return getSdkElicitationRef(ctx)?.getPending?.(id) ?? null;
}

/**
 * @param {AgentContext} ctx
 * @param {string} id
 * @param {import('#copilot/sdk/types').ElicitationResult} result
 * @returns {boolean}
 */
export function resolvePendingSdkElicitation(ctx, id, result) {
    return getSdkElicitationRef(ctx)?.resolvePending?.(id, result) ?? false;
}

/**
 * @param {AgentContext} ctx
 * @param {string} requestId
 * @param {{ kind: string } & Record<string, unknown>} result
 * @returns {Promise<Awaited<ReturnType<typeof permissionsHandlePending>>>}
 */
export async function handleSdkPendingPermission(ctx, requestId, result) {
    return permissionsHandlePending(requireSession(ctx, 'handleSdkPendingPermission'), requestId, result);
}

/**
 * @param {AgentContext} ctx
 * @param {string} requestId
 * @param {{ result?: string | { textResultForLlm: string; resultType?: string; error?: string }; error?: string }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof toolsHandlePendingCall>>>}
 */
export async function handleSdkPendingToolCall(ctx, requestId, options) {
    return toolsHandlePendingCall(requireSession(ctx, 'handleSdkPendingToolCall'), requestId, options);
}

/**
 * @param {AgentContext} ctx
 * @param {string} requestId
 * @param {{ error?: string }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof commandsHandlePending>>>}
 */
export async function handleSdkPendingCommand(ctx, requestId, options) {
    return commandsHandlePending(requireSession(ctx, 'handleSdkPendingCommand'), requestId, options);
}

/**
 * @param {AgentContext} ctx
 * @param {string} command
 * @param {{ cwd?: string; timeout?: number }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof shellExec>>>}
 */
export async function execSdkShell(ctx, command, options) {
    return shellExec(requireSession(ctx, 'execSdkShell'), command, options);
}

/**
 * @param {AgentContext} ctx
 * @param {string} processId
 * @param {'SIGTERM' | 'SIGKILL' | 'SIGINT'} [signal]
 * @returns {Promise<Awaited<ReturnType<typeof shellKill>>>}
 */
export async function killSdkShell(ctx, processId, signal) {
    return shellKill(requireSession(ctx, 'killSdkShell'), processId, signal);
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
