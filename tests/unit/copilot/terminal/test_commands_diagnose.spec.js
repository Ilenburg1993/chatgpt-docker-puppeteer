// @ts-check

import { describe, expect, it, vi } from 'vitest';

const defaultRuntime = /** @type {any} */ ({
    status: 'processing',
    model: 'gpt-5',
    reasoningEffort: 'high',
    dialogLoopActive: true,
    getStatusSnapshot: () => ({
        status: 'processing',
        model: 'gpt-5',
        reasoningEffort: 'high',
    }),
    getHealthSnapshot: () => ({
        ok: true,
        healthy: true,
        status: 'degraded',
        pendingQuestion: false,
        pendingQuestionKind: null,
        pendingQuestionShadow: true,
        pendingQuestionShadowKind: 'ready',
        pendingQuestionShadowState: 'expiring_soon',
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: 120000,
        pendingQuestionShadowRemainingMs: 15000,
        backgroundPendingCount: 4,
        issues: ['background.backlog_high', 'quota.monitor_missing'],
        recommendedAction: 'inspect_boot_report',
        checks: {
            io: { keepaliveRunning: false },
            quota: { running: false },
        },
    }),
});

const altRuntime = /** @type {any} */ ({
    status: 'idle',
    model: 'gpt-4.1-mini',
    reasoningEffort: 'medium',
    dialogLoopActive: false,
    getStatusSnapshot: () => ({
        status: 'idle',
        model: 'gpt-4.1-mini',
        reasoningEffort: 'medium',
    }),
    getHealthSnapshot: () => ({
        ok: true,
        healthy: true,
        status: 'healthy',
        pendingQuestion: false,
        pendingQuestionKind: null,
        pendingQuestionShadow: false,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowRemainingMs: null,
        backgroundPendingCount: 0,
        issues: [],
        recommendedAction: 'none',
        checks: {
            io: { keepaliveRunning: true },
            quota: { running: true },
        },
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
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    readSdkModelMetadata: () => null,
}));

vi.mock('#copilot/bridges', () => ({
    getMcpStatus: () => ({ available: false, toolCount: 0, circuitOpen: false, latencyMs: null }),
}));

vi.mock('#copilot/conversation-hub', () => ({
    conversationHub: { isReady: false },
    conversationStore: {
        getHubSession: vi.fn(() => null),
    },
}));

vi.mock('#copilot/observability', () => ({
    getToolStats: () => ({
        'tool.a': { calls: 4, errors: 1, avgLatencyMs: 120 },
        'tool.b': { calls: 2, errors: 0, avgLatencyMs: 40 },
    }),
}));

vi.mock('#copilot/core', async () => {
    const actual = await vi.importActual('#copilot/core');
    return {
        ...actual,
        getSharedSessionBinding: () => ({ hubSessionId: 'hub-1', sdkSessionId: 'sdk-1' }),
    };
});

vi.mock('../../../../src/copilot/tools/todo/store.js', async (importOriginal) => ({
    ...(await importOriginal()),
    readStore: async () => ({
        tasks: {
            a1: { id: 'a1', title: 'Primeira task', status: 'todo' },
            a2: { id: 'a2', title: 'Segunda task', status: 'in_progress' },
        },
    }),
}));

vi.mock('../../../../src/copilot/terminal/activity-state.js', () => ({
    readTerminalActivitySnapshot: () => ({
        phase: 'tool',
        label: 'Executando tool',
        detail: 'web_fetch · 50%',
        source: 'sdk',
        severity: 'info',
        progress: 50,
        toolName: 'web_fetch',
        startedAt: 1,
        updatedAt: 2,
        ageMs: 1200,
    }),
    readTerminalActivityHistory: () => [],
}));

const { cmdDiagnose } = await import('../../../../src/copilot/terminal/commands/diagnose.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('commands/diagnose', () => {
    it('inclui health, issues e status transversais do agente', async () => {
        const ctx = mockCtx();

        await cmdDiagnose({ hubSessionId: 'hub-1', println: ctx.println });

        expect(ctx.output()).toContain('Diagnóstico do Terminal LLM-B');
        expect(ctx.output()).toContain('degraded');
        expect(ctx.output()).toContain('bg tasks');
        expect(ctx.output()).toContain('keepalive');
        expect(ctx.output()).toContain('quota monitor');
        expect(ctx.output()).toContain('background.backlog_high');
        expect(ctx.output()).toContain('Executando tool');
        expect(ctx.output()).toContain('inspect_boot_report');
        expect(ctx.output()).toContain('streaming=');
        expect(ctx.output()).toContain('ask_user');
        expect(ctx.output()).toContain('shadow expirando');
        expect(ctx.output()).toContain('runtime id');
        expect(ctx.output()).toContain('*default:gpt-5/processing');
    });

    it('aceita runtimeId explícito no comando', async () => {
        const ctx = mockCtx();

        await cmdDiagnose({ hubSessionId: 'hub-1', println: ctx.println }, '--runtime alt');

        expect(ctx.output()).toContain('runtime id');
        expect(ctx.output()).toContain('alt');
        expect(ctx.output()).toContain('gpt-4.1-mini');
    });

    it('explica explicitamente quando o runtime solicitado não existe', async () => {
        const ctx = mockCtx();

        await cmdDiagnose({ hubSessionId: 'hub-1', println: ctx.println }, '--runtime missing');

        expect(ctx.output()).toContain('runtime default (default)');
    });
});
