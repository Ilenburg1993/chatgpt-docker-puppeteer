// @ts-check

import { beforeAll, describe, expect, it, vi } from 'vitest';

const clearPendingQuestionShadow = vi.fn(() => true);
const altClearPendingQuestionShadow = vi.fn(() => true);
const startAgentDialogLoop = vi.fn(async (/** @type {any} */ runtime, /** @type {string | undefined} */ bootPrompt) => {
    await runtime.startDialogLoop(bootPrompt);
});
const sendAgentDialogTurn = vi.fn(async () => 'Resumo final');
const defaultGetSdkSessionMode = vi.fn(async () => ({ mode: 'interactive' }));
const defaultSetSdkSessionMode = vi.fn(async (/** @type {any} */ mode) => ({ mode }));
const defaultReadSdkPlan = vi.fn(async () => ({ path: '/tmp/default-plan.md', content: 'default plan' }));
const defaultUpdateSdkPlan = vi.fn(async () => ({ ok: true }));
const defaultDeleteSdkPlan = vi.fn(async () => ({ ok: true }));
const altGetSdkSessionMode = vi.fn(async () => ({ mode: 'plan' }));
const altSetSdkSessionMode = vi.fn(async (/** @type {any} */ mode) => ({ mode }));
const altReadSdkPlan = vi.fn(async () => ({ path: '/tmp/alt-plan.md', content: 'alt plan' }));
const altUpdateSdkPlan = vi.fn(async () => ({ ok: true }));
const altDeleteSdkPlan = vi.fn(async () => ({ ok: true }));

const defaultRuntime = /** @type {any} */ ({
    status: 'idle',
    sessionId: 'runtime-123',
    model: 'gpt-5',
    reasoningEffort: 'high',
    dialogLoopActive: true,
    dialogPrMetrics: null,
    lastPrInfo: { model: 'gpt-5', cost: 0.1234 },
    setModel: vi.fn(),
    setReasoningEffort: vi.fn(),
    startDialogLoop: vi.fn(async () => {}),
    getSdkSessionMode: defaultGetSdkSessionMode,
    setSdkSessionMode: defaultSetSdkSessionMode,
    readSdkPlan: defaultReadSdkPlan,
    updateSdkPlan: defaultUpdateSdkPlan,
    deleteSdkPlan: defaultDeleteSdkPlan,
    answerPendingQuestion: vi.fn(() => true),
    clearPendingQuestionShadow,
    pendingQuestion: { question: 'Ready?', kind: 'question', allowFreeform: true, askedAt: 1 },
    pendingQuestionKind: 'question',
    pendingQuestionShadow: {
        question: 'READY: aguardando próxima mensagem',
        meta: { kind: 'ready', askedAt: 1, allowFreeform: true, protocolControlled: true },
        restoredAt: 2,
        expiresAt: 3,
    },
    pendingQuestionShadowKind: 'ready',
    pendingQuestionShadowState: 'expired',
    pendingQuestionShadowExpired: true,
    pendingQuestionShadowAgeMs: 1200,
    pendingQuestionShadowExpiresAt: 3,
    pendingQuestionShadowRemainingMs: 0,
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
        recommendedAction: 'clear_pending_question_shadow',
        checks: { io: { keepaliveRunning: true }, quota: { running: true } },
    }),
});

const altRuntime = /** @type {any} */ ({
    status: 'processing',
    sessionId: 'runtime-alt',
    model: 'gpt-5-mini',
    reasoningEffort: 'medium',
    dialogLoopActive: false,
    dialogPrMetrics: { boots: 2, resumesWithPR: 1, resumesZeroPR: 0, totalPR: 5 },
    lastPrInfo: { model: 'gpt-5-mini', cost: 0.02 },
    setModel: vi.fn(),
    setReasoningEffort: vi.fn(),
    startDialogLoop: vi.fn(async () => {}),
    getSdkSessionMode: altGetSdkSessionMode,
    setSdkSessionMode: altSetSdkSessionMode,
    readSdkPlan: altReadSdkPlan,
    updateSdkPlan: altUpdateSdkPlan,
    deleteSdkPlan: altDeleteSdkPlan,
    answerPendingQuestion: vi.fn(() => true),
    clearPendingQuestionShadow: altClearPendingQuestionShadow,
    pendingQuestion: null,
    pendingQuestionKind: null,
    pendingQuestionShadow: null,
    pendingQuestionShadowKind: null,
    pendingQuestionShadowState: null,
    pendingQuestionShadowExpired: false,
    pendingQuestionShadowAgeMs: null,
    pendingQuestionShadowExpiresAt: null,
    pendingQuestionShadowRemainingMs: null,
    getStatusSnapshot: () => ({
        status: 'processing',
        model: 'gpt-5-mini',
        reasoningEffort: 'medium',
        sendCount: 2,
        dialogPaused: true,
        pendingQuestion: null,
        contextState: { tokens: 8000, tokenLimit: 64000, utilization: 0.125 },
    }),
    getHealthSnapshot: () => ({
        status: 'degraded',
        backgroundPendingCount: 0,
        issues: ['runtime.alt'],
        recommendedAction: 'review_pending_question_shadow',
        checks: { io: { keepaliveRunning: false }, quota: { running: false } },
    }),
});

const modelMeta = new Map([
    [
        'gpt-5',
        {
            costTier: 'high',
            speedTier: 'fast',
            contextWindow: 128000,
            supportsReasoning: true,
            supportsVision: true,
        },
    ],
    [
        'gpt-5-mini',
        {
            costTier: 'low',
            speedTier: 'fast',
            contextWindow: 128000,
            supportsReasoning: true,
            supportsVision: false,
        },
    ],
    [
        'gpt-4.1',
        {
            costTier: 'medium',
            speedTier: 'fast',
            contextWindow: 1047576,
            supportsReasoning: false,
            supportsVision: true,
        },
    ],
]);

vi.mock('#copilot/agent', () => ({
    getAgent: () => defaultRuntime,
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getDefaultAgentRuntimeId: () => 'default',
    getAgentRuntime: (/** @type {string | null | undefined} */ runtimeId) => {
        if (runtimeId === 'alt') return altRuntime;
        return runtimeId === 'default' || runtimeId == null ? defaultRuntime : null;
    },
    getRegisteredAgentRuntime: (/** @type {string | null | undefined} */ runtimeId) => {
        if (runtimeId === 'alt') return altRuntime;
        return runtimeId === 'default' || runtimeId == null ? defaultRuntime : null;
    },
    listAgentRuntimes: () => [
        { runtimeId: 'default', runtime: defaultRuntime },
        { runtimeId: 'alt', runtime: altRuntime },
    ],
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
    readRuntimeInteractionState: (/** @type {any} */ runtime) => ({
        pendingQuestion: runtime.pendingQuestion ?? null,
        pendingQuestionKind: runtime.pendingQuestionKind ?? runtime.pendingQuestion?.kind ?? null,
        pendingQuestionShadow: runtime.pendingQuestionShadow ?? null,
        pendingQuestionShadowKind:
            runtime.pendingQuestionShadowKind ?? runtime.pendingQuestionShadow?.meta?.kind ?? null,
        pendingQuestionShadowState: runtime.pendingQuestionShadowState ?? null,
        pendingQuestionShadowExpired: Boolean(runtime.pendingQuestionShadowExpired),
        pendingQuestionShadowAgeMs: runtime.pendingQuestionShadowAgeMs ?? null,
        pendingQuestionShadowExpiresAt: runtime.pendingQuestionShadowExpiresAt ?? null,
        pendingQuestionShadowRemainingMs: runtime.pendingQuestionShadowRemainingMs ?? null,
    }),
    readRuntimePrBudgetSnapshot: (/** @type {any} */ runtime) => ({
        sendCount: Number(runtime.getStatusSnapshot().sendCount ?? 0),
        dialogLoopActive: Boolean(runtime.dialogLoopActive),
        sessionId: runtime.sessionId ?? null,
        prMetrics: runtime.dialogPrMetrics ?? { boots: 0, resumesWithPR: 0, resumesZeroPR: 0, totalPR: 0 },
        lastPrInfo: runtime.lastPrInfo ?? null,
    }),
    readRuntimeModelSelection: (/** @type {any} */ runtime) => ({
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
    }),
    setRuntimeModel: (/** @type {any} */ runtime, /** @type {string} */ modelId) => runtime.setModel(modelId),
    setRuntimeReasoningEffort: (/** @type {any} */ runtime, /** @type {any} */ effort) =>
        runtime.setReasoningEffort(effort),
    answerRuntimePendingQuestion: (/** @type {any} */ runtime, /** @type {string} */ answer) =>
        runtime.answerPendingQuestion(answer),
    clearRuntimePendingQuestionShadow: (/** @type {any} */ runtime) => runtime.clearPendingQuestionShadow(),
    readAgentSdkSessionMode: (/** @type {any} */ runtime) => runtime.getSdkSessionMode(),
    setAgentSdkSessionMode: (/** @type {any} */ runtime, /** @type {any} */ mode) => runtime.setSdkSessionMode(mode),
    readAgentSdkPlan: (/** @type {any} */ runtime) => runtime.readSdkPlan(),
    updateAgentSdkPlan: (/** @type {any} */ runtime, /** @type {string} */ content) => runtime.updateSdkPlan(content),
    deleteAgentSdkPlan: (/** @type {any} */ runtime) => runtime.deleteSdkPlan(),
    listSdkCatalogModels: vi.fn(async () => [
        { id: 'gpt-5', capabilities: { supports: { reasoningEffort: true, vision: true } } },
    ]),
    readSdkModelMetadata: (/** @type {string} */ modelId) => modelMeta.get(modelId) ?? null,
    readSdkModelStats: () => [{ modelId: 'gpt-5', totalCalls: 2, avgLatencyMs: 44, successRate: 1, totalTokens: 200 }],
    getRuntimeHandoffManager: (/** @type {any} */ runtime) => ({
        getHistory: () => [{ runtimeId: runtime === altRuntime ? 'alt' : 'default' }],
    }),
    getRuntimeHandoffHistory: (/** @type {any} */ runtime) => [
        { runtimeId: runtime === altRuntime ? 'alt' : 'default' },
    ],
    readAgentRuntimeTodoSummaries: vi.fn(async () => [
        { id: 'todo-1', title: 'Revisar fronteiras', status: 'todo' },
        { id: 'todo-2', title: 'Validar contratos', status: 'in_progress' },
    ]),
    startAgentDialogLoop,
    sendAgentDialogTurn,
    createRuntimeSnapshot: vi.fn((/** @type {Record<string, unknown>} */ data) => ({
        snapshotId: 'snap-1',
        createdAt: 1,
        ...data,
    })),
    saveRuntimeSnapshot: vi.fn(async () => '/tmp/snap-1.json'),
    listRuntimeSnapshots: vi.fn(async () => [{ snapshotId: 'snap-1', createdAt: 1, model: 'gpt-5', reason: 'manual' }]),
    loadRuntimeSnapshot: vi.fn(async (/** @type {string} */ id) =>
        id === 'snap-1' ? { snapshotId: 'snap-1', createdAt: 1, model: 'gpt-5', status: 'idle', sendCount: 1 } : null,
    ),
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

vi.mock('#copilot/core', async (importOriginal) => ({
    ...(await importOriginal()),
    getSharedSessionBinding: () => ({ hubSessionId: 'hub-1', sdkSessionId: 'sdk-1' }),
}));

vi.mock('#copilot/observability', () => ({
    log: vi.fn(),
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
    modelRegistry: new Map([
        [
            'gpt-5',
            {
                costTier: 'high',
                speedTier: 'fast',
                contextWindow: 128000,
                supportsReasoning: true,
                supportsVision: true,
            },
        ],
        [
            'gpt-5-mini',
            {
                costTier: 'low',
                speedTier: 'fast',
                contextWindow: 128000,
                supportsReasoning: true,
                supportsVision: false,
            },
        ],
        [
            'gpt-4.1',
            {
                costTier: 'medium',
                speedTier: 'fast',
                contextWindow: 1047576,
                supportsReasoning: false,
                supportsVision: true,
            },
        ],
    ]),
    modelStatsTracker: {
        allStats: () => [{ modelId: 'gpt-5', totalCalls: 2, avgLatencyMs: 44, successRate: 1, totalTokens: 200 }],
    },
    createTool: vi.fn((spec) => spec),
    SYSTEM_PROMPT_SECTIONS: {},
    loadCustomTools: vi.fn(async () => []),
    loadToolsConfig: vi.fn(async () => ({ categories: [] })),
    loadToolsConfigAsync: vi.fn(async () => ({ categories: [] })),
}));

vi.mock('../../../src/copilot/terminal/workspace-context.js', () => ({
    getWorkspaceContext: () => ({ cwd: '/repo', gitRoot: '/repo', currentBranch: 'main' }),
}));

vi.mock('../../../src/copilot/tools/todo/store.js', async (importOriginal) => ({
    ...(await importOriginal()),
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
        expect(projection.requestedRuntimeId).toBeNull();
        expect(projection.runtimeId).toBe('default');
        expect(projection.runtimeFound).toBe(true);
        expect(projection.usedDefaultRuntimeFallback).toBe(false);
        expect(projection.agentRuntimes).toEqual([
            {
                runtimeId: 'default',
                status: 'waiting_for_input',
                model: 'gpt-5',
                sessionId: 'runtime-123',
                isDefault: true,
            },
            {
                runtimeId: 'alt',
                status: 'processing',
                model: 'gpt-5-mini',
                sessionId: 'runtime-alt',
                isDefault: false,
            },
        ]);
        expect(projection.sdkSessionId).toBe('sdk-1');
        expect(projection.hubSessionId).toBe('hub-1');
        expect(projection.turnCount).toBe(9);
        expect(projection.workspace.currentBranch).toBe('main');
        expect(projection.pendingQuestionKind).toBe('question');
        expect(projection.pendingQuestionShadowExpired).toBe(true);
        expect(projection.pendingQuestionShadowState).toBe('expired');
        expect(projection.pendingQuestionShadowAgeMs).toBe(1200);
        expect(projection.pendingQuestionShadowRemainingMs).toBe(0);
        expect(projection.recommendedAction).toBe('clear_pending_question_shadow');
        expect(projection.activity.label).toBeTruthy();
    });

    it('projeta status/config/context para runtime explícito quando informado', () => {
        const status = frontend.readTerminalStatusProjection({ runtimeId: 'alt', injectPort: 3011 });
        const config = frontend.readTerminalConfigProjection('alt');
        const context = frontend.readTerminalContextProjection('alt');

        expect(status.runtimeId).toBe('alt');
        expect(status.requestedRuntimeId).toBe('alt');
        expect(status.runtimeFound).toBe(true);
        expect(status.runtimeSessionId).toBe('runtime-alt');
        expect(status.pendingQuestion).toBe(false);
        expect(config.runtimeId).toBe('alt');
        expect(config.requestedRuntimeId).toBe('alt');
        expect(config.runtimeFound).toBe(true);
        expect(config.currentModel).toBe('gpt-5-mini');
        expect(context.usedTokens).toBe(8000);
        expect(context.maxTokens).toBe(64000);
    });

    it('expõe fallback explícito quando o runtime solicitado não existe', () => {
        const status = frontend.readTerminalStatusProjection({ runtimeId: 'missing', injectPort: 3012 });
        const config = frontend.readTerminalConfigProjection('missing');

        expect(status.requestedRuntimeId).toBe('missing');
        expect(status.runtimeId).toBe('default');
        expect(status.runtimeFound).toBe(false);
        expect(status.usedDefaultRuntimeFallback).toBe(true);
        expect(config.requestedRuntimeId).toBe('missing');
        expect(config.runtimeId).toBe('default');
        expect(config.runtimeFound).toBe(false);
        expect(config.usedDefaultRuntimeFallback).toBe(true);
    });

    it('expõe limpeza canônica da shadow persistida do ask_user', () => {
        const ok = frontend.clearPendingTerminalQuestionShadow();

        expect(ok).toBe(true);
        expect(clearPendingQuestionShadow).toHaveBeenCalled();
    });

    it('encaminha answer/shadow cleanup para runtime explícito', () => {
        const answered = frontend.answerPendingTerminalQuestion('ok', 'alt');
        const cleared = frontend.clearPendingTerminalQuestionShadow('alt');

        expect(answered).toBe(true);
        expect(cleared).toBe(true);
        expect(altRuntime.answerPendingQuestion).toHaveBeenCalledWith('ok');
        expect(altClearPendingQuestionShadow).toHaveBeenCalled();
    });

    it('constrói metrics projection com agregados de tool/error/context', () => {
        const projection = frontend.readTerminalMetricsProjection();

        expect(projection.contextWindow?.tokenLimit).toBe(128000);
        expect(projection.toolCallCount).toBe(8);
        expect(projection.toolErrorCount).toBe(2);
        expect(projection.errorStats.total).toBe(3);
        expect(projection.binding.sdkSessionId).toBe('sdk-1');
    });

    it('projeta diagnose/metrics/usage por runtime explícito', async () => {
        const diagnose = await frontend.readTerminalDiagnoseProjection({ hubSessionId: 'hub-1', runtimeId: 'alt' });
        const metrics = frontend.readTerminalMetricsProjection('alt');
        const usage = frontend.readTerminalUsageNowProjection('alt');

        expect(diagnose.runtimeId).toBe('alt');
        expect(diagnose.runtimeSessionId).toBe('runtime-alt');
        expect(metrics.runtimeId).toBe('alt');
        expect(metrics.contextWindow?.tokenLimit).toBe(64000);
        expect(usage.runtimeId).toBe('alt');
        expect(usage.runtimeSessionId).toBe('runtime-alt');
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

    it('salva snapshot e opera plan mode em runtime explícito', async () => {
        const result = await frontend.saveTerminalSnapshotProjection('manual-alt', 'alt');
        const plan = await frontend.readTerminalPlanProjection('alt');
        const mode = await frontend.setTerminalPlanModeProjection('autopilot', 'alt');
        await frontend.updateTerminalPlanProjection('novo plano', 'alt');
        await frontend.deleteTerminalPlanProjection('alt');

        expect(result.data.sessionId).toBe('runtime-alt');
        expect(plan.currentMode).toBe('plan');
        expect(mode.currentMode).toBe('autopilot');
        expect(altUpdateSdkPlan).toHaveBeenCalledWith('novo plano');
        expect(altDeleteSdkPlan).toHaveBeenCalled();
    });

    it('expõe config/model stats/model list pela consumer layer canônica', async () => {
        const config = frontend.readTerminalConfigProjection();
        const stats = frontend.readTerminalModelStatsProjection();
        const available = await frontend.listTerminalAvailableModelsProjection();

        expect(config.currentModel).toBe('gpt-5');
        expect(config.currentReasoningEffort).toBe('high');
        expect(config.runtimeId).toBe('default');
        expect(config.agentRuntimes).toHaveLength(2);
        expect(config.modelMeta?.contextWindow).toBe(128000);
        expect(config.modelMeta?.supportsReasoning).toBe(true);
        expect(stats.stats[0]?.modelId).toBe('gpt-5');
        expect(available.models).toHaveLength(1);
    });

    it('ajusta model e reasoning via frontend canônico', () => {
        const modelResult = frontend.setTerminalModelProjection('gpt-5-mini');
        const reasoningResult = frontend.setTerminalReasoningProjection('low');

        expect(modelResult.previousModel).toBe('gpt-5');
        expect(modelResult.currentModel).toBe('gpt-5-mini');
        expect(modelResult.reasoningAdjusted).toBe(false);
        expect(reasoningResult.previousReasoningEffort).toBe('high');
        expect(reasoningResult.currentReasoningEffort).toBe('low');
    });

    it('ajusta model/reasoning em runtime explícito quando solicitado', () => {
        const modelResult = frontend.setTerminalModelProjection('gpt-5', 'alt');
        const reasoningResult = frontend.setTerminalReasoningProjection('high', 'alt');

        expect(modelResult.runtimeId).toBe('alt');
        expect(reasoningResult.runtimeId).toBe('alt');
        expect(altRuntime.setModel).toHaveBeenCalledWith('gpt-5');
        expect(altRuntime.setReasoningEffort).toHaveBeenCalledWith('high');
    });

    it('limpa reasoning ao migrar para modelo sem suporte explícito', () => {
        const modelResult = frontend.setTerminalModelProjection('gpt-4.1');

        expect(modelResult.currentModel).toBe('gpt-4.1');
        expect(modelResult.reasoningAdjusted).toBe(true);
        expect(modelResult.currentReasoningEffort).toBe('off');
        expect(modelResult.modelMeta?.supportsReasoning).toBe(false);
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

    it('compacta histórico usando runtime explícito pela façade canônica', async () => {
        const compact = await frontend.requestTerminalCompactionProjection('alt');

        expect(compact.ok).toBe(true);
        expect(compact.runtimeId).toBe('alt');
        expect(sendAgentDialogTurn).toHaveBeenCalledWith(
            altRuntime,
            expect.stringContaining('Compacte toda esta conversa'),
            undefined,
        );
    });
});
