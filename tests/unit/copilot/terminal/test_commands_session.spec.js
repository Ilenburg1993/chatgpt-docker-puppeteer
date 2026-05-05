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

const {
    cmdStatus,
    cmdNow,
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
        defaultRuntime.pendingQuestion = null;
        defaultRuntime.pendingQuestionKind = null;
        defaultRuntime.pendingQuestionShadowExpired = true;
        defaultRuntime.pendingQuestionShadowState = 'expired';
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
        expect(ctx.output()).not.toContain('plan local');
        expect(ctx.output()).toContain('bg tasks');
        expect(ctx.output()).toContain('display');
        expect(ctx.output()).toContain('shadow expirada');
        expect(ctx.output()).toContain('perfil modelo');
        expect(ctx.output()).toContain('runtime id');
        expect(ctx.output()).toContain('*default:gpt-5-mini/idle');
        expect(ctx.output()).toContain('billing/modelo');
        expect(ctx.output()).toContain('último PR');
        expect(ctx.output()).toContain('prompt digest');
        expect(ctx.output()).toContain('prompt frescor');
        expect(ctx.output()).toContain('binding ok');
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
        expect(ctx.output()).toContain('loop=off');
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
