// @ts-check

import { describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/agent', () => ({
    getAgent: () =>
        /** @type {any} */ ({
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
                backgroundPendingCount: 4,
                issues: ['background.backlog_high', 'quota.monitor_missing'],
                checks: {
                    io: { keepaliveRunning: false },
                    quota: { running: false },
                },
            }),
        }),
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

vi.mock('../../../../src/copilot/tools/todo/store.js', () => ({
    readStore: async () => ({
        tasks: {
            a1: { id: 'a1', title: 'Primeira task', status: 'todo' },
            a2: { id: 'a2', title: 'Segunda task', status: 'in_progress' },
        },
    }),
}));

const { cmdDiagnose } = await import('../../../../src/copilot/terminal/commands/diagnose.js');

function mockCtx() {
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
    });
});
