// @ts-check

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const stopDialogMode = vi.fn(async () => {});
const startDialogMode = vi.fn(async () => {});
const dialogTurn = vi.fn(async () => 'ok');
/** @type {{ role: string; content: string; timestamp?: number }[]} */
const liveHistory = [{ role: 'user', content: 'oi' }];
const clearHistory = vi.fn(() => {
    liveHistory.length = 0;
});
const pauseDialogLoop = vi.fn(async () => {});
const resumeDialogLoop = vi.fn(async () => {});
const stopDialogLoop = vi.fn(async () => {});
const pingDialogWatchdog = vi.fn();
const attachSocketIO = vi.fn();
const initHub = vi.fn(async () => {});
const notifyTerminalTurn = vi.fn();
const createHubSession = vi.fn(() => 'hub-1');
const getHubSession = vi.fn(() => ({ id: 'hub-1', title: 'Hub' }));
const getTurn = vi.fn(() => ({ turn_number: 7 }));
/** @type {Record<string, unknown>[]} */
const persistedTurns = [];
const countTurns = vi.fn(() => persistedTurns.length);
const readTurns = vi.fn(
    (/** @type {string} */ _hubSessionId, /** @type {{ limit?: number; offset?: number }} */ opts = {}) => {
        const limit = typeof opts.limit === 'number' ? opts.limit : 20;
        const offset = typeof opts.offset === 'number' ? opts.offset : 0;
        return persistedTurns.slice(offset, offset + limit);
    },
);
const writeTurn = vi.fn(
    async (
        /** @type {string} */ _hubSessionId,
        /** @type {{ role?: string; content?: string; metadata?: object | null; sdkSessionId?: string | null }} */ opts = {},
    ) => {
        persistedTurns.push({
            id: 40 + persistedTurns.length,
            role: opts.role ?? 'user',
            content: opts.content ?? '',
            created_at: Date.now() + persistedTurns.length,
            metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
            sdk_session_id: opts.sdkSessionId ?? null,
        });
        return 42;
    },
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

const defaultRuntime = /** @type {any} */ ({
    model: 'gpt-5',
    reasoningEffort: 'high',
    status: 'idle',
    sessionId: 'sdk-live',
    dialogLoopActive: true,
    dialogPaused: false,
    queueSize: 3,
    pendingQuestion: {
        question: 'seguir?',
        choices: ['sim', 'não'],
        kind: 'question',
        allowFreeform: true,
        askedAt: 1,
        protocolControlled: false,
    },
    pendingQuestionShadow: {
        question: 'READY: aguardando próxima mensagem',
        meta: { kind: 'ready', askedAt: 1, allowFreeform: true, protocolControlled: true },
        restoredAt: 2,
        expiresAt: 3,
    },
    pendingQuestionShadowState: 'expired',
    pendingQuestionShadowExpired: true,
    pendingQuestionShadowAgeMs: 1200,
    pendingQuestionShadowExpiresAt: 3,
    pendingQuestionShadowRemainingMs: 0,
    lastPrInfo: { model: 'gpt-5', cost: 0.1234, ts: 10 },
    pauseDialogLoop,
    resumeDialogLoop,
    stopDialogLoop,
    pingDialogWatchdog,
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
    getHandoffManager: () => ({ getHistory: () => [{ fromAgent: 'llm-a', toAgent: 'llm-b', status: 'done' }] }),
    getStatusSnapshot: () => ({
        contextWindow: { tokens: 32000, tokenLimit: 128000, utilization: 0.25 },
    }),
});

const altRuntime = /** @type {any} */ ({
    model: 'gpt-5-mini',
    reasoningEffort: 'medium',
    status: 'processing',
    sessionId: 'sdk-alt',
    dialogLoopActive: false,
    dialogPaused: true,
    queueSize: 1,
    pendingQuestion: null,
    pendingQuestionShadow: null,
    pendingQuestionShadowState: null,
    pendingQuestionShadowExpired: false,
    pendingQuestionShadowAgeMs: null,
    pendingQuestionShadowExpiresAt: null,
    pendingQuestionShadowRemainingMs: null,
    lastPrInfo: { model: 'gpt-5-mini', cost: 0.02, ts: 20 },
    pauseDialogLoop: vi.fn(async () => {}),
    resumeDialogLoop: vi.fn(async () => {}),
    stopDialogLoop: vi.fn(async () => {}),
    pingDialogWatchdog: vi.fn(),
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
    getHandoffManager: () => ({ getHistory: () => [{ fromAgent: 'llm-a', toAgent: 'llm-b', status: 'queued' }] }),
    getStatusSnapshot: () => ({
        contextWindow: { tokens: 12000, tokenLimit: 64000, utilization: 0.18 },
    }),
});
vi.mock('#copilot/agent', () => ({
    getAgent: () => defaultRuntime,
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (/** @type {string | null | undefined} */ runtimeId = 'default') => {
        if (runtimeId === 'alt') return altRuntime;
        return runtimeId === 'default' ? defaultRuntime : null;
    },
    listAgentRuntimes: () => [
        { runtimeId: 'default', runtime: defaultRuntime },
        { runtimeId: 'alt', runtime: altRuntime },
    ],
    readAgentRuntimeStatusSnapshot: (/** @type {any} */ runtime) => runtime.getStatusSnapshot(),
    readAgentRuntimeHealthSnapshot: (/** @type {any} */ runtime) => ({ ok: true, status: 'healthy' }),
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
    pauseRuntimeDialogLoop: (/** @type {any} */ runtime) => runtime.pauseDialogLoop(),
    resumeRuntimeDialogLoop: (/** @type {any} */ runtime) => runtime.resumeDialogLoop(),
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
    getRuntimeHandoffManager: (/** @type {any} */ runtime) => runtime.getHandoffManager(),
    getRuntimeHandoffHistory: (/** @type {any} */ runtime) => runtime.getHandoffManager().getHistory(),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    stopAgentDialogLoopAuthorized: vi.fn(
        async (/** @type {any} */ runtime, /** @type {string | undefined} */ reason) => {
            await runtime.stopDialogLoop({ authorized: true, reason: reason ?? 'authorized_stop' });
        },
    ),
}));

vi.mock('#copilot/channel', () => ({
    llmBridgeClient: {
        turnCount: 12,
        history: liveHistory,
        clearHistory,
        stopDialogMode,
        startDialogMode,
        dialogTurn,
    },
}));

vi.mock('#copilot/conversation-hub', () => ({
    conversationHub: {
        isReady: true,
        init: initHub,
        attachSocketIO,
        notifyTerminalTurn,
        orchestrator: { kind: 'orchestrator' },
    },
    conversationStore: {
        createHubSession,
        getHubSession,
        getTurn,
        readTurns,
        countTurns,
        writeTurn,
    },
}));

/** @type {typeof import('../../../src/copilot/terminal/frontend/index.js')} */
let runtime;
/** @type {typeof import('../../../src/copilot/core/shared-state.js')} */
let sharedState;

beforeAll(async () => {
    runtime = await import('../../../src/copilot/terminal/frontend/index.js');
    sharedState = await import('../../../src/copilot/core/shared-state.js');
});

beforeEach(() => {
    liveHistory.length = 0;
    liveHistory.push({ role: 'user', content: 'oi' });
    persistedTurns.length = 0;
    readTurns.mockClear();
    countTurns.mockClear();
    writeTurn.mockClear();
    clearHistory.mockClear();
    sharedState.clearSharedSessionBinding();
});

describe('terminal/frontend/index', () => {
    it('projeta o estado canônico do runtime do terminal', () => {
        const state = runtime.readTerminalRuntimeState();

        expect(state.runtimeId).toBe('default');
        expect(state.model).toBe('gpt-5');
        expect(state.reasoningEffort).toBe('high');
        expect(state.dialogLoopActive).toBe(true);
        expect(state.queueSize).toBe(3);
        expect(state.pendingQuestion?.question).toBe('seguir?');
        expect(state.pendingQuestionKind).toBe('question');
        expect(state.pendingQuestionShadowKind).toBe('ready');
        expect(state.pendingQuestionShadowState).toBe('expired');
        expect(state.pendingQuestionShadowExpired).toBe(true);
        expect(state.pendingQuestionShadowAgeMs).toBe(1200);
        expect(state.pendingQuestionShadowExpiresAt).toBe(3);
        expect(state.pendingQuestionShadowRemainingMs).toBe(0);
        expect(state.contextWindow).toEqual({ tokens: 32000, tokenLimit: 128000, utilization: 0.25 });
        expect(state.lastPrInfo).toEqual({ model: 'gpt-5', cost: 0.1234, ts: 10 });
    });

    it('lê runtime explícito sem quebrar o caminho default', () => {
        const state = runtime.readTerminalRuntimeState('alt');

        expect(state.runtimeId).toBe('alt');
        expect(state.model).toBe('gpt-5-mini');
        expect(state.reasoningEffort).toBe('medium');
        expect(state.sessionId).toBe('sdk-alt');
        expect(state.contextWindow).toEqual({ tokens: 12000, tokenLimit: 64000, utilization: 0.18 });
        expect(runtime.readTerminalHandoffHistory('alt')).toHaveLength(1);
    });

    it('encapsula operações de dialog mode e histórico pela timeline canônica', async () => {
        await runtime.startTerminalDialogMode('boot', { onReady: vi.fn() });
        await runtime.runTerminalDialogTurn('mensagem', { timeout: 1000, onDelta: vi.fn() });
        await runtime.stopTerminalDialogMode();
        const timelineBeforeClear = runtime.readTerminalTimelineProjection();
        runtime.clearTerminalHistory();
        const timelineAfterClear = runtime.readTerminalTimelineProjection();

        expect(startDialogMode).toHaveBeenCalled();
        expect(dialogTurn).toHaveBeenCalled();
        expect(stopDialogMode).toHaveBeenCalled();
        expect(clearHistory).toHaveBeenCalled();
        expect(timelineBeforeClear.timelineSource).toBe('bridge');
        expect(timelineBeforeClear.turns).toHaveLength(1);
        expect(timelineAfterClear.timelineSource).toBe('empty');
        expect(timelineAfterClear.turns).toHaveLength(0);
    });

    it('sincroniza lazy timeline bridge_only para o Hub sem criar pending user espúrio', async () => {
        sharedState.setSharedHubSessionId('hub-sync-bridge-only');
        sharedState.setSharedSdkSessionId('sdk-sync-bridge-only');
        liveHistory.length = 0;
        liveHistory.push(
            { role: 'user', content: 'pergunta viva', timestamp: 1710000000000 },
            { role: 'assistant', content: 'resposta viva', timestamp: 1710000001000 },
        );

        const timeline = runtime.readTerminalTimelineProjection({ limitPairs: 5 });
        await new Promise((resolve) => setImmediate(resolve));

        expect(timeline.reconciliationStatus).toBe('bridge_only');
        expect(timeline.sync.status).toBe('scheduled');
        expect(timeline.sync.pendingCount).toBe(2);
        expect(runtime.readTerminalTimelineSyncTelemetry()).toEqual(
            expect.objectContaining({
                scheduledTotal: expect.any(Number),
                turnsSyncedTotal: expect.any(Number),
                completedCacheSize: expect.any(Number),
            }),
        );
        expect(writeTurn).toHaveBeenCalledWith(
            'hub-sync-bridge-only',
            expect.objectContaining({
                role: 'llm_a',
                content: 'pergunta viva',
                sdkSessionId: 'sdk-sync-bridge-only',
                metadata: expect.objectContaining({
                    source: 'terminal.timeline_sync',
                    originalOrigin: 'bridge',
                    originalRole: 'user',
                }),
            }),
        );
        expect(writeTurn).toHaveBeenCalledWith(
            'hub-sync-bridge-only',
            expect.objectContaining({
                role: 'llm_b',
                content: 'resposta viva',
                sdkSessionId: 'sdk-sync-bridge-only',
                metadata: expect.objectContaining({
                    source: 'terminal.timeline_sync',
                    originalOrigin: 'bridge',
                    originalRole: 'assistant',
                }),
            }),
        );
    });

    it('retenta falha transitória do sync lazy e expõe telemetria', async () => {
        sharedState.setSharedHubSessionId('hub-sync-retry');
        sharedState.setSharedSdkSessionId('sdk-sync-retry');
        liveHistory.length = 0;
        liveHistory.push({ role: 'assistant', content: 'turno com retry', timestamp: 1710000002000 });
        writeTurn.mockImplementationOnce(async () => {
            throw new Error('transient hub failure');
        });

        const timeline = runtime.readTerminalTimelineProjection({ limitPairs: 5 });
        await new Promise((resolve) => setTimeout(resolve, 30));
        const telemetry = runtime.readTerminalTimelineSyncTelemetry();

        expect(timeline.sync.status).toBe('scheduled');
        expect(writeTurn).toHaveBeenCalledTimes(2);
        expect(telemetry.retryTotal).toBeGreaterThanOrEqual(1);
        expect(telemetry.turnsSyncedTotal).toBeGreaterThanOrEqual(1);
        expect(telemetry.lastError).toBeNull();
    });

    it('encapsula operações do agente e do hub', async () => {
        await runtime.pauseTerminalDialogLoop();
        await runtime.resumeTerminalDialogLoop();
        runtime.pingTerminalDialogWatchdog();
        await runtime.stopTerminalAgentRuntime();
        await runtime.initTerminalConversationHub();
        const hubId = runtime.createTerminalHubSession({ title: 'Terminal' });
        const turnId = await runtime.writeTerminalHubSystemTurn('hub-1', '[SISTEMA] ok');
        runtime.notifyTerminalHubTurn(
            'hub-1',
            { turnId: 1, role: 'user', content: 'olá', turnNumber: 1 },
            { turnId: 2, content: 'oi', turnNumber: 2, durationMs: 16 },
        );
        runtime.attachTerminalHubSocketIO(/** @type {any} */ ({ id: 'io' }));

        expect(runtime.readTerminalHandoffHistory()).toHaveLength(1);
        expect(runtime.readTerminalDialogStreamMeta()).toEqual({ model: 'gpt-5', reasoningEffort: 'high' });
        expect(runtime.isTerminalHubReady()).toBe(true);
        expect(runtime.readTerminalHubOrchestrator()).toEqual({ kind: 'orchestrator' });
        expect(runtime.readTerminalHubStore()).toBeTruthy();
        expect(runtime.readTerminalHubSession('hub-1')?.id).toBe('hub-1');
        expect(runtime.readTerminalHubTurn(42)?.turn_number).toBe(7);
        expect(hubId).toBe('hub-1');
        expect(turnId).toBe(42);
        expect(pauseDialogLoop).toHaveBeenCalled();
        expect(resumeDialogLoop).toHaveBeenCalled();
        expect(pingDialogWatchdog).toHaveBeenCalled();
        expect(stopDialogLoop).toHaveBeenCalledWith({ authorized: true, reason: 'authorized_stop' });
        expect(initHub).toHaveBeenCalled();
        expect(attachSocketIO).toHaveBeenCalled();
        expect(notifyTerminalTurn).toHaveBeenCalled();
    });

    it('encapsula mode/plan vanilla da sessão SDK por runtime explícito', async () => {
        expect(await runtime.getTerminalSdkSessionMode('alt')).toEqual({ mode: 'plan' });
        expect(await runtime.setTerminalSdkSessionMode('autopilot', 'alt')).toEqual({ mode: 'autopilot' });
        expect(await runtime.readTerminalSdkPlan('alt')).toEqual({ path: '/tmp/alt-plan.md', content: 'alt plan' });
        await runtime.updateTerminalSdkPlan('novo plano', 'alt');
        await runtime.deleteTerminalSdkPlan('alt');

        expect(altSetSdkSessionMode).toHaveBeenCalledWith('autopilot');
        expect(altUpdateSdkPlan).toHaveBeenCalledWith('novo plano');
        expect(altDeleteSdkPlan).toHaveBeenCalled();
    });
});
