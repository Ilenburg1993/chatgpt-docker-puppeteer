// @ts-check

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    agent: { status: 'idle' },
    metrics: { name: 'metrics-store' },
    allTools: [{ name: 'grep' }],
    getClient: vi.fn(),
    getClientState: vi.fn(),
    stopClient: vi.fn(),
    forceStopClient: vi.fn(),
    resolve: vi.fn(() => ({ name: 'metrics-store' })),
}));

vi.mock('#copilot/core', () => ({
    container: { resolve: mocks.resolve },
}));

vi.mock('#copilot/audit', () => ({
    defaultAuditLog: {
        getLast: vi.fn(() => []),
        flush: vi.fn(async () => {}),
    },
    getAuditTail: vi.fn(() => []),
}));

vi.mock('#copilot/bridges', () => ({
    getMcpStatus: vi.fn(() => ({ available: false, circuitOpen: false })),
    nervEventBusAdapter: { isMounted: false },
}));

vi.mock('#copilot/config', () => ({
    BRIDGE_ADMIN_TOKEN: undefined,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    SDK_API_TOKEN: null,
}));

vi.mock('#copilot/hooks', () => ({
    defaultBus: { on: vi.fn(), off: vi.fn() },
    SDK_HOOKS: { list: vi.fn(() => []) },
}));

vi.mock('#copilot/observability', () => ({
    DEFAULT_OTEL_FILE: '/tmp/otel.jsonl',
    defaultErrorTracker: {
        clearErrors: vi.fn(),
        getErrors: vi.fn(() => []),
        getStats: vi.fn(() => ({ total: 0, buffered: 0 })),
    },
    defaultMetrics: {
        getSummary: vi.fn(() => ({ tools: {}, tokens: {}, sessions: {}, gauges: {}, counters: {} })),
    },
    getCatalog: vi.fn(() => ({})),
    getCompactionHistory: vi.fn(() => []),
    getDeadLetters: vi.fn(() => []),
    getLastQuotaSnapshots: vi.fn(() => ({ snapshots: {}, ts: null })),
    getRecentLogs: vi.fn(() => []),
    isOtelEnabled: vi.fn(() => false),
    log: vi.fn(),
    METRICS_STORE: Symbol.for('METRICS_STORE'),
}));

vi.mock('#copilot/sdk', () => ({
    approveAll: vi.fn(),
    createClientSession: vi.fn(),
    disconnectClientSession: vi.fn(),
    getClient: mocks.getClient,
    getClientSession: vi.fn(),
    getClientState: mocks.getClientState,
    getForegroundClientSessionId: vi.fn(),
    getLastClientSessionId: vi.fn(),
    incrementSessionMessageCount: vi.fn(),
    listActiveClientSessions: vi.fn(() => []),
    listAllClientSessions: vi.fn(async () => []),
    pickDefined: (/** @type {Record<string, unknown>} */ value) =>
        Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)),
    resumeClientSession: vi.fn(),
    setForegroundClientSessionId: vi.fn(),
    stopClient: mocks.stopClient,
    forceStopClient: mocks.forceStopClient,
}));

vi.mock('#copilot/tools', () => ({
    getAllTools: () => mocks.allTools,
}));

vi.mock('../../../src/copilot/presentation/agent-runtime.js', () => ({
    resolveAgentRuntimeSelection: (/** @type {string | null | undefined} */ runtimeId) => ({
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId === 'alt' ? 'default' : (runtimeId ?? 'default'),
        runtime: mocks.agent,
        runtimeFound: runtimeId !== 'alt',
        usedDefaultRuntimeFallback: runtimeId === 'alt',
        defaultRuntimeId: 'default',
    }),
}));

vi.mock('../../../src/copilot/presentation/runtime-status.js', () => ({
    readAgentStatusSnapshot: vi.fn(() => ({ status: 'idle' })),
    readAgentStatusValue: vi.fn(() => 'idle'),
}));

vi.mock('../../../src/copilot/presentation/runtime-tools.js', () => ({
    paginateAgentRuntimeToolsProjection: vi.fn((projection) => projection),
    readAgentRuntimeToolsProjection: vi.fn(() => ({ ok: true, tools: [] })),
}));

vi.mock('../../../src/copilot/presentation/sdk-sessions.js', () => ({
    attachSdkSessionOwnership: vi.fn((payload) => payload),
    clearSdkRuntimeBinding: vi.fn(() => ({ hubSessionId: null, sdkSessionId: null, isBound: false })),
    forgetSdkSessionOwnership: vi.fn(() => ({ hubSessionId: null, sdkSessionId: null, isBound: false })),
    rememberSdkSessionOwnership: vi.fn(),
    resolveSdkRuntimeProjection: vi.fn(async () => ({})),
    resolveSdkSessionRouteMeta: vi.fn(async () => ({})),
}));

describe('presentation/runtime-route-deps.js', () => {
    it('compõe deps do copilot-api a partir do runtime default', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-route-deps.js');
        expect(mod.buildDefaultCopilotApiRouteDeps()).toEqual({
            agent: mocks.agent,
            runtimeId: 'default',
            requestedRuntimeId: null,
            runtimeFound: true,
            usedDefaultRuntimeFallback: false,
        });
    });

    it('aceita runtimeId explícito para preparar multi-agent futuro', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-route-deps.js');
        const deps = mod.buildDefaultCopilotApiRouteDeps('alt');
        expect(deps.requestedRuntimeId).toBe('alt');
        expect(deps.runtimeId).toBe('default');
        expect(deps.runtimeFound).toBe(false);
        expect(deps.usedDefaultRuntimeFallback).toBe(true);
        expect(deps.agent).toBe(mocks.agent);
    });
});

describe('server/routes/sdk/deps.js', () => {
    it('compõe deps compartilhadas do sdk router no adapter HTTP do SDK', async () => {
        const mod = await import('../../../src/copilot/server/routes/sdk/deps.js');
        const deps = mod.buildDefaultSdkRouteSharedDeps();

        expect(deps.agent).toBe(mocks.agent);
        expect(deps.runtimeId).toBe('default');
        expect(deps.runtimeFound).toBe(true);
        expect(deps.metrics).toEqual({ name: 'metrics-store' });
        expect(deps.allTools).toEqual([{ name: 'grep' }]);
        expect(deps.getClient).toBe(mocks.getClient);
        expect(deps.getClientState).toBe(mocks.getClientState);
        expect(deps.stopClient).toBe(mocks.stopClient);
        expect(deps.forceStopClient).toBe(mocks.forceStopClient);
        expect(deps.sdkSession.getClient).toBe(mocks.getClient);
        expect(deps.sdkRuntimeProjection).toHaveProperty('readAgentRuntimeToolsProjection');
        expect(deps.sdkSessionOwnership).toHaveProperty('resolveSdkRuntimeProjection');
        expect(deps.sdkObservability).toHaveProperty('getCompactionHistory');
        expect(deps.sdkHooks.registry.list).toBeTypeOf('function');
    });
});
