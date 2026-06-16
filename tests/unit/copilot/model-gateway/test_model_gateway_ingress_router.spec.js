// @ts-check

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
    createModelGatewayIngressRoute,
    createModelGatewayIngressRouteRegistry,
} from '../../../../src/copilot/model-gateway/index.js';
import { createModelGatewayIngressRouter } from '../../../../src/copilot/server/routes/model-gateway-ingress.js';

function createIngressTestApp(options) {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(createModelGatewayIngressRouter(options));
    return app;
}

describe('model gateway ingress HTTP router', () => {
    it('proxy OpenAI-compatible usa auth local, registry e auth upstream confiável', async () => {
        const registry = createModelGatewayIngressRouteRegistry();
        const route = createModelGatewayIngressRoute({
            sessionId: 'sdk-session-http',
            publicBaseUrl: 'http://127.0.0.1:4567',
            route: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                baseUrl: 'https://openrouter.ai/api/v1',
            },
        });
        registry.register({
            ingressRoute: route,
            localApiKey: 'local-route-key',
            upstreamAuthHeaders: { authorization: 'Bearer upstream-token' },
            metadata: { source: 'unit-test' },
        });
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify({ id: 'chatcmpl-test' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
        );
        const app = createIngressTestApp({ registry, fetchImpl });

        const res = await request(app)
            .post(`/v1/model-gateway-ingress/${route.routeId}/chat/completions`)
            .set('authorization', 'Bearer local-route-key')
            .set('x-api-key', 'client-key-that-must-not-forward')
            .send({ model: 'sdk-visible-model', messages: [{ role: 'user', content: 'oi' }], stream: true })
            .expect(200);

        expect(res.body).toEqual({ id: 'chatcmpl-test' });
        expect(fetchImpl).toHaveBeenCalledOnce();
        const [, init] = fetchImpl.mock.calls[0];
        expect(init.headers).toMatchObject({ authorization: 'Bearer upstream-token' });
        expect(init.headers).not.toHaveProperty('x-api-key');
        expect(JSON.parse(init.body)).toMatchObject({
            model: 'openrouter/free',
            messages: [{ role: 'user', content: 'oi' }],
            stream: true,
        });
    });

    it('bloqueia rota existente sem chave local e não chama upstream', async () => {
        const registry = createModelGatewayIngressRouteRegistry();
        const route = createModelGatewayIngressRoute({
            sessionId: 'sdk-session-http',
            publicBaseUrl: 'http://127.0.0.1:4567',
            route: {
                providerId: 'groq',
                providerModel: 'llama-test',
                baseUrl: 'https://api.groq.com/openai/v1',
            },
        });
        registry.register({ ingressRoute: route, localApiKey: 'local-route-key' });
        const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
        const app = createIngressTestApp({ registry, fetchImpl });

        const res = await request(app)
            .post(`/v1/model-gateway-ingress/${route.routeId}/chat/completions`)
            .send({ model: 'sdk-visible-model', messages: [] })
            .expect(401);

        expect(res.body.error).toBe('MODEL_GATEWAY_INGRESS_UNAUTHORIZED');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('retorna 404 para routeId desconhecido', async () => {
        const registry = createModelGatewayIngressRouteRegistry();
        const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
        const app = createIngressTestApp({ registry, fetchImpl });

        const res = await request(app)
            .post('/v1/model-gateway-ingress/missing/chat/completions')
            .set('authorization', 'Bearer local-route-key')
            .send({ model: 'sdk-visible-model', messages: [] })
            .expect(404);

        expect(res.body.error).toBe('MODEL_GATEWAY_INGRESS_ROUTE_NOT_FOUND');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
