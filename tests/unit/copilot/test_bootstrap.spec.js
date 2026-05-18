// @ts-check

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    bootRollbacks: /** @type {{ phaseId: string; id: string; rollback: () => void | Promise<void> }[]} */ ([]),
    bootstrapObservability: vi.fn(),
    bootstrapLateDeps: vi.fn(),
    validateRequired: vi.fn(),
    assertCopilotBootSurfaces: vi.fn(() => ({ ok: true, groups: [], missing: [] })),
    createCopilotBootPlan: vi.fn(() => ({
        phases: [
            { id: 'observability' },
            { id: 'late-deps' },
            { id: 'sdk-preflight' },
            { id: 'runtime-wiring' },
            { id: 'boot-surface-validation' },
            { id: 'terminal-init' },
            { id: 'terminal-aliases' },
            { id: 'terminal-runtime-config' },
            { id: 'terminal-pinned-context' },
            { id: 'terminal-conversation-hub' },
            { id: 'copilot-http-server' },
            { id: 'terminal-runtime-listeners' },
            { id: 'repl' },
        ],
    })),
    runCopilotBootPlan: vi.fn(async (plan, options) => {
        for (const phase of plan.phases) {
            const handler = options?.phaseHandlers?.[phase.id];
            const context = {
                phaseId: phase.id,
                registerRollback: vi.fn((id, rollback) => {
                    mocks.bootRollbacks.push({ phaseId: phase.id, id, rollback });
                }),
            };
            if (typeof handler === 'function') {
                await handler(context);
            } else if (handler?.run) {
                await handler.run(context);
            }
        }
        return { status: 'ok', phases: [] };
    }),
    readCopilotBootConfig: vi.fn(() => ({
        mode: 'terminal-runtime',
        workspace: { root: '/workspace' },
        server: { url: 'http://127.0.0.1:3009', host: '127.0.0.1', port: 3009, token: null },
    })),
    runCopilotSdkBootPreflight: vi.fn(async () => ({ ok: true, warnings: [], pingOk: true })),
    createTerminalBootContext: vi.fn(() => ({ id: 'terminal-context' })),
    runTerminalInitPhase: vi.fn(),
    runTerminalAliasesPhase: vi.fn(),
    runTerminalRuntimeConfigPhase: vi.fn(),
    runTerminalPinnedContextPhase: vi.fn(),
    runTerminalConversationHubPhase: vi.fn(),
    runTerminalHttpServerPhase: vi.fn(),
    runTerminalRuntimeListenersPhase: vi.fn(),
    runTerminalReplPhase: vi.fn(),
    rollbackTerminalPinnedContextPhase: vi.fn(),
    rollbackTerminalHttpServerPhase: vi.fn(),
    rollbackTerminalRuntimeListenersPhase: vi.fn(),
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
        has: vi.fn(() => false),
        register: vi.fn(),
        resolve: vi.fn((token) =>
            token === Symbol.for('ERROR_TRACKER') ? { registerGlobalHandlers: mocks.registerGlobalHandlers } : null,
        ),
        validateRequired: mocks.validateRequired,
    },
}));

vi.mock('#copilot/boot', async (importOriginal) => ({
    .../** @type {any} */ (await importOriginal()),
    assertCopilotBootSurfaces: mocks.assertCopilotBootSurfaces,
    createCopilotBootPlan: mocks.createCopilotBootPlan,
    readCopilotBootConfig: mocks.readCopilotBootConfig,
    runCopilotBootPlan: mocks.runCopilotBootPlan,
}));

vi.mock('#copilot/agent', () => ({
    AlwaysAliveAgent: class MockAlwaysAliveAgent {},
    ALWAYS_ALIVE_AGENT: Symbol.for('ALWAYS_ALIVE_AGENT'),
    alwaysAliveAgent: {},
    getAgent: vi.fn(),
    readAgentRuntimeCapabilities: vi.fn(),
    readAgentRuntimeHealthSnapshot: vi.fn(),
    readAgentRuntimeSdkResourceSnapshot: vi.fn(),
    readAgentRuntimeStatusSnapshot: vi.fn(),
    sendAgentDialogTurn: vi.fn(),
    startAgentDialogLoop: vi.fn(),
    startRuntime: vi.fn(),
}));

vi.mock('#copilot/sdk/telemetry', () => ({
    getAuthStatus: vi.fn(),
    runCopilotSdkBootPreflight: mocks.runCopilotSdkBootPreflight,
}));

vi.mock('../../../src/copilot/runtime-wiring.js', () => ({
    wireCopilotRuntimeDI: mocks.wireCopilotRuntimeDI,
}));

vi.mock('../../../src/copilot/tools/todo/store.js', async (importOriginal) => ({
    .../** @type {any} */ (await importOriginal()),
    startTodoCleanupJob: mocks.startTodoCleanupJob,
}));

vi.mock('../../../src/copilot/tools/index.js', async (importOriginal) => ({
    ...(await importOriginal()),
    buildTool: mocks.buildTool,
    TOOLS_LOGGER: Symbol.for('TOOLS_LOGGER'),
    TOOLS_METRICS: Symbol.for('TOOLS_METRICS'),
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

vi.mock('#copilot/core', async (importOriginal) => ({
    ...(await importOriginal()),
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
    HOOKS_LOGGER: Symbol.for('HOOKS_LOGGER'),
    TOOLS_BUILDER: Symbol.for('TOOLS_BUILDER'),
    defaultHookBus: mocks.defaultBus,
    checkAuthStatus: vi.fn(),
}));

vi.mock('#copilot/tools', async (importOriginal) => ({
    ...(await importOriginal()),
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
    /** @type {typeof import('../../../src/copilot/boot/runtime-bootstrap.js')} */
    let bootstrapMod;

    const terminalSurface = {
        createTerminalBootContext: mocks.createTerminalBootContext,
        runTerminalInitPhase: mocks.runTerminalInitPhase,
        runTerminalAliasesPhase: mocks.runTerminalAliasesPhase,
        runTerminalRuntimeConfigPhase: mocks.runTerminalRuntimeConfigPhase,
        runTerminalPinnedContextPhase: mocks.runTerminalPinnedContextPhase,
        runTerminalConversationHubPhase: mocks.runTerminalConversationHubPhase,
        runTerminalHttpServerPhase: mocks.runTerminalHttpServerPhase,
        runTerminalRuntimeListenersPhase: mocks.runTerminalRuntimeListenersPhase,
        runTerminalReplPhase: mocks.runTerminalReplPhase,
        rollbackTerminalPinnedContextPhase: mocks.rollbackTerminalPinnedContextPhase,
        rollbackTerminalHttpServerPhase: mocks.rollbackTerminalHttpServerPhase,
        rollbackTerminalRuntimeListenersPhase: mocks.rollbackTerminalRuntimeListenersPhase,
    };

    beforeAll(async () => {
        bootstrapMod = await import('../../../src/copilot/boot/runtime-bootstrap.js');
    });

    beforeEach(() => {
        bootstrapMod.resetBootFlagForTests();
        vi.clearAllMocks();
        mocks.createCopilotBootPlan.mockReturnValue({
            phases: [
                { id: 'observability' },
                { id: 'late-deps' },
                { id: 'sdk-preflight' },
                { id: 'runtime-wiring' },
                { id: 'boot-surface-validation' },
                { id: 'terminal-init' },
                { id: 'terminal-aliases' },
                { id: 'terminal-runtime-config' },
                { id: 'terminal-pinned-context' },
                { id: 'terminal-conversation-hub' },
                { id: 'copilot-http-server' },
                { id: 'terminal-runtime-listeners' },
                { id: 'repl' },
            ],
        });
        mocks.readCopilotBootConfig.mockReturnValue({
            mode: 'terminal-runtime',
            workspace: { root: '/workspace' },
            server: { url: 'http://127.0.0.1:3009', host: '127.0.0.1', port: 3009, token: null },
        });
        mocks.runCopilotSdkBootPreflight.mockResolvedValue({ ok: true, warnings: [], pingOk: true });
        mocks.createTerminalBootContext.mockClear();
        mocks.runTerminalInitPhase.mockReset();
        mocks.runTerminalAliasesPhase.mockReset();
        mocks.runTerminalRuntimeConfigPhase.mockReset();
        mocks.runTerminalPinnedContextPhase.mockReset();
        mocks.runTerminalConversationHubPhase.mockReset();
        mocks.runTerminalHttpServerPhase.mockReset();
        mocks.runTerminalRuntimeListenersPhase.mockReset();
        mocks.runTerminalReplPhase.mockReset();
        mocks.rollbackTerminalPinnedContextPhase.mockReset();
        mocks.rollbackTerminalHttpServerPhase.mockReset();
        mocks.rollbackTerminalRuntimeListenersPhase.mockReset();
        mocks.wireCopilotRuntimeDI.mockReset();
        mocks.assertCopilotBootSurfaces.mockClear();
        mocks.registerGlobalHandlers.mockReset();
        mocks.bootRollbacks.length = 0;
    });

    it('reseta a trava de boot quando o boot falha e permite nova tentativa', async () => {
        mocks.runTerminalReplPhase.mockRejectedValueOnce(new Error('boot failed')).mockResolvedValueOnce(undefined);

        const { bootCopilot } = bootstrapMod;

        await expect(bootCopilot({ terminal: terminalSurface, broadcastSse: vi.fn() })).rejects.toThrow('boot failed');
        await expect(bootCopilot({ terminal: terminalSurface, broadcastSse: vi.fn() })).resolves.toBeUndefined();

        expect(mocks.runTerminalReplPhase).toHaveBeenCalledTimes(2);
        expect(mocks.bootstrapObservability).toHaveBeenCalledTimes(2);
        expect(mocks.registerGlobalHandlers).toHaveBeenCalledTimes(2);
        expect(mocks.assertCopilotBootSurfaces).toHaveBeenCalledTimes(2);
    });

    it('registra rollbacks transacionais para recursos terminal alocados por fase', async () => {
        await bootstrapMod.bootCopilot({ terminal: terminalSurface, broadcastSse: vi.fn() });

        expect(mocks.bootRollbacks.map((entry) => `${entry.phaseId}:${entry.id}`)).toEqual(
            expect.arrayContaining([
                'terminal-pinned-context:pinned-context',
                'copilot-http-server:http-server',
                'terminal-runtime-listeners:runtime-listeners',
            ]),
        );

        await Promise.all(mocks.bootRollbacks.map((entry) => entry.rollback()));
        expect(mocks.rollbackTerminalPinnedContextPhase).toHaveBeenCalled();
        expect(mocks.rollbackTerminalHttpServerPhase).toHaveBeenCalled();
        expect(mocks.rollbackTerminalRuntimeListenersPhase).toHaveBeenCalled();
    });

    it('falha cedo quando o host terminal não é injetado', async () => {
        await expect(bootstrapMod.bootCopilot(/** @type {any} */ ({}))).rejects.toThrow(/terminal host/i);
    });
});
