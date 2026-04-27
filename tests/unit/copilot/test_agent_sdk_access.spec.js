// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/sdk', () => ({
    accountGetQuota: vi.fn(async (client) => client.rpc.account.getQuota()),
    commandsHandlePending: vi.fn(async (_session, requestId, options) => ({ requestId, ...options })),
    compactionCompact: vi.fn(async () => ({ success: true })),
    getSessionCapabilities: vi.fn((session) => session.capabilities ?? {}),
    getCurrentAgent: vi.fn(async (session) => ({ agent: { name: `current:${session.sessionId}` } })),
    isSessionUiElicitationAvailable: vi.fn((session) => Boolean(session.capabilities?.ui?.elicitation || session.ui)),
    listAgents: vi.fn(async (session) => ({ agents: [{ name: `agent:${session.sessionId}` }] })),
    modelsList: vi.fn(async (client) => client.rpc.models.list()),
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

import {
    compactSdkSession,
    confirmSdkSessionUi,
    createSdkWorkspaceFile,
    deselectSdkAgent,
    execSdkShell,
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
    pingSdk,
    readSdkWorkspaceFile,
    reloadSdkAgents,
    requestSdkElicitation,
    selectSdkAgent,
    selectSdkSessionUi,
    setForegroundSdkSessionId,
} from '../../../src/copilot/agent/facades/agent-sdk-access.js';

describe('agent-sdk-access facade', () => {
    /** @type {any} */
    let client;
    /** @type {any} */
    let session;
    /** @type {any} */
    let ctx;

    beforeEach(() => {
        client = {
            rpc: {
                account: { getQuota: vi.fn(async () => ({ quotaSnapshots: { chat: { remainingPercentage: 90 } } })) },
                models: { list: vi.fn(async () => ({ models: [{ id: 'gpt-5-mini' }] })) },
                tools: { list: vi.fn(async (options) => ({ tools: [{ name: options?.model ?? 'all' }] })) },
            },
            ping: vi.fn(async () => ({ message: 'pong', timestamp: 123, protocolVersion: 2 })),
            getStatus: vi.fn(async () => ({ version: '0.2.0', protocolVersion: 2 })),
            getAuthStatus: vi.fn(async () => ({ isAuthenticated: true, authType: 'user' })),
            getLastSessionId: vi.fn(async () => 'last-sdk-session'),
            getForegroundSessionId: vi.fn(async () => 'foreground-sdk-session'),
            setForegroundSessionId: vi.fn(async () => {}),
            listSessions: vi.fn(async () => [{ sessionId: 'disk-session-1' }]),
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
            getMessages: vi.fn(async () => []),
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

    it('operações server RPC de alto valor delegam pelo client atual do agent', async () => {
        await expect(listSdkModels(ctx)).resolves.toEqual({ models: [{ id: 'gpt-5-mini' }] });
        await expect(listSdkBuiltInTools(ctx, { model: 'gpt-5-mini' })).resolves.toEqual({
            tools: [{ name: 'gpt-5-mini' }],
        });
        await expect(getSdkQuota(ctx)).resolves.toEqual({
            quotaSnapshots: { chat: { remainingPercentage: 90 } },
        });
    });

    it('operações de custom agents delegam para a camada sdk canônica sobre a sessão atual', async () => {
        await expect(listSdkAgents(ctx)).resolves.toEqual({ agents: [{ name: 'agent:sdk-session-1' }] });
        await expect(getCurrentSdkAgent(ctx)).resolves.toEqual({ agent: { name: 'current:sdk-session-1' } });
        await expect(selectSdkAgent(ctx, 'reviewer')).resolves.toEqual({ agent: { name: 'reviewer' } });
        await expect(deselectSdkAgent(ctx)).resolves.toEqual({});
        await expect(reloadSdkAgents(ctx)).resolves.toEqual({ agents: [{ name: 'reloaded:sdk-session-1' }] });
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
        await expect(handleSdkPendingPermission(ctx, 'perm-1', { kind: 'approved' })).resolves.toEqual({
            requestId: 'perm-1',
            result: { kind: 'approved' },
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
            await import('../../../src/copilot/agent/facades/agent-sdk-access.js');
        expect(listPendingSdkElicitations(ctx)).toHaveLength(1);
        expect(getPendingSdkElicitation(ctx, 'elicitation-1')).toMatchObject({ message: 'Escolha o ambiente' });
        expect(resolvePendingSdkElicitation(ctx, 'elicitation-1', { action: 'accept' })).toBe(true);
    });
});
