// @ts-check

import { describe, expect, it, vi } from 'vitest';
import {
    clearRuntimeInjectHistory,
    recordRuntimeInjectHistory,
} from '../../../../src/copilot/presentation/state/index.js';

const defaultRuntime = /** @type {any} */ ({
    sessionId: 'runtime-4567890123456789012345',
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
        lastLlmUsage: runtime.lastLlmUsage ?? null,
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
    getSharedSessionBinding: () => ({
        hubSessionId: 'hub-4567890123456789012345',
        sdkSessionId: 'sdk-4567890123456789012345',
    }),
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
            cmdMetrics({ println: ctx.println }, '--runtime alt detail');

            expect(ctx.output()).toContain('Transporte');
            expect(ctx.output()).toContain('digest-alt');
            expect(ctx.output()).toContain('retomar sessão');
            expect(ctx.output()).toContain('checagem 5ms');
            expect(ctx.output()).toContain('diálogo 100ms');
            expect(ctx.output()).toContain('auto-início sim');
            expect(ctx.output()).toContain('recuperação não');
            expect(ctx.output()).not.toContain('digest-default');
        } finally {
            clearRuntimeInjectHistory();
        }
    });

    it('cmdMetrics exibe binding sdk/hub e agregados', () => {
        const ctx = mockCtx();

        cmdMetrics({ println: ctx.println });

        expect(ctx.output()).toContain('Sessão SDK');
        expect(ctx.output()).toContain('Sessão hub');
        expect(ctx.output()).toContain('Modo SDK');
        expect(ctx.output()).not.toContain('sessão SDK');
        expect(ctx.output()).not.toContain('sessão hub');
        expect(ctx.output()).not.toContain('modo sdk');
        expect(ctx.output()).not.toContain('plan local');
        expect(ctx.output()).toContain('timeline canônica');
        expect(ctx.output()).toMatch(/Timeline\s+0/u);
        expect(ctx.output()).not.toContain('bridge/live');
        expect(ctx.output()).toContain('Atividade');
        expect(ctx.output()).toContain('Injeção');
        expect(ctx.output()).not.toContain('Inject');
        expect(ctx.output()).toContain('Registro SSE');
        expect(ctx.output()).not.toContain('Archive SSE');
        expect(ctx.output()).toContain('binding ok');
        expect(ctx.output()).toContain('Processando mensagem');
        expect(ctx.output()).not.toContain('bound-default');
        expect(ctx.output()).not.toContain('runtime-4567890123456789012345');
        expect(ctx.output()).not.toContain('sdk-4567890123456789012345');
        expect(ctx.output()).not.toContain('hub-4567890123456789012345');
    });

    it('cmdMetrics encaminha runtimeId explícito para as projections', () => {
        const ctx = mockCtx();

        cmdMetrics({ println: ctx.println }, '--runtime alt');

        expect(ctx.output()).toContain('Runtime alvo');
        expect(ctx.output()).not.toContain('runtime id');
        expect(ctx.output()).toContain('alt');
        expect(ctx.output()).toContain('gpt-4.1-mini');
    });

    it('cmdUsage now exibe contexto e binding runtime/sdk/hub', () => {
        const ctx = mockCtx();

        cmdUsage({ println: ctx.println }, 'now');

        expect(ctx.output()).toContain('Janela de contexto');
        expect(ctx.output()).not.toContain('Context window');
        expect(ctx.output()).toContain('Vínculo');
        expect(ctx.output()).toContain('runtime, SDK e hub conectados');
        expect(ctx.output()).not.toContain('runtime-456789…');
        expect(ctx.output()).not.toContain('runtime-4567890123456789012345');
        expect(ctx.output()).toContain('/usage now detail');
        expect(ctx.output()).toContain('Modo');
        expect(ctx.output()).toContain('SDK interativo');
        expect(ctx.output()).not.toContain('interactive');
        expect(ctx.output()).toContain('gpt-5-mini');
        expect(ctx.output()).toMatch(/Telemetria PR|Histórico Copilot/);
        expect(ctx.output()).not.toContain('side-channel');
        expect(ctx.output()).toMatch(/não implica consumo neste boot\/sonda|BYOK atual separado/);
        expect(ctx.output()).not.toContain('Premium Request');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('cmdUsage now aceita runtimeId explícito', () => {
        const ctx = mockCtx();

        cmdUsage({ println: ctx.println }, 'now --runtime alt');

        expect(ctx.output()).toContain('Vínculo');
        expect(ctx.output()).toContain('runtime, SDK e hub conectados');
        expect(ctx.output()).toContain('SDK interativo');
        expect(ctx.output()).toContain('gpt-4.1-mini');
        expect(ctx.output()).not.toContain('interactive');
    });

    it('cmdUsage now detail preserva IDs completos', () => {
        const ctx = mockCtx();

        cmdUsage({ println: ctx.println }, 'now detail');

        expect(ctx.output()).toContain('runtime-4567890123456789012345');
        expect(ctx.output()).toContain('sdk-4567890123456789012345');
        expect(ctx.output()).toContain('hub-4567890123456789012345');
        expect(ctx.output()).not.toContain('/usage now detail para IDs completos');
    });

    it('cmdUsage now destaca continuação pós ask_user quando a telemetria LLM indica user_input', () => {
        const previous = defaultRuntime.lastLlmUsage;
        defaultRuntime.lastLlmUsage = {
            model: 'kilo-auto/free',
            effectiveModel: 'kilo-auto/free',
            cost: 0,
            classification: 'ask_user_continuation',
            premiumRequest: false,
            premiumRequestReason: 'user_input_completed_continuation',
            ts: Date.now(),
        };
        try {
            const ctx = mockCtx();

            cmdUsage({ println: ctx.println }, 'now');

            expect(ctx.output()).toContain('Telemetria LLM');
            expect(ctx.output()).toContain('Tipo');
            expect(ctx.output()).not.toContain('tipo=');
            expect(ctx.output()).toContain('Pedido');
            expect(ctx.output()).toContain('sem pedido premium');
            expect(ctx.output()).not.toContain('Request');
            expect(ctx.output()).not.toContain('Premium Request');
            expect(ctx.output()).toContain('continuação da pergunta humana');
            expect(ctx.output()).not.toContain('ask_user_continuation');
            expect(ctx.output()).not.toContain(
                'Telemetria LLM modelo kilo-auto/free · sem Premium Request · tipo continuação da pergunta humana',
            );
            expect(ctx.output()).toContain('Pergunta humana');
            expect(ctx.output()).toContain('Correlacionar');
            expect(ctx.output()).toContain('/events event=assistant.message');
            expect(ctx.output()).toContain('/export');
            expect(ctx.output()).not.toContain('\x1b[');
        } finally {
            defaultRuntime.lastLlmUsage = previous;
        }
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

            expect(metricsCtx.output()).toContain('divergente');
            expect(metricsCtx.output()).toContain('configurado gpt-5');
            expect(metricsCtx.output()).toContain('cobrado gpt-5-mini');
            expect(usageCtx.output()).toContain('configurado');
            expect(usageCtx.output()).toContain('gpt-5');
            expect(usageCtx.output()).toContain('cobrado');
            expect(usageCtx.output()).toContain('gpt-5-mini');
            expect(usageCtx.output()).not.toContain('cfg=');
            expect(usageCtx.output()).not.toContain('cobrado=');
        } finally {
            defaultRuntime.lastPrInfo = previous;
        }
    });
});
