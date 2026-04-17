// @ts-check
/**
 * tests/unit/copilot/terminal/test_handlers_agent.spec.js
 *
 * Testes para handlers/agent.js — context, pipeline, inject, dialog pause/resume, handoff. Mock do alwaysAliveAgent e
 * sendTurn para testar validação e fluxo dos handlers.
 */

const mockSendTurn = vi.fn(async (/** @type {string} */ _msg, /** @type {string} */ _from) => 'reply');

vi.mock('#copilot/agent', () => ({
    alwaysAliveAgent: {
        dialogLoopActive: false,
        status: 'idle',
        getStatusSnapshot: () => ({
            contextWindow: {
                tokens: 50000,
                tokenLimit: 128000,
                utilization: 0.39,
            },
            lastCheckpointPath: null,
        }),
        pauseDialogLoop: vi.fn(async () => {}),
        resumeDialogLoop: vi.fn(async () => {}),
        getHandoffManager: () => ({
            getPending: () => [],
            getHistory: () => [],
            accept: vi.fn((/** @type {string} */ id) => (id === 'h-1' ? { accepted: true } : { accepted: false })),
            reject: vi.fn((/** @type {string} */ _id, /** @type {string | undefined} */ _reason) => ({
                rejected: true,
            })),
        }),
    },
}));

vi.mock('../../../../src/copilot/terminal/dialog.js', () => ({
    sendTurn: mockSendTurn,
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

// ─── handleGetContext ─────────────────────────────────────────────────────────

describe('handlers/agent — handleGetContext', () => {
    it('retorna utilização e warning', () => {
        const result = handleGetContext();
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(result.body.tokens).toBe(50000);
        expect(result.body.utilizationPercent).toBe(39);
        expect(result.body.warning).toBe('none');
    });
});

// ─── handlePipeline — validação ───────────────────────────────────────────────

describe('handlers/agent — handlePipeline validação', () => {
    it('rejeita body sem steps', async () => {
        const result = await handlePipeline({});
        expect(result.status).toBe(400);
        expect(result.body.error).toContain('steps');
    });

    it('rejeita steps vazio', async () => {
        const result = await handlePipeline({ steps: [] });
        expect(result.status).toBe(400);
    });

    it('rejeita >20 steps', async () => {
        const steps = Array.from({ length: 21 }, (_, i) => ({ prompt: `p${i}` }));
        const result = await handlePipeline({ steps });
        expect(result.status).toBe(400);
        expect(result.body.error).toContain('20');
    });

    it('executa pipeline com 1 step', async () => {
        mockSendTurn.mockResolvedValueOnce('ok-reply');
        const result = await handlePipeline({ steps: [{ prompt: 'test' }] });
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(result.body.results.length).toBe(1);
    });
});

// ─── handleInject — validação ─────────────────────────────────────────────────

describe('handlers/agent — handleInject validação', () => {
    it('rejeita body sem message', async () => {
        const result = await handleInject({});
        expect(result.status).toBe(400);
        expect(result.body.error).toContain('message');
    });

    it('rejeita message vazia (whitespace)', async () => {
        const result = await handleInject({ message: '   ' });
        expect(result.status).toBe(400);
    });

    it('injeta message válida e retorna reply', async () => {
        mockSendTurn.mockResolvedValueOnce('resposta');
        const result = await handleInject({ message: 'hello' });
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(result.body.reply).toBe('resposta');
    });

    it('projeta AbortError para 504', async () => {
        mockSendTurn.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
        const result = await handleInject({ message: 'timeout please' });
        expect(result.status).toBe(504);
        expect(result.body.disposition).toBe('ignore');
        expect(result.body.retryable).toBe(false);
    });
});

// ─── Pause / Resume ──────────────────────────────────────────────────────────

describe('handlers/agent — dialog pause/resume', () => {
    it('handleDialogPause retorna 409 se loop inativo', async () => {
        const result = await handleDialogPause();
        expect(result.status).toBe(409);
    });

    it('handleDialogResume tenta retomar loop', async () => {
        // dialogLoopActive already false in mock, so resume should try
        const result = await handleDialogResume();
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
    });

    it('handleDialogResume projeta erro de sessão para 503', async () => {
        const { alwaysAliveAgent } = await import('#copilot/agent');
        alwaysAliveAgent.resumeDialogLoop.mockRejectedValueOnce(
            Object.assign(new Error('agente parado'), { code: 'AGENT_STOPPED' }),
        );

        const result = await handleDialogResume();

        expect(result.status).toBe(503);
        expect(result.body.code).toBe('AGENT_STOPPED');
        expect(result.body.ok).toBe(false);
    });
});

// ─── Handoff API ──────────────────────────────────────────────────────────────

describe('handlers/agent — handoff', () => {
    it('handleGetHandoffs retorna pending e history', () => {
        const result = handleGetHandoffs();
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
        expect(Array.isArray(result.body.pending)).toBe(true);
        expect(Array.isArray(result.body.history)).toBe(true);
    });

    it('handleAcceptHandoff rejeita sem handoffId', () => {
        const result = handleAcceptHandoff({});
        expect(result.status).toBe(400);
    });

    it('handleAcceptHandoff aceita id válido', () => {
        const result = handleAcceptHandoff({ handoffId: 'h-1' });
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
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
        expect(result.status).toBe(200);
        expect(result.body.ok).toBe(true);
    });
});
