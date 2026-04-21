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
    resolveRuntimeWebhookSelection: vi.fn((runtimeId) => ({
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId === 'missing' ? 'default' : (runtimeId ?? 'default'),
        runtimeFound: runtimeId !== 'missing',
        usedDefaultRuntimeFallback: runtimeId === 'missing',
        agent: {},
    })),
    listRuntimeWebhooks: vi.fn(() => [{ id: 'wh-1', url: 'https://example.test/hook' }]),
    registerRuntimeWebhook: vi.fn((url) => ({ id: 'wh-1', url })),
    unregisterRuntimeWebhook: vi.fn(() => true),
}));

vi.mock('../../../src/copilot/presentation/runtime-request.js', () => ({
    resolveRequestedRuntimeId: mocks.resolveRequestedRuntimeId,
}));

vi.mock('../../../src/copilot/presentation/runtime-webhooks.js', () => ({
    resolveRuntimeWebhookSelection: mocks.resolveRuntimeWebhookSelection,
    listRuntimeWebhooks: mocks.listRuntimeWebhooks,
    registerRuntimeWebhook: mocks.registerRuntimeWebhook,
    unregisterRuntimeWebhook: mocks.unregisterRuntimeWebhook,
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
