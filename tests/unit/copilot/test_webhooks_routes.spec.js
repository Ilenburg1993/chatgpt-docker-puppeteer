// @ts-check

import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import express from 'express';
import supertest from 'supertest';

const mocks = vi.hoisted(() => ({
    resolveRequestedRuntimeId: vi.fn((req) => {
        const value = typeof req.query?.runtimeId === 'string' ? req.query.runtimeId : null;
        return value;
    }),
    buildRuntimeWebhooksListHttpPayload: vi.fn((runtimeId) => ({
        ok: true,
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId === 'missing' ? 'default' : (runtimeId ?? 'default'),
        runtimeFound: runtimeId !== 'missing',
        usedDefaultRuntimeFallback: runtimeId === 'missing',
        count: 1,
        webhooks: [{ id: 'wh-1', url: 'https://example.test/hook' }],
    })),
    registerRuntimeWebhookHttp: vi.fn((url, runtimeId) => ({
        ok: true,
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId === 'missing' ? 'default' : (runtimeId ?? 'default'),
        runtimeFound: runtimeId !== 'missing',
        usedDefaultRuntimeFallback: runtimeId === 'missing',
        id: 'wh-1',
        url,
    })),
    unregisterRuntimeWebhookHttp: vi.fn((id, runtimeId) => ({
        ok: true,
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId === 'missing' ? 'default' : (runtimeId ?? 'default'),
        runtimeFound: runtimeId !== 'missing',
        usedDefaultRuntimeFallback: runtimeId === 'missing',
        id,
    })),
}));

vi.mock('../../../src/copilot/presentation/runtime-request.js', () => ({
    resolveRequestedRuntimeId: mocks.resolveRequestedRuntimeId,
}));

vi.mock('../../../src/copilot/presentation/runtime-webhooks.js', () => ({
    buildRuntimeWebhooksListHttpPayload: mocks.buildRuntimeWebhooksListHttpPayload,
    registerRuntimeWebhookHttp: mocks.registerRuntimeWebhookHttp,
    unregisterRuntimeWebhookHttp: mocks.unregisterRuntimeWebhookHttp,
}));

const { webhooksRouter } = await import('../../../src/copilot/server/routes/webhooks.js');

function createApp() {
    const app = express();
    app.use(express.json());
    app.use(webhooksRouter);
    return app;
}

describe('server/routes/webhooks.js', () => {
    it('expõe metadata de fallback quando o runtime pedido não existe', async () => {
        const res = await supertest(createApp()).get('/webhooks?runtimeId=missing').expect(200);

        assert.equal(res.body.runtimeId, 'default');
        assert.equal(res.body.requestedRuntimeId, 'missing');
        assert.equal(res.body.runtimeFound, false);
        assert.equal(res.body.usedDefaultRuntimeFallback, true);
        assert.equal(res.body.count, 1);
    });
});
