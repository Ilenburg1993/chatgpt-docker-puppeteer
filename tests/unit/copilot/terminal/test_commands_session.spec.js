// @ts-check
/**
 * tests/unit/copilot/terminal/test_commands_session.spec.js
 *
 * Testes para commands/session.js — comandos REPL de sessão (/status, /history, /who, etc). Usa mocks dos singletons;
 * testa saída via println mock.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const answerPendingQuestion = vi.fn((/** @type {string} */ _arg) => true);
const clearPendingQuestionShadow = vi.fn(() => true);
const listTerminalSdkSessionInventory = vi.fn(async () => ({
    currentSessionId: 'sdk-current',
    lastSessionId: 'sdk-last',
    foregroundSessionId: 'sdk-foreground',
    sessions: [
        {
            sessionId: 'sdk-current',
            startTime: new Date('2026-05-21T00:00:00.000Z'),
            modifiedTime: new Date('2026-05-21T00:01:00.000Z'),
            summary: 'sessão atual',
            isRemote: false,
        },
    ],
}));
const readTerminalSdkSessionBootSelection = vi.fn(async () => null);
const scheduleTerminalSdkSessionBootSelection = vi.fn(async () => ({ ok: true, data: {}, error: null }));
const deleteTerminalSdkSession = vi.fn(async () => undefined);
const readTerminalSseEventArchiveTail = vi.fn(async (/** @type {Record<string, unknown>} */ input = {}) => ({
    entries: [],
    state: {
        enabled: true,
        path: '/tmp/terminal-sse-events.jsonl',
        error: null,
        events: 0,
        bytes: 0,
        queueDepth: 0,
        flushScheduled: false,
        flushInFlight: false,
        failedEvents: 0,
        droppedEvents: 0,
        lastEventId: null,
    },
    filters: {
        limit: Number(input['limit'] ?? 20),
        event: typeof input['event'] === 'string' ? input['event'] : null,
        traceId: null,
        turnId: null,
        source: null,
        toolCallId: null,
        requestId: null,
        hubSessionId: null,
    },
}));

const defaultRuntime = /** @type {any} */ ({
    status: 'idle',
    model: 'gpt-5-mini',
    reasoningEffort: 'high',
    dialogLoopActive: false,
    sessionId: 'test-session-id',
    getHealthSnapshot: () => ({
        ok: true,
        healthy: true,
        status: 'healthy',
        issues: [],
        backgroundPendingCount: 0,
        recommendedAction: 'clear_pending_question_shadow',
    }),
    getStatusSnapshot: () => ({
        status: 'idle',
        model: 'gpt-5-mini',
        reasoningEffort: 'high',
        sendCount: 5,
        dialogPaused: false,
        pendingQuestion: null,
        contextWindow: 128000,
        systemPromptBinding: { digest: 'bound-default' },
        systemPromptFreshness: { isStale: false, reason: 'binding ok', recommendedAction: 'none' },
    }),
    dialogPrMetrics: null,
    answerPendingQuestion,
    clearPendingQuestionShadow,
    pendingQuestionShadowState: 'expired',
    pendingQuestionShadowExpired: true,
    pendingQuestionShadowRemainingMs: 0,
});

const altAnswerPendingQuestion = vi.fn((/** @type {string} */ _arg) => true);
const altClearPendingQuestionShadow = vi.fn(() => true);

const altRuntime = /** @type {any} */ ({
    status: 'waiting_for_input',
    model: 'gpt-4.1-mini',
    reasoningEffort: 'medium',
    dialogLoopActive: true,
    sessionId: 'alt-session-id',
    getHealthSnapshot: () => ({
        ok: true,
        healthy: true,
        status: 'degraded',
        issues: ['runtime.alt_waiting'],
        backgroundPendingCount: 1,
        recommendedAction: 'answer_pending_question',
    }),
    getStatusSnapshot: () => ({
        status: 'waiting_for_input',
        model: 'gpt-4.1-mini',
        reasoningEffort: 'medium',
        sendCount: 8,
        dialogPaused: false,
        pendingQuestion: 'Responder alt?',
        contextWindow: 64000,
        systemPromptBinding: { digest: 'bound-alt' },
        systemPromptFreshness: {
            isStale: true,
            reason: 'snapshot estático defasado',
            recommendedAction: 'resume-session',
        },
    }),
    dialogPrMetrics: null,
    answerPendingQuestion: altAnswerPendingQuestion,
    clearPendingQuestionShadow: altClearPendingQuestionShadow,
    pendingQuestionShadowState: null,
    pendingQuestionShadowExpired: false,
    pendingQuestionShadowRemainingMs: null,
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
function readMockRuntimeInteractionState(runtime) {
    return {
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
    alwaysAliveAgent: defaultRuntime,
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
    readRuntimeInteractionState: readMockRuntimeInteractionState,
    readRuntimePrBudgetSnapshot: readMockRuntimePrBudgetSnapshot,
    readRuntimeAutoModelPolicy: (/** @type {typeof defaultRuntime} */ runtime) => ({
        configuredModel: runtime.model,
        observedModel: runtime.lastPrInfo?.effectiveModel ?? runtime.lastPrInfo?.model ?? null,
        selectionAuthority: 'github-copilot',
        canForcePreference: false,
    }),
    answerRuntimePendingQuestion: (/** @type {typeof defaultRuntime} */ runtime, /** @type {string} */ answer) =>
        runtime.answerPendingQuestion?.(answer) ?? false,
    clearRuntimePendingQuestionShadow: (/** @type {typeof defaultRuntime} */ runtime) =>
        runtime.clearPendingQuestionShadow?.() ?? false,
    readSdkModelMetadata: () => null,
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    createRuntimeSnapshot: vi.fn((/** @type {Record<string, unknown>} */ data) => ({
        snapshotId: 'snap-001',
        createdAt: Date.now(),
        ...data,
    })),
    saveRuntimeSnapshot: vi.fn(async () => '/tmp/snap-001.json'),
    listRuntimeSnapshots: vi.fn(async () => [
        { snapshotId: 'snap-001', createdAt: Date.now(), model: 'gpt-5-mini', reason: 'manual' },
    ]),
    loadRuntimeSnapshot: vi.fn(async (/** @type {string} */ id) => {
        if (id === 'snap-001') {
            return {
                snapshotId: 'snap-001',
                createdAt: Date.now(),
                sessionId: 'sess',
                model: 'gpt-5-mini',
                status: 'idle',
                sendCount: 5,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
                pendingQuestionShadow: {
                    question: 'READY: aguardando próxima mensagem',
                    meta: { kind: 'ready' },
                    restoredAt: 1,
                    expiresAt: 2,
                },
                prMetrics: null,
            };
        }
        return null;
    }),
    createSnapshot: vi.fn(),
    saveSnapshotAsync: vi.fn(),
    listSnapshotsAsync: vi.fn(async () => []),
    loadSnapshotAsync: vi.fn(async () => null),
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
    readRuntimeInteractionState: readMockRuntimeInteractionState,
    readRuntimePrBudgetSnapshot: readMockRuntimePrBudgetSnapshot,
    readRuntimePermissionMode: vi.fn(() => 'approve_all'),
    readAgentRuntimeSdkResourceSnapshot: vi.fn(() => ({ client: false, session: false, quotaMonitor: false })),
    readAgentRuntimeCapabilities: vi.fn(() => ({})),
    readRuntimeAutoModelPolicy: (/** @type {typeof defaultRuntime} */ runtime) => ({
        configuredModel: runtime.model,
        observedModel: runtime.lastPrInfo?.effectiveModel ?? runtime.lastPrInfo?.model ?? null,
        selectionAuthority: 'github-copilot',
        canForcePreference: false,
    }),
    readSdkModelMetadata: () => null,
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    answerRuntimePendingQuestion: (/** @type {typeof defaultRuntime} */ runtime, /** @type {string} */ answer) =>
        runtime.answerPendingQuestion?.(answer) ?? false,
    clearRuntimePendingQuestionShadow: (/** @type {typeof defaultRuntime} */ runtime) =>
        runtime.clearPendingQuestionShadow?.() ?? false,
    createRuntimeSnapshot: vi.fn((/** @type {Record<string, unknown>} */ data) => ({
        snapshotId: 'snap-001',
        createdAt: Date.now(),
        ...data,
    })),
    saveRuntimeSnapshot: vi.fn(async () => '/tmp/snap-001.json'),
    listRuntimeSnapshots: vi.fn(async () => [
        { snapshotId: 'snap-001', createdAt: Date.now(), model: 'gpt-5-mini', reason: 'manual' },
    ]),
    loadRuntimeSnapshot: vi.fn(async (/** @type {string} */ id) =>
        id === 'snap-001'
            ? {
                  snapshotId: 'snap-001',
                  createdAt: Date.now(),
                  sessionId: 'sess',
                  model: 'gpt-5-mini',
                  status: 'idle',
                  sendCount: 5,
                  dialogLoopActive: false,
                  dialogPaused: false,
                  pendingQuestion: null,
                  pendingQuestionShadow: {
                      question: 'READY: aguardando próxima mensagem',
                      meta: { kind: 'ready' },
                      restoredAt: 1,
                      expiresAt: 2,
                  },
                  prMetrics: null,
              }
            : null,
    ),
}));

vi.mock('#copilot/core', async () => {
    const actual = await vi.importActual('#copilot/core');
    return {
        ...actual,
        getSharedSessionBinding: () => ({ hubSessionId: 'hub-1', sdkSessionId: 'sdk-1' }),
    };
});

vi.mock('#copilot/channel', () => ({
    llmBridgeClient: {
        turnCount: 12,
        history: [
            { role: 'user', content: 'hello world', timestamp: Date.now() },
            { role: 'assistant', content: 'hi', timestamp: Date.now() },
        ],
        clearHistory: vi.fn(),
    },
}));

vi.mock('#copilot/conversation-hub', () => ({
    conversationStore: {
        readTurns: vi.fn((_id, _opts) => [
            { role: 'user', content: 'a', created_at: Date.now() },
            { role: 'llm_b', content: 'b', created_at: Date.now() },
        ]),
        countTurns: vi.fn(() => 2),
        listHubSessions: vi.fn(() => [
            { id: 'abc-123', status: 'active', title: 'Test Session', created_at: Date.now() },
        ]),
        recallMemories: vi.fn(() => []),
    },
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', async (importOriginal) => ({
    ...(await importOriginal()),
    listTerminalSdkSessionInventory,
    readTerminalSdkSessionBootSelection,
    scheduleTerminalSdkSessionBootSelection,
    deleteTerminalSdkSession,
}));

vi.mock('../../../../src/copilot/terminal/state/index.js', async (importOriginal) => ({
    ...(await importOriginal()),
    readTerminalSseEventArchiveTail,
}));

const {
    cmdStatus,
    cmdNow,
    cmdLive,
    cmdHistory,
    cmdDbHistory,
    cmdDbSessions,
    cmdWho,
    cmdCount,
    cmdClear,
    cmdAnswer,
    cmdSessionSave,
    cmdSessionList,
    cmdSessionRestore,
    cmdSessionSdk,
    cmdClearShadow,
} = await import('../../../../src/copilot/terminal/commands/session.js');

/**
 * @returns {{ println: import('vitest').Mock; output: () => string }}
 */
function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('commands/session — sync commands', () => {
    beforeEach(() => {
        answerPendingQuestion.mockClear();
        answerPendingQuestion.mockReturnValue(true);
        altAnswerPendingQuestion.mockClear();
        altAnswerPendingQuestion.mockReturnValue(true);
        defaultRuntime.dialogLoopActive = false;
        defaultRuntime.status = 'idle';
        defaultRuntime.pendingQuestion = null;
        defaultRuntime.pendingQuestionKind = null;
        defaultRuntime.pendingQuestionShadowExpired = true;
        defaultRuntime.pendingQuestionShadowState = 'expired';
        defaultRuntime.pendingQuestionShadow = null;
        altRuntime.dialogLoopActive = true;
        altRuntime.status = 'waiting_for_input';
        altRuntime.pendingQuestion = null;
        altRuntime.pendingQuestionKind = null;
    });

    it('cmdStatus imprime status do agente', () => {
        const ctx = mockCtx();
        cmdStatus({ hubSessionId: 'hub-1', injectPort: 3009, println: ctx.println });
        expect(ctx.println).toHaveBeenCalled();
        expect(ctx.output()).toContain('gpt-5-mini');
        expect(ctx.output()).toContain('healthy');
        expect(ctx.output()).toContain('modo SDK');
        expect(ctx.output()).toContain('canal input');
        expect(ctx.output()).not.toContain('plan local');
        expect(ctx.output()).toContain('bg tasks');
        expect(ctx.output()).toContain('display');
        expect(ctx.output()).toContain('permission mode');
        expect(ctx.output()).toContain('shadow expirada');
        expect(ctx.output()).toContain('perfil modelo');
        expect(ctx.output()).toContain('runtime id');
        expect(ctx.output()).toContain('*default:gpt-5-mini/idle');
        expect(ctx.output()).toContain('billing/modelo');
        expect(ctx.output()).toContain('último PR');
        expect(ctx.output()).toContain('prompt digest');
        expect(ctx.output()).toContain('prompt frescor');
        expect(ctx.output()).toContain('binding ok');
        expect(ctx.output()).toContain('tools load');
        expect(ctx.output()).toContain('instr. load');
        expect(ctx.output()).toContain('sdk↔fs route');
        expect(ctx.output()).toContain('coleta ctx');
        expect(ctx.output()).toContain('/sdk doctor');
    });

    it('cmdStatus e cmdNow distinguem loop ativo em standby sem ask_user vivo', () => {
        defaultRuntime.dialogLoopActive = true;
        defaultRuntime.pendingQuestion = null;
        defaultRuntime.pendingQuestionKind = null;
        defaultRuntime.pendingQuestionShadow = null;
        defaultRuntime.pendingQuestionShadowState = null;
        defaultRuntime.pendingQuestionShadowExpired = false;
        const statusCtx = mockCtx();
        const nowCtx = mockCtx();

        cmdStatus({ hubSessionId: 'hub-1', injectPort: 3009, println: statusCtx.println });
        cmdNow({ hubSessionId: 'hub-1', injectPort: 3009, println: nowCtx.println });

        expect(statusCtx.output()).toContain('standby sem READY vivo');
        expect(statusCtx.output()).toContain('recovery sob demanda');
        expect(nowCtx.output()).toContain('live=ready');
        expect(nowCtx.output()).toContain('channel=standby');
    });

    it('cmdStatus destaca mismatch de modelo cobrado/configurado', () => {
        const prev = defaultRuntime.lastPrInfo;
        defaultRuntime.lastPrInfo = {
            ts: Date.now(),
            model: 'claude-haiku-4.5',
            configuredModel: 'gpt-5.4',
            modelMismatch: true,
            cost: 0.33,
        };
        const ctx = mockCtx();
        cmdStatus({ hubSessionId: 'hub-1', injectPort: 3009, println: ctx.println });
        expect(ctx.output()).toContain('mismatch');
        expect(ctx.output()).toContain('cobrado=claude-haiku-4.5');
        defaultRuntime.lastPrInfo = prev ?? null;
    });

    it('cmdNow imprime snapshot operacional compacto', () => {
        const ctx = mockCtx();
        cmdNow({ hubSessionId: 'hub-1', injectPort: 3009, println: ctx.println });
        expect(ctx.output()).toContain('[now]');
        expect(ctx.output()).toContain('runtime=default');
        expect(ctx.output()).toContain('live=');
        expect(ctx.output()).toContain('sse=');
        expect(ctx.output()).toContain('loop=off');
        expect(ctx.output()).toContain('PM:approve_all');
    });

    it('cmdLive imprime fluxo operacional live consolidado', () => {
        const ctx = mockCtx();
        cmdLive({ hubSessionId: 'hub-1', injectPort: 3009, println: ctx.println });
        expect(ctx.output()).toContain('Terminal Live Flow');
        expect(ctx.output()).toContain('estado');
        expect(ctx.output()).toContain('streaming');
        expect(ctx.output()).toContain('sse');
        expect(ctx.output()).toContain('trace');
    });

    it('cmdStatus aceita runtimeId explícito na sintaxe do REPL', () => {
        const ctx = mockCtx();
        cmdStatus({ hubSessionId: 'hub-1', injectPort: 3009, println: ctx.println }, '--runtime alt');
        expect(ctx.output()).toContain('runtime id');
        expect(ctx.output()).toContain('alt');
        expect(ctx.output()).toContain('gpt-4.1-mini');
        expect(ctx.output()).toContain('resume-session');
    });

    it('cmdStatus avisa quando o runtime solicitado cai em fallback para o default', () => {
        const ctx = mockCtx();
        cmdStatus({ hubSessionId: 'hub-1', injectPort: 3009, println: ctx.println }, '--runtime missing');
        expect(ctx.output()).toContain('runtime default (default)');
    });

    it('cmdHistory imprime histórico', () => {
        const ctx = mockCtx();
        cmdHistory({ println: ctx.println }, 5);
        expect(ctx.println).toHaveBeenCalled();
        expect(ctx.output()).toContain('a');
        expect(ctx.output()).toContain('hub');
    });

    it('cmdWho imprime atores com porta', () => {
        const ctx = mockCtx();
        cmdWho({ injectPort: 3009, println: ctx.println });
        expect(ctx.output()).toContain('3009');
        expect(ctx.output()).toContain('LLM-A');
        expect(ctx.output()).toContain('gpt-5-mini');
    });

    it('cmdWho aceita runtimeId explícito e projeta o modelo alvo', () => {
        const ctx = mockCtx();
        cmdWho({ injectPort: 3009, println: ctx.println }, '--runtime alt');
        expect(ctx.output()).toContain('gpt-4.1-mini');
    });

    it('cmdClear chama clearHistory', async () => {
        const ctx = mockCtx();
        cmdClear({ println: ctx.println });
        const { llmBridgeClient } = await import('#copilot/channel');
        expect(llmBridgeClient.clearHistory).toHaveBeenCalled();
    });

    it('cmdAnswer envia resposta pendente', () => {
        defaultRuntime.pendingQuestion = {
            question: 'Responder default?',
            kind: 'question',
            allowFreeform: true,
            askedAt: 1,
            protocolControlled: false,
        };
        defaultRuntime.pendingQuestionKind = 'question';
        defaultRuntime.pendingQuestionShadowExpired = false;
        defaultRuntime.pendingQuestionShadowState = null;
        const ctx = mockCtx();
        cmdAnswer({ println: ctx.println }, 'sim');
        expect(ctx.output()).toContain('Resposta enviada');
    });

    it('cmdAnswer aceita runtimeId explícito e usa o runtime alvo', () => {
        altRuntime.pendingQuestion = {
            question: 'Responder alt?',
            kind: 'question',
            allowFreeform: true,
            askedAt: 1,
            protocolControlled: false,
        };
        altRuntime.pendingQuestionKind = 'question';
        const ctx = mockCtx();
        cmdAnswer({ println: ctx.println }, '--runtime alt resposta-alt');
        expect(altAnswerPendingQuestion).toHaveBeenCalledWith('resposta-alt');
        expect(ctx.output()).toContain('resposta-alt');
    });

    it('cmdAnswer explica quando só resta shadow expirada', () => {
        defaultRuntime.pendingQuestion = null;
        defaultRuntime.pendingQuestionKind = null;
        defaultRuntime.pendingQuestionShadowExpired = true;
        defaultRuntime.pendingQuestionShadowState = 'expired';
        const ctx = mockCtx();
        cmdAnswer({ println: ctx.println }, 'sim');
        expect(ctx.output()).toContain('shadow expirada');
    });

    it('cmdAnswer não intercepta pergunta de protocolo do dialog loop', () => {
        defaultRuntime.pendingQuestion = {
            question: 'READY: aguardando próxima mensagem',
            kind: 'ready',
            allowFreeform: true,
            askedAt: 1,
            protocolControlled: true,
        };
        defaultRuntime.pendingQuestionKind = 'ready';

        const ctx = mockCtx();
        cmdAnswer({ println: ctx.println }, 'mensagem');

        expect(answerPendingQuestion).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Digite o texto normalmente');
    });

    it('cmdClearShadow limpa shadow persistida restaurada', () => {
        const ctx = mockCtx();
        cmdClearShadow({ println: ctx.println });
        expect(ctx.output()).toContain('Shadow persistida');
        expect(clearPendingQuestionShadow).toHaveBeenCalled();
    });

    it('cmdClearShadow aceita runtimeId explícito', () => {
        const ctx = mockCtx();
        cmdClearShadow({ println: ctx.println }, '--runtime alt');
        expect(altClearPendingQuestionShadow).toHaveBeenCalled();
    });

    it('cmdDbHistory sem hubSessionId avisa', () => {
        const ctx = mockCtx();
        cmdDbHistory({ hubSessionId: null, println: ctx.println });
        expect(ctx.output()).toContain('não disponível');
    });

    it('cmdDbHistory com hubSessionId exibe turnos', () => {
        const ctx = mockCtx();
        cmdDbHistory({ hubSessionId: 'hub-1', println: ctx.println });
        expect(ctx.println).toHaveBeenCalled();
    });

    it('cmdDbSessions lista sessions', () => {
        const ctx = mockCtx();
        cmdDbSessions({ hubSessionId: 'abc-123', println: ctx.println });
        expect(ctx.output()).toContain('Test Session');
    });

    it('cmdCount sem hubSessionId avisa', () => {
        const ctx = mockCtx();
        cmdCount({ hubSessionId: null, println: ctx.println });
        expect(ctx.output()).toContain('Nenhuma hub session');
    });

    it('cmdCount com hubSessionId exibe estatísticas', () => {
        const ctx = mockCtx();
        cmdCount({ hubSessionId: 'hub-1', println: ctx.println });
        expect(ctx.output()).toContain('Turnos');
    });
});

describe('commands/session — async commands', () => {
    beforeEach(() => {
        listTerminalSdkSessionInventory.mockClear();
        readTerminalSdkSessionBootSelection.mockClear();
        readTerminalSdkSessionBootSelection.mockResolvedValue(null);
        scheduleTerminalSdkSessionBootSelection.mockClear();
        scheduleTerminalSdkSessionBootSelection.mockResolvedValue({ ok: true, data: {}, error: null });
        deleteTerminalSdkSession.mockClear();
        readTerminalSseEventArchiveTail.mockClear();
        readTerminalSseEventArchiveTail.mockResolvedValue({
            entries: [],
            state: {
                enabled: true,
                path: '/tmp/terminal-sse-events.jsonl',
                error: null,
                events: 0,
                bytes: 0,
                queueDepth: 0,
                flushScheduled: false,
                flushInFlight: false,
                failedEvents: 0,
                droppedEvents: 0,
                lastEventId: null,
            },
            filters: {
                limit: 20,
                event: null,
                traceId: null,
                turnId: null,
                source: null,
                toolCallId: null,
                requestId: null,
                hubSessionId: null,
            },
        });
    });

    it('cmdSessionSdk distingue inventário SDK de resume do hub e snapshots', async () => {
        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, '2');
        expect(ctx.output()).toContain('Sessão SDK');
        expect(ctx.output()).toContain('/restart reinicia só dialog loop');
        expect(ctx.output()).toContain('/resume injeta histórico do hub');
        expect(ctx.output()).toContain('#1');
    });

    it('cmdSessionSdk respeita limite numérico e compacta previews longos', async () => {
        listTerminalSdkSessionInventory.mockResolvedValueOnce({
            currentSessionId: 'sdk-current',
            lastSessionId: 'sdk-last',
            foregroundSessionId: null,
            sessions: [
                {
                    sessionId: 'sdk-current',
                    startTime: new Date('2026-05-21T00:00:00.000Z'),
                    modifiedTime: new Date('2026-05-21T00:01:00.000Z'),
                    summary: `Prompt longo ${'delta '.repeat(80)}`,
                    isRemote: false,
                },
                {
                    sessionId: 'sdk-second',
                    startTime: new Date('2026-05-21T00:02:00.000Z'),
                    modifiedTime: new Date('2026-05-21T00:03:00.000Z'),
                    summary: 'segunda sessão',
                    isRemote: false,
                },
            ],
        });
        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, '1');
        expect(ctx.output()).toContain('sdk-current');
        expect(ctx.output()).not.toContain('sdk-second');
        expect(ctx.output()).toContain('/session sdk <n>');
        expect(ctx.output()).toContain('...');
        expect(ctx.output()).not.toContain('delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta delta');
    });

    it('cmdSessionSdk agenda uma sessão nova para o próximo boot', async () => {
        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, 'next new');
        expect(scheduleTerminalSdkSessionBootSelection).toHaveBeenCalledWith({ mode: 'new' });
        expect(ctx.output()).toContain('Próximo boot: criar nova sessão SDK');
    });

    it('cmdSessionSdk agenda resume por indice do inventário', async () => {
        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, 'next resume #1');
        expect(scheduleTerminalSdkSessionBootSelection).toHaveBeenCalledWith({
            mode: 'resume',
            sessionId: 'sdk-current',
        });
        expect(ctx.output()).toContain('(#1)');
    });

    it('cmdSessionSdk apaga sessão persistida por índice fora da sessão viva', async () => {
        listTerminalSdkSessionInventory.mockResolvedValueOnce({
            currentSessionId: 'sdk-current',
            lastSessionId: 'sdk-current',
            foregroundSessionId: null,
            sessions: [
                {
                    sessionId: 'sdk-old',
                    startTime: new Date('2026-05-20T00:00:00.000Z'),
                    modifiedTime: new Date('2026-05-20T00:01:00.000Z'),
                    summary: 'sessão antiga',
                    isRemote: false,
                },
            ],
        });
        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, 'delete #1');
        expect(deleteTerminalSdkSession).toHaveBeenCalledWith('sdk-old', null);
        expect(ctx.output()).toContain('Sessão SDK apagada: sdk-old (#1)');
        expect(ctx.output()).toContain('deleteSession');
    });

    it('cmdSessionSdk protege a sessão SDK viva contra delete', async () => {
        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, 'delete current');
        expect(deleteTerminalSdkSession).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Sessão SDK viva não apagada');
        expect(ctx.output()).toContain('/session sdk next new');
    });

    it('cmdSessionSdk marca resíduos de probes antigos sem esconder a sessão', async () => {
        listTerminalSdkSessionInventory.mockResolvedValueOnce({
            currentSessionId: 'sdk-current',
            lastSessionId: 'sdk-current',
            foregroundSessionId: null,
            sessions: [
                {
                    sessionId: 'sdk-probe',
                    startTime: new Date('2026-05-21T00:00:00.000Z'),
                    modifiedTime: new Date('2026-05-21T00:01:00.000Z'),
                    summary: 'Responda somente com o texto BYOK_PROBE_OK.',
                    isRemote: false,
                },
            ],
        });
        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, '2');
        expect(ctx.output()).toContain('sdk-probe');
        expect(ctx.output()).toContain('probe-residue');
        expect(ctx.output()).toContain('probes novos usam sessão efêmera');
    });

    it('cmdSessionSdk expõe binding BYOK redigido e decisão do último boot SDK', async () => {
        listTerminalSdkSessionInventory.mockResolvedValueOnce({
            currentSessionId: 'sdk-new',
            lastSessionId: 'sdk-new',
            foregroundSessionId: 'sdk-new',
            persistedByokBinding: {
                enabled: true,
                profile: 'groq-free',
                preset: 'groq',
                providerType: 'openai',
                model: 'qwen/qwen3-32b',
            },
            lastBootDecision: {
                outcome: 'created',
                requestedMode: 'auto',
                selectedSessionId: 'sdk-new',
                resumeCandidateSessionId: null,
                reason: 'provider-boundary: binding BYOK model mudou',
            },
            sessions: [],
        });
        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, '');
        expect(ctx.output()).toContain('provider bound');
        expect(ctx.output()).toContain('BYOK profile=groq-free');
        expect(ctx.output()).toContain('BYOK prepared');
        expect(ctx.output()).toContain('BYOK boundary');
        expect(ctx.output()).toContain('último boot');
        expect(ctx.output()).toContain('provider-boundary');
    });

    it('cmdSessionSdkEvents resume lifecycle e commands pelo archive SSE canônico', async () => {
        readTerminalSseEventArchiveTail
            .mockResolvedValueOnce({
                entries: [
                    {
                        schemaVersion: 1,
                        ts: '2026-05-22T00:00:00.000Z',
                        timestamp: Date.parse('2026-05-22T00:00:00.000Z'),
                        event: 'sdk.lifecycle',
                        eventId: 10,
                        source: 'agent/sdk.lifecycle',
                        eventSource: 'agent/sdk.lifecycle',
                        traceId: null,
                        turnId: null,
                        hubSessionId: null,
                        payload: { type: 'session.updated', sessionId: 'sdk-current' },
                    },
                    {
                        schemaVersion: 1,
                        ts: '2026-05-22T00:00:01.000Z',
                        timestamp: Date.parse('2026-05-22T00:00:01.000Z'),
                        event: 'sdk.lifecycle',
                        eventId: 11,
                        source: 'agent/sdk.lifecycle',
                        eventSource: 'agent/sdk.lifecycle',
                        traceId: null,
                        turnId: null,
                        hubSessionId: null,
                        payload: { type: 'session.updated', sessionId: 'sdk-current' },
                    },
                ],
                state: {
                    enabled: true,
                    path: '/tmp/terminal-sse-events.jsonl',
                    error: null,
                    events: 22,
                    bytes: 1024,
                    queueDepth: 0,
                    flushScheduled: false,
                    flushInFlight: false,
                    failedEvents: 0,
                    droppedEvents: 0,
                    lastEventId: 12,
                },
                filters: {
                    limit: 5,
                    event: 'sdk.lifecycle',
                    traceId: null,
                    turnId: null,
                    source: null,
                    toolCallId: null,
                    requestId: null,
                    hubSessionId: null,
                },
            })
            .mockResolvedValueOnce({
                entries: [
                    {
                        schemaVersion: 1,
                        ts: '2026-05-22T00:00:02.000Z',
                        timestamp: Date.parse('2026-05-22T00:00:02.000Z'),
                        event: 'sdk.command.executed',
                        eventId: 12,
                        source: 'agent/sdk.command',
                        eventSource: 'agent/sdk.command',
                        traceId: null,
                        turnId: null,
                        hubSessionId: null,
                        payload: {
                            commandName: 'terminal_status',
                            localCommand: '/status',
                            sessionId: 'sdk-current',
                            status: 'completed',
                        },
                    },
                ],
                state: {
                    enabled: true,
                    path: '/tmp/terminal-sse-events.jsonl',
                    error: null,
                    events: 22,
                    bytes: 1024,
                    queueDepth: 0,
                    flushScheduled: false,
                    flushInFlight: false,
                    failedEvents: 0,
                    droppedEvents: 0,
                    lastEventId: 12,
                },
                filters: {
                    limit: 5,
                    event: 'sdk.command.executed',
                    traceId: null,
                    turnId: null,
                    source: null,
                    toolCallId: null,
                    requestId: null,
                    hubSessionId: null,
                },
            });
        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, 'events 5');
        expect(readTerminalSseEventArchiveTail).toHaveBeenCalledWith({ event: 'sdk.lifecycle', limit: 5 });
        expect(readTerminalSseEventArchiveTail).toHaveBeenCalledWith({ event: 'sdk.command.executed', limit: 5 });
        expect(ctx.output()).toContain('Eventos SDK da sessão');
        expect(ctx.output()).toContain('sdk.lifecycle');
        expect(ctx.output()).toContain('×2');
        expect(ctx.output()).toContain('terminal_status');
        expect(ctx.output()).toContain('Este comando não cria eventos');
    });

    it('cmdSessionSdkWaits agrega ask_user, elicitation e permission pelo archive SSE canônico', async () => {
        const emptyProjection = (/** @type {string} */ event) => ({
            entries: [],
            state: {
                enabled: true,
                path: '/tmp/terminal-sse-events.jsonl',
                error: null,
                events: 40,
                bytes: 2048,
                queueDepth: 0,
                flushScheduled: false,
                flushInFlight: false,
                failedEvents: 0,
                droppedEvents: 0,
                lastEventId: 40,
            },
            filters: {
                limit: 6,
                event,
                traceId: null,
                turnId: null,
                source: null,
                toolCallId: null,
                requestId: null,
                hubSessionId: null,
            },
        });
        readTerminalSseEventArchiveTail
            .mockResolvedValueOnce({
                ...emptyProjection('user_input.requested'),
                entries: [
                    {
                        schemaVersion: 1,
                        ts: '2026-05-22T00:00:00.000Z',
                        timestamp: Date.parse('2026-05-22T00:00:00.000Z'),
                        event: 'user_input.requested',
                        eventId: 20,
                        source: 'sdk/user_input.requested',
                        eventSource: 'sdk/user_input.requested',
                        traceId: null,
                        turnId: null,
                        hubSessionId: null,
                        payload: {
                            requestId: 'ask-1',
                            question: 'Continuar?',
                            choices: ['SIM', 'NAO'],
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                ...emptyProjection('user_input.completed'),
                entries: [
                    {
                        schemaVersion: 1,
                        ts: '2026-05-22T00:00:01.000Z',
                        timestamp: Date.parse('2026-05-22T00:00:01.000Z'),
                        event: 'user_input.completed',
                        eventId: 21,
                        source: 'sdk/user_input.completed',
                        eventSource: 'sdk/user_input.completed',
                        traceId: null,
                        turnId: null,
                        hubSessionId: null,
                        payload: { requestId: 'ask-1', answer: 'SIM' },
                    },
                ],
            })
            .mockResolvedValueOnce({
                ...emptyProjection('elicitation.pending'),
                entries: [
                    {
                        schemaVersion: 1,
                        ts: '2026-05-22T00:00:02.000Z',
                        timestamp: Date.parse('2026-05-22T00:00:02.000Z'),
                        event: 'elicitation.pending',
                        eventId: 22,
                        source: 'sdk/elicitation.pending',
                        eventSource: 'sdk/elicitation.pending',
                        traceId: null,
                        turnId: null,
                        hubSessionId: null,
                        payload: { id: 'el-1', mode: 'form', message: 'Escolha ambiente' },
                    },
                ],
            })
            .mockResolvedValueOnce(emptyProjection('elicitation.completed'))
            .mockResolvedValueOnce({
                ...emptyProjection('permission.requested'),
                entries: [
                    {
                        schemaVersion: 1,
                        ts: '2026-05-22T00:00:03.000Z',
                        timestamp: Date.parse('2026-05-22T00:00:03.000Z'),
                        event: 'permission.requested',
                        eventId: 23,
                        source: 'sdk/permission.requested',
                        eventSource: 'sdk/permission.requested',
                        traceId: null,
                        turnId: null,
                        hubSessionId: null,
                        payload: { requestId: 'perm-1', permissionType: 'fs.write' },
                    },
                ],
            })
            .mockResolvedValueOnce(emptyProjection('permission.completed'))
            .mockResolvedValueOnce(emptyProjection('permission.mode_changed'));

        const ctx = mockCtx();
        await cmdSessionSdk({ println: ctx.println }, 'waits 6');

        expect(readTerminalSseEventArchiveTail).toHaveBeenCalledWith({ event: 'user_input.requested', limit: 6 });
        expect(readTerminalSseEventArchiveTail).toHaveBeenCalledWith({ event: 'elicitation.pending', limit: 6 });
        expect(readTerminalSseEventArchiveTail).toHaveBeenCalledWith({ event: 'permission.requested', limit: 6 });
        expect(ctx.output()).toContain('Waits SDK da sessão');
        expect(ctx.output()).toContain('ask_user=2');
        expect(ctx.output()).toContain('elicitation=1');
        expect(ctx.output()).toContain('permission=1');
        expect(ctx.output()).toContain('Continuar?');
        expect(ctx.output()).toContain('Escolha ambiente');
        expect(ctx.output()).toContain('fs.write');
    });

    it('cmdSessionSave salva e imprime path', async () => {
        const ctx = mockCtx();
        await cmdSessionSave({ println: ctx.println }, 'test-reason');
        expect(ctx.output()).toContain('Snapshot salvo');
    });

    it('cmdSessionSave aceita runtimeId explícito na cauda do comando', async () => {
        const ctx = mockCtx();
        await cmdSessionSave({ println: ctx.println }, '--runtime alt nightly');
        expect(ctx.output()).toContain('Snapshot salvo');
    });

    it('cmdSessionList lista snapshots', async () => {
        const ctx = mockCtx();
        await cmdSessionList({ println: ctx.println });
        expect(ctx.output()).toContain('snap-001');
    });

    it('cmdSessionRestore sem id mostra uso', async () => {
        const ctx = mockCtx();
        await cmdSessionRestore({ println: ctx.println }, '');
        expect(ctx.output()).toContain('/session restore');
    });

    it('cmdSessionRestore com id válido mostra detalhes', async () => {
        const ctx = mockCtx();
        await cmdSessionRestore({ println: ctx.println }, 'snap-001');
        expect(ctx.output()).toContain('snap-001');
        expect(ctx.output()).toContain('gpt-5-mini');
        expect(ctx.output()).toContain('Pending shadow');
    });

    it('cmdSessionRestore com id inválido mostra erro', async () => {
        const ctx = mockCtx();
        await cmdSessionRestore({ println: ctx.println }, 'nonexistent');
        expect(ctx.output()).toContain('não encontrado');
    });
});
