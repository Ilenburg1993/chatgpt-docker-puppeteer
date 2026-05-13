// @ts-check

import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import express from 'express';
import supertest from 'supertest';
import { copilotErrorHandler } from '../../../src/copilot/server/middleware/error-handler.js';

const mocks = vi.hoisted(() => ({
    resolveRequestedRuntimeId: vi.fn((req) => {
        const value = typeof req.query?.runtimeId === 'string' ? req.query.runtimeId : null;
        return value;
    }),
    buildRuntimeWebhooksListHttpPayload: vi.fn((runtimeId) => ({
        ...(runtimeId === 'missing'
            ? (() => {
                  throw Object.assign(new Error("Runtime 'missing' não encontrado."), {
                      name: 'NotFoundError',
                      code: 'AGENT_RUNTIME_NOT_FOUND',
                      status: 404,
                  });
              })()
            : {}),
        ok: true,
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId ?? 'default',
        runtimeFound: true,
        usedDefaultRuntimeFallback: false,
        count: 1,
        webhooks: [{ id: 'wh-1', url: 'https://example.test/hook' }],
    })),
    registerRuntimeWebhookHttp: vi.fn((url, runtimeId) => ({
        ...(runtimeId === 'missing'
            ? (() => {
                  throw Object.assign(new Error("Runtime 'missing' não encontrado."), {
                      name: 'NotFoundError',
                      code: 'AGENT_RUNTIME_NOT_FOUND',
                      status: 404,
                  });
              })()
            : {}),
        ok: true,
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId ?? 'default',
        runtimeFound: true,
        usedDefaultRuntimeFallback: false,
        id: 'wh-1',
        url,
    })),
    unregisterRuntimeWebhookHttp: vi.fn((id, runtimeId) => ({
        ...(runtimeId === 'missing'
            ? (() => {
                  throw Object.assign(new Error("Runtime 'missing' não encontrado."), {
                      name: 'NotFoundError',
                      code: 'AGENT_RUNTIME_NOT_FOUND',
                      status: 404,
                  });
              })()
            : {}),
        ok: true,
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId ?? 'default',
        runtimeFound: true,
        usedDefaultRuntimeFallback: false,
        id,
    })),
}));

vi.mock('../../../src/copilot/presentation/routing/index.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        resolveRequestedRuntimeId: mocks.resolveRequestedRuntimeId,
    };
});

vi.mock('../../../src/copilot/presentation/runtime/webhooks.js', () => ({
    buildRuntimeWebhooksListHttpPayload: mocks.buildRuntimeWebhooksListHttpPayload,
    registerRuntimeWebhookHttp: mocks.registerRuntimeWebhookHttp,
    unregisterRuntimeWebhookHttp: mocks.unregisterRuntimeWebhookHttp,
}));

const { webhooksRouter } = await import('../../../src/copilot/server/routes/webhooks.js');

function createApp() {
    const app = express();
    app.use(express.json());
    app.use(webhooksRouter);
    app.use(copilotErrorHandler);
    return app;
}

describe('server/routes/webhooks.js', () => {
    it('retorna 404 quando o runtime pedido não existe', async () => {
        const res = await supertest(createApp()).get('/webhooks?runtimeId=missing').expect(404);

        assert.equal(res.body.ok, false);
        assert.equal(res.body.code, 'AGENT_RUNTIME_NOT_FOUND');
        assert.equal(res.body.requestedRuntimeId, 'missing');
        assert.equal(res.body.runtimeFound, false);
        assert.equal(res.body.usedDefaultRuntimeFallback, false);
        assert.match(res.body.error, /Runtime 'missing' não encontrado/);
    });
});
