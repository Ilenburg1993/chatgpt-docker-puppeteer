// @ts-check

import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';

import express from 'express';
import request from 'supertest';

import createAgentRouter from '../../../src/copilot/server/routes/sdk/agent.js';
import createClientRouter from '../../../src/copilot/server/routes/sdk/client.js';
import createObservabilityRouter from '../../../src/copilot/server/routes/sdk/observability.js';

function createMissingRuntimeError(runtimeId = 'missing') {
    return Object.assign(new Error(`Runtime '${runtimeId}' não encontrado.`), {
        name: 'NotFoundError',
        code: 'AGENT_RUNTIME_NOT_FOUND',
        status: 404,
    });
}

/**
 * @param {import('express').Request} req
 * @returns {any}
 */
function rejectMissingRuntimeRoute(req) {
    const runtimeId = typeof req.query?.runtimeId === 'string' ? req.query.runtimeId : null;
    if (runtimeId === 'missing') {
        throw createMissingRuntimeError(runtimeId);
    }
    return /** @type {any} */ ({});
}

/**
 * @param {Record<string, unknown>} body
 * @returns {void}
 */
function assertMissingRuntimeBody(body) {
    assert.equal(body.ok, false);
    assert.equal(body.code, 'AGENT_RUNTIME_NOT_FOUND');
    assert.equal(body.requestedRuntimeId, 'missing');
    assert.equal(body.runtimeFound, false);
    assert.equal(body.usedDefaultRuntimeFallback, false);
    assert.match(String(body.error), /Runtime 'missing' não encontrado/);
}

const sessionRouterMocks = vi.hoisted(() => ({
    resolveSdkRouteSharedDeps: vi.fn((req) => {
        const runtimeId = typeof req.query?.runtimeId === 'string' ? req.query.runtimeId : null;
        if (runtimeId === 'missing') {
            throw createMissingRuntimeError(runtimeId);
        }
        return {
            sdkApiToken: null,
            sdkRuntimeProjection: {
                buildRuntimeRouteMetaPayload: () => ({ runtimeId: 'default', runtimeFound: true }),
            },
        };
    }),
}));

vi.mock('../../../src/copilot/server/routes/sdk/deps.js', () => ({
    resolveSdkRouteSharedDeps: sessionRouterMocks.resolveSdkRouteSharedDeps,
}));

vi.mock('../../../src/copilot/server/routes/sdk/session-crud.js', async () => {
    const { Router } = await import('express');
    const router = Router();
    router.get('/sessions/active', (_req, res) => {
        res.json({ ok: true, source: 'crud' });
    });
    return { default: router };
});

vi.mock('../../../src/copilot/server/routes/sdk/session-messaging.js', async () => {
    const { Router } = await import('express');
    return { default: Router() };
});

describe('sdk strict runtime targeting — HTTP routes', () => {
    it('client router retorna 404 sem fallback quando a seleção de runtime falha no binding', async () => {
        const app = express();
        app.use(createClientRouter(rejectMissingRuntimeRoute));

        const res = await request(app).get('/models?runtimeId=missing').expect(404);

        assertMissingRuntimeBody(res.body);
    });

    it('sessions router responde 404 semântico antes do auth quando runtimeId explícito não existe', async () => {
        const { default: sessionsRouter } = await import('../../../src/copilot/server/routes/sdk/sessions.js');
        const app = express();
        app.use(sessionsRouter);

        const res = await request(app).get('/sessions/active?runtimeId=missing').expect(404);

        expect(sessionRouterMocks.resolveSdkRouteSharedDeps).toHaveBeenCalled();
        assertMissingRuntimeBody(res.body);
    });

    it('agent router protege rotas de leitura que resolvem deps diretamente', async () => {
        const app = express();
        app.use(createAgentRouter(rejectMissingRuntimeRoute));

        const tools = await request(app).get('/agent/tools?runtimeId=missing').expect(404);
        assertMissingRuntimeBody(tools.body);

        const telemetry = await request(app).get('/agent/telemetry?runtimeId=missing').expect(404);
        assertMissingRuntimeBody(telemetry.body);

        const clear = await request(app).post('/agent/telemetry/clear?runtimeId=missing').expect(404);
        assertMissingRuntimeBody(clear.body);
    });

    it('hooks registry usa projeção canônica quando runtimeId explícito não existe', async () => {
        const { default: hooksRouter } = await import('../../../src/copilot/server/routes/sdk/hooks.js');
        const app = express();
        app.use(hooksRouter);

        const res = await request(app).get('/hooks/registry?runtimeId=missing').expect(404);

        assertMissingRuntimeBody(res.body);
    });

    it('observability router protege rotas auxiliares de leitura', async () => {
        const app = express();
        app.use(createObservabilityRouter(rejectMissingRuntimeRoute));

        const otel = await request(app).get('/observability/otel-status?runtimeId=missing').expect(404);
        assertMissingRuntimeBody(otel.body);

        const catalog = await request(app).get('/observability/events/catalog?runtimeId=missing').expect(404);
        assertMissingRuntimeBody(catalog.body);

        const deadLetter = await request(app).get('/observability/events/dead-letter?runtimeId=missing').expect(404);
        assertMissingRuntimeBody(deadLetter.body);
    });
});
