// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/sdk', () => ({
    getCurrentAgent: vi.fn(async (session) => ({ agent: { name: `current:${session.sessionId}` } })),
    listAgents: vi.fn(async (session) => ({ agents: [{ name: `agent:${session.sessionId}` }] })),
    reloadAgents: vi.fn(async (session) => ({ agents: [{ name: `reloaded:${session.sessionId}` }] })),
    selectAgent: vi.fn(async (_session, name) => ({ agent: { name } })),
    deselectAgent: vi.fn(async () => ({})),
}));

import {
    deselectSdkAgent,
    getCurrentSdkAgent,
    getForegroundSdkSessionId,
    getLastSdkSessionId,
    getSdkAuthStatus,
    getSdkHandles,
    getSdkResourceSnapshot,
    getSdkStatus,
    listSdkAgents,
    listSdkSessions,
    pingSdk,
    reloadSdkAgents,
    selectSdkAgent,
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
            rpc: { tools: { list: vi.fn() } },
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
            rpc: {
                agent: { list: vi.fn() },
                skills: { list: vi.fn() },
                mcp: { list: vi.fn() },
                plugins: { list: vi.fn() },
                extensions: { list: vi.fn() },
                fleet: { start: vi.fn() },
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

    it('operações de custom agents delegam para a camada sdk canônica sobre a sessão atual', async () => {
        await expect(listSdkAgents(ctx)).resolves.toEqual({ agents: [{ name: 'agent:sdk-session-1' }] });
        await expect(getCurrentSdkAgent(ctx)).resolves.toEqual({ agent: { name: 'current:sdk-session-1' } });
        await expect(selectSdkAgent(ctx, 'reviewer')).resolves.toEqual({ agent: { name: 'reviewer' } });
        await expect(deselectSdkAgent(ctx)).resolves.toEqual({});
        await expect(reloadSdkAgents(ctx)).resolves.toEqual({ agents: [{ name: 'reloaded:sdk-session-1' }] });
    });
});
