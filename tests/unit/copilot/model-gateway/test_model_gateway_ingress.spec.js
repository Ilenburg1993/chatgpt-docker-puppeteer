// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    buildModelGatewayIngressSessionOverrides,
    buildModelGatewayIngressUpstreamRequest,
    createModelGatewayIngressRoute,
    proxyModelGatewayIngressOpenAIChatCompletions,
    redactModelGatewayIngressRoute,
} from '../../../../src/copilot/model-gateway/index.js';

describe('model gateway dynamic ingress', () => {
    it('cria rota SDK-facing OpenAI-compatible sem credenciais na URL', () => {
        const route = createModelGatewayIngressRoute({
            sessionId: 'sdk-session-1',
            publicBaseUrl: 'http://127.0.0.1:4567/',
            now: Date.parse('2026-06-16T12:00:00.000Z'),
            ttlMs: 60_000,
            route: {
                providerId: 'ollama-cloud',
                providerModel: 'qwen3-coder-next',
                openAICompatibleBaseUrl: 'https://ollama.com/v1',
                routeProfile: 'repo_agent',
                selectedRouteKey: 'ollama-cloud:qwen3-coder-next',
                capabilities: { supports: { reasoningEffort: false } },
            },
        });

        expect(route.routeId).toMatch(/^mgw-ingress-/u);
        expect(route.sdkBaseUrl).toContain('/v1/model-gateway-ingress/');
        expect(route.upstreamChatCompletionsUrl).toBe('https://ollama.com/v1/chat/completions');
        expect(route.expiresAt).toBe('2026-06-16T12:01:00.000Z');
        expect(redactModelGatewayIngressRoute(route)).not.toHaveProperty('targetRoute');

        const overrides = buildModelGatewayIngressSessionOverrides(route, { localApiKey: 'local-only' });
        expect(overrides).toMatchObject({
            model: 'qwen3-coder-next',
            provider: {
                type: 'openai',
                baseUrl: route.sdkBaseUrl,
                apiKey: 'local-only',
            },
        });
    });

    it('rejeita upstream com credenciais embutidas ou protocolo inseguro', () => {
        expect(() =>
            createModelGatewayIngressRoute({
                sessionId: 'sdk-session-1',
                publicBaseUrl: 'http://127.0.0.1:4567',
                route: {
                    providerId: 'bad',
                    providerModel: 'bad/model',
                    baseUrl: 'https://user:secret@example.test/v1',
                },
            }),
        ).toThrow(/CREDENTIALS/u);

        expect(() =>
            createModelGatewayIngressRoute({
                sessionId: 'sdk-session-1',
                publicBaseUrl: 'http://127.0.0.1:4567',
                route: {
                    providerId: 'bad',
                    providerModel: 'bad/model',
                    baseUrl: 'file:///tmp/socket',
                },
            }),
        ).toThrow(/UNSUPPORTED_PROTOCOL/u);
    });

    it('reescreve model, remove auth do cliente e injeta auth upstream confiável', () => {
        const route = createModelGatewayIngressRoute({
            sessionId: 'sdk-session-1',
            publicBaseUrl: 'http://127.0.0.1:4567',
            route: {
                providerId: 'kilo-code',
                providerModel: 'kilo-auto/free',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                selectedRouteKey: 'kilo-code:kilo-auto/free',
            },
        });

        const upstream = buildModelGatewayIngressUpstreamRequest(route, {
            path: '/chat/completions',
            headers: {
                authorization: 'Bearer client-token',
                'x-api-key': 'client-key',
                accept: 'text/event-stream',
                connection: 'keep-alive',
            },
            upstreamAuthHeaders: {
                authorization: 'Bearer upstream-token',
                'x-provider-feature': 'enabled',
            },
            body: {
                model: 'sdk-visible-model',
                stream: true,
                messages: [{ role: 'user', content: 'oi' }],
                tools: [{ type: 'function', function: { name: 'ping' } }],
            },
        });

        expect(upstream.url).toBe('https://api.kilo.ai/api/gateway/chat/completions');
        expect(upstream.init.headers).toMatchObject({
            accept: 'text/event-stream',
            authorization: 'Bearer upstream-token',
            'x-provider-feature': 'enabled',
            'content-type': 'application/json',
        });
        expect(upstream.init.headers).not.toHaveProperty('x-api-key');
        expect(upstream.init.headers).not.toHaveProperty('connection');
        expect(JSON.parse(upstream.init.body)).toMatchObject({
            model: 'kilo-auto/free',
            stream: true,
            messages: [{ role: 'user', content: 'oi' }],
            tools: [{ type: 'function', function: { name: 'ping' } }],
        });
    });

    it('executa fetch injetado sem chamar rede real', async () => {
        const route = createModelGatewayIngressRoute({
            sessionId: 'sdk-session-1',
            publicBaseUrl: 'http://127.0.0.1:4567',
            route: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                baseUrl: 'https://openrouter.ai/api/v1',
            },
        });
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));

        const result = await proxyModelGatewayIngressOpenAIChatCompletions(route, {
            path: '/chat/completions',
            body: JSON.stringify({ model: 'placeholder', messages: [] }),
            fetchImpl,
            resolveUpstreamAuthHeaders: () => ({ authorization: 'Bearer upstream-token' }),
        });

        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/chat/completions',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ authorization: 'Bearer upstream-token' }),
            }),
        );
        expect(result).toMatchObject({
            providerId: 'openrouter',
            providerModel: 'openrouter/free',
            response: { ok: true, status: 200 },
        });
    });
});
