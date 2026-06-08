// @ts-check

import { beforeAll, describe, expect, it, vi } from 'vitest';

const clearPendingQuestionShadow = vi.fn(() => true);
const altClearPendingQuestionShadow = vi.fn(() => true);
const startAgentDialogLoop = vi.fn(async (/** @type {any} */ runtime, /** @type {string | undefined} */ bootPrompt) => {
    await runtime.startDialogLoop(bootPrompt);
});
const sendAgentDialogTurn = vi.fn(
    async (
        /** @type {any} */ _runtime,
        /** @type {string} */ _message,
        /** @type {number | null | undefined} */ _timeout,
    ) => 'Resumo final',
);
const defaultGetSdkSessionMode = vi.fn(async () => ({ mode: 'interactive' }));
const defaultSetSdkSessionMode = vi.fn(async (/** @type {any} */ mode) => ({ mode }));
const defaultGetSdkSessionCapabilities = vi.fn(() => ({ ui: { elicitation: true } }));
const defaultIsSdkSessionUiElicitationAvailable = vi.fn(() => true);
const defaultConfirmSdkSessionUi = vi.fn(async () => true);
const defaultSelectSdkSessionUi = vi.fn(async (_message, options) => options[0] ?? null);
const defaultInputSdkSessionUi = vi.fn(async (message) => `${message}:default`);
const defaultReadSdkPlan = vi.fn(async () => ({ path: '/tmp/default-plan.md', content: 'default plan' }));
const defaultUpdateSdkPlan = vi.fn(async () => ({ ok: true }));
const defaultDeleteSdkPlan = vi.fn(async () => ({ ok: true }));
const altGetSdkSessionMode = vi.fn(async () => ({ mode: 'plan' }));
const altSetSdkSessionMode = vi.fn(async (/** @type {any} */ mode) => ({ mode }));
const altGetSdkSessionCapabilities = vi.fn(() => ({ ui: { elicitation: false } }));
const altIsSdkSessionUiElicitationAvailable = vi.fn(() => false);
const altConfirmSdkSessionUi = vi.fn(async () => false);
const altSelectSdkSessionUi = vi.fn(async (_message, options) => options.at(-1) ?? null);
const altInputSdkSessionUi = vi.fn(async (message) => `${message}:alt`);
const altReadSdkPlan = vi.fn(async () => ({ path: '/tmp/alt-plan.md', content: 'alt plan' }));
const altUpdateSdkPlan = vi.fn(async () => ({ ok: true }));
const altDeleteSdkPlan = vi.fn(async () => ({ ok: true }));

/**
 * @param {string | null | undefined} runtimeId
 * @returns {any}
 */
function selectMockRuntime(runtimeId) {
    if (runtimeId === 'alt') return altRuntime;
    return runtimeId === 'default' || runtimeId == null ? defaultRuntime : null;
}

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
    getSdkSessionCapabilities: defaultGetSdkSessionCapabilities,
    isSdkSessionUiElicitationAvailable: defaultIsSdkSessionUiElicitationAvailable,
    confirmSdkSessionUi: defaultConfirmSdkSessionUi,
    selectSdkSessionUi: defaultSelectSdkSessionUi,
    inputSdkSessionUi: defaultInputSdkSessionUi,
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
        systemPromptBinding: { digest: 'bound-default' },
        systemPromptFreshness: { isStale: false, reason: 'binding ok', recommendedAction: 'none' },
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
    getSdkSessionCapabilities: altGetSdkSessionCapabilities,
    isSdkSessionUiElicitationAvailable: altIsSdkSessionUiElicitationAvailable,
    confirmSdkSessionUi: altConfirmSdkSessionUi,
    selectSdkSessionUi: altSelectSdkSessionUi,
    inputSdkSessionUi: altInputSdkSessionUi,
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
        systemPromptBinding: { digest: 'bound-alt' },
        systemPromptFreshness: {
            isStale: true,
            reason: 'snapshot estático defasado',
            recommendedAction: 'resume-session',
        },
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
        status: runtime.getStatusSnapshot?.().status ?? runtime.status,
        model: runtime.getStatusSnapshot?.().model ?? runtime.model,
        reasoningEffort: runtime.getStatusSnapshot?.().reasoningEffort ?? runtime.reasoningEffort ?? 'off',
        sessionId: runtime.sessionId ?? runtime.getStatusSnapshot?.().sessionId ?? null,
        dialogLoopActive: Boolean(runtime.dialogLoopActive),
        dialogPaused: Boolean(runtime.getStatusSnapshot?.().dialogPaused ?? runtime.dialogPaused),
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
    readRuntimeAutoModelPolicy: (/** @type {any} */ runtime) => ({
        configuredModel: runtime.model,
        observedModel: runtime.lastPrInfo?.effectiveModel ?? runtime.lastPrInfo?.model ?? null,
        selectionAuthority: 'github-copilot',
        canForcePreference: false,
    }),
    setRuntimeModel: (/** @type {any} */ runtime, /** @type {string} */ modelId) => runtime.setModel(modelId),
    setRuntimeReasoningEffort: (/** @type {any} */ runtime, /** @type {any} */ effort) =>
        runtime.setReasoningEffort(effort),
    answerRuntimePendingQuestion: (/** @type {any} */ runtime, /** @type {string} */ answer) =>
        runtime.answerPendingQuestion(answer),
    clearRuntimePendingQuestionShadow: (/** @type {any} */ runtime) => runtime.clearPendingQuestionShadow(),
    readAgentSdkSessionMode: (/** @type {any} */ runtime) => runtime.getSdkSessionMode(),
    setAgentSdkSessionMode: (/** @type {any} */ runtime, /** @type {any} */ mode) => runtime.setSdkSessionMode(mode),
    getSdkSessionCapabilities: (/** @type {any} */ runtime) => runtime.getSdkSessionCapabilities(),
    isSdkSessionUiElicitationAvailable: (/** @type {any} */ runtime) => runtime.isSdkSessionUiElicitationAvailable(),
    confirmSdkSessionUi: (/** @type {any} */ runtime, /** @type {string} */ message) =>
        runtime.confirmSdkSessionUi(message),
    selectSdkSessionUi: (/** @type {any} */ runtime, /** @type {string} */ message, /** @type {string[]} */ options) =>
        runtime.selectSdkSessionUi(message, options),
    inputSdkSessionUi: (/** @type {any} */ runtime, /** @type {string} */ message, /** @type {any} */ options) =>
        runtime.inputSdkSessionUi(message, options),
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

vi.mock('#copilot/runtime', () => ({
    abortAgentRuntimeCurrentMessage: vi.fn(async () => undefined),
    answerAgentPendingQuestion: (/** @type {string} */ answer, /** @type {string | null | undefined} */ runtimeId) =>
        (selectMockRuntime(runtimeId) ?? defaultRuntime).answerPendingQuestion(answer),
    clearAgentPendingQuestionShadow: (/** @type {string | null | undefined} */ runtimeId) =>
        (selectMockRuntime(runtimeId) ?? defaultRuntime).clearPendingQuestionShadow(),
    createAgentRuntimeSnapshot: vi.fn((/** @type {Record<string, unknown>} */ data) => ({
        snapshotId: 'snap-1',
        createdAt: 1,
        ...data,
    })),
    listAgentRuntimeSnapshots: vi.fn(async () => [
        { snapshotId: 'snap-1', createdAt: 1, model: 'gpt-5', reason: 'manual' },
    ]),
    loadAgentRuntimeSnapshot: vi.fn(async (/** @type {string} */ id) =>
        id === 'snap-1' ? { snapshotId: 'snap-1', createdAt: 1, model: 'gpt-5', status: 'idle', sendCount: 1 } : null,
    ),
    offAgentRuntimeEvent: vi.fn(),
    onAgentRuntimeEvent: vi.fn(),
    onceAgentRuntimeEvent: vi.fn(),
    pauseAgentDialogLoop: vi.fn(async () => undefined),
    pingDefaultAgentDialogWatchdog: vi.fn(),
    readAgentHandoffHistory: (/** @type {string | null | undefined} */ runtimeId) => [
        { runtimeId: (selectMockRuntime(runtimeId) ?? defaultRuntime) === altRuntime ? 'alt' : 'default' },
    ],
    readAgentRuntimeControlState: (/** @type {string | null | undefined} */ runtimeId) => {
        const runtime = selectMockRuntime(runtimeId);
        if (!runtime) throw new Error(`Runtime '${runtimeId}' não encontrado.`);
        const snap = runtime.getStatusSnapshot();
        return {
            status: snap.status,
            model: snap.model,
            reasoningEffort: snap.reasoningEffort,
            sessionId: runtime.sessionId ?? null,
            dialogLoopActive: Boolean(runtime.dialogLoopActive),
            dialogPaused: Boolean(snap.dialogPaused),
            queueSize: Number(runtime.queueSize ?? 0),
        };
    },
    readAgentRuntimePermissionMode: vi.fn(() => 'selective'),
    resumeAgentDialogLoop: vi.fn(async () => undefined),
    saveAgentRuntimeSnapshot: vi.fn(async (_data) => '/tmp/snap-1.json'),
    setAgentRuntimePermissionMode: vi.fn((mode) => mode),
    startAgentRuntime: vi.fn(async () => undefined),
    steerAgentRuntimeMessage: vi.fn(async (prompt) => prompt),
    stopAgentRuntimeDialogLoopAuthorized: vi.fn(async () => undefined),
    readAgentRuntimeOverviewProjection: (/** @type {string | null | undefined} */ runtimeId) => {
        const runtime = selectMockRuntime(runtimeId);
        if (!runtime) {
            return {
                requestedRuntimeId: runtimeId ?? null,
                runtimeId: 'default',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
                agentProfileId: null,
                agentRuntimes: [
                    {
                        runtimeId: 'default',
                        status: defaultRuntime.getStatusSnapshot().status,
                        model: defaultRuntime.model,
                        sessionId: defaultRuntime.sessionId,
                        isDefault: true,
                        agentProfileId: null,
                    },
                    {
                        runtimeId: 'alt',
                        status: altRuntime.getStatusSnapshot().status,
                        model: altRuntime.model,
                        sessionId: altRuntime.sessionId,
                        isDefault: false,
                        agentProfileId: null,
                    },
                ],
                snap: defaultRuntime.getStatusSnapshot(),
                health: defaultRuntime.getHealthSnapshot(),
                runtimeSessionId: defaultRuntime.sessionId,
                contextWindow: defaultRuntime.getStatusSnapshot().contextState,
                model: defaultRuntime.model,
                reasoningEffort: defaultRuntime.reasoningEffort,
                status: defaultRuntime.getStatusSnapshot().status,
                sessionId: defaultRuntime.sessionId,
                dialogLoopActive: true,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: defaultRuntime.pendingQuestion,
                pendingQuestionKind: defaultRuntime.pendingQuestionKind,
                pendingQuestionShadow: defaultRuntime.pendingQuestionShadow,
                pendingQuestionShadowKind: defaultRuntime.pendingQuestionShadowKind,
                pendingQuestionShadowState: defaultRuntime.pendingQuestionShadowState,
                pendingQuestionShadowExpired: defaultRuntime.pendingQuestionShadowExpired,
                pendingQuestionShadowAgeMs: defaultRuntime.pendingQuestionShadowAgeMs,
                pendingQuestionShadowExpiresAt: defaultRuntime.pendingQuestionShadowExpiresAt,
                pendingQuestionShadowRemainingMs: defaultRuntime.pendingQuestionShadowRemainingMs,
                systemPromptBinding: defaultRuntime.getStatusSnapshot().systemPromptBinding,
                systemPromptFreshness: defaultRuntime.getStatusSnapshot().systemPromptFreshness,
                lastPrInfo: defaultRuntime.lastPrInfo,
                dialogPrMetrics: defaultRuntime.dialogPrMetrics,
            };
        }
        const snap = runtime.getStatusSnapshot();
        return {
            requestedRuntimeId: runtimeId ?? null,
            runtimeId: runtime === altRuntime ? 'alt' : 'default',
            runtimeFound: true,
            usedDefaultRuntimeFallback: false,
            agentProfileId: null,
            agentRuntimes: [
                {
                    runtimeId: 'default',
                    status: defaultRuntime.getStatusSnapshot().status,
                    model: defaultRuntime.model,
                    sessionId: defaultRuntime.sessionId,
                    isDefault: true,
                    agentProfileId: null,
                },
                {
                    runtimeId: 'alt',
                    status: altRuntime.getStatusSnapshot().status,
                    model: altRuntime.model,
                    sessionId: altRuntime.sessionId,
                    isDefault: false,
                    agentProfileId: null,
                },
            ],
            snap,
            health: runtime.getHealthSnapshot(),
            runtimeSessionId: runtime.sessionId,
            contextWindow: snap.contextState,
            model: runtime.model,
            reasoningEffort: runtime.reasoningEffort,
            status: snap.status,
            sessionId: runtime.sessionId,
            dialogLoopActive: Boolean(runtime.dialogLoopActive),
            dialogPaused: Boolean(snap.dialogPaused),
            queueSize: Number(runtime.queueSize ?? 0),
            pendingQuestion: runtime.pendingQuestion,
            pendingQuestionKind: runtime.pendingQuestionKind,
            pendingQuestionShadow: runtime.pendingQuestionShadow,
            pendingQuestionShadowKind: runtime.pendingQuestionShadowKind,
            pendingQuestionShadowState: runtime.pendingQuestionShadowState,
            pendingQuestionShadowExpired: runtime.pendingQuestionShadowExpired,
            pendingQuestionShadowAgeMs: runtime.pendingQuestionShadowAgeMs,
            pendingQuestionShadowExpiresAt: runtime.pendingQuestionShadowExpiresAt,
            pendingQuestionShadowRemainingMs: runtime.pendingQuestionShadowRemainingMs,
            systemPromptBinding: snap.systemPromptBinding,
            systemPromptFreshness: snap.systemPromptFreshness,
            lastPrInfo: runtime.lastPrInfo,
            dialogPrMetrics: runtime.dialogPrMetrics,
        };
    },
}));

vi.mock('../../../src/copilot/presentation/runtime/index.js', () => ({
    readAgentRuntimeOverviewProjection: (/** @type {string | null | undefined} */ runtimeId) => {
        const runtime = selectMockRuntime(runtimeId);
        if (!runtime) {
            return {
                requestedRuntimeId: runtimeId ?? null,
                runtimeId: 'default',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
                agentProfileId: null,
                agentRuntimes: [
                    {
                        runtimeId: 'default',
                        status: 'waiting_for_input',
                        model: 'gpt-5',
                        sessionId: 'runtime-123',
                        isDefault: true,
                        agentProfileId: null,
                    },
                    {
                        runtimeId: 'alt',
                        status: 'processing',
                        model: 'gpt-5-mini',
                        sessionId: 'runtime-alt',
                        isDefault: false,
                        agentProfileId: null,
                    },
                ],
                snap: defaultRuntime.getStatusSnapshot(),
                health: defaultRuntime.getHealthSnapshot(),
                runtimeSessionId: defaultRuntime.sessionId,
                contextWindow: defaultRuntime.getStatusSnapshot().contextState,
                model: defaultRuntime.model,
                reasoningEffort: defaultRuntime.reasoningEffort,
                status: defaultRuntime.getStatusSnapshot().status,
                sessionId: defaultRuntime.sessionId,
                dialogLoopActive: true,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: defaultRuntime.pendingQuestion,
                pendingQuestionKind: defaultRuntime.pendingQuestionKind,
                pendingQuestionShadow: defaultRuntime.pendingQuestionShadow,
                pendingQuestionShadowKind: defaultRuntime.pendingQuestionShadowKind,
                pendingQuestionShadowState: defaultRuntime.pendingQuestionShadowState,
                pendingQuestionShadowExpired: defaultRuntime.pendingQuestionShadowExpired,
                pendingQuestionShadowAgeMs: defaultRuntime.pendingQuestionShadowAgeMs,
                pendingQuestionShadowExpiresAt: defaultRuntime.pendingQuestionShadowExpiresAt,
                pendingQuestionShadowRemainingMs: defaultRuntime.pendingQuestionShadowRemainingMs,
                systemPromptBinding: defaultRuntime.getStatusSnapshot().systemPromptBinding,
                systemPromptFreshness: defaultRuntime.getStatusSnapshot().systemPromptFreshness,
                lastPrInfo: defaultRuntime.lastPrInfo,
                dialogPrMetrics: defaultRuntime.dialogPrMetrics,
            };
        }
        const snap = runtime.getStatusSnapshot();
        return {
            requestedRuntimeId: runtimeId ?? null,
            runtimeId: runtime === altRuntime ? 'alt' : 'default',
            runtimeFound: true,
            usedDefaultRuntimeFallback: false,
            agentProfileId: null,
            agentRuntimes: [
                {
                    runtimeId: 'default',
                    status: 'waiting_for_input',
                    model: 'gpt-5',
                    sessionId: 'runtime-123',
                    isDefault: true,
                    agentProfileId: null,
                },
                {
                    runtimeId: 'alt',
                    status: 'processing',
                    model: 'gpt-5-mini',
                    sessionId: 'runtime-alt',
                    isDefault: false,
                    agentProfileId: null,
                },
            ],
            snap,
            health: runtime.getHealthSnapshot(),
            runtimeSessionId: runtime.sessionId,
            contextWindow: snap.contextState,
            model: runtime.model,
            reasoningEffort: runtime.reasoningEffort,
            status: snap.status,
            sessionId: runtime.sessionId,
            dialogLoopActive: Boolean(runtime.dialogLoopActive),
            dialogPaused: Boolean(snap.dialogPaused),
            queueSize: Number(runtime.queueSize ?? 0),
            pendingQuestion: runtime.pendingQuestion,
            pendingQuestionKind: runtime.pendingQuestionKind,
            pendingQuestionShadow: runtime.pendingQuestionShadow,
            pendingQuestionShadowKind: runtime.pendingQuestionShadowKind,
            pendingQuestionShadowState: runtime.pendingQuestionShadowState,
            pendingQuestionShadowExpired: runtime.pendingQuestionShadowExpired,
            pendingQuestionShadowAgeMs: runtime.pendingQuestionShadowAgeMs,
            pendingQuestionShadowExpiresAt: runtime.pendingQuestionShadowExpiresAt,
            pendingQuestionShadowRemainingMs: runtime.pendingQuestionShadowRemainingMs,
            systemPromptBinding: snap.systemPromptBinding,
            systemPromptFreshness: snap.systemPromptFreshness,
            lastPrInfo: runtime.lastPrInfo,
            dialogPrMetrics: runtime.dialogPrMetrics,
        };
    },
    normalizeAgentContextWindowProjection: (/** @type {unknown} */ raw) => raw ?? null,
    readRuntimeLifecycleSnapshot: vi.fn(() => ({ shuttingDown: false, registeredShutdownHandlers: 2 })),
    buildRuntimeLifecycleSummary: vi.fn((snapshot) => snapshot),
    listActiveRuntimeTodosProjection: vi.fn(async () => [
        { id: 'todo-1', title: 'Revisar fronteiras', status: 'todo' },
        { id: 'todo-2', title: 'Validar contratos', status: 'in_progress' },
    ]),
    listRuntimeAvailableModelsProjection: vi.fn(async (runtimeId) => ({
        currentModel: (selectMockRuntime(runtimeId) ?? defaultRuntime).model,
        models: [{ id: 'gpt-5', capabilities: { supports: { reasoningEffort: true, vision: true } } }],
    })),
    readRuntimeAutoModelPolicyProjection: vi.fn((runtimeId) => ({
        configuredModel: (selectMockRuntime(runtimeId) ?? defaultRuntime).model,
        observedModel: null,
        selectionAuthority: 'github-copilot',
        canForcePreference: false,
    })),
    readRuntimeModelMetadata: vi.fn((modelId) => modelMeta.get(modelId) ?? null),
    readRuntimeModelStatsProjection: vi.fn(() => ({
        stats: [{ modelId: 'gpt-5', totalCalls: 2, avgLatencyMs: 44, successRate: 1, totalTokens: 200 }],
    })),
    setRuntimeModelProjection: vi.fn((modelId, runtimeId) => {
        const runtime = selectMockRuntime(runtimeId) ?? defaultRuntime;
        const previousModel = runtime.model;
        const previousReasoningEffort = runtime.reasoningEffort;
        const nextModelMeta = modelMeta.get(modelId) ?? null;
        runtime.setModel(modelId);
        runtime.model = modelId;
        let reasoningAdjusted = false;
        if (nextModelMeta?.supportsReasoning === false && previousReasoningEffort !== undefined) {
            runtime.setReasoningEffort(undefined);
            runtime.reasoningEffort = undefined;
            reasoningAdjusted = true;
        }
        return {
            previousModel,
            previousReasoningEffort,
            currentModel: modelId,
            currentReasoningEffort: reasoningAdjusted ? 'off' : runtime.reasoningEffort,
            reasoningAdjusted,
            modelMeta: nextModelMeta,
            runtimeId: runtime === altRuntime ? 'alt' : 'default',
        };
    }),
    setRuntimeReasoningProjection: vi.fn((effort, runtimeId) => {
        const runtime = selectMockRuntime(runtimeId) ?? defaultRuntime;
        const previousReasoningEffort = runtime.reasoningEffort;
        runtime.setReasoningEffort(effort);
        runtime.reasoningEffort = effort;
        return {
            previousReasoningEffort,
            currentReasoningEffort: effort,
            runtimeId: runtime === altRuntime ? 'alt' : 'default',
        };
    }),
    getAgentSdkSessionMode: vi.fn(async (/** @type {string | null | undefined} */ runtimeId) =>
        (selectMockRuntime(runtimeId) ?? defaultRuntime).getSdkSessionMode(),
    ),
    setAgentSdkSessionMode: vi.fn(async (/** @type {any} */ mode, /** @type {string | null | undefined} */ runtimeId) =>
        (selectMockRuntime(runtimeId) ?? defaultRuntime).setSdkSessionMode(mode),
    ),
    getAgentSdkSessionCapabilities: vi.fn(async (/** @type {string | null | undefined} */ runtimeId) =>
        (selectMockRuntime(runtimeId) ?? defaultRuntime).getSdkSessionCapabilities(),
    ),
    isAgentSdkSessionUiElicitationAvailable: vi.fn(async (/** @type {string | null | undefined} */ runtimeId) =>
        (selectMockRuntime(runtimeId) ?? defaultRuntime).isSdkSessionUiElicitationAvailable(),
    ),
    confirmAgentSdkSessionUi: vi.fn(
        async (/** @type {string} */ message, /** @type {string | null | undefined} */ runtimeId) =>
            (selectMockRuntime(runtimeId) ?? defaultRuntime).confirmSdkSessionUi(message),
    ),
    selectAgentSdkSessionUi: vi.fn(
        async (
            /** @type {string} */ message,
            /** @type {string[]} */ options,
            /** @type {string | null | undefined} */ runtimeId,
        ) => (selectMockRuntime(runtimeId) ?? defaultRuntime).selectSdkSessionUi(message, options),
    ),
    inputAgentSdkSessionUi: vi.fn(
        async (
            /** @type {string} */ message,
            /** @type {any} */ options,
            /** @type {string | null | undefined} */ runtimeId,
        ) => (selectMockRuntime(runtimeId) ?? defaultRuntime).inputSdkSessionUi(message, options),
    ),
    readAgentSdkPlan: vi.fn(async (/** @type {string | null | undefined} */ runtimeId) =>
        (selectMockRuntime(runtimeId) ?? defaultRuntime).readSdkPlan(),
    ),
    updateAgentSdkPlan: vi.fn(
        async (/** @type {string} */ content, /** @type {string | null | undefined} */ runtimeId) =>
            (selectMockRuntime(runtimeId) ?? defaultRuntime).updateSdkPlan(content),
    ),
    deleteAgentSdkPlan: vi.fn(async (/** @type {string | null | undefined} */ runtimeId) =>
        (selectMockRuntime(runtimeId) ?? defaultRuntime).deleteSdkPlan(),
    ),
    compactAgentSdkSession: vi.fn(async (/** @type {string | null | undefined} */ runtimeId) => ({
        ok: true,
        runtimeId: runtimeId ?? 'default',
    })),
    sendRuntimeDialogTurnForRuntime: vi.fn(
        async (
            /** @type {string} */ message,
            /** @type {string} */ _from,
            /** @type {{ timeout?: number | null } | undefined} */ options,
            /** @type {string | null | undefined} */ runtimeId,
        ) => sendAgentDialogTurn(selectMockRuntime(runtimeId) ?? defaultRuntime, message, options?.timeout),
    ),
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

vi.mock('#copilot/observability', async (importOriginal) => ({
    .../** @type {any} */ (await importOriginal()),
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
    getPendingStructuredUserInputCount: vi.fn(() => 0),
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
    SYSTEM_MESSAGE_SECTIONS: {},
    SYSTEM_PROMPT_SECTIONS: {},
    loadCustomToolsAsync: vi.fn(async () => []),
    loadToolsConfigAsync: vi.fn(async () => ({ categories: [] })),
}));

vi.mock('#copilot/boot', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        getWorkspaceContext: () => ({ cwd: '/repo', gitRoot: '/repo', currentBranch: 'main' }),
        getWorkspaceContextAsync: async () => ({ cwd: '/repo', gitRoot: '/repo', currentBranch: 'main' }),
    };
});

vi.mock('../../../src/copilot/tools/todo/store.js', async (importOriginal) => ({
    ...(await importOriginal()),
    readStore: async () => ({
        tasks: {
            a1: { id: 'a1', title: 'Primeira task', status: 'todo' },
            a2: { id: 'a2', title: 'Segunda task', status: 'in_progress' },
        },
    }),
}));

/** @type {typeof import('../../../src/copilot/terminal/frontend/index.js')} */
let frontend;

beforeAll(async () => {
    frontend = await import('../../../src/copilot/terminal/frontend/index.js');
});

describe('terminal/frontend/index', () => {
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
                agentProfileId: null,
            },
            {
                runtimeId: 'alt',
                status: 'processing',
                model: 'gpt-5-mini',
                sessionId: 'runtime-alt',
                isDefault: false,
                agentProfileId: null,
            },
        ]);
        expect(projection.runtimeTopologyLabel).toBe('*default:gpt-5/waiting_for_input  •  -alt:gpt-5-mini/processing');
        expect(projection.modelBilling).toEqual(
            expect.objectContaining({
                billedModel: 'gpt-5',
                configuredModel: null,
                mismatch: false,
                cost: 0.1234,
                displayModel: 'gpt-5',
            }),
        );
        expect(projection.sdkSessionId).toBe('sdk-1');
        expect(projection.hubSessionId).toBe('hub-1');
        expect(projection.turnCount).toBe(4);
        expect(projection.bridgeTurnCount).toBe(2);
        expect(projection.workspace.currentBranch).toBe('main');
        expect(projection.pendingQuestionKind).toBe('question');
        expect(projection.pendingQuestionShadowExpired).toBe(true);
        expect(projection.pendingQuestionShadowState).toBe('expired');
        expect(projection.pendingQuestionShadowAgeMs).toBe(1200);
        expect(projection.pendingQuestionShadowRemainingMs).toBe(0);
        expect(projection.recommendedAction).toBe('clear_pending_question_shadow');
        expect(projection.systemPromptBinding).toEqual(expect.objectContaining({ digest: 'bound-default' }));
        expect(projection.systemPromptFreshness).toEqual(
            expect.objectContaining({ isStale: false, recommendedAction: 'none' }),
        );
        expect(projection.activity.label).toBeTruthy();
        expect(projection.lifecycle).toEqual(expect.objectContaining({ shuttingDown: expect.any(Boolean) }));
        expect(projection.lifecycleSummary).toEqual(
            expect.objectContaining({ registeredShutdownHandlers: expect.any(Number) }),
        );
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
        expect(status.systemPromptBinding).toEqual(expect.objectContaining({ digest: 'bound-alt' }));
        expect(status.systemPromptFreshness).toEqual(
            expect.objectContaining({ isStale: true, recommendedAction: 'resume-session' }),
        );
        expect(config.runtimeId).toBe('alt');
        expect(config.requestedRuntimeId).toBe('alt');
        expect(config.runtimeFound).toBe(true);
        expect(config.currentModel).toBe('gpt-5-mini');
        expect(context.usedTokens).toBe(8000);
        expect(context.maxTokens).toBe(64000);
        expect(context.timelineSource).toBe('mixed');
    });

    it('expõe timeline canônica reconciliada com divergência explícita entre hub e bridge vivo', () => {
        const timeline = frontend.readTerminalTimelineProjection();

        expect(timeline.timelineSource).toBe('mixed');
        expect(timeline.timelineAuthority).toBe('reconciled');
        expect(timeline.reconciliationStatus).toBe('diverged');
        expect(timeline.sync.status).toBe('blocked');
        expect(timeline.sync.reason).toBe('diverged-no-overlap');
        expect(timeline.turns.map((turn) => turn.content)).toEqual(['olá', 'oi', 'a', 'b']);
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
        expect(projection.systemPromptBinding).toEqual(expect.objectContaining({ digest: 'bound-default' }));
        expect(projection.systemPromptFreshness).toEqual(
            expect.objectContaining({ isStale: false, recommendedAction: 'none' }),
        );
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
        expect(config.sdkSessionMode).toBe('interactive');
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
        expect(context.timelineAuthority).toBe('reconciled');
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
