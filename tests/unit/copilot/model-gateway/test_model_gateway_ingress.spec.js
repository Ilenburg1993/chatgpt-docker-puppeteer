// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    buildModelGatewayIngressPublicBaseUrl,
    buildModelGatewayIngressSessionOverrides,
    buildModelGatewayIngressUpstreamRequest,
    createModelGatewayIngressLocalApiKey,
    createModelGatewayIngressRoute,
    createModelGatewayIngressRouteRegistry,
    proxyModelGatewayIngressOpenAIChatCompletions,
    redactModelGatewayIngressRoute,
} from '../../../../src/copilot/model-gateway/index.js';

describe('model gateway dynamic ingress', () => {
    it('gera credencial local não persistível e normaliza wildcard para loopback conectável', () => {
        const localApiKey = createModelGatewayIngressLocalApiKey({
            randomBytesImpl: (size) => Buffer.alloc(size, 0xab),
        });

        expect(localApiKey).toMatch(/^mgw-local-[A-Za-z0-9_-]{43}$/u);
        expect(localApiKey).not.toBe('model-gateway-ingress-local');
        expect(buildModelGatewayIngressPublicBaseUrl({ host: '0.0.0.0', port: 3009 })).toBe('http://127.0.0.1:3009');
        expect(buildModelGatewayIngressPublicBaseUrl({ host: '::', port: 3009 })).toBe('http://127.0.0.1:3009');
        expect(buildModelGatewayIngressPublicBaseUrl({ host: '::1', port: 3009 })).toBe('http://[::1]:3009');
        expect(() => buildModelGatewayIngressPublicBaseUrl({ host: '127.0.0.1', port: 0 })).toThrow(
            /PUBLIC_PORT_INVALID/u,
        );
    });

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

    it('mantém rota SDK-facing estável enquanto o target upstream muda no registry', () => {
        const baseInput = {
            sessionId: 'sdk-session-1',
            publicBaseUrl: 'http://127.0.0.1:4567',
        };
        const first = createModelGatewayIngressRoute({
            ...baseInput,
            route: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                baseUrl: 'https://openrouter.ai/api/v1',
                sdkRouteKey: 'sdk-session-1:live-provider',
                sdkVisibleModel: 'model-gateway-live',
            },
        });
        const second = createModelGatewayIngressRoute({
            ...baseInput,
            route: {
                providerId: 'groq',
                providerModel: 'llama-test',
                baseUrl: 'https://api.groq.com/openai/v1',
                sdkRouteKey: 'sdk-session-1:live-provider',
                sdkVisibleModel: 'model-gateway-live',
            },
        });
        const registry = createModelGatewayIngressRouteRegistry();

        const firstEntry = registry.register({
            ingressRoute: first,
            localApiKey: 'local-route-key-v1',
            expectedRevision: null,
            now: Date.parse('2026-06-16T12:00:00.000Z'),
        });
        expect(() => registry.register({ ingressRoute: second, localApiKey: 'stale-writer-key' })).toThrow(
            /REVISION_CONFLICT/u,
        );
        const secondEntry = registry.register({
            ingressRoute: second,
            localApiKey: 'local-route-key-v2',
            expectedRevision: firstEntry.revision,
            now: Date.parse('2026-06-16T12:00:01.000Z'),
        });

        expect(second.routeId).toBe(first.routeId);
        expect(second.sdkBaseUrl).toBe(first.sdkBaseUrl);
        expect(buildModelGatewayIngressSessionOverrides(second, { localApiKey: 'local-route-key-v2' }).model).toBe(
            'model-gateway-live',
        );
        expect(secondEntry).toMatchObject({
            revision: 2,
            registeredAt: '2026-06-16T12:00:00.000Z',
            updatedAt: '2026-06-16T12:00:01.000Z',
        });
        expect(registry.get(first.routeId)?.ingressRoute).toMatchObject({
            providerId: 'groq',
            providerModel: 'llama-test',
            sdkVisibleModel: 'model-gateway-live',
        });
        expect(registry.listRedacted()[0]).toMatchObject({
            revision: 2,
            targetFingerprint: secondEntry.targetFingerprint,
        });
    });

    it('restaura snapshot somente contra a revisão esperada e mantém revisão monotônica', () => {
        const registry = createModelGatewayIngressRouteRegistry();
        const first = createModelGatewayIngressRoute({
            sessionId: 'sdk-session-rollback',
            publicBaseUrl: 'http://127.0.0.1:4567',
            route: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                baseUrl: 'https://openrouter.ai/api/v1',
                sdkRouteKey: 'sdk-session-rollback:live-provider',
                sdkVisibleModel: 'model-gateway-live',
            },
        });
        const second = createModelGatewayIngressRoute({
            sessionId: 'sdk-session-rollback',
            publicBaseUrl: 'http://127.0.0.1:4567',
            route: {
                providerId: 'groq',
                providerModel: 'llama-test',
                baseUrl: 'https://api.groq.com/openai/v1',
                sdkRouteKey: 'sdk-session-rollback:live-provider',
                sdkVisibleModel: 'model-gateway-live',
            },
        });

        const firstEntry = registry.register({
            ingressRoute: first,
            localApiKey: 'rollback-key-v1',
            expectedRevision: null,
            now: Date.parse('2026-06-16T12:00:00.000Z'),
        });
        const snapshot = registry.snapshot(first.routeId, {
            now: Date.parse('2026-06-16T12:00:00.500Z'),
        });
        expect(snapshot).not.toBeNull();
        const secondEntry = registry.register({
            ingressRoute: second,
            localApiKey: 'rollback-key-v2',
            expectedRevision: firstEntry.revision,
            now: Date.parse('2026-06-16T12:00:01.000Z'),
        });

        expect(() =>
            registry.restore(/** @type {NonNullable<typeof snapshot>} */ (snapshot), {
                expectedRevision: firstEntry.revision,
            }),
        ).toThrow(/REVISION_CONFLICT/u);

        const restored = registry.restore(/** @type {NonNullable<typeof snapshot>} */ (snapshot), {
            expectedRevision: secondEntry.revision,
            now: Date.parse('2026-06-16T12:00:02.000Z'),
            metadata: { source: 'unit.rollback' },
        });

        expect(restored).toMatchObject({
            revision: 3,
            localApiKey: 'rollback-key-v1',
            ingressRoute: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
            },
            metadata: {
                source: 'unit.rollback',
                restoredFromRevision: 1,
                rollbackOfRevision: 2,
            },
        });
        expect(registry.listRedacted()[0]).not.toHaveProperty('localApiKey');
        expect(registry.listRedacted()[0]).not.toHaveProperty('upstreamAuthHeaders');
    });

    it('exige credencial local explícita para overrides e registry', () => {
        const route = createModelGatewayIngressRoute({
            sessionId: 'sdk-session-key-required',
            publicBaseUrl: 'http://127.0.0.1:4567',
            route: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                baseUrl: 'https://openrouter.ai/api/v1',
            },
        });
        const registry = createModelGatewayIngressRouteRegistry();

        expect(() => buildModelGatewayIngressSessionOverrides(route, /** @type {any} */ ({}))).toThrow(
            /LOCAL_API_KEY_REQUIRED/u,
        );
        expect(() =>
            registry.register({
                ingressRoute: route,
                localApiKey: '',
                expectedRevision: null,
            }),
        ).toThrow(/LOCAL_API_KEY_REQUIRED/u);
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
