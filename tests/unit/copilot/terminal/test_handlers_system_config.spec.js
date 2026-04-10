// @ts-check
/**
 * tests/unit/copilot/terminal/test_handlers_system_config.spec.js
 *
 * Testes para handlers/system-config.js — config, infinite session, tools config, custom tools. Mock pesado dos
 * singletons para testar lógica de validação dos handlers.
 */

// ─── Mock singletons ─────────────────────────────────────────────────────────

vi.mock('#copilot/agent', () => ({
    alwaysAliveAgent: {
        model: 'test-model',
        reasoningEffort: 'high',
        dialogLoopActive: false,
        status: 'idle',
        getStatusSnapshot: () => ({ contextWindow: 128000, lastCheckpointPath: null }),
    },
    setBackgroundCompactionThreshold: vi.fn(),
}));
vi.mock('#copilot/bridges/mcp-tool-bridge', () => ({
    getMcpStatus: () => ({ available: false, toolCount: 0, circuitOpen: false }),
}));
vi.mock('#copilot/config/env', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        LLM_B_TERMINAL_PORT: 3009,
    };
});
vi.mock('#copilot/conversation-hub/hub', () => ({
    conversationHub: { isReady: false },
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
vi.mock('#copilot/sdk/tools-state', () => ({
    getToolsConfig: () => ({ ..._toolsState.current }),
    patchToolsConfig: async (/** @type {Record<string, unknown>} */ patch) => {
        Object.assign(_toolsState.current, patch);
    },
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('handlers/system-config — handleHealth', () => {
    it('retorna status 200 com shape esperado', () => {
        const result = handleHealth();
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(typeof result.body.uptime).toBe('number');
        expect(typeof result.body.memoryMB).toBe('number');
    });
});

describe('handlers/system-config — handleGetConfig', () => {
    it('retorna config com model e planMode', () => {
        const result = handleGetConfig();
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(result.body.model).toBe('test-model');
    });
});

describe('handlers/system-config — infiniteSession', () => {
    it('getInfiniteSessionConfig retorna threshold padrão', () => {
        const cfg = getInfiniteSessionConfig();
        expect(typeof cfg.backgroundCompactionThreshold).toBe('number');
    });

    it('handleSetInfiniteSessionConfig aceita valor válido', () => {
        const result = handleSetInfiniteSessionConfig({ backgroundCompactionThreshold: 0.5 });
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(result.body.infiniteSession.backgroundCompactionThreshold).toBe(0.5);
    });

    it('handleSetInfiniteSessionConfig rejeita valor < 0.1', () => {
        const result = handleSetInfiniteSessionConfig({ backgroundCompactionThreshold: 0.05 });
        expect(result.status).toBe(400);
        expect(result.body.ok).toBe(false);
    });

    it('handleSetInfiniteSessionConfig rejeita valor > 1.0', () => {
        const result = handleSetInfiniteSessionConfig({ backgroundCompactionThreshold: 1.5 });
        expect(result.status).toBe(400);
        expect(result.body.ok).toBe(false);
    });

    it('handleSetInfiniteSessionConfig rejeita tipo não-numérico', () => {
        const result = handleSetInfiniteSessionConfig({ backgroundCompactionThreshold: 'high' });
        expect(result.status).toBe(400);
        expect(result.body.ok).toBe(false);
    });
});

describe('handlers/system-config — tools config', () => {
    it('handleGetToolsConfig retorna ok', () => {
        const result = handleGetToolsConfig();
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
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
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
    });
});

describe('handlers/system-config — custom tools', () => {
    it('handleGetCustomTools retorna lista', () => {
        const result = handleGetCustomTools();
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(Array.isArray(result.body.tools)).toBe(true);
        expect(Array.isArray(result.body.availableHandlers)).toBe(true);
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
