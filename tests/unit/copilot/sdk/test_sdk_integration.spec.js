/**
 * Faixa 17 - Integration Tests: New Features (F90-F94)
 *
 * Testes e2e que exercitam fluxos cross-module do SDK: F90: health check -> auth -> quota -> session create (5 tests)
 * F91: mode switch -> plan CRUD -> mode restore (5 tests) F92: model switch mid-session (4 tests) F93: provider config
 * validation + session creation (4 tests) F94: system-message customize mode with section overrides (5 tests)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mock factories ─────────────────────────────────────────────────

const mockPing = vi.fn();
const mockAccountGetQuota = vi.fn();

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Logger mock: must be a callable function (modules use `log('LEVEL', msg)`)
const logFn = vi.fn();
/** @type {any} */ (logFn).info = vi.fn();
/** @type {any} */ (logFn).warn = vi.fn();
/** @type {any} */ (logFn).debug = vi.fn();
/** @type {any} */ (logFn).error = vi.fn();

vi.mock('#copilot/observability/logger', () => ({
    log: logFn,
    appLog: logFn,
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('@github/copilot-sdk', () => {
    const SYSTEM_PROMPT_SECTIONS = Object.freeze({
        identity: 'identity',
        tone: 'tone',
        tool_efficiency: 'tool_efficiency',
        environment_context: 'environment_context',
        code_change_rules: 'code_change_rules',
        guidelines: 'guidelines',
        safety: 'safety',
        instructions: 'instructions',
        docs: 'docs',
        context: 'context',
    });
    return {
        SYSTEM_PROMPT_SECTIONS,
        CopilotClient: vi.fn(),
        defineTool: vi.fn(),
        approveAll: vi.fn(),
        ConfigError: class ConfigError extends Error {
            /** @param {string} msg */
            constructor(msg) {
                super(msg);
                this.name = 'ConfigError';
            }
        },
        CopilotError: class CopilotError extends Error {
            /** @param {string} msg */
            constructor(msg) {
                super(msg);
                this.name = 'CopilotError';
            }
        },
    };
});

vi.mock('#copilot/sdk/client', () => ({
    getClient: vi.fn(),
}));

// Mock server-rpc (used transitively by health.js)
vi.mock('#copilot/sdk/server-rpc', () => ({
    ping: mockPing,
    accountGetQuota: mockAccountGetQuota,
}));

// Mock tools factory (used transitively by custom-tools.js)
vi.mock('../../../../src/copilot/tools/infra/tool-factory.js', () => ({
    buildTool: vi.fn((config) => ({ ...config, type: 'function' })),
}));

// Mock core utilities (used transitively by custom-tools.js)
vi.mock('#copilot/core/safe-json', () => ({
    safeJsonParse: vi.fn(() => ({ success: false })),
}));

vi.mock('#copilot/core/schemas', () => ({
    CustomToolsFileSchema: { safeParse: vi.fn(() => ({ success: true, data: { tools: [] } })) },
}));

vi.mock('#copilot/core/error-handlers', () => ({
    logSwallowed: vi.fn(),
}));

// ─── Session mock factory ────────────────────────────────────────────────────

function createMockRpc() {
    return {
        model: { getCurrent: vi.fn(), switchTo: vi.fn() },
        mode: { get: vi.fn(), set: vi.fn() },
        plan: { read: vi.fn(), update: vi.fn(), delete: vi.fn() },
        workspace: { listFiles: vi.fn(), readFile: vi.fn(), createFile: vi.fn() },
        log: vi.fn(),
        compaction: { compact: vi.fn() },
        shell: { exec: vi.fn(), kill: vi.fn() },
        ui: { elicitation: vi.fn() },
        commands: { handlePending: vi.fn() },
        permissions: { handlePending: vi.fn() },
        tools: { handlePendingCall: vi.fn() },
    };
}

/** @returns {any} */
function createMockSession() {
    const rpc = createMockRpc();
    return {
        rpc,
        sessionId: 'test-session-id',
        abort: vi.fn().mockResolvedValue(undefined),
        model: 'gpt-4.1',
        messages: [],
        workspacePath: '/workspace/test',
        disconnect: vi.fn().mockResolvedValue(undefined),
        [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
    };
}

/** @returns {any} */
function createMockClient() {
    return {
        rpc: {
            ping: mockPing,
            models: { list: vi.fn() },
            tools: { list: vi.fn() },
            account: { getQuota: mockAccountGetQuota },
        },
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetMocks() {
    vi.clearAllMocks();

    // server-rpc mock defaults
    mockPing.mockResolvedValue({
        message: 'pong',
        timestamp: Date.now(),
        protocolVersion: 1,
    });
    mockAccountGetQuota.mockResolvedValue({
        quotaSnapshots: {
            chat: { remainingPercentage: 80, overageAllowedWithExhaustedQuota: false },
        },
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// F90 - Health check -> auth -> quota -> session create
// ═════════════════════════════════════════════════════════════════════════════

describe('F90 - Health -> Auth -> Quota -> Session create', () => {
    beforeEach(resetMocks);

    it('full health check retorna healthy quando tudo ok', async () => {
        const { fullHealthCheck } = await import('#copilot/sdk/health');
        const client = createMockClient();
        const result = await fullHealthCheck(client);
        expect(result.status).toBe('healthy');
        expect(result.checks.ping.ok).toBe(true);
        expect(result.checks.auth.ok).toBe(true);
        expect(result.checks.quota.ok).toBe(true);
    });

    it('health check falha quando ping falha', async () => {
        mockPing.mockRejectedValue(new Error('timeout'));
        const { fullHealthCheck } = await import('#copilot/sdk/health');
        const client = createMockClient();
        const result = await fullHealthCheck(client);
        expect(result.status).toBe('unhealthy');
        expect(result.checks.ping.ok).toBe(false);
    });

    it('health check detecta auth negada (quota throws)', async () => {
        // getAuthStatus uses accountGetQuota internally
        mockAccountGetQuota.mockRejectedValue(new Error('unauthorized'));
        const { fullHealthCheck } = await import('#copilot/sdk/health');
        const client = createMockClient();
        const result = await fullHealthCheck(client);
        expect(result.status).toBe('degraded');
        expect(result.checks.auth.ok).toBe(false);
        expect(result.checks.auth.authenticated).toBe(false);
    });

    it('health check detecta quota esgotada', async () => {
        mockAccountGetQuota.mockResolvedValue({
            quotaSnapshots: {
                chat: { remainingPercentage: 0, overageAllowedWithExhaustedQuota: false },
            },
        });
        const { fullHealthCheck } = await import('#copilot/sdk/health');
        const client = createMockClient();
        const result = await fullHealthCheck(client);
        // Auth uses same accountGetQuota so it will succeed, but quota exhausted
        expect(result.checks.quota.exhausted).toBe(true);
    });

    it('apos health ok, session lifecycle funciona', async () => {
        const { isServerReachable } = await import('#copilot/sdk/health');
        const { runSessionLifecycle } = await import('#copilot/sdk/sdk-session-wrapper');

        const client = createMockClient();
        const reachable = await isServerReachable(client);
        expect(reachable).toBe(true);

        const mockSession = createMockSession();
        let useCalled = false;
        const result = await runSessionLifecycle({
            create: async () => mockSession,
            use: async (session) => {
                useCalled = true;
                expect(session).toBe(mockSession);
            },
        });
        expect(useCalled).toBe(true);
        expect(result.error).toBeUndefined();
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F91 - Mode switch -> Plan CRUD -> Mode restore
// ═════════════════════════════════════════════════════════════════════════════

describe('F91 - Mode switch -> Plan CRUD -> Mode restore', () => {
    /** @type {ReturnType<typeof createMockSession>} */
    let session;

    beforeEach(() => {
        resetMocks();
        session = createMockSession();
        session.rpc.mode.get.mockResolvedValue({ mode: 'interactive' });
        session.rpc.mode.set.mockResolvedValue({ mode: 'plan' });
        session.rpc.plan.read.mockResolvedValue({ exists: true, content: 'Step 1', path: '/plan.md' });
        session.rpc.plan.update.mockResolvedValue({});
        session.rpc.plan.delete.mockResolvedValue({});
    });

    it('modeGet retorna modo atual', async () => {
        const { modeGet } = await import('#copilot/sdk/rpc');
        const result = await modeGet(session);
        expect(result).toEqual({ mode: 'interactive' });
    });

    it('modeSet altera modo para plan', async () => {
        const { modeSet } = await import('#copilot/sdk/rpc');
        const result = await modeSet(session, 'plan');
        expect(result).toEqual({ mode: 'plan' });
        expect(session.rpc.mode.set).toHaveBeenCalledWith({ mode: 'plan' });
    });

    it('plan CRUD completo: read -> update -> read -> delete', async () => {
        const { planRead, planUpdate, planDelete } = await import('#copilot/sdk/rpc');

        const initial = /** @type {any} */ (await planRead(session));
        expect(initial.exists).toBe(true);

        await planUpdate(session, 'New plan content');
        expect(session.rpc.plan.update).toHaveBeenCalledWith({ content: 'New plan content' });

        session.rpc.plan.read.mockResolvedValue({ exists: true, content: 'New plan content', path: '/plan.md' });
        const afterUpdate = /** @type {any} */ (await planRead(session));
        expect(afterUpdate.content).toBe('New plan content');

        await planDelete(session);
        expect(session.rpc.plan.delete).toHaveBeenCalledOnce();
    });

    it('fluxo completo: get mode -> plan -> CRUD -> restore', async () => {
        const { modeGet, modeSet, planRead, planUpdate } = await import('#copilot/sdk/rpc');

        await modeGet(session);
        await modeSet(session, 'plan');

        const plan = /** @type {any} */ (await planRead(session));
        expect(plan.exists).toBe(true);

        await planUpdate(session, 'Updated plan');

        session.rpc.mode.set.mockResolvedValue({ mode: 'interactive' });
        await modeSet(session, 'interactive');
        expect(session.rpc.mode.set).toHaveBeenLastCalledWith({ mode: 'interactive' });
    });

    it('mode set com sessao invalida rejeita', async () => {
        const { modeSet } = await import('#copilot/sdk/rpc');
        await expect(modeSet(/** @type {any} */ (null), 'plan')).rejects.toThrow();
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F92 - Model switch mid-session
// ═════════════════════════════════════════════════════════════════════════════

describe('F92 - Model switch mid-session', () => {
    /** @type {ReturnType<typeof createMockSession>} */
    let session;

    beforeEach(() => {
        resetMocks();
        session = createMockSession();
        session.rpc.model.getCurrent.mockResolvedValue({ modelId: 'gpt-4.1' });
        session.rpc.model.switchTo.mockResolvedValue({ modelId: 'gpt-4.1-mini' });
    });

    it('modelGetCurrent retorna modelo ativo', async () => {
        const { modelGetCurrent } = await import('#copilot/sdk/rpc');
        const result = /** @type {any} */ (await modelGetCurrent(session));
        expect(result.modelId).toBe('gpt-4.1');
    });

    it('modelSwitchTo troca modelo mid-session', async () => {
        const { modelSwitchTo } = await import('#copilot/sdk/rpc');
        const result = /** @type {any} */ (await modelSwitchTo(session, 'gpt-4.1-mini'));
        expect(result.modelId).toBe('gpt-4.1-mini');
        expect(session.rpc.model.switchTo).toHaveBeenCalledWith({ modelId: 'gpt-4.1-mini' });
    });

    it('fluxo get -> switch -> verify', async () => {
        const { modelGetCurrent, modelSwitchTo } = await import('#copilot/sdk/rpc');

        const before = /** @type {any} */ (await modelGetCurrent(session));
        expect(before.modelId).toBe('gpt-4.1');

        await modelSwitchTo(session, 'gpt-4.1-mini');

        session.rpc.model.getCurrent.mockResolvedValue({ modelId: 'gpt-4.1-mini' });
        const after = /** @type {any} */ (await modelGetCurrent(session));
        expect(after.modelId).toBe('gpt-4.1-mini');
    });

    it('model switch com sessao invalida rejeita', async () => {
        const { modelSwitchTo } = await import('#copilot/sdk/rpc');
        await expect(modelSwitchTo(/** @type {any} */ (null), 'gpt-4.1-mini')).rejects.toThrow();
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F93 - Provider config validation + session creation
// ═════════════════════════════════════════════════════════════════════════════

describe('F93 - Provider config validation + session creation', () => {
    beforeEach(resetMocks);

    it('openaiProvider retorna config valida com type', async () => {
        const { openaiProvider } = await import('#copilot/sdk/provider');
        const config = openaiProvider({
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test-key',
        });
        expect(config).toBeDefined();
        expect(config.type).toBe('openai');
        expect(config.baseUrl).toBe('https://api.openai.com/v1');
    });

    it('azureProvider retorna config valida com azure options', async () => {
        const { azureProvider } = await import('#copilot/sdk/provider');
        const config = azureProvider({
            baseUrl: 'https://myinstance.openai.azure.com',
            apiKey: 'azure-key',
            apiVersion: '2024-02-01',
        });
        expect(config).toBeDefined();
        expect(config.type).toBe('azure');
        expect(config.azure?.apiVersion).toBe('2024-02-01');
    });

    it('provider config + session config merge funciona', async () => {
        const { openaiProvider } = await import('#copilot/sdk/provider');
        const { buildSessionConfig } = await import('#copilot/sdk/config');

        const providerConfig = openaiProvider({
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-key',
        });

        const sessionConfig = buildSessionConfig({
            provider: providerConfig,
            model: 'gpt-4.1',
        });

        expect(sessionConfig).toBeDefined();
        expect(sessionConfig.provider).toBe(providerConfig);
        expect(sessionConfig.model).toBe('gpt-4.1');
    });

    it('isValidProviderType rejeita tipos invalidos', async () => {
        const { isValidProviderType } = await import('#copilot/sdk/provider');
        expect(isValidProviderType('openai')).toBe(true);
        expect(isValidProviderType('azure')).toBe(true);
        expect(isValidProviderType('anthropic')).toBe(true);
        expect(isValidProviderType('invalid-provider')).toBe(false);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F94 - System-message customize mode with section overrides
// ═════════════════════════════════════════════════════════════════════════════

describe('F94 - System-message customize mode with section overrides', () => {
    beforeEach(resetMocks);

    it('appendSystemMessage retorna config no modo append', async () => {
        const { appendSystemMessage } = await import('#copilot/sdk/system-message');
        const config = appendSystemMessage('Extra instructions');
        expect(config).toBeDefined();
        expect(config.mode).toBe('append');
        expect(config.content).toBe('Extra instructions');
    });

    it('replaceSystemMessage retorna config no modo replace', async () => {
        const { replaceSystemMessage } = await import('#copilot/sdk/system-message');
        const config = replaceSystemMessage('Custom system prompt');
        expect(config).toBeDefined();
        expect(config.mode).toBe('replace');
        expect(config.content).toBe('Custom system prompt');
    });

    it('customizeSystemMessage com section overrides funciona', async () => {
        const { customizeSystemMessage, sectionOverride } = await import('#copilot/sdk/system-message');

        const sections = {
            identity: sectionOverride('replace', 'You are a specialized agent'),
            guidelines: sectionOverride('append', '\n- Follow project conventions'),
        };

        const config = customizeSystemMessage(sections, 'Base content');
        expect(config).toBeDefined();
        expect(config.mode).toBe('customize');
        expect(/** @type {any} */ (config).sections).toBeDefined();
        expect(/** @type {any} */ (config).sections.identity).toBeDefined();
        expect(/** @type {any} */ (config).sections.guidelines).toBeDefined();
    });

    it('getSectionNames retorna secoes do SDK', async () => {
        const { getSectionNames } = await import('#copilot/sdk/system-message');
        const names = getSectionNames();
        // With mock, sections come from SYSTEM_PROMPT_SECTIONS keys
        expect(names).toContain('identity');
        expect(names).toContain('guidelines');
        expect(names).toContain('safety');
        expect(names.length).toBe(10);
    });

    it('system-message + config merge produz session config valido', async () => {
        const { customizeSystemMessage, sectionOverride } = await import('#copilot/sdk/system-message');
        const { buildSessionConfig } = await import('#copilot/sdk/config');

        const sysMsg = customizeSystemMessage(
            {
                identity: sectionOverride('replace', 'Custom identity'),
            },
            'Extra',
        );

        const config = buildSessionConfig({
            systemMessage: sysMsg,
            model: 'gpt-4.1',
        });

        expect(config).toBeDefined();
        expect(config.systemMessage).toBe(sysMsg);
        expect(config.model).toBe('gpt-4.1');
    });
});
