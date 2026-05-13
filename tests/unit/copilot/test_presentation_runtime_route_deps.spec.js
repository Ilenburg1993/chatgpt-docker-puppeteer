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
    getSessionCapabilities: vi.fn(() => ({ ui: { elicitation: true } })),
    resolve: vi.fn(() => ({ name: 'metrics-store' })),
    isSessionUiElicitationAvailable: vi.fn(() => true),
    sessionUiConfirm: vi.fn(),
    sessionUiElicitation: vi.fn(),
    sessionUiInput: vi.fn(),
    sessionUiSelect: vi.fn(),
}));

vi.mock('#copilot/core', async (importOriginal) => {
    const actual = /** @type {any} */ (await importOriginal());
    return {
        ...actual,
        container: { resolve: mocks.resolve },
        DEFAULT_BLOCKED_READ_PATH_PATTERNS: actual.DEFAULT_BLOCKED_READ_PATH_PATTERNS ?? [],
        DEFAULT_BLOCKED_WRITE_PATH_PATTERNS: actual.DEFAULT_BLOCKED_WRITE_PATH_PATTERNS ?? [],
        evaluateIoPathPolicyAsync:
            actual.evaluateIoPathPolicyAsync ??
            vi.fn(async () => ({
                ok: true,
                absolutePath: process.cwd(),
                relativePath: '.',
                workspaceRoot: process.cwd(),
                policyVersion: 'test',
                blockedSegments: [],
                realPath: process.cwd(),
                symlinkResolved: false,
            })),
        registerShutdownHandler: vi.fn(),
        runShutdown: vi.fn(async () => []),
        isShuttingDown: vi.fn(() => false),
    };
});

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

vi.mock('#copilot/config', async (importOriginal) => {
    const actual = /** @type {any} */ (await importOriginal());
    return {
        ...actual,
        BRIDGE_ADMIN_TOKEN: undefined,
        LLM_B_TURN_TIMEOUT_MS: 120_000,
        LLM_B_DIALOG_QUEUE_MAX: 10,
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
        SDK_API_TOKEN: null,
    };
});

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
    defaultConvergenceTraceStore: {
        clear: vi.fn(),
        getSnapshot: vi.fn(() => ({
            totalTraces: 0,
            operations: {},
            traces: [],
            selectedTrace: null,
            updatedAt: null,
        })),
        recordMetric: vi.fn(),
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
    defaultHookBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    SDK_HOOKS: { list: vi.fn(() => []) },
    approveAll: vi.fn(),
    commandsHandlePending: vi.fn(),
    compactionCompact: vi.fn(),
    createClientSession: vi.fn(),
    createTool: vi.fn(() => ({})),
    createToolSync: vi.fn(() => ({})),
    getToolsConfig: vi.fn(() => ({})),
    loadToolsConfigAsync: vi.fn(async () => ({})),
    patchToolsConfig: vi.fn(),
    createToolRegistryAdapter: vi.fn(() => ({})),
    disconnectClientSession: vi.fn(),
    emitSdkOperationMetric: vi.fn(),
    getClient: mocks.getClient,
    getClientSession: vi.fn(),
    getClientState: mocks.getClientState,
    getForegroundClientSessionId: vi.fn(),
    getLastClientSessionId: vi.fn(),
    getSessionCapabilities: mocks.getSessionCapabilities,
    incrementSessionMessageCount: vi.fn(),
    isSessionUiElicitationAvailable: mocks.isSessionUiElicitationAvailable,
    listActiveClientSessions: vi.fn(() => []),
    listAllClientSessions: vi.fn(async () => []),
    onAllSessionEvents: vi.fn(),
    permissionsHandlePending: vi.fn(),
    pickDefined: (/** @type {Record<string, unknown>} */ value) =>
        Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)),
    resumeClientSession: vi.fn(),
    sessionUiConfirm: mocks.sessionUiConfirm,
    sessionUiElicitation: mocks.sessionUiElicitation,
    sessionUiInput: mocks.sessionUiInput,
    sessionUiSelect: mocks.sessionUiSelect,
    setForegroundClientSessionId: vi.fn(),
    shellExec: vi.fn(),
    shellKill: vi.fn(),
    stopClient: mocks.stopClient,
    forceStopClient: mocks.forceStopClient,
    toolsHandlePendingCall: vi.fn(),
    toolsList: vi.fn(),
    uiElicitation: vi.fn(),
    validateProviderConfig: vi.fn(),
    workspaceCreateFile: vi.fn(),
    workspaceListFiles: vi.fn(),
    workspaceReadFile: vi.fn(),
}));

vi.mock('#copilot/tools', () => ({
    getAllTools: () => mocks.allTools,
}));

vi.mock('../../../src/copilot/presentation/agent/index.js', () => ({
    resolveAgentRuntimeSelection: (/** @type {string | null | undefined} */ runtimeId) => ({
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId === 'alt' ? 'default' : (runtimeId ?? 'default'),
        runtime: mocks.agent,
        runtimeFound: runtimeId !== 'alt',
        usedDefaultRuntimeFallback: runtimeId === 'alt',
        defaultRuntimeId: 'default',
    }),
    requireAgentRuntimeSelection: (/** @type {string | null | undefined} */ runtimeId) => {
        if (runtimeId === 'alt') {
            throw Object.assign(new Error("Runtime 'alt' não encontrado."), {
                name: 'NotFoundError',
                code: 'AGENT_RUNTIME_NOT_FOUND',
                status: 404,
            });
        }
        return {
            requestedRuntimeId: runtimeId ?? null,
            runtimeId: runtimeId ?? 'default',
            runtime: mocks.agent,
            runtimeFound: true,
            usedDefaultRuntimeFallback: false,
            defaultRuntimeId: 'default',
        };
    },
}));

vi.mock('../../../src/copilot/presentation/runtime/sdk-session.js', () => ({
    resolveAgentSdkActiveSessionEntry: vi.fn(() => null),
}));

vi.mock('../../../src/copilot/presentation/runtime/status.js', () => ({
    readAgentStatusSnapshot: vi.fn(() => ({ status: 'idle' })),
    readAgentStatusSnapshotForRuntime: vi.fn(() => ({
        status: 'idle',
        runtimeId: 'default',
        requestedRuntimeId: null,
        runtimeFound: true,
        usedDefaultRuntimeFallback: false,
    })),
    readAgentStatusValue: vi.fn(() => 'idle'),
    readAgentStatusValueForRuntime: vi.fn(() => 'idle'),
}));

vi.mock('../../../src/copilot/presentation/runtime/tools.js', () => ({
    paginateAgentRuntimeToolsProjection: vi.fn((projection) => projection),
    readAgentRuntimeToolsProjection: vi.fn(() => ({ ok: true, tools: [] })),
    readAgentRuntimeToolsProjectionForRuntime: vi.fn(() => ({ ok: true, tools: [] })),
}));

vi.mock('../../../src/copilot/presentation/sdk/sessions.js', () => ({
    attachSdkSessionOwnership: vi.fn((payload) => payload),
    clearSdkRuntimeBinding: vi.fn(() => ({ hubSessionId: null, sdkSessionId: null, isBound: false })),
    forgetSdkSessionOwnership: vi.fn(() => ({ hubSessionId: null, sdkSessionId: null, isBound: false })),
    rememberSdkSessionOwnership: vi.fn(),
    resolveSdkRuntimeProjection: vi.fn(async () => ({})),
    resolveSdkRuntimeProjectionForRuntime: vi.fn(async () => ({})),
    resolveSdkSessionRouteMeta: vi.fn(async () => ({})),
}));

describe('presentation/runtime-route-deps.js', () => {
    it('compõe deps do copilot-api a partir do runtime default', async () => {
        const mod = await import('../../../src/copilot/presentation/routing/index.js');
        expect(mod.buildDefaultCopilotApiRouteDeps()).toEqual({
            agent: mocks.agent,
            runtimeId: 'default',
            requestedRuntimeId: null,
            runtimeFound: true,
            usedDefaultRuntimeFallback: false,
            runtimeFallbackWarning: null,
        });
    });

    it('aceita runtimeId explícito para preparar multi-agent futuro', async () => {
        const mod = await import('../../../src/copilot/presentation/routing/index.js');
        const deps = mod.buildDefaultCopilotApiRouteDeps('alt');
        expect(deps.requestedRuntimeId).toBe('alt');
        expect(deps.runtimeId).toBe('default');
        expect(deps.runtimeFound).toBe(false);
        expect(deps.usedDefaultRuntimeFallback).toBe(true);
        expect(deps.runtimeFallbackWarning).toContain("Runtime 'alt' não encontrado");
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
        expect(deps.sdkSessionUi.getSessionCapabilities).toBe(mocks.getSessionCapabilities);
        expect(deps.sdkSessionUi.sessionUiConfirm).toBe(mocks.sessionUiConfirm);
        expect(deps.sdkRuntimeSession).toHaveProperty('resolveAgentSdkActiveSessionEntry');
        expect(deps.sdkRuntimeProjection).toHaveProperty('readAgentRuntimeToolsProjection');
        expect(deps.sdkRuntimeProjection).toHaveProperty('readAgentRuntimeToolsProjectionForRuntime');
        expect(deps.sdkRuntimeProjection).toHaveProperty('readAgentStatusSnapshotForRuntime');
        expect(deps.sdkRuntimeProjection).toHaveProperty('buildRuntimeRouteMetaPayload');
        expect(deps.sdkSessionOwnership).toHaveProperty('resolveSdkRuntimeProjection');
        expect(deps.sdkSessionOwnership).toHaveProperty('resolveSdkRuntimeProjectionForRuntime');
        expect(deps.sdkObservability).toHaveProperty('getCompactionHistory');
        expect(deps.sdkObservability).toHaveProperty('convergenceTraceStore');
        expect(deps.sdkHooks.registry.list).toBeTypeOf('function');
        expect(deps.sdkTelemetry.emitOperationMetric).toBeTypeOf('function');
    });

    it('rejeita runtimeId explícito inexistente em vez de cair no default', async () => {
        const mod = await import('../../../src/copilot/server/routes/sdk/deps.js');
        expect(() => mod.buildDefaultSdkRouteSharedDeps('alt')).toThrow("Runtime 'alt' não encontrado.");
    });
});
