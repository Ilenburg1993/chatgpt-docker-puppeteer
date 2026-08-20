// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createQuotaMonitorMock } = vi.hoisted(() => ({
    createQuotaMonitorMock: vi.fn((options) => ({
        start: vi.fn(),
        stop: vi.fn(),
        poll: vi.fn(),
        status: vi.fn(() => ({ running: true, options })),
    })),
}));

const sdkMocks = vi.hoisted(() => ({
    onLifecycleEvents: vi.fn((handlers, client) => {
        /** @type {(() => void)[]} */
        const unsubscribers = [];
        for (const [event, handler] of Object.entries(handlers)) {
            const maybeUnsub = client.on?.(event, handler);
            if (typeof maybeUnsub === 'function') {
                unsubscribers.push(maybeUnsub);
                continue;
            }
            unsubscribers.push(() => client.off?.(event, handler));
        }
        return () => {
            for (const unsub of unsubscribers) unsub();
        };
    }),
    createSession: vi.fn(async (_client, options) => ({ session: { sessionId: 'created-session' }, options })),
    deleteSession: vi.fn(async () => undefined),
    getConfiguredSessionFsHandler: vi.fn(() => undefined),
    listSessions: vi.fn(async (client, filter) => client.listSessions(filter)),
    resumeOrCreate: vi.fn(async (_client, sessionId, options) => ({
        session: { sessionId: sessionId ?? 'resumed-session' },
        isResumed: Boolean(sessionId),
        options,
    })),
    disconnectSessionSafe: vi.fn(async () => undefined),
    getAuthStatus: vi.fn(async (client) => client.getAuthStatus()),
    raceEvents: vi.fn(async () => ({ event: 'session.created' })),
    getSdkRecoveryPolicy: vi.fn((error, scope) => ({
        kind: error && typeof error === 'object' && 'code' in error ? 'network' : 'unknown',
        scope: scope ?? 'connection',
        retryable: true,
    })),
    isSdkQuotaOrRateLimitError: vi.fn(() => false),
    listModels: vi.fn(async () => [{ id: 'gpt-5-mini' }]),
    modelRegistry: new Map([
        [
            'gpt-5-mini',
            {
                costTier: 'low',
                speedTier: 'fast',
                contextWindow: 128000,
                supportsReasoning: true,
                supportsVision: false,
            },
        ],
    ]),
    modelStatsTracker: {
        allStats: vi.fn(() => [{ modelId: 'gpt-5-mini', totalCalls: 1, avgLatencyMs: 12, successRate: 1 }]),
    },
    isExperimentalEnabled: vi.fn(() => false),
    createTool: vi.fn((options) => ({
        name: options?.name ?? 'mock_tool',
        description: options?.description ?? '',
        parameters: options?.inputSchema ?? { type: 'object', properties: {} },
        handler: options?.execute ?? (async () => ({})),
    })),
    createRegistry: vi.fn(() => new Map()),
    getToolsConfig: vi.fn(() => ({ denylist: [], allowlist: null })),
    loadToolsConfigAsync: vi.fn(async () => undefined),
    pickDefined: vi.fn((value) =>
        Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)),
    ),
    listAgents: vi.fn(async (session) => ({ agents: [{ name: `agent:${session.sessionId}` }] })),
    getCurrentAgent: vi.fn(async (session) => ({ agent: { name: `current:${session.sessionId}` } })),
    selectAgent: vi.fn(async (_session, name) => ({ agent: { name } })),
    reloadAgents: vi.fn(async (session) => ({ agents: [{ name: `reloaded:${session.sessionId}` }] })),
    modelsList: vi.fn(async (client) => client.rpc.models.list()),
    toolsList: vi.fn(async (client, options) => client.rpc.tools.list(options)),
    accountGetQuota: vi.fn(async (client) => client.rpc.account.getQuota()),
    workspaceListFiles: vi.fn(async () => ({ files: ['plan.md'] })),
    workspaceReadFile: vi.fn(async (_session, path) => ({ path, content: 'hello' })),
    workspaceCreateFile: vi.fn(async (_session, path, content) => ({ path, content })),
    compactionCompact: vi.fn(async () => ({ success: true })),
    shellExec: vi.fn(async (_session, command, options) => ({ command, ...options })),
    shellKill: vi.fn(async (_session, processId, signal) => ({ processId, signal })),
    permissionsHandlePending: vi.fn(async (_session, requestId, result) => ({ requestId, result })),
    permissionsListPending: vi.fn(async () => ({ available: true, source: 'rpc', requests: [] })),
    permissionsResetSessionApprovals: vi.fn(async () => ({ ok: true })),
    toolsHandlePendingCall: vi.fn(async (_session, requestId, options) => ({ requestId, ...options })),
    commandsHandlePending: vi.fn(async (_session, requestId, options) => ({ requestId, ...options })),
    uiElicitation: vi.fn(async (_session, message, requestedSchema) => ({
        action: 'accept',
        params: { message, requestedSchema },
    })),
    usageGetMetrics: vi.fn(async () => ({ ok: true, quotaSnapshots: {} })),
    mcpOauthLogin: vi.fn(async (_session, serverName) => ({ ok: true, serverName })),
}));

vi.mock('#copilot/sdk', () => ({
    LIFECYCLE_EVENTS: {
        CREATED: 'sessionCreated',
        UPDATED: 'sessionUpdated',
        DELETED: 'sessionDeleted',
    },
    SESSION_LIFECYCLE_EVENTS: {
        CREATED: 'session.created',
        UPDATED: 'session.updated',
        DELETED: 'session.deleted',
    },
    accountGetQuota: vi.fn(async (client) => client.rpc.account.getQuota()),
    commandsHandlePending: vi.fn(async (_session, requestId, options) => ({ requestId, ...options })),
    compactionCompact: vi.fn(async () => ({ success: true })),
    createTool: vi.fn((options) => ({
        name: options?.name ?? 'mock_tool',
        description: options?.description ?? '',
        parameters: options?.inputSchema ?? { type: 'object', properties: {} },
        handler: options?.execute ?? (async () => ({})),
    })),
    createQuotaMonitor: createQuotaMonitorMock,
    getSdkRecoveryPolicy: vi.fn((error, scope) => ({
        kind: error && typeof error === 'object' && 'code' in error ? 'network' : 'unknown',
        scope: scope ?? 'connection',
        retryable: true,
    })),
    getSessionCapabilities: vi.fn((session) => session.capabilities ?? {}),
    getCurrentAgent: vi.fn(async (session) => ({ agent: { name: `current:${session.sessionId}` } })),
    isSessionUiElicitationAvailable: vi.fn((session) => Boolean(session.capabilities?.ui?.elicitation || session.ui)),
    listAgents: vi.fn(async (session) => ({ agents: [{ name: `agent:${session.sessionId}` }] })),
    modelsList: vi.fn(async (client) => client.rpc.models.list()),
    onLifecycleEvents: vi.fn((handlers, client) => {
        for (const [event, handler] of Object.entries(handlers)) {
            client.on?.(event, handler);
        }
        return () => {
            for (const [event, handler] of Object.entries(handlers)) {
                client.off?.(event, handler);
            }
        };
    }),
    permissionsHandlePending: vi.fn(async (_session, requestId, result) => ({ requestId, result })),
    reloadAgents: vi.fn(async (session) => ({ agents: [{ name: `reloaded:${session.sessionId}` }] })),
    selectAgent: vi.fn(async (_session, name) => ({ agent: { name } })),
    deselectAgent: vi.fn(async () => ({})),
    sessionUiConfirm: vi.fn(async (_session, message) => message === 'Confirma?'),
    sessionUiElicitation: vi.fn(async (_session, params) => ({ action: 'accept', params })),
    sessionUiInput: vi.fn(async (_session, message) => `${message}:input`),
    sessionUiSelect: vi.fn(async (_session, _message, options) => options[0] ?? null),
    shellExec: vi.fn(async (_session, command, options) => ({ command, ...options })),
    shellKill: vi.fn(async (_session, processId, signal) => ({ processId, signal })),
    toolsHandlePendingCall: vi.fn(async (_session, requestId, options) => ({ requestId, ...options })),
    toolsList: vi.fn(async (client, options) => client.rpc.tools.list(options)),
    uiElicitation: vi.fn(async (_session, message, requestedSchema) => ({
        action: 'accept',
        message,
        requestedSchema,
    })),
    workspaceCreateFile: vi.fn(async (_session, path, content) => ({ path, content })),
    workspaceListFiles: vi.fn(async () => ({ files: ['plan.md'] })),
    workspaceReadFile: vi.fn(async (_session, path) => ({ path, content: 'hello' })),
}));

vi.mock('#copilot/sdk/constants', () => ({
    DEFAULT_MODEL: 'auto',
    PROVIDER_TYPES: {
        OPENAI: 'openai',
        AZURE: 'azure',
        ANTHROPIC: 'anthropic',
    },
    SESSION_LIFECYCLE_EVENTS: {
        CREATED: 'session.created',
        UPDATED: 'session.updated',
        DELETED: 'session.deleted',
    },
}));

vi.mock('#copilot/sdk/event-helpers', () => ({
    raceEvents: sdkMocks.raceEvents,
}));

vi.mock('#copilot/sdk/session', () => ({
    LIFECYCLE_EVENTS: {
        CREATED: 'sessionCreated',
        UPDATED: 'sessionUpdated',
        DELETED: 'sessionDeleted',
    },
    createCopilotClient: vi.fn(() => ({ sessionId: 'client-created' })),
    disconnectSessionSafe: sdkMocks.disconnectSessionSafe,
    onLifecycleEvents: sdkMocks.onLifecycleEvents,
    getSessionCapabilities: vi.fn((session) => session.capabilities ?? {}),
    isSessionUiElicitationAvailable: vi.fn((session) => Boolean(session.capabilities?.ui?.elicitation || session.ui)),
    sessionUiConfirm: vi.fn(async (_session, message) => message === 'Confirma?'),
    sessionUiElicitation: vi.fn(async (_session, params) => ({ action: 'accept', params })),
    sessionUiInput: vi.fn(async (_session, message) => `${message}:input`),
    sessionUiSelect: vi.fn(async (_session, _message, options) => options[0] ?? null),
    createSession: sdkMocks.createSession,
    deleteSession: sdkMocks.deleteSession,
    getConfiguredSessionFsHandler: sdkMocks.getConfiguredSessionFsHandler,
    listSessions: sdkMocks.listSessions,
    resumeOrCreate: sdkMocks.resumeOrCreate,
}));

vi.mock('#copilot/sdk/telemetry', () => ({
    createQuotaMonitor: createQuotaMonitorMock,
    getAuthStatus: sdkMocks.getAuthStatus,
}));

vi.mock('#copilot/sdk/errors', () => ({
    getSdkRecoveryPolicy: sdkMocks.getSdkRecoveryPolicy,
    isSdkQuotaOrRateLimitError: sdkMocks.isSdkQuotaOrRateLimitError,
}));

vi.mock('#copilot/sdk/models', () => ({
    listModels: sdkMocks.listModels,
    modelRegistry: sdkMocks.modelRegistry,
    modelStatsTracker: sdkMocks.modelStatsTracker,
}));

vi.mock('#copilot/sdk/feature-flags', () => ({
    isExperimentalEnabled: sdkMocks.isExperimentalEnabled,
}));

vi.mock('#copilot/sdk/tools', () => ({
    createTool: sdkMocks.createTool,
    createRegistry: sdkMocks.createRegistry,
    getToolsConfig: sdkMocks.getToolsConfig,
    loadToolsConfigAsync: sdkMocks.loadToolsConfigAsync,
}));

vi.mock('#copilot/sdk/utils', () => ({
    pickDefined: sdkMocks.pickDefined,
}));

vi.mock('#copilot/sdk/agents', () => ({
    listAgents: sdkMocks.listAgents,
    getCurrentAgent: sdkMocks.getCurrentAgent,
    selectAgent: sdkMocks.selectAgent,
    reloadAgents: sdkMocks.reloadAgents,
}));

vi.mock('#copilot/sdk/rpc', () => ({
    modelsList: sdkMocks.modelsList,
    toolsList: sdkMocks.toolsList,
    accountGetQuota: sdkMocks.accountGetQuota,
    workspaceListFiles: sdkMocks.workspaceListFiles,
    workspaceReadFile: sdkMocks.workspaceReadFile,
    workspaceCreateFile: sdkMocks.workspaceCreateFile,
    compactionCompact: sdkMocks.compactionCompact,
    shellExec: sdkMocks.shellExec,
    shellKill: sdkMocks.shellKill,
    permissionsHandlePending: sdkMocks.permissionsHandlePending,
    permissionsListPending: sdkMocks.permissionsListPending,
    permissionsResetSessionApprovals: sdkMocks.permissionsResetSessionApprovals,
    toolsHandlePendingCall: sdkMocks.toolsHandlePendingCall,
    commandsHandlePending: sdkMocks.commandsHandlePending,
    uiElicitation: sdkMocks.uiElicitation,
}));

vi.mock('#copilot/sdk/rpc/experimental', () => ({
    usageGetMetrics: sdkMocks.usageGetMetrics,
    mcpOauthLogin: sdkMocks.mcpOauthLogin,
}));

import {
    attachAgentSdkBootLifecycleBridge,
    canReadAgentSdkSessionMessages,
    compactSdkSession,
    confirmSdkSessionUi,
    createSdkWorkspaceFile,
    deselectSdkAgent,
    ensureAgentSdkClientStarted,
    execSdkShell,
    getAgentSdkLifecycleEvents,
    getAgentSdkRecoveryPolicy,
    getCurrentSdkAgent,
    getForegroundSdkSessionId,
    getLastSdkSessionId,
    getSdkAuthStatus,
    getSdkHandles,
    getSdkQuota,
    getSdkResourceSnapshot,
    getSdkSessionCapabilities,
    getSdkStatus,
    handleSdkPendingCommand,
    handleSdkPendingPermission,
    handleSdkPendingToolCall,
    inputSdkSessionUi,
    isSdkSessionUiElicitationAvailable,
    killSdkShell,
    listSdkAgents,
    listSdkBuiltInTools,
    listSdkModels,
    listSdkSessions,
    listSdkWorkspaceFiles,
    observeAgentSdkSessionLifecycle,
    pingAgentSdkClient,
    pingSdk,
    readSdkWorkspaceFile,
    reloadSdkAgents,
    requestSdkElicitation,
    selectSdkAgent,
    selectSdkSessionUi,
    setForegroundSdkSessionId,
    startAgentSdkBootQuotaBridge,
    startAgentSdkQuotaMonitor,
    stopAgentSdkClient,
} from '../../../src/copilot/agent/facades/sdk-access.js';

describe('sdk-access facade', () => {
    /** @type {any} */
    let client;
    /** @type {any} */
    let session;
    /** @type {any} */
    let ctx;

    beforeEach(() => {
        createQuotaMonitorMock.mockClear();
        client = {
            rpc: {
                account: { getQuota: vi.fn(async () => ({ quotaSnapshots: { chat: { remainingPercentage: 90 } } })) },
                models: { list: vi.fn(async () => ({ models: [{ id: 'gpt-5-mini' }] })) },
                tools: { list: vi.fn(async (options) => ({ tools: [{ name: options?.model ?? 'all' }] })) },
            },
            start: vi.fn(async () => {}),
            stop: vi.fn(async () => []),
            ping: vi.fn(async () => ({ message: 'pong', timestamp: 123, protocolVersion: 2 })),
            getState: vi.fn(() => 'disconnected'),
            getStatus: vi.fn(async () => ({ version: '0.2.0', protocolVersion: 2 })),
            getAuthStatus: vi.fn(async () => ({ isAuthenticated: true, authType: 'user' })),
            getLastSessionId: vi.fn(async () => 'last-sdk-session'),
            getForegroundSessionId: vi.fn(async () => 'foreground-sdk-session'),
            setForegroundSessionId: vi.fn(async () => {}),
            listSessions: vi.fn(async () => [{ sessionId: 'disk-session-1' }]),
            on: vi.fn(() => () => {}),
            off: vi.fn(),
        };

        session = {
            sessionId: 'sdk-session-1',
            capabilities: { ui: { elicitation: true } },
            ui: {
                confirm: vi.fn(async () => true),
                select: vi.fn(async (_message, options) => options.at(-1) ?? null),
                input: vi.fn(async (message) => `${message}:ui`),
                elicitation: vi.fn(async (params) => ({ action: 'accept', content: { answer: params.message } })),
            },
            rpc: {
                agent: { list: vi.fn() },
                commands: { handlePendingCommand: vi.fn() },
                compaction: { compact: vi.fn() },
                skills: { list: vi.fn() },
                mcp: { list: vi.fn() },
                plugins: { list: vi.fn() },
                extensions: { list: vi.fn() },
                fleet: { start: vi.fn() },
                permissions: { handlePendingPermissionRequest: vi.fn() },
                shell: { exec: vi.fn(), kill: vi.fn() },
                tools: { handlePendingToolCall: vi.fn() },
                ui: { elicitation: vi.fn() },
                workspace: { listFiles: vi.fn(), readFile: vi.fn(), createFile: vi.fn() },
            },
            workspacePath: '/tmp/sdk-workspace',
            setModel: vi.fn(),
            abort: vi.fn(),
            log: vi.fn(),
            getEvents: vi.fn(async () => []),
        };

        ctx = {
            ioState: { client },
            sessionState: { session },
            permissions: { handler: vi.fn() },
            toolsRegistry: new Map(),
            sdkElicitation: {
                handler: vi.fn(),
                listPending: vi.fn(() => [
                    {
                        id: 'elicitation-1',
                        sessionId: 'sdk-session-1',
                        message: 'Escolha o ambiente',
                        mode: 'form',
                        createdAt: 123,
                    },
                ]),
                getPending: vi.fn((id) =>
                    id === 'elicitation-1'
                        ? {
                              id,
                              sessionId: 'sdk-session-1',
                              message: 'Escolha o ambiente',
                              mode: 'form',
                              createdAt: 123,
                          }
                        : null,
                ),
                resolvePending: vi.fn((id) => id === 'elicitation-1'),
            },
        };
    });

    it('getSdkHandles e getSdkResourceSnapshot refletem cobertura completa do runtime atual', () => {
        const handles = getSdkHandles(ctx);
        const snapshot = getSdkResourceSnapshot(ctx);

        expect(handles.client).toBe(client);
        expect(handles.session).toBe(session);
        expect(handles.serverRpc).toBe(client.rpc);
        expect(handles.sessionRpc).toBe(session.rpc);
        expect(handles.workspacePath).toBe('/tmp/sdk-workspace');

        expect(snapshot.allCoreResourcesAvailable).toBe(true);
        expect(snapshot.allRuntimeResourcesAvailable).toBe(true);
        expect(snapshot.missingResources).toEqual([]);
        expect(snapshot.resources.serverRpcAvailable).toBe(true);
        expect(snapshot.resources.sessionRpcAvailable).toBe(true);
        expect(snapshot.resources.serverModelsListAvailable).toBe(true);
        expect(snapshot.resources.serverToolsListAvailable).toBe(true);
        expect(snapshot.resources.quotaAvailable).toBe(true);
        expect(snapshot.resources.workspaceRpcAvailable).toBe(true);
        expect(snapshot.resources.compactionAvailable).toBe(true);
        expect(snapshot.resources.shellAvailable).toBe(true);
        expect(snapshot.resources.uiElicitationAvailable).toBe(true);
        expect(snapshot.resources.uiApiAvailable).toBe(true);
        expect(snapshot.resources.uiElicitationCapabilityAvailable).toBe(true);
        expect(snapshot.resources.uiConfirmAvailable).toBe(true);
        expect(snapshot.resources.uiSelectAvailable).toBe(true);
        expect(snapshot.resources.uiInputAvailable).toBe(true);
        expect(snapshot.resources.elicitationProviderAvailable).toBe(true);
        expect(snapshot.resources.pendingCommandsAvailable).toBe(true);
        expect(snapshot.resources.pendingPermissionsAvailable).toBe(true);
        expect(snapshot.resources.pendingToolsAvailable).toBe(true);
        expect(snapshot.resources.foregroundControlAvailable).toBe(true);
        expect(snapshot.resources.customAgentsAvailable).toBe(true);
        expect(snapshot.resources.skillsAvailable).toBe(true);
        expect(snapshot.resources.mcpAvailable).toBe(true);
        expect(snapshot.resources.pluginsAvailable).toBe(true);
        expect(snapshot.resources.extensionsAvailable).toBe(true);
        expect(snapshot.resources.fleetAvailable).toBe(true);
    });

    it('canReadAgentSdkSessionMessages reflete a disponibilidade de getEvents na sessão ativa', () => {
        expect(canReadAgentSdkSessionMessages(session)).toBe(true);
        expect(canReadAgentSdkSessionMessages(/** @type {any} */ ({ sessionId: 'no-history' }))).toBe(false);
    });

    it('getSdkResourceSnapshot denuncia recursos ausentes quando client/sessão não existem', () => {
        const degradedCtx = {
            ioState: { client: null },
            sessionState: { session: null },
            permissions: { handler: null },
            toolsRegistry: null,
        };

        const snapshot = getSdkResourceSnapshot(/** @type {any} */ (degradedCtx));

        expect(snapshot.allCoreResourcesAvailable).toBe(false);
        expect(snapshot.allRuntimeResourcesAvailable).toBe(false);
        expect(snapshot.missingResources).toEqual([
            'client',
            'session',
            'serverRpc',
            'sessionRpc',
            'permissionHandler',
            'toolRegistry',
        ]);
        expect(snapshot.resources.clientAvailable).toBe(false);
        expect(snapshot.resources.sessionAvailable).toBe(false);
    });

    it('operações client-level delegam para o client atual do agent', async () => {
        await expect(pingSdk(ctx)).resolves.toEqual({ message: 'pong', timestamp: 123, protocolVersion: 2 });
        await expect(getSdkStatus(ctx)).resolves.toEqual({ version: '0.2.0', protocolVersion: 2 });
        await expect(getSdkAuthStatus(ctx)).resolves.toEqual({ isAuthenticated: true, authType: 'user' });
        await expect(getLastSdkSessionId(ctx)).resolves.toBe('last-sdk-session');
        await expect(getForegroundSdkSessionId(ctx)).resolves.toBe('foreground-sdk-session');
        await expect(listSdkSessions(ctx)).resolves.toEqual([{ sessionId: 'disk-session-1' }]);

        await setForegroundSdkSessionId(ctx, 'sdk-session-999');
        expect(client.setForegroundSessionId).toHaveBeenCalledWith('sdk-session-999');
    });

    it('operações canônicas de lifecycle do client passam pela façade do agent', async () => {
        await expect(ensureAgentSdkClientStarted(client)).resolves.toBeUndefined();
        await expect(pingAgentSdkClient(client)).resolves.toEqual({
            message: 'pong',
            timestamp: 123,
            protocolVersion: 2,
        });
        await expect(stopAgentSdkClient(client)).resolves.toEqual([]);

        expect(client.start).toHaveBeenCalledTimes(1);
        expect(client.ping).toHaveBeenCalledTimes(1);
        expect(client.stop).toHaveBeenCalledTimes(1);
    });

    it('expõe helpers semânticos de boot para lifecycle e quota do SDK', () => {
        const onEvent = vi.fn();

        const detach = attachAgentSdkBootLifecycleBridge(client, onEvent);
        const quotaMonitor = startAgentSdkBootQuotaBridge({
            client,
            intervalMs: 1000,
            warningThreshold: 20,
        });

        expect(typeof detach).toBe('function');
        expect(createQuotaMonitorMock).toHaveBeenCalledWith(
            expect.objectContaining({ client, intervalMs: 1000, warningThreshold: 20 }),
        );
        expect(quotaMonitor.start).toHaveBeenCalled();
    });

    it('ensureAgentSdkClientStarted não reexecuta start quando o client já está conectado', async () => {
        client.getState.mockReturnValue('connected');

        await expect(ensureAgentSdkClientStarted(client)).resolves.toBeUndefined();

        expect(client.start).not.toHaveBeenCalled();
    });

    it('operações server RPC de alto valor delegam pelo client atual do agent', async () => {
        await expect(listSdkModels(ctx)).resolves.toEqual({ models: [{ id: 'gpt-5-mini' }] });
        await expect(listSdkBuiltInTools(ctx, { model: 'gpt-5-mini' })).resolves.toEqual({
            tools: [{ name: 'gpt-5-mini' }],
        });
        await expect(getSdkQuota(ctx)).resolves.toEqual({
            quotaSnapshots: { chat: { remainingPercentage: 90 } },
        });
    });

    it('expõe a policy de recovery do SDK sem reabrir o boundary no agent', () => {
        expect(getAgentSdkRecoveryPolicy({ code: 'ECONNREFUSED' }, 'connection')).toMatchObject({
            kind: 'network',
            scope: 'connection',
            retryable: true,
        });
    });

    it('observeAgentSdkSessionLifecycle normaliza eventos vanilla no contrato interno do agent', () => {
        const handlers = /** @type {Record<string, (event: unknown) => void>} */ ({});
        const off = vi.fn();
        /** @type {unknown[]} */
        const normalized = [];

        client.on = vi.fn((event, handler) => {
            handlers[event] = handler;
        });
        client.off = vi.fn();

        const unsub = observeAgentSdkSessionLifecycle(client, (event) => {
            normalized.push(event);
        });

        handlers[getAgentSdkLifecycleEvents().CREATED]?.({ sessionId: 's-1' });
        handlers[getAgentSdkLifecycleEvents().UPDATED]?.({ sessionId: 's-2' });
        handlers[getAgentSdkLifecycleEvents().DELETED]?.({ sessionId: 's-3' });

        expect(normalized).toEqual([
            { type: 'session.created', sessionId: 's-1' },
            { type: 'session.updated', sessionId: 's-2' },
            { type: 'session.deleted', sessionId: 's-3' },
        ]);

        unsub();
        expect(client.off).toHaveBeenCalled();
        expect(off).not.toHaveBeenCalled();
    });

    it('startAgentSdkQuotaMonitor cria e inicia o monitor vanilla pela façade canônica', () => {
        const monitor = startAgentSdkQuotaMonitor({
            client: /** @type {any} */ ({ rpc: {} }),
            intervalMs: 60_000,
            warningThreshold: 20,
            onWarning: vi.fn(),
            onUpdate: vi.fn(),
        });

        expect(createQuotaMonitorMock).toHaveBeenCalledWith(
            expect.objectContaining({ intervalMs: 60_000, warningThreshold: 20 }),
        );
        expect(typeof monitor.start).toBe('function');
        expect(monitor.start).toHaveBeenCalledTimes(1);
    });

    it('operações de custom agents delegam para a camada sdk canônica sobre a sessão atual', async () => {
        await expect(listSdkAgents(ctx)).resolves.toEqual({ agents: [{ name: 'agent:sdk-session-1' }] });
        await expect(getCurrentSdkAgent(ctx)).resolves.toEqual({
            agent: { name: 'agent-full' },
            previousAgent: { name: 'current:sdk-session-1' },
            enforced: true,
        });
        await expect(selectSdkAgent(ctx, 'reviewer')).rejects.toThrow(/agent-full|obrigatório/i);
        await expect(selectSdkAgent(ctx, 'agent-full')).resolves.toEqual({ agent: { name: 'agent-full' } });
        await expect(deselectSdkAgent(ctx)).resolves.toEqual({ agent: { name: 'agent-full' } });
        await expect(reloadSdkAgents(ctx)).resolves.toEqual({
            agents: [{ name: 'reloaded:sdk-session-1' }],
            selectedAgent: { name: 'agent-full' },
        });
    });

    it('operações session RPC avançadas ficam disponíveis pela facade do agent', async () => {
        await expect(listSdkWorkspaceFiles(ctx)).resolves.toEqual({ files: ['plan.md'] });
        await expect(readSdkWorkspaceFile(ctx, 'plan.md')).resolves.toEqual({ path: 'plan.md', content: 'hello' });
        await expect(createSdkWorkspaceFile(ctx, 'notes.md', 'ok')).resolves.toEqual({
            path: 'notes.md',
            content: 'ok',
        });
        await expect(compactSdkSession(ctx)).resolves.toEqual({ success: true });
        await expect(requestSdkElicitation(ctx, 'Dados?', { type: 'object' })).resolves.toMatchObject({
            action: 'accept',
            params: {
                message: 'Dados?',
                requestedSchema: { type: 'object' },
            },
        });
        await expect(confirmSdkSessionUi(ctx, 'Confirma?')).resolves.toBe(true);
        await expect(selectSdkSessionUi(ctx, 'Escolha', ['dev', 'prod'])).resolves.toBe('dev');
        await expect(inputSdkSessionUi(ctx, 'Nome?')).resolves.toBe('Nome?:input');
        expect(getSdkSessionCapabilities(ctx)).toEqual({ ui: { elicitation: true } });
        expect(isSdkSessionUiElicitationAvailable(ctx)).toBe(true);
        await expect(handleSdkPendingPermission(ctx, 'perm-1', { kind: 'approve-once' })).resolves.toEqual({
            requestId: 'perm-1',
            result: { kind: 'approve-once' },
        });
        await expect(handleSdkPendingToolCall(ctx, 'tool-1', { result: 'ok' })).resolves.toEqual({
            requestId: 'tool-1',
            result: 'ok',
        });
        await expect(handleSdkPendingCommand(ctx, 'cmd-1', { error: 'denied' })).resolves.toEqual({
            requestId: 'cmd-1',
            error: 'denied',
        });
        await expect(execSdkShell(ctx, 'npm test', { timeout: 1000 })).resolves.toEqual({
            command: 'npm test',
            timeout: 1000,
        });
        await expect(killSdkShell(ctx, 'proc-1', 'SIGINT')).resolves.toEqual({
            processId: 'proc-1',
            signal: 'SIGINT',
        });
    });

    it('provider-side elicitation fica acessível pela facade do agent', async () => {
        const { getPendingSdkElicitation, listPendingSdkElicitations, resolvePendingSdkElicitation } =
            await import('../../../src/copilot/agent/facades/sdk-access.js');
        expect(listPendingSdkElicitations(ctx)).toHaveLength(1);
        expect(getPendingSdkElicitation(ctx, 'elicitation-1')).toMatchObject({ message: 'Escolha o ambiente' });
        expect(resolvePendingSdkElicitation(ctx, 'elicitation-1', { action: 'accept' })).toBe(true);
    });
});
