import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleInject = vi.fn(async (params) => ({
    status: 200,
    body: { ok: true, accepted: params?.body ?? null },
}));

const handlePipeline = vi.fn(async (params) => ({
    status: 200,
    body: { ok: true, accepted: params?.body ?? null },
}));

vi.mock('../../../src/copilot/presentation/agent-control.js', () => ({
    handleAcceptHandoff: vi.fn(() => ({ status: 200, body: { ok: true } })),
    handleDialogPause: vi.fn(() => ({ status: 200, body: { ok: true } })),
    handleDialogResume: vi.fn(() => ({ status: 200, body: { ok: true } })),
    handleGetContext: vi.fn(() => ({ status: 200, body: { ok: true } })),
    handleGetHandoffs: vi.fn(() => ({ status: 200, body: { ok: true, pending: [], history: [] } })),
    handleInject,
    handlePipeline,
    handleRejectHandoff: vi.fn(() => ({ status: 200, body: { ok: true } })),
}));

vi.mock('../../../src/copilot/presentation/system-metrics.js', () => ({
    handleGetPrBudget: vi.fn(() => ({ status: 200, body: { ok: true } })),
    handleGetQuota: vi.fn(() => ({ status: 200, body: { ok: true } })),
}));

vi.mock('../../../src/copilot/server/middleware/rate-limiter.js', () => ({
    injectRateMiddleware: (
        /** @type {any} */ _req,
        /** @type {any} */ _res,
        /** @type {Function} */ next
    ) => next(),
    writeRateMiddleware: (
        /** @type {any} */ _req,
        /** @type {any} */ _res,
        /** @type {Function} */ next
    ) => next(),
}));

describe('server/routes/agent validation', () => {
    beforeEach(() => {
        handleInject.mockClear();
        handlePipeline.mockClear();
    });

    async function createApp() {
        const { createAgentRouter } = await import('../../../src/copilot/server/routes/agent.js');
        const app = express();
        app.use(express.json());
        app.use(createAgentRouter());
        return app;
    }

    it('aceita POST /inject com body.message canônico', async () => {
        const app = await createApp();

        const res = await request(app)
            .post('/inject')
            .send({ message: 'hello from message', from: 'llm-a' })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(handleInject).toHaveBeenCalledTimes(1);
        expect(handleInject.mock.calls[0]?.[0]).toMatchObject({
            body: { message: 'hello from message', from: 'llm-a' },
        });
    });

    it('aceita POST /inject com body.content retrocompatível', async () => {
        const app = await createApp();

        const res = await request(app).post('/inject').send({ content: 'hello from content' }).expect(200);

        expect(res.body.ok).toBe(true);
        expect(handleInject).toHaveBeenCalledTimes(1);
        expect(handleInject.mock.calls[0]?.[0]).toMatchObject({
            body: { content: 'hello from content' },
        });
    });

    it('rejeita POST /inject sem message nem content', async () => {
        const app = await createApp();

        const res = await request(app).post('/inject').send({ from: 'llm-a' }).expect(400);

        expect(res.body.ok).toBe(false);
        expect(res.body.error).toBe('Validation failed');
        expect(handleInject).not.toHaveBeenCalled();
    });

    it('aceita POST /pipeline com steps canônicos', async () => {
        const app = await createApp();

        const res = await request(app)
            .post('/pipeline')
            .send({
                from: 'llm-a',
                steps: [
                    { prompt: 'primeiro passo', waitMs: 10 },
                    { prompt: 'segundo passo', from: 'system' },
                ],
            })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(handlePipeline).toHaveBeenCalledTimes(1);
        expect(handlePipeline.mock.calls[0]?.[0]).toMatchObject({
            body: {
                from: 'llm-a',
                steps: [
                    { prompt: 'primeiro passo', waitMs: 10 },
                    { prompt: 'segundo passo', from: 'system' },
                ],
            },
        });
    });

    it('rejeita POST /pipeline com shape legado sem prompt', async () => {
        const app = await createApp();

        const res = await request(app)
            .post('/pipeline')
            .send({ steps: [{ type: 'legacy-step', config: { foo: 'bar' } }] })
            .expect(400);

        expect(res.body.ok).toBe(false);
        expect(res.body.error).toBe('Validation failed');
        expect(handlePipeline).not.toHaveBeenCalled();
    });
});
