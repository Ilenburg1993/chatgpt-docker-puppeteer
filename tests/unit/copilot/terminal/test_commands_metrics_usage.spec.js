// @ts-check

import { describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/agent', () => ({
    getAgent: () =>
        /** @type {any} */ ({
            sessionId: 'runtime-456',
            dialogLoopActive: true,
            dialogPrMetrics: null,
            lastPrInfo: { model: 'gpt-4.1', cost: 0.0456 },
            answerPendingQuestion: vi.fn(() => true),
            getStatusSnapshot: () => ({
                status: 'idle',
                model: 'gpt-4.1',
                reasoningEffort: 'medium',
                contextState: { tokens: 64000, tokenLimit: 128000, utilization: 0.5 },
            }),
            getHealthSnapshot: () => ({
                status: 'healthy',
                backgroundPendingCount: 0,
                issues: [],
                checks: { io: { keepaliveRunning: true }, quota: { running: true } },
            }),
        }),
    createSnapshot: vi.fn(),
    saveSnapshotAsync: vi.fn(),
    listSnapshotsAsync: vi.fn(async () => []),
    loadSnapshotAsync: vi.fn(async () => null),
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

const { cmdMetrics } = await import('../../../../src/copilot/terminal/commands/metrics.js');
const { cmdUsage } = await import('../../../../src/copilot/terminal/commands/usage.js');

function mockCtx() {
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
        expect(ctx.output()).toContain('11');
    });

    it('cmdUsage now exibe contexto e binding runtime/sdk/hub', () => {
        const ctx = mockCtx();

        cmdUsage({ println: ctx.println }, 'now');

        expect(ctx.output()).toContain('Context window');
        expect(ctx.output()).toContain('Binding: runtime=');
        expect(ctx.output()).toContain('gpt-4.1');
    });
});
