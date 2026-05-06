// @ts-check
/**
 * Testes para handlers/agent.js — context, pipeline, inject, dialog pause/resume, handoff.
 *
 * A suíte cobre a SSOT compartilhada em `presentation/agent-control.js`, incluindo o novo caminho runtime-aware
 * (`runtimeId`) e compatibilidade com payload bridgeado `{ body: ... }`.
 */

import { describe, expect, it, vi } from 'vitest';

const mockStartAgentDialogLoop = vi.fn(async () => {});
const mockSendAgentDialogTurn = vi.fn(async () => 'reply');
const mockStopAgentDialogLoopAuthorized = vi.fn(async () => {});

const defaultRuntime = /** @type {any} */ ({
    dialogLoopActive: false,
    dialogPaused: false,
    status: 'idle',
    model: 'gpt-5-mini',
    sessionId: 'sess-default',
    pauseDialogLoop: vi.fn(async () => {}),
    resumeDialogLoop: vi.fn(async () => {}),
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
    pauseRuntimeDialogLoop: vi.fn(async (/** @type {any} */ runtime) => runtime.pauseDialogLoop?.()),
    resumeRuntimeDialogLoop: vi.fn(async (/** @type {any} */ runtime) => runtime.resumeDialogLoop?.()),
    getRuntimeHandoffManager: (/** @type {any} */ runtime) => runtime.getHandoffManager(),
    getRuntimeHandoffHistory: (/** @type {any} */ runtime) => runtime.getHandoffManager().getHistory(),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    startAgentDialogLoop: mockStartAgentDialogLoop,
    sendAgentDialogTurn: mockSendAgentDialogTurn,
    stopAgentDialogLoopAuthorized: mockStopAgentDialogLoopAuthorized,
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

/** @template T @param {{ body: unknown }} result @returns {T} */
const bodyOf = (result) => /** @type {T} */ (result.body);

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

    it('injeta message válida e retorna reply', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('resposta');
        const result = await handleInject({ message: 'hello' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.reply).toBe('resposta');
        expect(body.traceId).toEqual(expect.any(String));
        expect(mockSendAgentDialogTurn).toHaveBeenLastCalledWith(
            defaultRuntime,
            'hello',
            expect.objectContaining({ traceId: expect.any(String) }),
        );
    });

    it('mantém timeout explícito como informativo e envia runtime dialog sem bloqueio', async () => {
        mockSendAgentDialogTurn.mockResolvedValueOnce('com-timeout');
        const result = await handleInject({ body: { message: 'hello', timeout: 2500 } });
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
        const result = await handleInject({ runtimeId: 'alt', body: { content: 'hello from body' } });
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

    it('projeta AbortError para 504', async () => {
        mockSendAgentDialogTurn.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
        const result = await handleInject({ message: 'timeout please' });
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
