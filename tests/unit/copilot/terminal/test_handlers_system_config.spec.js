// @ts-check
/**
 * tests/unit/copilot/terminal/test_handlers_system_config.spec.js
 *
 * Testes para handlers/system-config.js — config, infinite session, tools config, custom tools. Mock pesado dos
 * singletons para testar lógica de validação dos handlers.
 */

import { describe, expect, it, vi } from 'vitest';

// ─── Mock singletons ─────────────────────────────────────────────────────────

const defaultRuntime = /** @type {any} */ ({
    model: 'test-model',
    reasoningEffort: 'high',
    dialogLoopActive: false,
    status: 'idle',
    getStatusSnapshot: () => ({
        contextWindow: 128000,
        lastCheckpointPath: null,
        systemPromptBinding: { digest: 'bound-default' },
        systemPromptFreshness: { isStale: false, reason: 'ok', recommendedAction: 'none' },
    }),
    getHealthSnapshot: () => ({
        ok: true,
        healthy: true,
        status: 'healthy',
        issues: [],
        backgroundPendingCount: 0,
        checks: {
            io: { keepaliveRunning: true },
            quota: { running: true },
        },
    }),
});

vi.mock('#copilot/agent', () => ({
    alwaysAliveAgent: defaultRuntime,
    getAgent: () => defaultRuntime,
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (runtimeId = 'default') => (runtimeId === 'default' ? defaultRuntime : null),
    listAgentRuntimes: () => [{ runtimeId: 'default', runtime: defaultRuntime }],
    readAgentRuntimeStatusSnapshot: (/** @type {any} */ runtime) => runtime.getStatusSnapshot(),
    readAgentRuntimeHealthSnapshot: (/** @type {any} */ runtime) => runtime.getHealthSnapshot(),
    readRuntimeControlState: (/** @type {any} */ runtime) => ({
        status: runtime.status,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort ?? 'off',
        sessionId: runtime.sessionId ?? null,
        dialogLoopActive: Boolean(runtime.dialogLoopActive),
        dialogPaused: Boolean(runtime.dialogPaused),
        queueSize: Number(runtime.queueSize ?? 0),
    }),
    readRuntimeInteractionState: () => ({
        pendingQuestion: null,
        pendingQuestionKind: null,
        pendingQuestionShadow: null,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowExpiresAt: null,
        pendingQuestionShadowRemainingMs: null,
    }),
    readRuntimePrBudgetSnapshot: () => ({
        sendCount: 0,
        dialogLoopActive: false,
        sessionId: null,
        prMetrics: { boots: 0, resumesWithPR: 0, resumesZeroPR: 0, totalPR: 0 },
        lastPrInfo: null,
    }),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    setRuntimeBackgroundCompactionThreshold: vi.fn(),
}));

vi.mock('#copilot/agent/always-alive', () => ({
    alwaysAliveAgent: defaultRuntime,
    getAgent: () => defaultRuntime,
}));

vi.mock('#copilot/agent/runtime-registry', () => ({
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (runtimeId = 'default') => (runtimeId === 'default' ? defaultRuntime : null),
    listAgentRuntimes: () => [{ runtimeId: 'default', runtime: defaultRuntime }],
}));

vi.mock('#copilot/agent/facades', () => ({
    readAgentRuntimeStatusSnapshot: (/** @type {any} */ runtime) => runtime.getStatusSnapshot(),
    readAgentRuntimeHealthSnapshot: (/** @type {any} */ runtime) => runtime.getHealthSnapshot(),
    readRuntimeControlState: (/** @type {any} */ runtime) => ({
        status: runtime.status,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort ?? 'off',
        sessionId: runtime.sessionId ?? null,
        dialogLoopActive: Boolean(runtime.dialogLoopActive),
        dialogPaused: Boolean(runtime.dialogPaused),
        queueSize: Number(runtime.queueSize ?? 0),
    }),
    readRuntimeInteractionState: () => ({
        pendingQuestion: null,
        pendingQuestionKind: null,
        pendingQuestionShadow: null,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowExpiresAt: null,
        pendingQuestionShadowRemainingMs: null,
    }),
    readRuntimePrBudgetSnapshot: () => ({
        sendCount: 0,
        dialogLoopActive: false,
        sessionId: null,
        prMetrics: { boots: 0, resumesWithPR: 0, resumesZeroPR: 0, totalPR: 0 },
        lastPrInfo: null,
    }),
    readRuntimePermissionMode: vi.fn(() => 'approve_all'),
    readAgentRuntimeSdkResourceSnapshot: vi.fn(() => ({ client: false, session: false, quotaMonitor: false })),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    setRuntimeBackgroundCompactionThreshold: vi.fn(),
}));
vi.mock('#copilot/bridges/mcp-tool-bridge', () => ({
    getMcpStatus: () => ({ available: false, toolCount: 0, circuitOpen: false }),
}));
vi.mock('#copilot/config/env', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        LLM_B_TERMINAL_PORT: 3009,
    };
});
vi.mock('#copilot/conversation-hub/hub', () => ({
    conversationHub: { isReady: false },

    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
}));
vi.mock('#copilot/conversation-hub/store', () => ({
    conversationStore: { countHubSessions: () => 0 },
}));
vi.mock('#copilot/observability/metrics', () => ({
    defaultMetrics: {
        getSummary: () => ({
            tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
            tasks: { completed: 0, failed: 0 },
            dialog: { turnsTotal: 0, turnsSuccess: 0 },
        }),
    },
}));

// Mock tools-state in-memory para não tocar no disco
const _toolsState = { current: { allowlist: ['read_file', 'write_file'], denylist: ['run_shell_command'] } };
vi.mock('#copilot/sdk/tools', async (importOriginal) => ({
    ...(await importOriginal()),
    getToolsConfig: () => ({ ..._toolsState.current }),
    patchToolsConfig: async (/** @type {Record<string, unknown>} */ patch) => {
        Object.assign(_toolsState.current, patch);
    },
    loadToolsConfigAsync: vi.fn(async () => ({ ..._toolsState.current })),
    SYSTEM_MESSAGE_SECTIONS: {},
    SYSTEM_PROMPT_SECTIONS: {},
}));

const {
    handleHealth,
    handleGetConfig,
    getInfiniteSessionConfig,
    handleSetInfiniteSessionConfig,
    handleGetToolsConfig,
    handleSetToolsConfig,
    handleGetCustomTools,
    handleRegisterCustomTool,
    handleDeleteCustomTool,
} = await import('../../../../src/copilot/terminal/handlers/system-config.js');

/** @template T @param {{ body: unknown }} result @returns {T} */
const bodyOf = (result) => /** @type {T} */ (result.body);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('handlers/system-config — handleHealth', () => {
    it('retorna status 200 com shape esperado', () => {
        const result = handleHealth();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.healthStatus).toBe('healthy');
        expect(body.runtimeId).toBe('default');
        expect(Array.isArray(body.agentRuntimes)).toBe(true);
        expect(body.backgroundPendingCount).toBe(0);
        expect(body.keepaliveRunning).toBe(true);
        expect(body.quotaMonitorRunning).toBe(true);
        expect(body.systemPromptBinding).toEqual(expect.objectContaining({ digest: 'bound-default' }));
        expect(body.systemPromptFreshness).toEqual(
            expect.objectContaining({ isStale: false, recommendedAction: 'none' }),
        );
        expect(body.shuttingDown).toBe(false);
        expect(body.lifecycle).toEqual(
            expect.objectContaining({
                shuttingDown: false,
                lastShutdownReport: null,
            }),
        );
        expect(typeof body.uptime).toBe('number');
        expect(typeof body.memoryMB).toBe('number');
    });
});

describe('handlers/system-config — handleGetConfig', () => {
    it('retorna config com model e modo/plan do SDK', () => {
        const result = handleGetConfig();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.runtimeId).toBe('default');
        expect(Array.isArray(body.agentRuntimes)).toBe(true);
        expect(body.model).toBe('test-model');
        expect(body.systemPromptBinding).toEqual(expect.objectContaining({ digest: 'bound-default' }));
        expect(body.systemPromptFreshness).toEqual(
            expect.objectContaining({ isStale: false, recommendedAction: 'none' }),
        );
        expect(body).toHaveProperty('sdkSessionMode');
        expect(body).toHaveProperty('sdkPlanOperation');
    });
});

describe('handlers/system-config — infiniteSession', () => {
    it('getInfiniteSessionConfig retorna threshold padrão', () => {
        const cfg = getInfiniteSessionConfig();
        expect(typeof cfg.backgroundCompactionThreshold).toBe('number');
    });

    it('handleSetInfiniteSessionConfig aceita valor válido', () => {
        const result = handleSetInfiniteSessionConfig({ backgroundCompactionThreshold: 0.5 });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.infiniteSession.backgroundCompactionThreshold).toBe(0.5);
    });

    it('handleSetInfiniteSessionConfig rejeita valor < 0.1', () => {
        const result = handleSetInfiniteSessionConfig({ backgroundCompactionThreshold: 0.05 });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(400);
        expect(body.ok).toBe(false);
    });

    it('handleSetInfiniteSessionConfig rejeita valor > 1.0', () => {
        const result = handleSetInfiniteSessionConfig({ backgroundCompactionThreshold: 1.5 });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(400);
        expect(body.ok).toBe(false);
    });

    it('handleSetInfiniteSessionConfig rejeita tipo não-numérico', () => {
        const result = handleSetInfiniteSessionConfig(/** @type {any} */ ({ backgroundCompactionThreshold: 'high' }));
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(400);
        expect(body.ok).toBe(false);
    });
});

describe('handlers/system-config — tools config', () => {
    it('handleGetToolsConfig retorna ok', () => {
        const result = handleGetToolsConfig();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
    });

    it('handleSetToolsConfig rejeita allowlist inválido (não-array)', async () => {
        const result = await handleSetToolsConfig({ allowlist: 'invalid' });
        expect(result.status).toBe(400);
    });

    it('handleSetToolsConfig rejeita denylist com não-strings', async () => {
        const result = await handleSetToolsConfig({ denylist: [123] });
        expect(result.status).toBe(400);
    });

    it('handleSetToolsConfig aceita denylist válida', async () => {
        const result = await handleSetToolsConfig({ denylist: ['tool-a', 'tool-b'] });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
    });
});

describe('handlers/system-config — custom tools', () => {
    it('handleGetCustomTools retorna lista', () => {
        const result = handleGetCustomTools();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.tools)).toBe(true);
        expect(Array.isArray(body.availableHandlers)).toBe(true);
    });

    it('handleRegisterCustomTool rejeita sem name', async () => {
        const result = await handleRegisterCustomTool({ description: 'test', handlerId: 'echo' });
        expect(result.status).toBe(400);
    });

    it('handleRegisterCustomTool rejeita sem description', async () => {
        const result = await handleRegisterCustomTool({ name: 'test', handlerId: 'echo' });
        expect(result.status).toBe(400);
    });

    it('handleRegisterCustomTool rejeita sem handlerId', async () => {
        const result = await handleRegisterCustomTool({ name: 'test', description: 'desc' });
        expect(result.status).toBe(400);
    });

    it('handleDeleteCustomTool rejeita sem name', async () => {
        const result = await handleDeleteCustomTool({});
        expect(result.status).toBe(400);
    });

    it('handleDeleteCustomTool retorna 404 para tool inexistente', async () => {
        const result = await handleDeleteCustomTool({ name: 'nonexistent-tool-xyz' });
        expect(result.status).toBe(404);
    });
});
