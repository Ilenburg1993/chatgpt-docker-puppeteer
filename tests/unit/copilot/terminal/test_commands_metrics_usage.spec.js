// @ts-check

import { describe, expect, it, vi } from 'vitest';

const defaultRuntime = /** @type {any} */ ({
    sessionId: 'runtime-456',
    dialogLoopActive: true,
    dialogPrMetrics: null,
    lastPrInfo: { model: 'gpt-5-mini', cost: 0.0456 },
    answerPendingQuestion: vi.fn(() => true),
    getStatusSnapshot: () => ({
        status: 'idle',
        model: 'gpt-5-mini',
        reasoningEffort: 'medium',
        contextState: { tokens: 64000, tokenLimit: 128000, utilization: 0.5 },
    }),
    getHealthSnapshot: () => ({
        status: 'healthy',
        backgroundPendingCount: 0,
        issues: [],
        checks: { io: { keepaliveRunning: true }, quota: { running: true } },
    }),
});

const altRuntime = /** @type {any} */ ({
    sessionId: 'runtime-alt',
    dialogLoopActive: false,
    dialogPrMetrics: null,
    lastPrInfo: { model: 'gpt-4.1-mini', cost: 0.0123 },
    answerPendingQuestion: vi.fn(() => true),
    getStatusSnapshot: () => ({
        status: 'waiting_for_input',
        model: 'gpt-4.1-mini',
        reasoningEffort: 'low',
        contextState: { tokens: 1000, tokenLimit: 2000, utilization: 0.5 },
    }),
    getHealthSnapshot: () => ({
        status: 'healthy',
        backgroundPendingCount: 0,
        issues: [],
        checks: { io: { keepaliveRunning: true }, quota: { running: true } },
    }),
});

vi.mock('#copilot/agent', () => ({
    getAgent: () => defaultRuntime,
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (runtimeId = 'default') =>
        runtimeId === 'alt' ? altRuntime : runtimeId === 'default' ? defaultRuntime : null,
    listAgentRuntimes: () => [
        { runtimeId: 'default', runtime: defaultRuntime },
        { runtimeId: 'alt', runtime: altRuntime },
    ],
    readAgentRuntimeStatusSnapshot: (/** @type {typeof defaultRuntime} */ agent) => agent.getStatusSnapshot(),
    readAgentRuntimeHealthSnapshot: (/** @type {typeof defaultRuntime} */ agent) => agent.getHealthSnapshot(),
    createRuntimeSnapshot: vi.fn(),
    saveRuntimeSnapshot: vi.fn(),
    listRuntimeSnapshots: vi.fn(async () => []),
    loadRuntimeSnapshot: vi.fn(async () => null),
}));

vi.mock('#copilot/channel', () => ({
    llmBridgeClient: {
        turnCount: 11,
        history: [],
        clearHistory: vi.fn(),
    },
}));

vi.mock('#copilot/conversation-hub', () => ({
    conversationHub: { isReady: false },
    conversationStore: {
        getHubSession: vi.fn(() => null),
        readTurns: vi.fn(() => []),
        listHubSessions: vi.fn(() => []),
        recallMemories: vi.fn(() => []),
    },
}));

vi.mock('#copilot/core', () => ({
    getSharedSessionBinding: () => ({ hubSessionId: 'hub-456', sdkSessionId: 'sdk-456' }),
}));

vi.mock('#copilot/observability', () => ({
    getToolStats: () => ({
        'tool.x': { calls: 3, errors: 1, avgLatencyMs: 33 },
        'tool.y': { calls: 4, errors: 0, avgLatencyMs: 55 },
    }),
    defaultErrorTracker: { getStats: () => ({ total: 2, buffered: 1 }) },
}));

vi.mock('../../../../src/copilot/terminal/activity-state.js', () => ({
    readTerminalActivitySnapshot: () => ({
        phase: 'turn',
        label: 'Processando mensagem',
        detail: 'mensagem do usuário',
        source: 'dialog',
        severity: 'info',
        progress: null,
        toolName: null,
        startedAt: 1,
        updatedAt: 2,
        ageMs: 1200,
    }),
    readTerminalActivityHistory: () => [],
}));

const { cmdMetrics } = await import('../../../../src/copilot/terminal/commands/metrics.js');
const { cmdUsage } = await import('../../../../src/copilot/terminal/commands/usage.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('commands/metrics + usage', () => {
    it('cmdMetrics exibe binding sdk/hub e agregados', () => {
        const ctx = mockCtx();

        cmdMetrics({ println: ctx.println });

        expect(ctx.output()).toContain('sdk sessão');
        expect(ctx.output()).toContain('hub sessão');
        expect(ctx.output()).toContain('modo sdk');
        expect(ctx.output()).not.toContain('plan local');
        expect(ctx.output()).toContain('11');
        expect(ctx.output()).toContain('Atividade');
        expect(ctx.output()).toContain('Processando mensagem');
    });

    it('cmdMetrics encaminha runtimeId explícito para as projections', () => {
        const ctx = mockCtx();

        cmdMetrics({ println: ctx.println }, '--runtime alt');

        expect(ctx.output()).toContain('runtime id');
        expect(ctx.output()).toContain('alt');
        expect(ctx.output()).toContain('gpt-4.1-mini');
    });

    it('cmdUsage now exibe contexto e binding runtime/sdk/hub', () => {
        const ctx = mockCtx();

        cmdUsage({ println: ctx.println }, 'now');

        expect(ctx.output()).toContain('Context window');
        expect(ctx.output()).toContain('Binding: runtime=');
        expect(ctx.output()).toContain('Modo: sdk=');
        expect(ctx.output()).toContain('gpt-5-mini');
    });

    it('cmdUsage now aceita runtimeId explícito', () => {
        const ctx = mockCtx();

        cmdUsage({ println: ctx.println }, 'now --runtime alt');

        expect(ctx.output()).toContain('Binding: runtime=');
        expect(ctx.output()).toContain('Modo: sdk=');
        expect(ctx.output()).toContain('gpt-4.1-mini');
    });
});
