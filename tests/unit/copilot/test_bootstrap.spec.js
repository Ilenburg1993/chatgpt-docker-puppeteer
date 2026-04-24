// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    bootstrapObservability: vi.fn(),
    bootstrapLateDeps: vi.fn(),
    validateRequired: vi.fn(),
    createCopilotBootPlan: vi.fn(() => ({
        phases: [{ id: 'observability' }, { id: 'terminal' }],
    })),
    readCopilotBootConfig: vi.fn(() => ({
        mode: 'terminal-runtime',
        workspace: { root: '/workspace' },
        server: { url: 'http://127.0.0.1:3009', host: '127.0.0.1', port: 3009, token: null },
    })),
    runCopilotSdkBootPreflight: vi.fn(async () => ({ ok: true, warnings: [], pingOk: true })),
    startTerminalServer: vi.fn(),
    wireCopilotRuntimeDI: vi.fn(),
    startTodoCleanupJob: vi.fn(),
    buildTool: vi.fn(),
    setAuditBus: vi.fn(),
    defaultBus: { on: vi.fn(), emit: vi.fn() },
    registerGlobalHandlers: vi.fn(),
}));

vi.mock('../../../src/copilot/observability/bootstrap.js', () => ({
    bootstrapObservability: mocks.bootstrapObservability,
    bootstrapLateDeps: mocks.bootstrapLateDeps,
}));

vi.mock('../../../src/copilot/core/di-container.js', () => ({
    container: {
        register: vi.fn(),
        resolve: vi.fn((token) =>
            token === Symbol.for('ERROR_TRACKER') ? { registerGlobalHandlers: mocks.registerGlobalHandlers } : null,
        ),
        validateRequired: mocks.validateRequired,
    },
}));

vi.mock('#copilot/boot', () => ({
    createCopilotBootPlan: mocks.createCopilotBootPlan,
    readCopilotBootConfig: mocks.readCopilotBootConfig,
}));

vi.mock('../../../src/copilot/agent/lifecycle/runtime-host.js', () => ({
    runCopilotSdkBootPreflight: mocks.runCopilotSdkBootPreflight,
}));

vi.mock('../../../src/copilot/terminal/index.js', () => ({
    startTerminalServer: mocks.startTerminalServer,
}));

vi.mock('../../../src/copilot/runtime-wiring.js', () => ({
    wireCopilotRuntimeDI: mocks.wireCopilotRuntimeDI,
}));

vi.mock('../../../src/copilot/tools/todo/store.js', () => ({
    startTodoCleanupJob: mocks.startTodoCleanupJob,
}));

vi.mock('../../../src/copilot/tools/index.js', () => ({
    buildTool: mocks.buildTool,
}));

vi.mock('../../../src/copilot/hooks/bus.js', () => ({
    defaultBus: mocks.defaultBus,
}));

vi.mock('../../../src/copilot/audit/pipeline-permission.js', () => ({
    setAuditBus: mocks.setAuditBus,
}));

vi.mock('../../../src/copilot/server/index.js', () => ({
    startCopilotServer: vi.fn(),
}));

vi.mock('#copilot/audit', () => ({
    AUDIT_BUS: Symbol.for('AUDIT_BUS'),
}));

vi.mock('#copilot/core', () => ({
    EVENT_BUS: Symbol.for('EVENT_BUS'),
    SHUTDOWN_LOGGER: Symbol.for('SHUTDOWN_LOGGER'),
}));

vi.mock('#copilot/hooks', () => ({
    HOOKS_LOGGER: Symbol.for('HOOKS_LOGGER'),
}));

vi.mock('#copilot/observability', () => ({
    ERROR_TRACKER: Symbol.for('ERROR_TRACKER'),
}));

vi.mock('#copilot/sdk', () => ({
    CopilotClient: class MockCopilotClient {},
    SDK_LOGGER: Symbol.for('SDK_LOGGER'),
    TOOLS_BUILDER: Symbol.for('TOOLS_BUILDER'),
    checkAuthStatus: vi.fn(),
}));

vi.mock('#copilot/tools', () => ({
    buildTool: mocks.buildTool,
    TOOLS_LOGGER: Symbol.for('TOOLS_LOGGER'),
    TOOLS_METRICS: Symbol.for('TOOLS_METRICS'),
}));

vi.mock('../../../src/copilot/config/agent.js', () => ({
    COPILOT_MODEL: 'gpt-5-mini',
    PING_TIMEOUT_MS: 1000,
}));

vi.mock('../../../src/copilot/observability/logger.js', () => ({
    log: vi.fn(),
}));

describe('copilot/bootstrap', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.createCopilotBootPlan.mockReturnValue({
            phases: [{ id: 'observability' }, { id: 'terminal' }],
        });
        mocks.readCopilotBootConfig.mockReturnValue({
            mode: 'terminal-runtime',
            workspace: { root: '/workspace' },
            server: { url: 'http://127.0.0.1:3009', host: '127.0.0.1', port: 3009, token: null },
        });
        mocks.runCopilotSdkBootPreflight.mockResolvedValue({ ok: true, warnings: [], pingOk: true });
        mocks.startTerminalServer.mockReset();
        mocks.wireCopilotRuntimeDI.mockReset();
        mocks.registerGlobalHandlers.mockReset();
    });

    it('reseta a trava de boot quando o boot falha e permite nova tentativa', async () => {
        mocks.startTerminalServer.mockRejectedValueOnce(new Error('boot failed')).mockResolvedValueOnce(undefined);

        const { bootCopilot } = await import('../../../src/copilot/bootstrap.js');

        await expect(bootCopilot()).rejects.toThrow('boot failed');
        await expect(bootCopilot()).resolves.toBeUndefined();

        expect(mocks.startTerminalServer).toHaveBeenCalledTimes(2);
        expect(mocks.bootstrapObservability).toHaveBeenCalledTimes(2);
        expect(mocks.registerGlobalHandlers).toHaveBeenCalledTimes(2);
    });
});
