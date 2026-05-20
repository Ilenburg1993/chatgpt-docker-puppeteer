// @ts-check

import { describe, expect, it, vi } from 'vitest';
import {
    clearRuntimeInjectHistory,
    recordRuntimeInjectHistory,
} from '../../../../src/copilot/presentation/state/index.js';

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
        systemPromptBinding: { digest: 'bound-default' },
        systemPromptFreshness: { isStale: false, reason: 'binding ok', recommendedAction: 'none' },
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
        systemPromptBinding: { digest: 'bound-alt' },
        systemPromptFreshness: {
            isStale: true,
            reason: 'snapshot estático defasado',
            recommendedAction: 'resume-session',
        },
    }),
    getHealthSnapshot: () => ({
        status: 'healthy',
        backgroundPendingCount: 0,
        issues: [],
        checks: { io: { keepaliveRunning: true }, quota: { running: true } },
    }),
});

/**
 * @param {typeof defaultRuntime} runtime
 * @returns {{
 *     status: string;
 *     model: string;
 *     reasoningEffort: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 * }}
 */
function readMockRuntimeControlState(runtime) {
    const snap = runtime.getStatusSnapshot?.() ?? {};
    return {
        status: snap.status ?? runtime.status ?? 'unknown',
        model: snap.model ?? runtime.model ?? 'unknown',
        reasoningEffort: snap.reasoningEffort ?? runtime.reasoningEffort ?? 'off',
        sessionId: runtime.sessionId ?? snap.sessionId ?? null,
        dialogLoopActive: Boolean(runtime.dialogLoopActive),
        dialogPaused: Boolean(snap.dialogPaused ?? runtime.dialogPaused),
        queueSize: Number(runtime.queueSize ?? snap.queueSize ?? 0),
    };
}

/**
 * @param {typeof defaultRuntime} runtime
 * @returns {Record<string, any>}
 */
function readMockRuntimePrBudgetSnapshot(runtime) {
    return {
        sendCount: Number(runtime.getStatusSnapshot?.().sendCount ?? 0),
        dialogLoopActive: Boolean(runtime.dialogLoopActive),
        sessionId: runtime.sessionId ?? null,
        prMetrics: runtime.dialogPrMetrics ?? null,
        lastPrInfo: runtime.lastPrInfo ?? null,
    };
}

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
    readRuntimeControlState: readMockRuntimeControlState,
    readRuntimeInteractionState: vi.fn(() => ({
        pendingQuestion: null,
        pendingQuestionKind: null,
        pendingQuestionShadow: null,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowExpiresAt: null,
        pendingQuestionShadowRemainingMs: null,
    })),
    readRuntimePrBudgetSnapshot: readMockRuntimePrBudgetSnapshot,
    readRuntimeAutoModelPolicy: (/** @type {typeof defaultRuntime} */ runtime) => ({
        configuredModel: runtime.model,
        observedModel: runtime.lastPrInfo?.effectiveModel ?? runtime.lastPrInfo?.model ?? null,
        selectionAuthority: 'github-copilot',
        canForcePreference: false,
    }),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    readSdkModelMetadata: () => null,
    createRuntimeSnapshot: vi.fn(),
    saveRuntimeSnapshot: vi.fn(),
    listRuntimeSnapshots: vi.fn(async () => []),
    loadRuntimeSnapshot: vi.fn(async () => null),
}));

vi.mock('#copilot/agent/always-alive', () => ({
    alwaysAliveAgent: defaultRuntime,
    getAgent: () => defaultRuntime,
}));

vi.mock('#copilot/agent/runtime-registry', () => ({
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (runtimeId = 'default') =>
        runtimeId === 'alt' ? altRuntime : runtimeId === 'default' ? defaultRuntime : null,
    listAgentRuntimes: () => [
        { runtimeId: 'default', runtime: defaultRuntime },
        { runtimeId: 'alt', runtime: altRuntime },
    ],
}));

vi.mock('#copilot/agent/facades', () => ({
    readAgentRuntimeStatusSnapshot: (/** @type {typeof defaultRuntime} */ agent) => agent.getStatusSnapshot(),
    readAgentRuntimeHealthSnapshot: (/** @type {typeof defaultRuntime} */ agent) => agent.getHealthSnapshot(),
    readRuntimeControlState: readMockRuntimeControlState,
    readRuntimePrBudgetSnapshot: readMockRuntimePrBudgetSnapshot,
    readRuntimeInteractionState: vi.fn(() => ({
        pendingQuestion: null,
        pendingQuestionKind: null,
        pendingQuestionShadow: null,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowExpiresAt: null,
        pendingQuestionShadowRemainingMs: null,
    })),
    readRuntimePermissionMode: vi.fn(() => 'approve_all'),
    readAgentRuntimeSdkResourceSnapshot: vi.fn(() => ({ client: false, session: false, quotaMonitor: false })),
    readRuntimeAutoModelPolicy: (/** @type {typeof defaultRuntime} */ runtime) => ({
        configuredModel: runtime.model,
        observedModel: runtime.lastPrInfo?.effectiveModel ?? runtime.lastPrInfo?.model ?? null,
        selectionAuthority: 'github-copilot',
        canForcePreference: false,
    }),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    readSdkModelMetadata: () => null,
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

vi.mock('#copilot/core', async (importOriginal) => ({
    ...(await importOriginal()),
    getSharedSessionBinding: () => ({ hubSessionId: 'hub-456', sdkSessionId: 'sdk-456' }),
}));

vi.mock('#copilot/observability', () => ({
    getToolStats: () => ({
        'tool.x': { calls: 3, errors: 1, avgLatencyMs: 33 },
        'tool.y': { calls: 4, errors: 0, avgLatencyMs: 55 },
    }),
    defaultErrorTracker: { getStats: () => ({ total: 2, buffered: 1 }) },
}));

vi.mock('../../../../src/copilot/terminal/state/activity-state.js', () => ({
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
    it('cmdMetrics mostra diagnósticos do último inject do runtime selecionado', () => {
        clearRuntimeInjectHistory();
        recordRuntimeInjectHistory({
            ts: Date.now(),
            from: 'llm-a',
            message: 'default inject',
            replySnippet: 'ok',
            durationMs: 321,
            timeoutMs: null,
            timeoutStrategy: 'disabled',
            transportTimeoutMs: 28000,
            transportTimeoutStrategy: 'adaptive',
            runtimeId: 'default',
            promptDigest: 'digest-default',
            promptFreshnessReason: 'binding ok',
            promptRecommendedAction: 'none',
            promptIsStale: false,
            diagnostics: {
                preflightDurationMs: 12,
                contextEmbeddingDurationMs: 34,
                attachmentEmbeddingDurationMs: 0,
                dialogDurationMs: 275,
                runtimeDialog: {
                    autoStarted: false,
                    recoveredInputChannel: true,
                },
            },
            outcome: 'completed',
            ok: true,
        });
        recordRuntimeInjectHistory({
            ts: Date.now(),
            from: 'llm-a',
            message: 'alt inject',
            replySnippet: 'ok-alt',
            durationMs: 111,
            timeoutMs: 5000,
            timeoutStrategy: 'explicit',
            transportTimeoutMs: 15000,
            transportTimeoutStrategy: 'explicit',
            runtimeId: 'alt',
            promptDigest: 'digest-alt',
            promptFreshnessReason: 'snapshot estático defasado',
            promptRecommendedAction: 'resume-session',
            promptIsStale: true,
            diagnostics: {
                preflightDurationMs: 5,
                contextEmbeddingDurationMs: 0,
                attachmentEmbeddingDurationMs: 0,
                dialogDurationMs: 100,
                runtimeDialog: {
                    autoStarted: true,
                    recoveredInputChannel: false,
                },
            },
            outcome: 'completed',
            ok: true,
        });
        const ctx = mockCtx();

        try {
            cmdMetrics({ println: ctx.println }, '--runtime alt');

            expect(ctx.output()).toContain('transporte');
            expect(ctx.output()).toContain('digest-alt');
            expect(ctx.output()).toContain('resume-session');
            expect(ctx.output()).toContain('preflight=5ms');
            expect(ctx.output()).toContain('dialog=100ms');
            expect(ctx.output()).toContain('autostart=yes');
            expect(ctx.output()).toContain('recovery=no');
            expect(ctx.output()).not.toContain('digest-default');
        } finally {
            clearRuntimeInjectHistory();
        }
    });

    it('cmdMetrics exibe binding sdk/hub e agregados', () => {
        const ctx = mockCtx();

        cmdMetrics({ println: ctx.println });

        expect(ctx.output()).toContain('sdk sessão');
        expect(ctx.output()).toContain('hub sessão');
        expect(ctx.output()).toContain('modo sdk');
        expect(ctx.output()).not.toContain('plan local');
        expect(ctx.output()).toContain('timeline canônica');
        expect(ctx.output()).toContain('bridge/live 0');
        expect(ctx.output()).toContain('Atividade');
        expect(ctx.output()).toContain('Inject');
        expect(ctx.output()).toContain('Archive SSE');
        expect(ctx.output()).toContain('binding ok');
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
        expect(ctx.output()).toContain('Última telemetria PR classificada');
        expect(ctx.output()).toContain('não implica consumo neste boot/probe');
    });

    it('cmdUsage now aceita runtimeId explícito', () => {
        const ctx = mockCtx();

        cmdUsage({ println: ctx.println }, 'now --runtime alt');

        expect(ctx.output()).toContain('Binding: runtime=');
        expect(ctx.output()).toContain('Modo: sdk=');
        expect(ctx.output()).toContain('gpt-4.1-mini');
    });

    it('cmdMetrics e cmdUsage usam projection comum para mismatch de billing', () => {
        const previous = defaultRuntime.lastPrInfo;
        defaultRuntime.lastPrInfo = {
            model: 'gpt-5-mini',
            configuredModel: 'gpt-5',
            modelMismatch: true,
            cost: 0.0789,
            ts: Date.now(),
        };
        try {
            const metricsCtx = mockCtx();
            const usageCtx = mockCtx();

            cmdMetrics({ println: metricsCtx.println });
            cmdUsage({ println: usageCtx.println }, 'now');

            expect(metricsCtx.output()).toContain('mismatch');
            expect(metricsCtx.output()).toContain('cfg=gpt-5');
            expect(metricsCtx.output()).toContain('cobrado=gpt-5-mini');
            expect(usageCtx.output()).toContain('cfg=');
            expect(usageCtx.output()).toContain('cobrado=');
        } finally {
            defaultRuntime.lastPrInfo = previous;
        }
    });
});
