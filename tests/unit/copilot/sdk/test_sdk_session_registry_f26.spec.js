// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_session_registry_f26.spec.js
 *
 * Faixa 26 — Session Registry SSOT
 *
 * F123: sdk/client.js Map<sessionId, SessionEntry> como SSOT — verificação estrutural F124:
 * createClientSession/resumeClientSession populam o registry F125: disconnectClientSession/deleteClientSession removem
 * do registry F126: registry: getClientSession, listActiveClientSessions, getActiveSessionCount F127: barrel exporta
 * todas as funções do registry
 *
 * @module tests/unit/copilot/sdk/test_sdk_session_registry_f26
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── F127: barrel exporta as funções do registry ──────────────────────────────

describe('F127 — barrel exporta funções do registry de sessão', () => {
    it('exporta createClientSession', async () => {
        const sdk = await import('#copilot/sdk');
        expect(typeof sdk.createClientSession).toBe('function');
    });

    it('exporta resumeClientSession', async () => {
        const sdk = await import('#copilot/sdk');
        expect(typeof sdk.resumeClientSession).toBe('function');
    });

    it('exporta disconnectClientSession', async () => {
        const sdk = await import('#copilot/sdk');
        expect(typeof sdk.disconnectClientSession).toBe('function');
    });

    it('exporta listActiveClientSessions', async () => {
        const sdk = await import('#copilot/sdk');
        expect(typeof sdk.listActiveClientSessions).toBe('function');
    });

    it('exporta getActiveSessionCount', async () => {
        const sdk = await import('#copilot/sdk');
        expect(typeof sdk.getActiveSessionCount).toBe('function');
    });

    it('exporta incrementSessionMessageCount', async () => {
        const sdk = await import('#copilot/sdk');
        expect(typeof sdk.incrementSessionMessageCount).toBe('function');
    });
});

// ─── Client.js registry direto ──────────────────────────────────────────────

describe('F123 — sdk/client.js: registry Map como SSOT', () => {
    /** @type {import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js')} */
    let clientModule;

    beforeEach(async () => {
        clientModule = await import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js');
        clientModule._resetClientState();
    });

    afterEach(() => {
        clientModule._resetClientState();
    });

    it('getActiveSessionCount começa com 0', () => {
        expect(clientModule.getActiveSessionCount()).toBe(0);
    });

    it('listActiveClientSessions começa vazio', () => {
        expect(clientModule.listActiveClientSessions()).toEqual([]);
    });

    it('getClientSession retorna undefined para sessão não registrada', () => {
        expect(clientModule.getClientSession('session-nao-existe')).toBeUndefined();
    });

    it('incrementSessionMessageCount retorna 0 para sessão não registrada', () => {
        expect(clientModule.incrementSessionMessageCount('nao-existe')).toBe(0);
    });

    it('_resetClientState limpa o registry', () => {
        // Injeta um mock de client com sessão mock
        const mockSession = {
            sessionId: 'test-session-id',
            disconnect: vi.fn().mockResolvedValue(undefined),
        };
        const mockClient = {
            getState: () => 'connected',
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue([]),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        // Após reset, registry está limpo
        clientModule._resetClientState();
        expect(clientModule.getActiveSessionCount()).toBe(0);
    });
});

describe('F124 — createClientSession registra sessão no Map', () => {
    /** @type {import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js')} */
    let clientModule;

    beforeEach(async () => {
        clientModule = await import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js');
        clientModule._resetClientState();
    });

    afterEach(() => {
        clientModule._resetClientState();
    });

    it('cria sessão e a registra no Map', async () => {
        const mockSession = {
            sessionId: 'session-abc-123',
            disconnect: vi.fn().mockResolvedValue(undefined),
        };
        const mockClient = {
            getState: () => 'connected',
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue([]),
            start: vi.fn().mockResolvedValue(undefined),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        await clientModule.createClientSession(
            /** @type {any} */ ({ model: 'gpt-4.1', onPermissionRequest: () => {} }),
        );

        expect(clientModule.getActiveSessionCount()).toBe(1);
        const entry = clientModule.getClientSession('session-abc-123');
        expect(entry).toBeDefined();
        expect(entry?.session).toBe(mockSession);
        expect(entry?.model).toBe('gpt-4.1');
        expect(entry?.messagesCount).toBe(0);
    });

    it('retorna a sessão criada', async () => {
        const mockSession = {
            sessionId: 'session-xyz',
            disconnect: vi.fn().mockResolvedValue(undefined),
        };
        const mockClient = {
            getState: () => 'connected',
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue([]),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        const result = await clientModule.createClientSession(
            /** @type {any} */ ({ model: 'gpt-4.1', onPermissionRequest: () => {} }),
        );
        expect(result).toBe(mockSession);
    });

    it('registra createdAt como timestamp recente', async () => {
        const tsBefore = Date.now();
        const mockSession = { sessionId: 's1', disconnect: vi.fn().mockResolvedValue(undefined) };
        const mockClient = {
            getState: () => 'connected',
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue([]),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        await clientModule.createClientSession(/** @type {any} */ ({ onPermissionRequest: () => {} }));

        const entry = clientModule.getClientSession('s1');
        expect(entry?.createdAt).toBeGreaterThanOrEqual(tsBefore);
    });
});

describe('F124 — resumeClientSession registra sessão no Map', () => {
    /** @type {import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js')} */
    let clientModule;

    beforeEach(async () => {
        clientModule = await import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js');
        clientModule._resetClientState();
    });

    afterEach(() => {
        clientModule._resetClientState();
    });

    it('resume cria entrada no registry', async () => {
        const mockSession = { sessionId: 'resumed-session-id', disconnect: vi.fn().mockResolvedValue(undefined) };
        const mockClient = {
            getState: () => 'connected',
            resumeSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue([]),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        await clientModule.resumeClientSession(
            'resumed-session-id',
            /** @type {any} */ ({ model: 'gpt-4.1', onPermissionRequest: () => {} }),
        );

        expect(clientModule.getActiveSessionCount()).toBe(1);
        expect(clientModule.getClientSession('resumed-session-id')).toBeDefined();
    });

    it('resume retorna sessão existente do registry sem nova conexão', async () => {
        const mockSession = { sessionId: 'existing-session', disconnect: vi.fn().mockResolvedValue(undefined) };
        const mockClient = {
            getState: () => 'connected',
            resumeSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue([]),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        // Primeira chamada
        await clientModule.resumeClientSession(
            'existing-session',
            /** @type {any} */ ({ model: 'gpt-4.1', onPermissionRequest: () => {} }),
        );
        // Segunda chamada — deve retornar do registry sem chamar resumeSession novamente
        await clientModule.resumeClientSession(
            'existing-session',
            /** @type {any} */ ({ model: 'gpt-4.1', onPermissionRequest: () => {} }),
        );

        expect(mockClient.resumeSession).toHaveBeenCalledTimes(1);
    });
});

describe('F125 — disconnectClientSession remove do registry', () => {
    /** @type {import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js')} */
    let clientModule;

    beforeEach(async () => {
        clientModule = await import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js');
        clientModule._resetClientState();
    });

    afterEach(() => {
        clientModule._resetClientState();
    });

    it('disconnectClientSession chama session.disconnect e remove do registry', async () => {
        const mockSession = { sessionId: 'disc-session', disconnect: vi.fn().mockResolvedValue(undefined) };
        const mockClient = {
            getState: () => 'connected',
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue([]),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        await clientModule.createClientSession(/** @type {any} */ ({ onPermissionRequest: () => {} }));
        expect(clientModule.getActiveSessionCount()).toBe(1);

        await clientModule.disconnectClientSession('disc-session');
        expect(clientModule.getActiveSessionCount()).toBe(0);
        expect(mockSession.disconnect).toHaveBeenCalledOnce();
    });

    it('disconnectClientSession em sessão não registrada não lança', async () => {
        await expect(clientModule.disconnectClientSession('nao-existe')).resolves.not.toThrow();
    });
});

describe('F126 — registry: listActiveClientSessions e incrementSessionMessageCount', () => {
    /** @type {import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js')} */
    let clientModule;

    beforeEach(async () => {
        clientModule = await import('/workspaces/chatgpt-docker-puppeteer/src/copilot/sdk/client.js');
        clientModule._resetClientState();
    });

    afterEach(() => {
        clientModule._resetClientState();
    });

    it('listActiveClientSessions retorna todas as sessões registradas', async () => {
        const makeSession = (/** @type {string} */ id) => ({
            sessionId: id,
            disconnect: vi.fn().mockResolvedValue(undefined),
        });

        let callCount = 0;
        const sessions = [makeSession('s-alpha'), makeSession('s-beta')];
        const mockClient = {
            getState: () => 'connected',
            createSession: vi.fn().mockImplementation(() => Promise.resolve(sessions[callCount++])),
            stop: vi.fn().mockResolvedValue([]),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        await clientModule.createClientSession(/** @type {any} */ ({ onPermissionRequest: () => {} }));
        await clientModule.createClientSession(/** @type {any} */ ({ onPermissionRequest: () => {} }));

        const active = clientModule.listActiveClientSessions();
        expect(active).toHaveLength(2);
        const ids = active.map((e) => e.sessionId).sort();
        expect(ids).toEqual(['s-alpha', 's-beta']);
    });

    it('incrementSessionMessageCount incrementa corretamente', async () => {
        const mockSession = { sessionId: 'msg-session', disconnect: vi.fn().mockResolvedValue(undefined) };
        const mockClient = {
            getState: () => 'connected',
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue([]),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        await clientModule.createClientSession(/** @type {any} */ ({ onPermissionRequest: () => {} }));

        expect(clientModule.incrementSessionMessageCount('msg-session')).toBe(1);
        expect(clientModule.incrementSessionMessageCount('msg-session')).toBe(2);
        expect(clientModule.incrementSessionMessageCount('msg-session')).toBe(3);

        const entry = clientModule.getClientSession('msg-session');
        expect(entry?.messagesCount).toBe(3);
    });

    it('getActiveSessionCount reflete sesões em tempo real', async () => {
        const mockSession = { sessionId: 'count-session', disconnect: vi.fn().mockResolvedValue(undefined) };
        const mockClient = {
            getState: () => 'connected',
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue([]),
        };
        clientModule._injectClientForTest(/** @type {any} */ (mockClient));

        expect(clientModule.getActiveSessionCount()).toBe(0);
        await clientModule.createClientSession(/** @type {any} */ ({ onPermissionRequest: () => {} }));
        expect(clientModule.getActiveSessionCount()).toBe(1);
        await clientModule.disconnectClientSession('count-session');
        expect(clientModule.getActiveSessionCount()).toBe(0);
    });
});
