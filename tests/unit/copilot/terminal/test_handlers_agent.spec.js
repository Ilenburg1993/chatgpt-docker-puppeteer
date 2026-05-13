// @ts-check
/**
 * Testes para handlers/agent.js — context, pipeline, inject, dialog pause/resume, handoff.
 *
 * A suíte cobre a SSOT compartilhada em `presentation/agent-control.js`, incluindo o novo caminho runtime-aware
 * (`runtimeId`) e compatibilidade com payload bridgeado `{ body: ... }`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockStartAgentDialogLoop = vi.fn(async () => {});
const mockSendAgentDialogTurn = vi.fn(async () => 'reply');
const mockStopAgentDialogLoopAuthorized = vi.fn(async () => {});
const mockAbortRuntimeCurrentMessage = vi.fn(async (/** @type {any} */ runtime) => runtime.abortCurrentMessage?.());
const mockSteerRuntimeMessage = vi.fn(async (/** @type {any} */ runtime, /** @type {string} */ prompt) => {
    return runtime.steerMessage?.(prompt) ?? 'msg-steer';
});
const mockAnswerRuntimePendingQuestion = vi.fn(
    (/** @type {any} */ runtime, /** @type {string} */ answer) => runtime.answerPendingQuestion?.(answer) ?? true,
);

const defaultRuntime = /** @type {any} */ ({
    dialogLoopActive: false,
    dialogPaused: false,
    status: 'idle',
    model: 'gpt-5-mini',
    sessionId: 'sess-default',
    pauseDialogLoop: vi.fn(async () => {}),
    resumeDialogLoop: vi.fn(async () => {}),
    abortCurrentMessage: vi.fn(async () => {}),
    steerMessage: vi.fn(async (/** @type {string} */ _prompt) => 'msg-default-steer'),
    pingDialogWatchdog: vi.fn(),
    getStatusSnapshot: () => ({
        status: 'idle',
        sessionId: 'sess-default',
        contextWindow: {
            tokens: 50000,
            tokenLimit: 128000,
            utilization: 0.39,
        },
        lastCheckpointPath: null,
    }),
    getHealthSnapshot: () => ({ ok: true, status: 'healthy' }),
    getHandoffManager: () => ({
        getPending: () => [],
        getHistory: () => [],
        accept: vi.fn((/** @type {string} */ id) => (id === 'h-1' ? { accepted: true } : { accepted: false })),
        reject: vi.fn((/** @type {string} */ _id, /** @type {string | undefined} */ _reason) => ({
            rejected: true,
        })),
    }),
});

const altRuntime = /** @type {any} */ ({
    dialogLoopActive: false,
    dialogPaused: false,
    status: 'processing',
    model: 'gpt-5',
    sessionId: 'sess-alt',
    pauseDialogLoop: vi.fn(async () => {}),
    resumeDialogLoop: vi.fn(async () => {}),
    abortCurrentMessage: vi.fn(async () => {}),
    steerMessage: vi.fn(async (/** @type {string} */ _prompt) => 'msg-alt-steer'),
    pingDialogWatchdog: vi.fn(),
    getStatusSnapshot: () => ({
        status: 'processing',
        sessionId: 'sess-alt',
        contextWindow: {
            tokens: 64000,
            tokenLimit: 256000,
            utilization: 0.25,
        },
        lastCheckpointPath: '/tmp/alt.chk',
    }),
    getHealthSnapshot: () => ({ ok: true, status: 'degraded' }),
    getHandoffManager: () => ({
        getPending: () => [{ id: 'alt-1' }],
        getHistory: () => [{ id: 'alt-history' }],
        accept: vi.fn((/** @type {string} */ id) => (id === 'alt-1' ? { accepted: true } : { accepted: false })),
        reject: vi.fn((/** @type {string} */ _id, /** @type {string | undefined} */ _reason) => ({
            rejected: true,
        })),
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

vi.mock('#copilot/agent', () => ({
    alwaysAliveAgent: defaultRuntime,
    getAgent: () => defaultRuntime,
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (runtimeId = 'default') => {
        if (runtimeId === 'alt') return altRuntime;
        return runtimeId === 'default' ? defaultRuntime : null;
    },
    listAgentRuntimes: () => [
        { runtimeId: 'default', runtime: defaultRuntime },
        { runtimeId: 'alt', runtime: altRuntime },
    ],
    readAgentRuntimeStatusSnapshot: (/** @type {any} */ runtime) => runtime.getStatusSnapshot(),
    readAgentRuntimeHealthSnapshot: (/** @type {any} */ runtime) => runtime.getHealthSnapshot(),
    classifyAgentError: (/** @type {any} */ error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return 'ignore';
        if (error?.code === 'AGENT_STOPPED') return 'fatal';
        return 'retry';
    },
    readRuntimeControlState: readMockRuntimeControlState,
    readRuntimeInteractionState: (/** @type {any} */ runtime) => ({
        pendingQuestion: runtime.pendingQuestion ?? null,
        pendingQuestionKind: runtime.pendingQuestionKind ?? null,
        pendingQuestionShadow: runtime.pendingQuestionShadow ?? null,
        pendingQuestionShadowKind: runtime.pendingQuestionShadowKind ?? null,
        pendingQuestionShadowState: runtime.pendingQuestionShadowState ?? null,
        pendingQuestionShadowExpired: Boolean(runtime.pendingQuestionShadowExpired),
        pendingQuestionShadowAgeMs: runtime.pendingQuestionShadowAgeMs ?? null,
        pendingQuestionShadowExpiresAt: runtime.pendingQuestionShadowExpiresAt ?? null,
        pendingQuestionShadowRemainingMs: runtime.pendingQuestionShadowRemainingMs ?? null,
    }),
    readRuntimePrBudgetSnapshot: () => ({ lastPrInfo: null, prMetrics: null }),
    abortRuntimeCurrentMessage: mockAbortRuntimeCurrentMessage,
    steerRuntimeMessage: mockSteerRuntimeMessage,
    answerRuntimePendingQuestion: mockAnswerRuntimePendingQuestion,
    pauseRuntimeDialogLoop: vi.fn(async (/** @type {any} */ runtime) => runtime.pauseDialogLoop?.()),
    resumeRuntimeDialogLoop: vi.fn(async (/** @type {any} */ runtime) => runtime.resumeDialogLoop?.()),
    getRuntimeHandoffManager: (/** @type {any} */ runtime) => runtime.getHandoffManager(),
    getRuntimeHandoffHistory: (/** @type {any} */ runtime) => runtime.getHandoffManager().getHistory(),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    startAgentDialogLoop: mockStartAgentDialogLoop,
    sendAgentDialogTurn: mockSendAgentDialogTurn,
    stopAgentDialogLoopAuthorized: mockStopAgentDialogLoopAuthorized,
}));

vi.mock('#copilot/agent/always-alive', () => ({
    alwaysAliveAgent: defaultRuntime,
    getAgent: () => defaultRuntime,
}));

vi.mock('#copilot/agent/runtime-registry', () => ({
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (runtimeId = 'default') => {
        if (runtimeId === 'alt') return altRuntime;
        return runtimeId === 'default' ? defaultRuntime : null;
    },
    listAgentRuntimes: () => [
        { runtimeId: 'default', runtime: defaultRuntime },
        { runtimeId: 'alt', runtime: altRuntime },
    ],
}));

vi.mock('#copilot/agent/error-policy', () => ({
    classifyAgentError: (/** @type {any} */ error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return 'ignore';
        if (error?.code === 'AGENT_STOPPED') return 'fatal';
        return 'retry';
    },
}));

vi.mock('#copilot/agent/facades', () => ({
    readAgentRuntimeStatusSnapshot: (/** @type {any} */ runtime) => runtime.getStatusSnapshot(),
    readAgentRuntimeHealthSnapshot: (/** @type {any} */ runtime) => runtime.getHealthSnapshot(),
    readRuntimeControlState: readMockRuntimeControlState,
    readRuntimeInteractionState: (/** @type {any} */ runtime) => ({
        pendingQuestion: runtime.pendingQuestion ?? null,
        pendingQuestionKind: runtime.pendingQuestionKind ?? null,
        pendingQuestionShadow: runtime.pendingQuestionShadow ?? null,
        pendingQuestionShadowKind: runtime.pendingQuestionShadowKind ?? null,
        pendingQuestionShadowState: runtime.pendingQuestionShadowState ?? null,
        pendingQuestionShadowExpired: Boolean(runtime.pendingQuestionShadowExpired),
        pendingQuestionShadowAgeMs: runtime.pendingQuestionShadowAgeMs ?? null,
        pendingQuestionShadowExpiresAt: runtime.pendingQuestionShadowExpiresAt ?? null,
        pendingQuestionShadowRemainingMs: runtime.pendingQuestionShadowRemainingMs ?? null,
    }),
    readRuntimePrBudgetSnapshot: () => ({ lastPrInfo: null, prMetrics: null }),
    readRuntimePermissionMode: vi.fn(() => 'approve_all'),
    readAgentRuntimeSdkResourceSnapshot: vi.fn(() => ({ client: false, session: false, quotaMonitor: false })),
    abortRuntimeCurrentMessage: mockAbortRuntimeCurrentMessage,
    steerRuntimeMessage: mockSteerRuntimeMessage,
    answerRuntimePendingQuestion: mockAnswerRuntimePendingQuestion,
    pauseRuntimeDialogLoop: vi.fn(async (/** @type {any} */ runtime) => runtime.pauseDialogLoop?.()),
    resumeRuntimeDialogLoop: vi.fn(async (/** @type {any} */ runtime) => runtime.resumeDialogLoop?.()),
    getRuntimeHandoffManager: (/** @type {any} */ runtime) => runtime.getHandoffManager(),
    getRuntimeHandoffHistory: (/** @type {any} */ runtime) => runtime.getHandoffManager().getHistory(),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    startAgentDialogLoop: mockStartAgentDialogLoop,
    sendAgentDialogTurn: mockSendAgentDialogTurn,
    stopAgentDialogLoopAuthorized: mockStopAgentDialogLoopAuthorized,
    recoverAgentDialogInputChannel: vi.fn(async () => ({
        recovered: true,
        reason: 'input_channel_missing',
        strategy: 'mock',
        prConsumed: false,
        durationMs: 1,
    })),
}));

const {
    handleGetContext,
    handlePipeline,
    handleInject,
    handleDialogPause,
    handleDialogResume,
    handleGetHandoffs,
    handleAcceptHandoff,
    handleRejectHandoff,
} = await import('../../../../src/copilot/terminal/handlers/agent.js');
const { clearRuntimeInterventions } = await import('../../../../src/copilot/presentation/state/index.js');

/** @template T @param {{ body: unknown }} result @returns {T} */
const bodyOf = (result) => /** @type {T} */ (result.body);

beforeEach(() => {
    vi.stubEnv('INJECT_ZERO_PR_USER_DEFAULT', 'true');
    vi.stubEnv('INJECT_USER_DEFAULT_MODE', 'intervene');
    vi.stubEnv('INJECT_ZERO_PR_USER_ALLOW_QUEUE_FALLBACK', 'false');
    vi.stubEnv('INJECT_ZERO_PR_USER_ALLOW_STEER', 'false');
    mockStartAgentDialogLoop.mockClear();
    mockSendAgentDialogTurn.mockClear();
    mockStopAgentDialogLoopAuthorized.mockClear();
    mockAbortRuntimeCurrentMessage.mockClear();
    mockSteerRuntimeMessage.mockClear();
    mockAnswerRuntimePendingQuestion.mockClear();
    defaultRuntime.pendingQuestion = null;
    defaultRuntime.pendingQuestionKind = null;
    altRuntime.pendingQuestion = null;
    altRuntime.pendingQuestionKind = null;
    clearRuntimeInterventions(null);
    clearRuntimeInterventions('alt');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('handlers/agent — handleGetContext', () => {
    it('retorna utilização e warning do runtime default', () => {
        const result = handleGetContext();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.tokens).toBe(50000);
        expect(body.utilizationPercent).toBe(39);
        expect(body.warning).toBe('none');
    });

    it('aceita runtimeId explícito e lê o runtime alternativo', () => {
        const result = handleGetContext({ runtimeId: 'alt' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.tokens).toBe(64000);
        expect(body.utilizationPercent).toBe(25);
    });
});

describe('handlers/agent — handlePipeline validação', () => {
    it('rejeita body sem steps', async () => {
        const result = await handlePipeline({});
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(400);
        expect(body.error).toContain('steps');
    });

    it('rejeita steps vazio', async () => {
        const result = await handlePipeline({ steps: [] });
        expect(result.status).toBe(400);
    });

    it('aceita mais de 20 steps sem limite bloqueante', async () => {
        const steps = Array.from({ length: 21 }, (_, i) => ({ prompt: `p${i}` }));
        mockSendAgentDialogTurn.mockResolvedValue('ok');
        const result = await handlePipeline({ steps });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.results.length).toBe(21);
    });

    it('executa pipeline com 1 step no runtime default', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('ok-reply');
        const result = await handlePipeline({ steps: [{ prompt: 'test' }] });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.results.length).toBe(1);
        expect(mockSendAgentDialogTurn).toHaveBeenCalledWith(
            defaultRuntime,
            'test',
            expect.objectContaining({ timeout: null, traceId: expect.any(String) }),
        );
    });

    it('aceita payload bridgeado e runtimeId explícito', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('alt-reply');
        const result = await handlePipeline({ runtimeId: 'alt', body: { steps: [{ prompt: 'alt-turn' }] } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.results[0].reply).toBe('alt-reply');
        expect(mockSendAgentDialogTurn).toHaveBeenLastCalledWith(
            altRuntime,
            'alt-turn',
            expect.objectContaining({ timeout: null, traceId: expect.any(String) }),
        );
    });
});

describe('handlers/agent — handleInject validação', () => {
    it('rejeita body sem message', async () => {
        const result = await handleInject({});
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(400);
        expect(body.error).toContain('message');
    });

    it('rejeita message vazia (whitespace)', async () => {
        const result = await handleInject({ message: '   ' });
        expect(result.status).toBe(400);
    });

    it('sem mode enfileira no mailbox zero-PR e não abre turno', async () => {
        const result = await handleInject({ message: 'hello' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(202);
        expect(body.ok).toBe(true);
        expect(body.code).toBe('ZERO_PR_MAILBOX_QUEUED');
        expect(body.mode).toBe('mailbox_queue');
        expect(body.reply).toBeNull();
        expect(body.mailbox.queueSize).toBe(1);
        expect(body.traceId).toEqual(expect.any(String));
        expect(mockSendAgentDialogTurn).not.toHaveBeenCalled();
        expect(mockSteerRuntimeMessage).not.toHaveBeenCalled();
    });

    it('mode=turn abre turno explicitamente e pode retornar reply', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('resposta');
        const result = await handleInject({ message: 'hello', mode: 'turn' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.mode).toBe('queue');
        expect(body.reply).toBe('resposta');
        expect(mockSendAgentDialogTurn).toHaveBeenLastCalledWith(
            defaultRuntime,
            'hello',
            expect.objectContaining({ traceId: expect.any(String) }),
        );
    });

    it('mantém timeout explícito como informativo e envia runtime dialog sem bloqueio', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('com-timeout');
        const result = await handleInject({ body: { message: 'hello', timeout: 2500, mode: 'turn' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.reply).toBe('com-timeout');
        expect(body.traceId).toEqual(expect.any(String));
        expect(mockSendAgentDialogTurn).toHaveBeenLastCalledWith(
            defaultRuntime,
            'hello',
            expect.objectContaining({ timeout: null, traceId: expect.any(String) }),
        );
    });

    it('aceita payload bridgeado com alias content e runtimeId explícito', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('alt-body');
        const result = await handleInject({ runtimeId: 'alt', body: { content: 'hello from body', mode: 'dialog' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.reply).toBe('alt-body');
        expect(body.traceId).toEqual(expect.any(String));
        expect(mockSendAgentDialogTurn).toHaveBeenLastCalledWith(
            altRuntime,
            'hello from body',
            expect.objectContaining({ traceId: expect.any(String) }),
        );
    });

    it('usa mailbox zero-PR por padrão também para from=user', async () => {
        const result = await handleInject({ body: { message: 'aguarde sua vez', from: 'user' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(202);
        expect(body.code).toBe('ZERO_PR_MAILBOX_QUEUED');
        expect(body.mode).toBe('mailbox_queue');
        expect(body.reply).toBeNull();
        expect(mockSendAgentDialogTurn).not.toHaveBeenCalled();
    });

    it('mode=queue também usa mailbox zero-PR para não consumir PR', async () => {
        const result = await handleInject({ body: { message: 'fila sem PR', from: 'llm-a', mode: 'queue' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(202);
        expect(body.code).toBe('ZERO_PR_MAILBOX_QUEUED');
        expect(body.mode).toBe('mailbox_queue');
        expect(body.reply).toBeNull();
        expect(body.mailbox.queueSize).toBe(1);
        expect(mockSendAgentDialogTurn).not.toHaveBeenCalled();
    });

    it('não remove diretiva textual conflitante quando mode explícito já foi informado', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('literal-ok');
        const result = await handleInject({ body: { message: '!!queue literal deve permanecer', mode: 'turn' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.reply).toBe('literal-ok');
        expect(mockSendAgentDialogTurn).toHaveBeenLastCalledWith(
            defaultRuntime,
            '!!queue literal deve permanecer',
            expect.objectContaining({ traceId: expect.any(String) }),
        );
    });

    it('remove diretiva textual redundante compatível com mode explícito', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('stripped-ok');
        const result = await handleInject({ body: { message: '!!turn\nrode como turno', mode: 'turn' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.reply).toBe('stripped-ok');
        expect(mockSendAgentDialogTurn).toHaveBeenLastCalledWith(
            defaultRuntime,
            'rode como turno',
            expect.objectContaining({ traceId: expect.any(String) }),
        );
    });

    it('aceita diretiva textual com dois-pontos quando mode não foi informado', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('directive-ok');
        const result = await handleInject({ body: { message: '!!turn: rode explicitamente' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.reply).toBe('directive-ok');
        expect(mockSendAgentDialogTurn).toHaveBeenLastCalledWith(
            defaultRuntime,
            'rode explicitamente',
            expect.objectContaining({ traceId: expect.any(String) }),
        );
    });

    it('modo steer fica bloqueado por padrão e cai no mailbox zero-PR', async () => {
        const result = await handleInject({ body: { message: 'mude o rumo agora', mode: 'steer' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(202);
        expect(body.ok).toBe(true);
        expect(body.code).toBe('ZERO_PR_DEFERRED_MAILBOX');
        expect(body.mode).toBe('deferred_mailbox');
        expect(body.reply).toBeNull();
        expect(body.mailbox.queueSize).toBe(1);
        expect(mockSteerRuntimeMessage).not.toHaveBeenCalled();
        expect(mockSendAgentDialogTurn).not.toHaveBeenCalled();
    });

    it('modo steer só envia SDK immediate quando a política permite explicitamente', async () => {
        vi.stubEnv('INJECT_ZERO_PR_USER_ALLOW_STEER', 'true');
        const result = await handleInject({ body: { message: 'mude o rumo agora', mode: 'steer' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(202);
        expect(body.ok).toBe(true);
        expect(body.mode).toBe('steer');
        expect(body.reply).toBeNull();
        expect(body.messageId).toBe('msg-default-steer');
        expect(mockSteerRuntimeMessage).toHaveBeenLastCalledWith(defaultRuntime, 'mude o rumo agora', {});
        expect(mockSendAgentDialogTurn).not.toHaveBeenCalled();
    });

    it('modo immediate é alias explícito de steer, mas preserva zero-PR por padrão', async () => {
        const result = await handleInject({ body: { message: 'intervenha agora', mode: 'immediate' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(202);
        expect(body.ok).toBe(true);
        expect(body.mode).toBe('deferred_mailbox');
        expect(body.reply).toBeNull();
        expect(mockSteerRuntimeMessage).not.toHaveBeenCalled();
    });

    it('se answer zero-PR falha, preserva steer bloqueado no mailbox em vez de perder a intervenção', async () => {
        defaultRuntime.pendingQuestion = { protocolControlled: false };
        defaultRuntime.pendingQuestionKind = 'question';
        mockAnswerRuntimePendingQuestion.mockReturnValueOnce(false);

        const result = await handleInject({ body: { message: 'preserve no mailbox', mode: 'steer' } });
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        expect(result.status).toBe(202);
        expect(body.code).toBe('ZERO_PR_DEFERRED_MAILBOX');
        expect(body.mode).toBe('deferred_mailbox');
        expect(body.mailbox.queueSize).toBe(1);
        expect(mockSteerRuntimeMessage).not.toHaveBeenCalled();
        expect(mockSendAgentDialogTurn).not.toHaveBeenCalled();
    });

    it('modo interrupt aborta turno ativo e guarda substituição no mailbox zero-PR por padrão', async () => {
        const result = await handleInject({
            runtimeId: 'alt',
            body: { message: 'substitua o plano', mode: 'interrupt' },
        });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(202);
        expect(body.ok).toBe(true);
        expect(body.code).toBe('ZERO_PR_DEFERRED_MAILBOX');
        expect(body.mode).toBe('interrupt_deferred_mailbox');
        expect(body.reply).toBeNull();
        expect(mockAbortRuntimeCurrentMessage).toHaveBeenLastCalledWith(altRuntime);
        expect(mockSendAgentDialogTurn).not.toHaveBeenCalled();
    });

    it('mode=abort não processa context_files nem attachments antes de abortar', async () => {
        const result = await handleInject({
            body: {
                mode: 'abort',
                context_files: ['/arquivo/inexistente/que/nao/deve/ser/lido.md'],
                attachments: [{ path: '/anexo/inexistente/que/nao/deve/ser/lido.txt' }],
            },
        });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(202);
        expect(body.ok).toBe(true);
        expect(body.mode).toBe('abort');
        expect(mockAbortRuntimeCurrentMessage).toHaveBeenLastCalledWith(defaultRuntime);
    });

    it('projeta AbortError para 504', async () => {
        mockSendAgentDialogTurn.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
        const result = await handleInject({ message: 'timeout please', mode: 'turn' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(504);
        expect(body.disposition).toBe('ignore');
        expect(body.retryable).toBe(false);
        expect(body.traceId).toEqual(expect.any(String));
    });
});

describe('handlers/agent — dialog pause/resume', () => {
    it('handleDialogPause retorna 409 se loop inativo', async () => {
        const result = await handleDialogPause();
        expect(result.status).toBe(409);
    });

    it('handleDialogPause retorna 409 se loop já está pausado', async () => {
        defaultRuntime.dialogLoopActive = true;
        defaultRuntime.dialogPaused = true;

        const result = await handleDialogPause();
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        defaultRuntime.dialogLoopActive = false;
        defaultRuntime.dialogPaused = false;

        expect(result.status).toBe(409);
        expect(body.error).toMatch(/já está pausado/i);
    });

    it('handleDialogPause usa runtimeId explícito quando informado', async () => {
        altRuntime.dialogLoopActive = true;
        const result = await handleDialogPause({ runtimeId: 'alt' });
        altRuntime.dialogLoopActive = false;
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(altRuntime.pauseDialogLoop).toHaveBeenCalled();
    });

    it('handleDialogResume tenta retomar loop', async () => {
        defaultRuntime.dialogPaused = true;
        const result = await handleDialogResume();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        defaultRuntime.dialogPaused = false;
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(defaultRuntime.resumeDialogLoop).toHaveBeenCalled();
    });

    it('handleDialogResume retorna 409 se loop já está ativo e não pausado', async () => {
        defaultRuntime.dialogLoopActive = true;
        defaultRuntime.dialogPaused = false;

        const result = await handleDialogResume();
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        defaultRuntime.dialogLoopActive = false;

        expect(result.status).toBe(409);
        expect(body.error).toMatch(/já está ativo/i);
    });

    it('handleDialogResume retorna 409 se loop não está pausado', async () => {
        defaultRuntime.dialogLoopActive = false;
        defaultRuntime.dialogPaused = false;

        const result = await handleDialogResume();
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        expect(result.status).toBe(409);
        expect(body.error).toMatch(/não está pausado/i);
    });

    it('handleDialogResume projeta erro de sessão para 503', async () => {
        defaultRuntime.dialogPaused = true;
        defaultRuntime.resumeDialogLoop.mockRejectedValueOnce(
            Object.assign(new Error('agente parado'), { code: 'AGENT_STOPPED' }),
        );

        const result = await handleDialogResume();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        defaultRuntime.dialogPaused = false;

        expect(result.status).toBe(503);
        expect(body.code).toBe('AGENT_STOPPED');
        expect(body.ok).toBe(false);
    });
});

describe('handlers/agent — handoff', () => {
    it('handleGetHandoffs retorna pending e history', () => {
        const result = handleGetHandoffs();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.pending)).toBe(true);
        expect(Array.isArray(body.history)).toBe(true);
    });

    it('handleGetHandoffs aceita runtimeId explícito', () => {
        const result = handleGetHandoffs({ runtimeId: 'alt' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.pending).toEqual([{ id: 'alt-1' }]);
        expect(body.history).toEqual([{ id: 'alt-history' }]);
    });

    it('handleAcceptHandoff rejeita sem handoffId', () => {
        const result = handleAcceptHandoff({});
        expect(result.status).toBe(400);
    });

    it('handleAcceptHandoff aceita id válido', () => {
        const result = handleAcceptHandoff({ handoffId: 'h-1' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
    });

    it('handleAcceptHandoff aceita runtimeId explícito', () => {
        const result = handleAcceptHandoff({ runtimeId: 'alt', handoffId: 'alt-1' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
    });

    it('handleAcceptHandoff retorna 404 para id inválido', () => {
        const result = handleAcceptHandoff({ handoffId: 'nope' });
        expect(result.status).toBe(404);
    });

    it('handleRejectHandoff rejeita sem handoffId', () => {
        const result = handleRejectHandoff({}, {});
        expect(result.status).toBe(400);
    });

    it('handleRejectHandoff aceita id com reason', () => {
        const result = handleRejectHandoff({ handoffId: 'h-1' }, { reason: 'not needed' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
    });
});
