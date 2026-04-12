// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_client.spec.js
 *
 * Testes unitários para src/copilot/sdk/client.js Cobre: buildClientOptions, getClient, stopClient, forceStopClient,
 * session CRUD, registry, getClientState, state reset/inject
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger
vi.mock('#copilot/observability/logger', () => ({ log: vi.fn(), LOG_DIR: '/tmp/test-logs', getRecentLogs: vi.fn(() => []), }));

vi.mock('#copilot/config/env', () => ({
    COPILOT_CLI_URL: '',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',

    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
}));

vi.mock('../../../src/copilot/core/error-handlers.js', () => ({
    logSwallowed: vi.fn(),
}));

/** @returns {any} */
function mockSession(id = 'sess-1') {
    return {
        sessionId: id,
        disconnect: vi.fn().mockResolvedValue(undefined),
    };
}

/** @returns {any} */
function mockClient() {
    return {
        getState: vi.fn(() => 'connected'),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue([]),
        ping: vi.fn().mockResolvedValue({ message: 'pong', timestamp: Date.now() }),
        getStatus: vi.fn().mockResolvedValue({ version: '1.0' }),
        getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
        listModels: vi.fn().mockResolvedValue([{ id: 'gpt-4.1' }]),
        createSession: vi.fn((_cfg) => Promise.resolve(mockSession())),
        resumeSession: vi.fn((id, _cfg) => Promise.resolve(mockSession(id))),
        deleteSession: vi.fn().mockResolvedValue(undefined),
        listSessions: vi.fn().mockResolvedValue([]),
    };
}

// Mock CopilotClient constructor — must be class for `new` to work
vi.mock('@github/copilot-sdk', () => {
    class MockCopilotClient {
        constructor() {
            this.getState = vi.fn(() => 'connected');
            this.start = vi.fn().mockResolvedValue(undefined);
            this.stop = vi.fn().mockResolvedValue([]);
            this.ping = vi.fn().mockResolvedValue({ message: 'pong', timestamp: Date.now() });
            this.getStatus = vi.fn().mockResolvedValue({ version: '1.0' });
            this.getAuthStatus = vi.fn().mockResolvedValue({ authenticated: true });
            this.listModels = vi.fn().mockResolvedValue([{ id: 'gpt-4.1' }]);
            this.createSession = vi.fn((_cfg) => Promise.resolve({ sessionId: 'sess-1', disconnect: vi.fn() }));
            this.resumeSession = vi.fn((id, _cfg) => Promise.resolve({ sessionId: id, disconnect: vi.fn() }));
            this.deleteSession = vi.fn().mockResolvedValue(undefined);
            this.listSessions = vi.fn().mockResolvedValue([]);
        }
    }
    return {
        CopilotClient: MockCopilotClient,
        approveAll: vi.fn().mockResolvedValue({ kind: 'approved' }),
    };
});

import {
    _injectClientForTest,
    _resetClientState,
    buildClientOptions,
    createClientSession,
    deleteClientSession,
    disconnectClientSession,
    forceStopClient,
    getActiveSessionCount,
    getClient,
    getClientSession,
    getClientState,
    incrementSessionMessageCount,
    listActiveClientSessions,
    resumeClientSession,
    stopClient,
} from '../../../../src/copilot/sdk/client.js';

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
    _resetClientState();
});

// ─── buildClientOptions ──────────────────────────────────────────────────────

describe('sdk/client › buildClientOptions', () => {
    it('retorna objeto de opções vazio por padrão', () => {
        const opts = buildClientOptions();
        expect(opts).toBeDefined();
        expect(typeof opts).toBe('object');
    });

    it('aceita overrides', () => {
        const opts = buildClientOptions({ logLevel: 'debug' });
        expect(/** @type {any} */ (opts).logLevel).toBe('debug');
    });
});

// ─── getClient ──────────────────────────────────────────────────────────────

describe('sdk/client › getClient', () => {
    it('cria e retorna client conectado', async () => {
        const client = await getClient();
        expect(client).toBeDefined();
        expect(client.getState()).toBe('connected');
    });

    it('chamadas concorrentes retornam mesma promise', async () => {
        const [c1, c2] = await Promise.all([getClient(), getClient()]);
        expect(c1).toBe(c2);
    });

    it('reutiliza client existente se conectado', async () => {
        const c1 = await getClient();
        const c2 = await getClient();
        expect(c1).toBe(c2);
    });
});

// ─── stopClient ─────────────────────────────────────────────────────────────

describe('sdk/client › stopClient', () => {
    it('retorna array vazio quando sem client', async () => {
        const errors = await stopClient();
        expect(errors).toEqual([]);
    });

    it('para client e limpa sessions', async () => {
        const mc = mockClient();
        _injectClientForTest(/** @type {any} */ (mc));
        const errors = await stopClient();
        expect(errors).toEqual([]);
        expect(mc.stop).toHaveBeenCalled();
        expect(getClientState()).toBe('not_started');
    });
});

// ─── forceStopClient ────────────────────────────────────────────────────────

describe('sdk/client › forceStopClient', () => {
    it('sem client é noop', async () => {
        await expect(forceStopClient()).resolves.toBeUndefined();
    });

    it('chama stop no client', async () => {
        const mc = mockClient();
        _injectClientForTest(/** @type {any} */ (mc));
        await forceStopClient();
        expect(mc.stop).toHaveBeenCalled();
        expect(getClientState()).toBe('not_started');
    });

    it('chama forceStop se disponível', async () => {
        const mc = mockClient();
        mc.forceStop = vi.fn().mockResolvedValue(undefined);
        _injectClientForTest(/** @type {any} */ (mc));
        await forceStopClient();
        expect(mc.forceStop).toHaveBeenCalled();
    });
});

// ─── getClientState ─────────────────────────────────────────────────────────

describe('sdk/client › getClientState', () => {
    it('retorna not_started sem client', () => {
        expect(getClientState()).toBe('not_started');
    });

    it('retorna estado do client injetado', () => {
        const mc = mockClient();
        mc.getState.mockReturnValue('disconnected');
        _injectClientForTest(/** @type {any} */ (mc));
        expect(getClientState()).toBe('disconnected');
    });
});

// ─── Session CRUD ───────────────────────────────────────────────────────────

describe('sdk/client › session management', () => {
    beforeEach(async () => {
        const mc = mockClient();
        _injectClientForTest(/** @type {any} */ (mc));
    });

    it('createClientSession cria e registra no registry', async () => {
        const session = await createClientSession(/** @type {any} */ ({ model: 'gpt-4.1' }));
        expect(session.sessionId).toBe('sess-1');
        expect(getActiveSessionCount()).toBe(1);
        const entry = getClientSession('sess-1');
        expect(entry).toBeDefined();
        expect(entry?.model).toBe('gpt-4.1');
    });

    it('resumeClientSession retorna sessão existente do registry', async () => {
        await createClientSession(/** @type {any} */ ({ model: 'gpt-4.1' }));
        const resumed = await resumeClientSession('sess-1', /** @type {any} */ ({}));
        expect(resumed.sessionId).toBe('sess-1');
        expect(getActiveSessionCount()).toBe(1); // não duplicou
    });

    it('resumeClientSession cria nova se não existe', async () => {
        const session = await resumeClientSession('sess-new', /** @type {any} */ ({}));
        expect(session.sessionId).toBe('sess-new');
        expect(getActiveSessionCount()).toBe(1);
    });

    it('disconnectClientSession remove do registry', async () => {
        await createClientSession(/** @type {any} */ ({ model: 'gpt-4.1' }));
        await disconnectClientSession('sess-1');
        expect(getActiveSessionCount()).toBe(0);
        expect(getClientSession('sess-1')).toBeUndefined();
    });

    it('disconnectClientSession com ID inexistente é noop', async () => {
        await expect(disconnectClientSession('nonexistent')).resolves.toBeUndefined();
    });

    it('deleteClientSession remove e deleta do disco', async () => {
        await createClientSession(/** @type {any} */ ({ model: 'gpt-4.1' }));
        await deleteClientSession('sess-1');
        expect(getActiveSessionCount()).toBe(0);
    });

    it('listActiveClientSessions retorna todas as sessões', async () => {
        const mc = mockClient();
        mc.createSession.mockImplementation((cfg) => Promise.resolve(mockSession(`s-${cfg.model}`)));
        _injectClientForTest(/** @type {any} */ (mc));

        await createClientSession(/** @type {any} */ ({ model: 'a' }));
        await createClientSession(/** @type {any} */ ({ model: 'b' }));

        const list = listActiveClientSessions();
        expect(list.length).toBe(2);
        expect(list.every((e) => e.sessionId && e.model)).toBe(true);
    });
});

// ─── incrementSessionMessageCount ───────────────────────────────────────────

describe('sdk/client › incrementSessionMessageCount', () => {
    it('incrementa e retorna novo total', async () => {
        const mc = mockClient();
        _injectClientForTest(/** @type {any} */ (mc));
        await createClientSession(/** @type {any} */ ({ model: 'gpt-4.1' }));

        expect(incrementSessionMessageCount('sess-1')).toBe(1);
        expect(incrementSessionMessageCount('sess-1')).toBe(2);
    });

    it('retorna 0 para sessão inexistente', () => {
        expect(incrementSessionMessageCount('nonexistent')).toBe(0);
    });
});

// ─── _resetClientState ──────────────────────────────────────────────────────

describe('sdk/client › _resetClientState', () => {
    it('limpa client, promise e sessions', async () => {
        const mc = mockClient();
        _injectClientForTest(/** @type {any} */ (mc));
        await createClientSession(/** @type {any} */ ({ model: 'gpt-4.1' }));
        expect(getActiveSessionCount()).toBe(1);

        _resetClientState();
        expect(getClientState()).toBe('not_started');
        expect(getActiveSessionCount()).toBe(0);
    });
});
