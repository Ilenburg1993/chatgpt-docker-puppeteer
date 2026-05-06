// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_client.spec.js
 *
 * Testes unitários para src/copilot/sdk/session/client.js Cobre: buildClientOptions, getClient, stopClient,
 * forceStopClient, session CRUD, registry, getClientState, state reset/inject
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

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
        rpc: { tools: { list: vi.fn() } },
        getState: vi.fn(() => 'connected'),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue([]),
        ping: vi.fn().mockResolvedValue({ message: 'pong', timestamp: Date.now() }),
        getStatus: vi.fn().mockResolvedValue({ version: '1.0' }),
        getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
        getLastSessionId: vi.fn().mockResolvedValue('last-session-id'),
        getForegroundSessionId: vi.fn().mockResolvedValue('foreground-session-id'),
        setForegroundSessionId: vi.fn().mockResolvedValue(undefined),
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
            this.listModels = vi.fn().mockResolvedValue([{ id: 'gpt-4.1' }]);
            this.rpc = { tools: { list: vi.fn() } };
            this.createSession = vi.fn((_cfg) => Promise.resolve({ sessionId: 'sess-1', disconnect: vi.fn() }));
            this.resumeSession = vi.fn((id, _cfg) => Promise.resolve({ sessionId: id, disconnect: vi.fn() }));
            this.deleteSession = vi.fn().mockResolvedValue(undefined);
            this.listSessions = vi.fn().mockResolvedValue([]);
        }

        getState() {
            return 'connected';
        }

        async start() {
            return undefined;
        }

        async stop() {
            return [];
        }

        async ping() {
            return { message: 'pong', timestamp: Date.now() };
        }

        async getStatus() {
            return { version: '1.0' };
        }

        async getAuthStatus() {
            return { authenticated: true };
        }

        async getLastSessionId() {
            return 'last-session-id';
        }

        async getForegroundSessionId() {
            return 'foreground-session-id';
        }

        async setForegroundSessionId() {
            return undefined;
        }
    }
    return {
        CopilotClient: MockCopilotClient,
        approveAll: vi.fn().mockResolvedValue({ kind: 'approve-once' }),
    };
});

import { classifySdkRateLimitScope, getSdkRecoveryPolicy } from '../../../../src/copilot/sdk/errors.js';
import { listModels } from '../../../../src/copilot/sdk/models/helpers.js';
import {
    _injectClientForTest,
    _resetClientState,
    buildClientOptions,
    createClientSession,
    createCopilotClientManager,
    deleteClientSession,
    disconnectClientSession,
    forceStopClient,
    getActiveSessionCount,
    getClient,
    getClientSession,
    getClientState,
    getForegroundClientSessionId,
    getLastClientSessionId,
    getSdkConnectionCircuitBreaker,
    getServerRpc,
    incrementSessionMessageCount,
    listActiveClientSessions,
    resumeClientSession,
    sdkConnectionCircuitBreaker,
    setForegroundClientSessionId,
    stopClient,
} from '../../../../src/copilot/sdk/session/client.js';
import { createSdkSessionRegistry } from '../../../../src/copilot/sdk/session/session-registry.js';
import { setSdkMetricEmitter } from '../../../../src/copilot/sdk/telemetry/operation-metrics.js';

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.restoreAllMocks();
    _resetClientState();
    setSdkMetricEmitter(null);
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

    it('não abre o circuit breaker para falha auth', async () => {
        const { CopilotClient: MockCopilotClient } = await import('@github/copilot-sdk');
        vi.spyOn(MockCopilotClient.prototype, 'start').mockRejectedValueOnce(
            Object.assign(new Error('unauthorized'), { status: 401 }),
        );

        await expect(getClient()).rejects.toMatchObject({ name: 'SdkOperationError', kind: 'auth' });
        expect(sdkConnectionCircuitBreaker.getState()).toBe('closed');
    });

    it('usa retry curto em falha transitória e emite métricas de client.connect', async () => {
        const { CopilotClient: MockCopilotClient } = await import('@github/copilot-sdk');
        const startSpy = vi
            .spyOn(MockCopilotClient.prototype, 'start')
            .mockRejectedValueOnce(Object.assign(new Error('conn refused'), { code: 'ECONNREFUSED' }))
            .mockResolvedValueOnce(undefined);

        /** @type {import('../../../../src/copilot/sdk/types.js').SdkOperationMetric[]} */
        const metrics = [];
        setSdkMetricEmitter((metric) => metrics.push(metric));

        const client = await getClient();
        expect(client).toBeDefined();
        expect(startSpy).toHaveBeenCalledTimes(2);
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining(['client.connect:started', 'client.connect:succeeded']),
        );
        expect(sdkConnectionCircuitBreaker.getState()).toBe('closed');
    });
});

describe('sdk/client › CopilotClientManager', () => {
    it('permite runtimes isolados sem compartilhar client nem registry', async () => {
        const clientA = mockClient();
        const clientB = mockClient();
        clientA.createSession.mockResolvedValue(mockSession('manager-a'));
        clientB.createSession.mockResolvedValue(mockSession('manager-b'));

        const managerA = createCopilotClientManager({
            registry: createSdkSessionRegistry(),
            createClient: () => /** @type {any} */ (clientA),
        });
        const managerB = createCopilotClientManager({
            registry: createSdkSessionRegistry(),
            createClient: () => /** @type {any} */ (clientB),
        });

        await managerA.createClientSession(/** @type {any} */ ({ model: 'a' }));

        expect(managerA.getActiveSessionCount()).toBe(1);
        expect(managerB.getActiveSessionCount()).toBe(0);
        expect(managerA.getClientSession('manager-a')?.model).toBe('a');
        expect(managerB.getClientSession('manager-a')).toBeUndefined();

        await managerB.createClientSession(/** @type {any} */ ({ model: 'b' }));
        expect(managerA.getActiveSessionCount()).toBe(1);
        expect(managerB.getActiveSessionCount()).toBe(1);
        expect(clientA.createSession).toHaveBeenCalledTimes(1);
        expect(clientB.createSession).toHaveBeenCalledTimes(1);
    });
});

describe('sdk/errors › getSdkRecoveryPolicy', () => {
    it('classifica rate_limit/quota/auth sem circuit breaker', () => {
        expect(getSdkRecoveryPolicy({ status: 429, message: 'Too many requests' }, 'connection')).toMatchObject({
            kind: 'rate_limit',
            retryable: false,
            tripCircuit: false,
            resetCircuit: true,
        });
        expect(getSdkRecoveryPolicy({ message: 'quota exceeded' }, 'connection')).toMatchObject({
            kind: 'quota_exhausted',
            allowReconnect: false,
        });
        expect(getSdkRecoveryPolicy({ status: 401, message: 'unauthorized' }, 'connection')).toMatchObject({
            kind: 'auth',
            tripCircuit: false,
        });
    });

    it('refina rate_limit entre sessão e semanal/modelo sem alterar kind operacional', () => {
        expect(
            classifySdkRateLimitScope({
                status: 429,
                message: "You've hit your rate limit. Please wait for your limit to reset in 18 minutes.",
            }),
        ).toBe('session');
        expect(
            classifySdkRateLimitScope({
                status: 429,
                message: 'You have reached your weekly rate limit. Please switch to auto model.',
            }),
        ).toBe('weekly_model');
    });

    it('classifica network/timeout como transitórios com backoff', () => {
        expect(getSdkRecoveryPolicy({ code: 'ECONNREFUSED', message: 'conn refused' }, 'connection')).toMatchObject({
            kind: 'network',
            retryable: true,
            tripCircuit: true,
        });
        expect(getSdkRecoveryPolicy({ code: 'ETIMEDOUT', message: 'timeout' }, 'connection')).toMatchObject({
            kind: 'timeout',
            retryable: true,
            tripCircuit: true,
        });
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

    it('limpa cache de modelos ao parar client', async () => {
        const mc = mockClient();
        mc.listModels.mockResolvedValueOnce([{ id: 'cached-model' }]).mockResolvedValueOnce([{ id: 'fresh-model' }]);
        _injectClientForTest(/** @type {any} */ (mc));

        await expect(listModels({}, true)).resolves.toEqual([{ id: 'cached-model' }]);
        await stopClient();
        _injectClientForTest(/** @type {any} */ (mc));

        await expect(listModels()).resolves.toEqual([{ id: 'fresh-model' }]);
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

    it('expõe getter explícito do circuit breaker compartilhado', () => {
        expect(getSdkConnectionCircuitBreaker()).toBe(sdkConnectionCircuitBreaker);
    });
});

// ─── client surface extras ─────────────────────────────────────────────────

describe('sdk/client › surface extras', () => {
    it('expõe getLastClientSessionId, getForegroundClientSessionId e setForegroundClientSessionId', async () => {
        const mc = mockClient();
        _injectClientForTest(/** @type {any} */ (mc));

        await expect(getLastClientSessionId()).resolves.toBe('last-session-id');
        await expect(getForegroundClientSessionId()).resolves.toBe('foreground-session-id');
        await expect(setForegroundClientSessionId('sess-999')).resolves.toBeUndefined();

        expect(mc.getLastSessionId).toHaveBeenCalled();
        expect(mc.getForegroundSessionId).toHaveBeenCalled();
        expect(mc.setForegroundSessionId).toHaveBeenCalledWith('sess-999');
    });

    it('expõe getServerRpc do client atual', async () => {
        const mc = mockClient();
        _injectClientForTest(/** @type {any} */ (mc));

        await expect(getServerRpc()).resolves.toBe(mc.rpc);
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

    it('createClientSession herda retry transitório do lifecycle wrapper', async () => {
        const mc = mockClient();
        mc.createSession
            .mockRejectedValueOnce(Object.assign(new Error('network down'), { code: 'ECONNRESET' }))
            .mockResolvedValueOnce(mockSession('sess-1'));
        _injectClientForTest(/** @type {any} */ (mc));

        const session = await createClientSession(/** @type {any} */ ({ model: 'gpt-4.1' }));

        expect(session.sessionId).toBe('sess-1');
        expect(mc.start).toHaveBeenCalledTimes(1);
        expect(mc.createSession).toHaveBeenCalledTimes(2);
        expect(getActiveSessionCount()).toBe(1);
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
        mc.createSession.mockImplementation((/** @type {{ model?: string }} */ cfg) =>
            Promise.resolve(mockSession(`s-${cfg.model}`)),
        );
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
