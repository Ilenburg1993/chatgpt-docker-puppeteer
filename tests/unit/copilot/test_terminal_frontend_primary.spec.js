// @ts-check

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/agent', () => ({
    getAgent: () =>
        /** @type {any} */ ({
            sessionId: 'runtime-123',
            model: 'gpt-5',
            reasoningEffort: 'high',
            dialogLoopActive: true,
            dialogPrMetrics: null,
            lastPrInfo: { model: 'gpt-5', cost: 0.1234 },
            setModel: vi.fn(),
            setReasoningEffort: vi.fn(),
            answerPendingQuestion: vi.fn(() => true),
            getStatusSnapshot: () => ({
                status: 'waiting_for_input',
                model: 'gpt-5',
                reasoningEffort: 'high',
                sendCount: 7,
                dialogPaused: false,
                pendingQuestion: 'Ready?',
                contextState: { tokens: 32000, tokenLimit: 128000, utilization: 0.25 },
            }),
            getHealthSnapshot: () => ({
                status: 'healthy',
                backgroundPendingCount: 2,
                issues: [],
                checks: { io: { keepaliveRunning: true }, quota: { running: true } },
            }),
        }),
    createSnapshot: vi.fn((/** @type {Record<string, unknown>} */ data) => ({
        snapshotId: 'snap-1',
        createdAt: 1,
        ...data,
    })),
    saveSnapshotAsync: vi.fn(async () => '/tmp/snap-1.json'),
    listSnapshotsAsync: vi.fn(async () => [{ snapshotId: 'snap-1', createdAt: 1, model: 'gpt-5', reason: 'manual' }]),
    loadSnapshotAsync: vi.fn(async (/** @type {string} */ id) =>
        id === 'snap-1' ? { snapshotId: 'snap-1', createdAt: 1, model: 'gpt-5', status: 'idle', sendCount: 1 } : null,
    ),
}));

vi.mock('#copilot/bridges', () => ({
    getMcpStatus: () => ({ available: true, toolCount: 4, circuitOpen: false, latencyMs: 23 }),
}));

vi.mock('#copilot/channel', () => ({
    llmBridgeClient: {
        turnCount: 9,
        history: [
            { role: 'user', content: 'olá', timestamp: 1000 },
            { role: 'assistant', content: 'oi', timestamp: 1001 },
        ],
        clearHistory: vi.fn(),
        seedHistory: vi.fn(),
    },
}));

vi.mock('#copilot/conversation-hub', () => ({
    conversationHub: { isReady: true },
    conversationStore: {
        getHubSession: vi.fn(() => ({ id: 'hub-1', title: 'Sessão Hub' })),
        readTurns: vi.fn(() => [
            { role: 'user', content: 'a', created_at: Date.now() },
            { role: 'llm_b', content: 'b', created_at: Date.now() },
        ]),
        listHubSessions: vi.fn(() => [{ id: 'hub-1', status: 'active', title: 'Sessão Hub', created_at: Date.now() }]),
        recallMemories: vi.fn(() => [{ id: 'm1' }]),
    },
}));

vi.mock('#copilot/core', () => ({
    getSharedSessionBinding: () => ({ hubSessionId: 'hub-1', sdkSessionId: 'sdk-1' }),
}));

vi.mock('#copilot/observability', () => ({
    getToolStats: () => ({
        'tool.fast': { calls: 3, errors: 0, avgLatencyMs: 20 },
        'tool.slow': { calls: 5, errors: 2, avgLatencyMs: 150 },
    }),
    defaultErrorTracker: {
        getStats: () => ({ total: 3, buffered: 2 }),
        getErrors: () => [{ timestamp: 1, errorType: 'TypeError', source: 'agent', message: 'kaboom' }],
    },
}));

vi.mock('#copilot/sdk', () => ({
    listModels: vi.fn(async () => [
        { id: 'gpt-5', capabilities: { supports: { reasoningEffort: true, vision: true } } },
    ]),
    modelRegistry: new Map([['gpt-5', { costTier: 'high', speedTier: 'fast', contextWindow: 128000 }]]),
    modelStatsTracker: {
        allStats: () => [{ modelId: 'gpt-5', totalCalls: 2, avgLatencyMs: 44, successRate: 1, totalTokens: 200 }],
    },
    createTool: vi.fn((spec) => spec),
    SYSTEM_PROMPT_SECTIONS: {},
    loadCustomTools: vi.fn(async () => []),
    loadToolsConfig: vi.fn(async () => ({ categories: [] })),
}));

vi.mock('../../../src/copilot/terminal/workspace-context.js', () => ({
    getWorkspaceContext: () => ({ cwd: '/repo', gitRoot: '/repo', currentBranch: 'main' }),
}));

vi.mock('../../../src/copilot/terminal/dialog.js', () => ({
    sendTurn: vi.fn(async () => 'Resumo final'),
}));

vi.mock('../../../src/copilot/tools/todo/store.js', () => ({
    readStore: async () => ({
        tasks: {
            a1: { id: 'a1', title: 'Primeira task', status: 'todo' },
            a2: { id: 'a2', title: 'Segunda task', status: 'in_progress' },
        },
    }),
}));

/** @type {typeof import('../../../src/copilot/terminal/frontend/llm-b-frontend.js')} */
let frontend;

beforeAll(async () => {
    frontend = await import('../../../src/copilot/terminal/frontend/llm-b-frontend.js');
});

describe('terminal/frontend/llm-b-frontend', () => {
    it('constrói status projection com binding compartilhado e workspace', () => {
        const projection = frontend.readTerminalStatusProjection({ hubSessionId: null, injectPort: 3009 });

        expect(projection.runtimeSessionId).toBe('runtime-123');
        expect(projection.sdkSessionId).toBe('sdk-1');
        expect(projection.hubSessionId).toBe('hub-1');
        expect(projection.turnCount).toBe(9);
        expect(projection.workspace.currentBranch).toBe('main');
    });

    it('constrói metrics projection com agregados de tool/error/context', () => {
        const projection = frontend.readTerminalMetricsProjection();

        expect(projection.contextWindow?.tokenLimit).toBe(128000);
        expect(projection.toolCallCount).toBe(8);
        expect(projection.toolErrorCount).toBe(2);
        expect(projection.errorStats.total).toBe(3);
        expect(projection.binding.sdkSessionId).toBe('sdk-1');
    });

    it('constrói diagnose projection com hub/todos/tool stats', async () => {
        const projection = await frontend.readTerminalDiagnoseProjection({ hubSessionId: 'hub-1' });

        expect(projection.hub.summary).toContain('sessão');
        expect(projection.todos).toHaveLength(2);
        expect(projection.topToolStats[0]?.[0]).toBe('tool.slow');
    });

    it('salva snapshot via fachada principal do terminal', async () => {
        const result = await frontend.saveTerminalSnapshotProjection('manual');

        expect(result.data.snapshotId).toBe('snap-1');
        expect(result.path).toBe('/tmp/snap-1.json');
    });

    it('expõe config/model stats/model list pela consumer layer canônica', async () => {
        const config = frontend.readTerminalConfigProjection();
        const stats = frontend.readTerminalModelStatsProjection();
        const available = await frontend.listTerminalAvailableModelsProjection();

        expect(config.currentModel).toBe('gpt-5');
        expect(config.currentReasoningEffort).toBe('high');
        expect(config.modelMeta?.contextWindow).toBe(128000);
        expect(stats.stats[0]?.modelId).toBe('gpt-5');
        expect(available.models).toHaveLength(1);
    });

    it('ajusta model e reasoning via frontend canônico', () => {
        const modelResult = frontend.setTerminalModelProjection('gpt-4.1');
        const reasoningResult = frontend.setTerminalReasoningProjection('low');

        expect(modelResult.previousModel).toBe('gpt-5');
        expect(modelResult.currentModel).toBe('gpt-4.1');
        expect(reasoningResult.previousReasoningEffort).toBe('high');
        expect(reasoningResult.currentReasoningEffort).toBe('low');
    });

    it('projeta contexto e erros e compacta histórico pela camada frontend', async () => {
        const context = frontend.readTerminalContextProjection();
        const errors = frontend.readTerminalErrorsProjection(5);
        const compact = await frontend.requestTerminalCompactionProjection();

        expect(context.isRealData).toBe(true);
        expect(context.workspace.currentBranch).toBe('main');
        expect(errors.stats.total).toBe(3);
        expect(errors.recent[0]?.message).toBe('kaboom');
        expect(compact.ok).toBe(true);
    });
});
