// @ts-check
/**
 * Unit tests for the canonical model gateway foundation.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

import {
    JsonModelGatewayRegistryStore,
    listProviderEndpointInventory,
    listModelGatewayTaskProfiles,
    ModelGatewayRegistry,
    MODEL_GATEWAY_TASK_PROFILES,
    anthropicAdapter,
    buildEnvByokModelGatewaySnapshot,
    buildModelGatewayOperatorProjection,
    buildProviderModelId,
    buildProbeCompletedEvent,
    buildRegistrySnapshotEvent,
    buildRouteDecisionEvent,
    createModelRecord,
    createEnvSecretRegistry,
    buildModelGatewayOnListModelsHandler,
    evaluateGatewayModelHealthRoute,
    geminiAdapter,
    ollamaAdapter,
    openAICompatibleAdapter,
    OPENAI_PROVIDER_FAMILY_SPECS,
    openRouterAdapter,
    persistEnvByokModelGatewaySnapshot,
    projectProbeCompletedMetrics,
    projectRouteDecisionMetrics,
    projectModelGatewayMetrics,
    redactSecretRecord,
    redactSecretText,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    listModelGatewayRouteDecisions,
    recordModelGatewayRouteDecision,
    resolveModelGatewayProviderAdapter,
    resolveProviderEndpointInventory,
    resolveModelGatewayTaskProfile,
    resetByokProviderHealthForTests,
    resetModelGatewayRouteDecisionLedgerForTests,
    routeGatewayModels,
    BYOK_AGENT_PROBE_ANSWER,
    BYOK_AGENT_PROBE_QUESTION,
    BYOK_AGENT_PROBE_READ_PATH,
    BYOK_AGENT_PROBE_READ_TOOL,
    BYOK_AGENT_PROBE_TOOL,
    BYOK_VISION_PROBE_DISPLAY_NAME,
    BYOK_VISION_PROBE_MIME_TYPE,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
    runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe,
    runConfiguredByokVisionProbe,
    scoreGatewayModelCandidate,
    toCopilotModelInfoList,
} from '../../../../src/copilot/model-gateway/index.js';

const PROVIDER_FAMILY_ENV_FIXTURES = Object.freeze([
    {
        preset: 'kilo-code',
        model: 'kilo-auto/free',
        secretKey: 'KILO_API_KEY',
        secretValue: 'kilo-secret-that-must-not-leak',
        expectedAdapter: 'kilo',
    },
    {
        preset: 'groq',
        model: 'qwen/qwen3-32b',
        secretKey: 'GROQ_KEY',
        secretValue: 'gsk-secret-that-must-not-leak',
        expectedAdapter: 'groq',
    },
    {
        preset: 'mistral',
        model: 'codestral-latest',
        secretKey: 'MISTRAL_KEY',
        secretValue: 'mistral-secret-that-must-not-leak',
        expectedAdapter: 'mistral',
    },
    {
        preset: 'huggingface',
        model: 'openai/gpt-oss-120b:fastest',
        secretKey: 'HUGGING_FACE_KEY',
        secretValue: 'hf-secret-that-must-not-leak',
        expectedAdapter: 'huggingface',
    },
    {
        preset: 'cloudflare-workers-ai',
        model: '@cf/meta/llama-3.1-8b-instruct',
        secretKey: 'CLOUDFLARE_KEY',
        secretValue: 'cfat-secret-that-must-not-leak',
        extraEnv: { CLOUDFLARE_ACCOUNT_ID: 'account-for-test' },
        expectedAdapter: 'cloudflare-workers-ai',
    },
    {
        preset: 'nvidia-nim',
        model: 'openai/gpt-oss-120b',
        secretKey: 'NVIDIA_KEY',
        secretValue: 'nvapi-secret-that-must-not-leak',
        expectedAdapter: 'nvidia-nim',
    },
    {
        preset: 'cerebras',
        model: 'gpt-oss-120b',
        secretKey: 'CEREBRAS_KEY',
        secretValue: 'csk-secret-that-must-not-leak',
        expectedAdapter: 'cerebras',
    },
    {
        preset: 'chutes',
        model: 'Qwen/Qwen3.5-397B-A17B-TEE',
        secretKey: 'CHUTES_AI',
        secretValue: 'cpk-secret-that-must-not-leak',
        expectedAdapter: 'chutes',
    },
    {
        preset: 'zai',
        model: 'glm-4.6',
        secretKey: 'Z_AI_KEY',
        secretValue: 'zai-secret-that-must-not-leak',
        expectedAdapter: 'zai',
    },
]);

describe('model-gateway foundation', () => {
    afterEach(() => {
        resetByokProviderHealthForTests();
        resetModelGatewayRouteDecisionLedgerForTests();
    });

    it('keeps provider/model identity distinct from provider-local SDK ids', () => {
        const registry = new ModelGatewayRegistry();
        registry.upsertProvider({ id: 'openrouter', providerType: 'openai', baseUrl: 'https://openrouter.ai/api/v1' });
        registry.upsertProvider({ id: 'groq', providerType: 'openai', baseUrl: 'https://api.groq.com/openai/v1' });
        registry.upsertModel({ providerId: 'openrouter', providerModel: 'openai/gpt-oss-120b', capabilities: { tools: true } });
        registry.upsertModel({ providerId: 'groq', providerModel: 'openai/gpt-oss-120b', capabilities: { tools: false } });

        assert.equal(registry.listModels().length, 2);
        assert.ok(registry.getModel('openrouter:openai/gpt-oss-120b'));
        assert.ok(registry.getModel('groq:openai/gpt-oss-120b'));

        const sdkModels = toCopilotModelInfoList(registry.listModels());
        assert.deepEqual(
            sdkModels.map((model) => model.id),
            ['openai/gpt-oss-120b', 'openai/gpt-oss-120b'],
        );
        assert.deepEqual(
            sdkModels.map((model) => model.byok?.gatewayId).sort(),
            ['groq:openai/gpt-oss-120b', 'openrouter:openai/gpt-oss-120b'],
        );
    });

    it('uses runtime health when routing gateway model candidates', () => {
        const registry = new ModelGatewayRegistry();
        registry.upsertProvider({ id: 'openrouter', providerType: 'openai' });
        registry.upsertProvider({ id: 'groq', providerType: 'openai' });
        registry.upsertModel({ providerId: 'openrouter', providerModel: 'model-a', capabilities: { tools: true } });
        registry.upsertModel({ providerId: 'groq', providerModel: 'model-b', capabilities: { tools: true } });

        recordByokProviderModelCallFailure({
            routeProfile: 'agent',
            providerId: 'openrouter',
            providerModel: 'model-a',
            message: 'rate limit',
            errorContext: 'provider.rate_limit',
            timestamp: 10,
        });
        recordByokProviderModelCallSuccess({
            routeProfile: 'agent',
            providerId: 'groq',
            providerModel: 'model-b',
            timestamp: 20,
        });
        recordByokProviderModelAgentProbeSuccess({
            routeProfile: 'agent',
            providerId: 'groq',
            providerModel: 'model-b',
            timestamp: 30,
        });

        assert.deepEqual(
            registry
                .findCandidates({ requires: ['tools'], health: { routeProfile: 'agent', excludeFailed: true } })
                .map((model) => model['id']),
            ['groq:model-b'],
        );
        assert.deepEqual(
            registry
                .findCandidates({
                    requires: ['tools'],
                    health: { routeProfile: 'agent', excludeFailed: true, requireAgentProbeOk: true },
                })
                .map((model) => model['id']),
            ['groq:model-b'],
        );
        assert.equal(
            evaluateGatewayModelHealthRoute(registry.getModel('openrouter:model-a') ?? {}, {
                routeProfile: 'agent',
                excludeFailed: true,
            }).reason,
            'chat_health_failed',
        );
    });

    it('defines canonical task profiles before provider-specific scoring', () => {
        assert.deepEqual(
            listModelGatewayTaskProfiles().map((profile) => profile.id),
            [
                'cheap_chat',
                'code',
                'repo_agent',
                'tool_agent',
                'json_extraction',
                'vision',
                'deep_reasoning',
                'local_private',
            ],
        );
        assert.equal(resolveModelGatewayTaskProfile('repo-agent')?.requireAgentProbeOk, true);
        assert.deepEqual(MODEL_GATEWAY_TASK_PROFILES.vision.requires, ['text', 'streaming']);
        assert.deepEqual(MODEL_GATEWAY_TASK_PROFILES.vision.softRequires, ['vision']);
        assert.equal(resolveModelGatewayTaskProfile('missing'), null);
    });

    it('treats vision as a soft routing preference rather than a hard admission gate', () => {
        const textOnly = createModelRecord({
            providerId: 'basic',
            providerModel: 'text-model',
            capabilities: { streaming: true },
            limits: { contextWindowTokens: 32_000 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });
        const multimodal = createModelRecord({
            providerId: 'visionary',
            providerModel: 'vision-model',
            capabilities: { streaming: true, vision: true },
            limits: { contextWindowTokens: 32_000 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });

        const decision = routeGatewayModels([textOnly, multimodal], 'vision', { routeProfile: 'vision' });

        assert.equal(decision.selected?.model['id'], 'visionary:vision-model');
        assert.deepEqual(
            decision.candidates.map((candidate) => candidate.model['id']),
            ['visionary:vision-model', 'basic:text-model'],
        );
        assert.equal(decision.rejected.some((candidate) => candidate.rejectedReasons.includes('missing_capability:vision')), false);
        assert.ok(decision.candidates[0].reasons.includes('soft_capability:vision'));
        assert.ok(decision.candidates[1].reasons.includes('missing_soft_capability:vision'));
    });

    it('scores and explains gateway route decisions before runtime probes', () => {
        const weak = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'weak-chat',
            capabilities: { tools: false, streaming: true },
            limits: { contextWindowTokens: 32_000 },
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
            routing: { tier: 'free' },
        });
        const strong = createModelRecord({
            providerId: 'kilo',
            providerModel: 'anthropic/claude-sonnet-4.5',
            capabilities: { tools: true, streaming: true, reasoningEffort: true },
            limits: { contextWindowTokens: 200_000 },
            pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
            verification: { confidence: 'probe_verified', sources: ['probe'] },
        });

        recordByokProviderModelAgentProbeSuccess({
            routeProfile: 'repo_agent',
            providerId: 'kilo',
            providerModel: 'anthropic/claude-sonnet-4.5',
            timestamp: 50,
        });

        const decision = routeGatewayModels([weak, strong], 'repo_agent', { routeProfile: 'repo_agent' });

        assert.equal(decision.selected?.model['id'], 'kilo:anthropic/claude-sonnet-4.5');
        assert.deepEqual(decision.fallbackChain, ['kilo:anthropic/claude-sonnet-4.5']);
        assert.ok(decision.selected?.reasons.includes('agent_probe_verified'));
        assert.ok(decision.selected?.reasons.includes('preferred:large_context'));
        assert.ok(decision.rejected.some((candidate) => candidate.rejectedReasons.includes('missing_capability:tools')));
    });

    it('applies provider allow/block policy to scored candidates with audit reasons', () => {
        const model = createModelRecord({
            providerId: 'groq',
            providerModel: 'qwen/qwen3-32b',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
        });
        const blocked = scoreGatewayModelCandidate(model, MODEL_GATEWAY_TASK_PROFILES.tool_agent, {
            routeProfile: 'tool_agent',
            blockProviders: ['groq'],
            requireAgentProbeOk: false,
        });

        assert.equal(blocked.include, false);
        assert.ok(blocked.rejectedReasons.includes('provider_blocked'));
        assert.ok(blocked.score > 0);
    });

    it('imports current env BYOK without serializing secrets', () => {
        const env = {
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'openrouter',
            COPILOT_BYOK_MODEL: 'deepseek/deepseek-v4-flash:free',
            OPEN_ROUTER_KEY: 'sk-or-v1-secret-value-that-must-not-leak',
        };

        const snapshot = buildEnvByokModelGatewaySnapshot(env);
        assert.equal(snapshot.active.enabled, true);
        assert.equal(snapshot.active.ready, true);
        assert.equal(snapshot.active.providerId, 'openrouter');
        assert.equal(snapshot.active.modelId, buildProviderModelId('openrouter', 'deepseek/deepseek-v4-flash:free'));
        assert.ok(snapshot.providers.some((provider) => provider.id === 'openrouter'));
        assert.ok(snapshot.models.some((model) => model.id === 'openrouter:deepseek/deepseek-v4-flash:free'));
        assert.ok(snapshot.providers.some((provider) => provider.secretRefs.includes('OPEN_ROUTER_KEY')));
        assert.ok(snapshot.providers.some((provider) => provider.auth.apiKeyRefs.includes('OPEN_ROUTER_KEY')));

        const serialized = JSON.stringify(snapshot);
        assert.equal(serialized.includes('sk-or-v1-secret-value-that-must-not-leak'), false);
        assert.equal(serialized.includes('[redacted]') || serialized.includes('secretRefs'), true);
    });

    it('projects registry snapshot into stable observability events and metrics', () => {
        const snapshot = buildEnvByokModelGatewaySnapshot({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'groq',
            COPILOT_BYOK_MODEL: 'qwen/qwen3-32b',
            GROQ_KEY: 'gsk-secret-value-that-must-not-leak',
        });
        const event = buildRegistrySnapshotEvent(snapshot);
        const metrics = projectModelGatewayMetrics(snapshot);

        assert.equal(event.type, 'model_gateway:registry:snapshot');
        assert.equal(event.providerCount, 1);
        assert.ok(event.modelCount >= 1);
        assert.equal(metrics.gauges['model_gateway.providers'], 1);
        assert.equal(JSON.stringify({ event, metrics }).includes('gsk-secret-value-that-must-not-leak'), false);
    });

    it('projects probe completion into stable observability event and metrics without prompt content', () => {
        const event = buildProbeCompletedEvent({
            probeKind: 'streaming',
            providerAttempted: true,
            result: {
                ok: false,
                status: 'no-delta',
                elapsedMs: 1234,
                model: 'free-model',
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                deltaCount: 0,
                deltaChars: 0,
                finalChars: 32,
                observedFinalEvent: true,
                sessionId: 'tmp-stream-probe',
                errors: ['Probe respondeu, mas não emitiu assistant.message_delta.'],
                warnings: ['free tier'],
                // @ts-expect-error event builder intentionally ignores content-bearing probe fields.
                finalContent: 'STREAM_A STREAM_B STREAM_C',
            },
        });
        const metrics = projectProbeCompletedMetrics(event);

        assert.equal(event.type, 'model_gateway:probe:completed');
        assert.equal(event.probeKind, 'streaming');
        assert.equal(event.ok, false);
        assert.equal(event.status, 'no-delta');
        assert.equal(event.errorCount, 1);
        assert.equal(event.warningCount, 1);
        assert.equal(JSON.stringify(event).includes('STREAM_A'), false);
        assert.equal(metrics.counters['model_gateway.probe.failed'], 1);
        assert.equal(metrics.counters['model_gateway.probe.kind.streaming'], 1);
        assert.equal(metrics.counters['model_gateway.probe.status.no-delta'], 1);
        assert.equal(metrics.gauges['model_gateway.probe.final_chars'], 32);
    });

    it('records route decisions as a sanitized usage ledger event', () => {
        const route = routeGatewayModels(
            [
                createModelRecord({
                    providerId: 'kilo',
                    providerModel: 'kilo-auto/free',
                    capabilities: { tools: true, reasoningEffort: true },
                    limits: { contextWindowTokens: 200000 },
                    pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
                    routing: { tier: 'free' },
                    verification: { confidence: 'catalog', sources: ['provider_catalog'] },
                }),
                createModelRecord({
                    providerId: 'tiny',
                    providerModel: 'chat-only',
                    capabilities: { tools: false },
                    limits: { contextWindowTokens: 4000 },
                    verification: { confidence: 'catalog', sources: ['provider_catalog'] },
                }),
            ],
            'repo_agent',
            { routeProfile: 'kilo-free', requireAgentProbeOk: false },
        );
        const event = buildRouteDecisionEvent({
            taskProfile: 'repo_agent',
            routeProfile: 'kilo-free',
            mode: 'pre-probe',
            source: 'unit-test',
            route,
            estimatedInputTokens: 12345,
            estimatedOutputTokens: null,
            estimatedCostUsd: null,
            // @ts-expect-error event builder intentionally ignores content-bearing caller fields.
            prompt: 'do not persist this prompt',
        });
        const metrics = projectRouteDecisionMetrics(event);
        const recorded = recordModelGatewayRouteDecision(event);
        const ledger = listModelGatewayRouteDecisions({ limit: 5 });

        assert.equal(event.type, 'model_gateway:route:decision');
        assert.equal(event.taskProfile, 'repo_agent');
        assert.equal(event.routeProfile, 'kilo-free');
        assert.equal(event.selected, true);
        assert.equal(event.providerId, 'kilo');
        assert.equal(event.modelId, 'kilo-auto/free');
        assert.equal(event.candidateCount, 1);
        assert.equal(event.rejectedCount, 1);
        assert.equal(event.estimatedInputTokens, 12345);
        assert.equal(JSON.stringify(event).includes('do not persist'), false);
        assert.equal(metrics.counters['model_gateway.route.decision'], 1);
        assert.equal(metrics.counters['model_gateway.route.selected'], 1);
        assert.equal(metrics.gauges['model_gateway.route.candidates'], 1);
        assert.equal(recorded.decisionId, event.decisionId);
        assert.equal(ledger.length, 1);
        assert.equal(ledger[0].decisionId, event.decisionId);
    });

    it('persists a versioned JSON registry snapshot without secrets', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-model-gateway-'));
        try {
            const filePath = join(dir, 'registry.json');
            const secret = 'hf_secret_value_that_must_not_leak';
            const snapshot = await persistEnvByokModelGatewaySnapshot(
                {
                    COPILOT_BYOK_ENABLED: 'true',
                    COPILOT_BYOK_PROVIDER_PRESET: 'huggingface',
                    COPILOT_BYOK_MODEL: 'openai/gpt-oss-120b:fastest',
                    HUGGING_FACE_KEY: secret,
                },
                { filePath },
            );

            assert.equal(snapshot.registryPath, filePath);
            const raw = await readFile(filePath, 'utf8');
            assert.equal(raw.includes(secret), false);

            const store = new JsonModelGatewayRegistryStore({ filePath });
            const loaded = await store.loadRegistry();
            assert.equal(loaded.listProviders().length, 1);
            assert.ok(loaded.getModel('huggingface:openai/gpt-oss-120b:fastest'));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('builds an operator projection with counts, provider rows and capability tags', () => {
        const snapshot = buildEnvByokModelGatewaySnapshot({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'gemini',
            COPILOT_BYOK_MODEL: 'gemini-2.5-flash',
            GEMINI_API_KEY: 'gemini_secret_value_that_must_not_leak',
        });
        recordByokProviderModelCallSuccess({
            providerId: 'gemini',
            providerModel: 'gemini-2.5-flash',
            successContext: 'projection-test',
            timestamp: 1_700_000_000_000,
        });

        const projection = buildModelGatewayOperatorProjection(snapshot);
        assert.equal(projection.providerCount, 1);
        assert.ok(projection.modelCount >= 1);
        assert.equal(projection.providers[0].id, 'gemini');
        assert.ok(projection.models.some((model) => model.providerModel === 'gemini-2.5-flash'));
        assert.ok(projection.models.some((model) => model.tags.includes('vision')));
        const model = projection.models.find((item) => item.providerModel === 'gemini-2.5-flash');
        assert.equal(model?.runtime.chat, 'ok');
        assert.ok(model?.tags.includes('runtime=proved'));
        assert.ok(model?.tags.includes('runtime.chat=ok'));
    });

    it('resolves env secrets by reference without exposing values in descriptions', () => {
        const secret = 'sk-or-v1-test-secret-that-must-not-leak';
        const registry = createEnvSecretRegistry({
            env: { OPEN_ROUTER_KEY: secret, IGNORED_KEY: 'ignored-secret' },
            keys: ['OPEN_ROUTER_KEY'],
        });

        assert.equal(registry.get('OPEN_ROUTER_KEY'), secret);
        assert.equal(registry.get('IGNORED_KEY'), undefined);
        assert.equal(registry.describe('OPEN_ROUTER_KEY').configured, true);
        assert.equal(JSON.stringify(registry.describe('OPEN_ROUTER_KEY')).includes(secret), false);
        assert.equal(JSON.stringify(registry.listConfigured()).includes(secret), false);
    });

    it('redacts secret-like text and nested records', () => {
        const secret = 'gsk_secret_value_that_must_not_leak';
        assert.equal(redactSecretText(`Authorization: Bearer ${secret}`).includes(secret), false);
        assert.equal(redactSecretText('erro com token direto', { additionalSecrets: ['token direto'] }), 'erro com [redacted]');
        assert.equal(
            redactSecretText(
                'jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbnYiOiJwcm9kdWN0aW9uIiwia2lsb0lkIjoiabcifQ.F6DBD5my8raY_4eMPA5HjaVtUMFG4l3JUg8WQtD29_c',
            ).includes('eyJhbGci'),
            false,
        );

        const redacted = redactSecretRecord({
            headers: { Authorization: `Bearer ${secret}` },
            message: `apiKey=${secret}`,
            nested: [{ token: secret }],
        });
        const serialized = JSON.stringify(redacted);
        assert.equal(serialized.includes(secret), false);
        assert.ok(serialized.includes('[redacted]'));
    });

    it('projects openai-compatible gateway records into SDK session overrides using secret refs', () => {
        const secret = 'sk-or-v1-adapter-secret-that-must-not-leak';
        const env = {
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'openrouter',
            COPILOT_BYOK_MODEL: 'deepseek/deepseek-v4-flash:free',
            OPEN_ROUTER_KEY: secret,
        };
        const snapshot = buildEnvByokModelGatewaySnapshot(env);
        const provider = snapshot.providers.find((item) => item.id === 'openrouter');
        const model = snapshot.models.find((item) => item.providerModel === 'deepseek/deepseek-v4-flash:free');
        assert.ok(provider);
        assert.ok(model);

        const overrides = openAICompatibleAdapter.toCopilotSessionOverrides({
            provider,
            model,
            secrets: createEnvSecretRegistry({ env }),
        });

        assert.equal(overrides.model, 'deepseek/deepseek-v4-flash:free');
        assert.equal(overrides.provider.baseUrl, 'https://openrouter.ai/api/v1');
        assert.equal(overrides.provider.apiKey, secret);
        assert.equal(overrides.modelCapabilities?.supports.vision, true);
        assert.equal(JSON.stringify({ provider, model }).includes(secret), false);
    });

    it('projects OpenRouter through a provider-specific adapter with public attribution headers', () => {
        const secret = 'sk-or-v1-openrouter-secret-that-must-not-leak';
        const env = {
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'openrouter',
            COPILOT_BYOK_MODEL: 'deepseek/deepseek-v4-flash:free',
            OPEN_ROUTER_KEY: secret,
        };
        const snapshot = buildEnvByokModelGatewaySnapshot(env);
        const provider = snapshot.providers.find((item) => item.id === 'openrouter');
        const model = snapshot.models.find((item) => item.providerModel === 'deepseek/deepseek-v4-flash:free');
        assert.ok(provider);
        assert.ok(model);
        assert.equal(openRouterAdapter.canHandle(provider), true);

        const overrides = openRouterAdapter.toCopilotSessionOverrides({
            provider,
            model,
            secrets: createEnvSecretRegistry({ env }),
        });

        assert.equal(overrides.model, 'deepseek/deepseek-v4-flash:free');
        assert.equal(overrides.provider.baseUrl, 'https://openrouter.ai/api/v1');
        assert.equal(overrides.provider.apiKey, secret);
        assert.equal(overrides.provider.headers['X-Title'], 'Terminal LLM-B');
        assert.equal(
            JSON.stringify({
                provider,
                model,
                overrides: { ...overrides, provider: { ...overrides.provider, apiKey: undefined } },
            }).includes(secret),
            false,
        );
    });

    it('projects Ollama local as a private local route without requiring auth', () => {
        const env = {
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'ollama-local',
            COPILOT_BYOK_MODEL: 'qwen3-coder-next',
            OLLAMA_LOCAL_BASE_URL: 'http://localhost:11434/v1',
        };
        const snapshot = buildEnvByokModelGatewaySnapshot(env);
        const provider = snapshot.providers.find((item) => item.id === 'ollama-local');
        const model = snapshot.models.find((item) => item.providerModel === 'qwen3-coder-next');
        assert.ok(provider);
        assert.ok(model);
        assert.equal(ollamaAdapter.canHandle(provider), true);

        const overrides = ollamaAdapter.toCopilotSessionOverrides({
            provider,
            model,
            secrets: createEnvSecretRegistry({ env }),
        });

        assert.equal(overrides.model, 'qwen3-coder-next');
        assert.equal(overrides.provider.baseUrl, 'http://localhost:11434/v1');
        assert.equal(overrides.provider.apiKey, undefined);
        assert.equal(overrides.gateway?.providerFamily, 'ollama');
        assert.equal(overrides.gateway?.runtimeKind, 'local');
        assert.equal(overrides.gateway?.localPrivate, true);
    });

    it('projects Gemini through its OpenAI-compatible endpoint while preserving provider family metadata', () => {
        const secret = 'gemini-secret-that-must-not-leak';
        const env = {
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'gemini',
            COPILOT_BYOK_MODEL: 'gemini-2.5-flash',
            GEMINI_API_KEY: secret,
        };
        const snapshot = buildEnvByokModelGatewaySnapshot(env);
        const provider = snapshot.providers.find((item) => item.id === 'gemini');
        const model = snapshot.models.find((item) => item.providerModel === 'gemini-2.5-flash');
        assert.ok(provider);
        assert.ok(model);
        assert.equal(geminiAdapter.canHandle(provider), true);

        const overrides = geminiAdapter.toCopilotSessionOverrides({
            provider,
            model,
            secrets: createEnvSecretRegistry({ env }),
        });

        assert.equal(overrides.model, 'gemini-2.5-flash');
        assert.equal(overrides.provider.type, 'openai');
        assert.equal(overrides.provider.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
        assert.equal(overrides.provider.apiKey, secret);
        assert.equal(overrides.gateway?.providerFamily, 'gemini');
        assert.equal(overrides.gateway?.openAiCompatibleEndpoint, true);
    });

    it('projects Anthropic as a native SDK provider type without wireApi', () => {
        const secret = 'sk-ant-secret-that-must-not-leak';
        const provider = {
            id: 'anthropic',
            providerType: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            auth: { apiKeyRefs: ['ANTHROPIC_API_KEY'] },
        };
        const model = {
            providerId: 'anthropic',
            providerModel: 'claude-sonnet-4.5',
            capabilities: { reasoningEffort: true, vision: true },
            limits: { contextWindowTokens: 200_000 },
        };
        assert.equal(anthropicAdapter.canHandle(provider), true);

        const overrides = anthropicAdapter.toCopilotSessionOverrides({
            provider,
            model,
            secrets: createEnvSecretRegistry({ env: { ANTHROPIC_API_KEY: secret } }),
        });

        assert.equal(overrides.model, 'claude-sonnet-4.5');
        assert.equal(overrides.provider.type, 'anthropic');
        assert.equal(overrides.provider.baseUrl, 'https://api.anthropic.com');
        assert.equal(overrides.provider.apiKey, secret);
        assert.equal(overrides.provider.wireApi, undefined);
        assert.equal(overrides.gateway?.providerFamily, 'anthropic');
        assert.equal(overrides.gateway?.openAiCompatibleEndpoint, false);
    });

    it('resolves remaining BYOK provider families through gateway adapters instead of SDK preset logic', () => {
        const registeredFamilies = new Set(OPENAI_PROVIDER_FAMILY_SPECS.map((spec) => spec.id));
        for (const fixture of PROVIDER_FAMILY_ENV_FIXTURES) {
            const env = {
                COPILOT_BYOK_ENABLED: 'true',
                COPILOT_BYOK_PROVIDER_PRESET: fixture.preset,
                COPILOT_BYOK_MODEL: fixture.model,
                [fixture.secretKey]: fixture.secretValue,
                ...(fixture.extraEnv ?? {}),
            };
            const snapshot = buildEnvByokModelGatewaySnapshot(env);
            const provider = snapshot.providers.find((item) => item.id === fixture.preset);
            const model = snapshot.models.find((item) => item.providerModel === fixture.model);
            assert.ok(provider, `provider missing for ${fixture.preset}`);
            assert.ok(model, `model missing for ${fixture.preset}`);
            assert.ok(registeredFamilies.has(fixture.expectedAdapter), `family spec missing for ${fixture.expectedAdapter}`);

            const adapter = resolveModelGatewayProviderAdapter(provider);
            const overrides = adapter.toCopilotSessionOverrides({
                provider,
                model,
                secrets: createEnvSecretRegistry({ env }),
            });

            assert.equal(adapter.id, fixture.expectedAdapter);
            assert.equal(overrides.model, fixture.model);
            assert.equal(overrides.provider.apiKey ?? overrides.provider.bearerToken, fixture.secretValue);
            assert.equal(overrides.gateway?.providerFamily, fixture.expectedAdapter);
            assert.equal(JSON.stringify({ provider, model, gateway: overrides.gateway }).includes(fixture.secretValue), false);
        }
    });

    it('keeps a provider endpoint inventory separate from adapter dispatch', () => {
        const endpointInventory = listProviderEndpointInventory();
        const ids = new Set(endpointInventory.map((item) => item.providerId));
        for (const expected of [
            'openai',
            'openrouter',
            'anthropic',
            'gemini',
            'ollama',
            'kilo',
            'groq',
            'mistral',
            'huggingface',
            'cloudflare-workers-ai',
            'nvidia-nim',
            'cerebras',
            'chutes',
            'zai',
        ]) {
            assert.ok(ids.has(expected), `endpoint inventory missing ${expected}`);
        }

        const kilo = resolveProviderEndpointInventory('kilo');
        const hf = resolveProviderEndpointInventory('huggingface');
        const cloudflare = resolveProviderEndpointInventory('cloudflare-workers-ai');

        assert.equal(kilo?.providerKind, 'gateway');
        assert.ok(kilo?.modelCatalogSources.some((source) => source.url.endsWith('/api/gateway/models')));
        assert.ok(hf?.routeSelectors.includes('fastest'));
        assert.ok(hf?.routeSelectors.includes('cheapest'));
        assert.ok(cloudflare?.routeSelectors.includes('gateway_fallback'));
    });

    it('builds an SDK onListModels handler from gateway records without exposing secrets', async () => {
        const secret = 'sk-or-v1-list-models-secret-that-must-not-leak';
        const handler = buildModelGatewayOnListModelsHandler({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'openrouter',
            COPILOT_BYOK_MODEL: 'deepseek/deepseek-v4-flash:free',
            OPEN_ROUTER_KEY: secret,
        });
        assert.equal(typeof handler, 'function');

        const models = await handler?.();
        assert.ok(models?.some((model) => model.id === 'deepseek/deepseek-v4-flash:free'));
        assert.ok(models?.some((model) => model.byok?.gatewayId === 'openrouter:deepseek/deepseek-v4-flash:free'));
        assert.equal(JSON.stringify(models).includes(secret), false);
    });

    it('does not install a gateway onListModels handler when BYOK is disabled', () => {
        assert.equal(buildModelGatewayOnListModelsHandler({ COPILOT_BYOK_ENABLED: 'false' }), undefined);
    });

    it('reports configured BYOK chat probe as unavailable before provider readiness', async () => {
        const result = await runConfiguredByokChatProbe({
            deps: {
                // @ts-expect-error test double keeps only the fields consumed by the probe.
                readConfiguredByokState: () => ({
                    enabled: false,
                    ready: false,
                    provider: null,
                    model: null,
                    errors: [],
                    warnings: ['missing provider'],
                    summary: {
                        model: null,
                        profile: 'dev',
                        preset: 'openrouter',
                        providerType: 'openai',
                    },
                }),
            },
        });

        assert.equal(result.ok, false);
        assert.equal(result.status, 'unavailable');
        assert.equal(result.profile, 'dev');
        assert.equal(result.providerType, 'openai');
        assert.deepEqual(result.warnings, ['missing provider']);
        assert.match(result.errors[0], /BYOK/);
    });

    it('blocks configured BYOK chat probe through canonical admission policy', async () => {
        const result = await runConfiguredByokChatProbe({
            deps: {
                // @ts-expect-error test double keeps only the fields consumed by the probe.
                readConfiguredByokState: () => ({
                    enabled: true,
                    ready: true,
                    provider: { type: 'openai', apiKey: 'secret' },
                    model: 'model-a',
                    errors: [],
                    warnings: [],
                    summary: { model: 'model-a', profile: 'dev', preset: 'groq', providerType: 'openai' },
                }),
                // @ts-expect-error test double keeps only the fields consumed by the probe.
                resolveConfiguredByokSessionOverrides: () => ({
                    provider: { type: 'openai', apiKey: 'secret' },
                    model: 'model-a',
                    summary: { model: 'model-a', profile: 'dev', preset: 'groq', providerType: 'openai', warnings: [] },
                }),
                evaluateAdmission: () => ({ shouldBlock: true, label: 'blocked by budget' }),
            },
        });

        assert.equal(result.ok, false);
        assert.equal(result.status, 'admission-blocked');
        assert.deepEqual(result.errors, ['blocked by budget']);
    });

    it('runs configured BYOK chat probe through disposable session with deltas and final event', async () => {
        let unsubscribed = false;
        /** @type {any} */
        let capturedConfig = null;
        /** @type {any} */
        let capturedPayload = null;

        const result = await runConfiguredByokChatProbe({
            prompt: 'probe now',
            timeoutMs: 100,
            deps: {
                // @ts-expect-error test double keeps only the fields consumed by the probe.
                readConfiguredByokState: () => ({
                    enabled: true,
                    ready: true,
                    provider: { type: 'openai', apiKey: 'secret' },
                    model: 'model-a',
                    errors: [],
                    warnings: [],
                    summary: { model: 'model-a', profile: 'dev', preset: 'openrouter', providerType: 'openai' },
                }),
                // @ts-expect-error test double keeps only the fields consumed by the probe.
                resolveConfiguredByokSessionOverrides: () => ({
                    provider: { type: 'openai', apiKey: 'secret' },
                    model: 'model-a',
                    modelCapabilities: { tools: false },
                    summary: {
                        model: 'model-a',
                        profile: 'dev',
                        preset: 'openrouter',
                        providerType: 'openai',
                        warnings: ['free tier'],
                    },
                }),
                // @ts-expect-error test double calls the callback synchronously with a fake SDK session.
                withEphemeralSession: async (config, callback) => {
                    capturedConfig = config;
                    await callback({ session: { id: 'session-object' }, sessionId: 'tmp-chat-probe' });
                },
                // @ts-expect-error test double emits the subset of SDK events used by the probe.
                onSessionEvents: (_session, handlers) => {
                    handlers['assistant.message_delta']?.({ data: { deltaContent: 'BYOK_' } });
                    handlers['assistant.message_delta']?.({ data: { deltaContent: 'PROBE_' } });
                    handlers['assistant.message']?.({ data: { content: 'BYOK_PROBE_OK' } });
                    return () => {
                        unsubscribed = true;
                    };
                },
                // @ts-expect-error test double records the prompt payload.
                sendSessionAndWait: async (_session, payload, timeoutMs) => {
                    capturedPayload = { payload, timeoutMs };
                    return { data: { content: 'BYOK_PROBE_OK' } };
                },
                // @ts-expect-error test double makes the permission handler identity observable.
                createPermissionHandler: (options) => ({ permission: options.defaultDecision }),
            },
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 'ok');
        assert.equal(result.sessionId, 'tmp-chat-probe');
        assert.equal(result.deltaCount, 2);
        assert.equal(result.deltaChars, 'BYOK_PROBE_'.length);
        assert.equal(result.finalChars, 'BYOK_PROBE_OK'.length);
        assert.equal(result.finalContent, 'BYOK_PROBE_OK');
        assert.equal(result.observedFinalEvent, true);
        assert.deepEqual(result.warnings, ['free tier']);
        assert.equal(unsubscribed, true);
        assert.equal(capturedConfig.streaming, true);
        assert.deepEqual(capturedConfig.availableTools, []);
        assert.deepEqual(capturedConfig.onPermissionRequest, { permission: 'deny' });
        assert.deepEqual(capturedPayload, { payload: { prompt: 'probe now' }, timeoutMs: 5000 });
    });

    it('runs configured BYOK agent probe through disposable tools, ask_user, deltas and final event', async () => {
        let unsubscribed = false;
        /** @type {any} */
        let capturedConfig = null;
        /** @type {any} */
        let capturedPayload = null;
        /** @type {unknown} */
        let capturedAskAnswer = null;

        const result = await runConfiguredByokAgentProbe({
            prompt: 'agent probe now',
            timeoutMs: 100,
            deps: {
                // @ts-expect-error test double keeps only the fields consumed by the probe.
                readConfiguredByokState: () => ({
                    enabled: true,
                    ready: true,
                    provider: { type: 'openai', apiKey: 'secret' },
                    model: 'model-agent',
                    errors: [],
                    warnings: [],
                    summary: { model: 'model-agent', profile: 'dev', preset: 'kilo-code', providerType: 'openai' },
                }),
                // @ts-expect-error test double keeps only the fields consumed by the probe.
                resolveConfiguredByokSessionOverrides: () => ({
                    provider: { type: 'openai', apiKey: 'secret' },
                    model: 'model-agent',
                    modelCapabilities: { tools: true },
                    summary: {
                        model: 'model-agent',
                        profile: 'dev',
                        preset: 'kilo-code',
                        providerType: 'openai',
                        warnings: ['agent tier'],
                    },
                }),
                // @ts-expect-error test double uses the same shape consumed by the probe.
                createTool: (definition) => definition,
                // @ts-expect-error test double returns a deterministic ask_user handler.
                createStaticInputHandler: (answers, fallback) => async (request) => {
                    const question =
                        request && typeof request === 'object' && typeof request.question === 'string'
                            ? request.question.toLowerCase()
                            : '';
                    return answers[question] ?? fallback;
                },
                // @ts-expect-error test double calls the callback synchronously with a fake SDK session.
                withEphemeralSession: async (config, callback) => {
                    capturedConfig = config;
                    await config.tools[0].handler({ marker: 'BYOK_AGENT_PROBE_TOOL_OK' });
                    await config.tools[1].handler({ path: BYOK_AGENT_PROBE_READ_PATH, startLine: 1, endLine: 3 });
                    capturedAskAnswer = await config.onUserInputRequest({ question: BYOK_AGENT_PROBE_QUESTION }, {});
                    await callback({ session: { id: 'agent-session-object' }, sessionId: 'tmp-agent-probe' });
                },
                // @ts-expect-error test double emits the subset of SDK events used by the probe.
                onSessionEvents: (_session, handlers) => {
                    handlers['assistant.message_delta']?.({ data: { deltaContent: 'AGENT_' } });
                    handlers['assistant.message']?.({ data: { content: 'BYOK_AGENT_PROBE_DONE' } });
                    return () => {
                        unsubscribed = true;
                    };
                },
                // @ts-expect-error test double records the prompt payload.
                sendSessionAndWait: async (_session, payload, timeoutMs) => {
                    capturedPayload = { payload, timeoutMs };
                    return { data: { content: 'BYOK_AGENT_PROBE_DONE' } };
                },
                // @ts-expect-error test double makes the permission handler identity observable.
                createPermissionHandler: (options) => ({ permission: options.allowAll ? 'allow' : 'deny' }),
            },
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 'ok');
        assert.equal(result.sessionId, 'tmp-agent-probe');
        assert.equal(result.toolCallCount, 2);
        assert.equal(result.markerToolCallCount, 1);
        assert.equal(result.readToolCallCount, 1);
        assert.equal(result.userInputRequestCount, 1);
        assert.equal(result.userInputAnswerCount, 1);
        assert.equal(result.deltaCount, 1);
        assert.equal(result.deltaChars, 'AGENT_'.length);
        assert.equal(result.finalChars, 'BYOK_AGENT_PROBE_DONE'.length);
        assert.equal(result.observedFinalEvent, true);
        assert.deepEqual(result.warnings, ['agent tier']);
        assert.equal(capturedAskAnswer, BYOK_AGENT_PROBE_ANSWER);
        assert.equal(unsubscribed, true);
        assert.equal(capturedConfig.streaming, true);
        assert.deepEqual(capturedConfig.availableTools, [
            BYOK_AGENT_PROBE_TOOL,
            BYOK_AGENT_PROBE_READ_TOOL,
            'ask_user',
        ]);
        assert.deepEqual(capturedConfig.onPermissionRequest, { permission: 'allow' });
        assert.deepEqual(capturedPayload, { payload: { prompt: 'agent probe now' }, timeoutMs: 5000 });
    });

    it('classifies configured BYOK streaming probe as ok only when message deltas are observed', async () => {
        const baseDeps = {
            // @ts-expect-error test double keeps only the fields consumed by the probe.
            readConfiguredByokState: () => ({
                enabled: true,
                ready: true,
                provider: { type: 'openai', apiKey: 'secret' },
                model: 'model-stream',
                errors: [],
                warnings: [],
                summary: { model: 'model-stream', profile: 'dev', preset: 'openrouter', providerType: 'openai' },
            }),
            // @ts-expect-error test double keeps only the fields consumed by the probe.
            resolveConfiguredByokSessionOverrides: () => ({
                provider: { type: 'openai', apiKey: 'secret' },
                model: 'model-stream',
                summary: {
                    model: 'model-stream',
                    profile: 'dev',
                    preset: 'openrouter',
                    providerType: 'openai',
                    warnings: [],
                },
            }),
            // @ts-expect-error test double calls the callback synchronously with a fake SDK session.
            withEphemeralSession: async (_config, callback) => {
                await callback({ session: { id: 'stream-session-object' }, sessionId: 'tmp-stream-probe' });
            },
            // @ts-expect-error test double records no actual permission behavior.
            createPermissionHandler: () => ({}),
        };
        const withDelta = await runConfiguredByokStreamingProbe({
            deps: {
                ...baseDeps,
                // @ts-expect-error test double emits the subset of SDK events used by the probe.
                onSessionEvents: (_session, handlers) => {
                    handlers['assistant.message_delta']?.({ data: { deltaContent: 'STREAM_A' } });
                    handlers['assistant.message']?.({ data: { content: 'STREAM_A STREAM_B STREAM_C' } });
                    return () => {};
                },
                // @ts-expect-error test double returns final content.
                sendSessionAndWait: async () => ({ data: { content: 'STREAM_A STREAM_B STREAM_C' } }),
            },
        });
        const withoutDelta = await runConfiguredByokStreamingProbe({
            deps: {
                ...baseDeps,
                // @ts-expect-error test double emits only final content.
                onSessionEvents: (_session, handlers) => {
                    handlers['assistant.message']?.({ data: { content: 'STREAM_A STREAM_B STREAM_C' } });
                    return () => {};
                },
                // @ts-expect-error test double returns final content.
                sendSessionAndWait: async () => ({ data: { content: 'STREAM_A STREAM_B STREAM_C' } }),
            },
        });

        assert.equal(withDelta.ok, true);
        assert.equal(withDelta.status, 'ok');
        assert.equal(withDelta.streamingProved, true);
        assert.equal(withDelta.deltaCount, 1);
        assert.equal(withoutDelta.ok, false);
        assert.equal(withoutDelta.status, 'no-delta');
        assert.equal(withoutDelta.streamingProved, false);
        assert.match(withoutDelta.errors.at(-1) ?? '', /message_delta/);
    });

    it('validates configured BYOK JSON probe from final assistant content', async () => {
        const baseDeps = {
            // @ts-expect-error test double keeps only the fields consumed by the probe.
            readConfiguredByokState: () => ({
                enabled: true,
                ready: true,
                provider: { type: 'openai', apiKey: 'secret' },
                model: 'model-json',
                errors: [],
                warnings: [],
                summary: { model: 'model-json', profile: 'dev', preset: 'mistral', providerType: 'openai' },
            }),
            // @ts-expect-error test double keeps only the fields consumed by the probe.
            resolveConfiguredByokSessionOverrides: () => ({
                provider: { type: 'openai', apiKey: 'secret' },
                model: 'model-json',
                summary: {
                    model: 'model-json',
                    profile: 'dev',
                    preset: 'mistral',
                    providerType: 'openai',
                    warnings: [],
                },
            }),
            // @ts-expect-error test double calls the callback synchronously with a fake SDK session.
            withEphemeralSession: async (_config, callback) => {
                await callback({ session: { id: 'json-session-object' }, sessionId: 'tmp-json-probe' });
            },
            // @ts-expect-error test double records no actual permission behavior.
            createPermissionHandler: () => ({}),
        };

        const valid = await runConfiguredByokJsonProbe({
            deps: {
                ...baseDeps,
                // @ts-expect-error test double emits valid JSON final content.
                onSessionEvents: (_session, handlers) => {
                    handlers['assistant.message']?.({ data: { content: '{"byok_probe":"ok","mode":"json"}' } });
                    return () => {};
                },
                // @ts-expect-error test double returns valid JSON final content.
                sendSessionAndWait: async () => ({ data: { content: '{"byok_probe":"ok","mode":"json"}' } }),
            },
        });
        const invalid = await runConfiguredByokJsonProbe({
            deps: {
                ...baseDeps,
                // @ts-expect-error test double emits invalid JSON final content.
                onSessionEvents: (_session, handlers) => {
                    handlers['assistant.message']?.({ data: { content: 'not-json' } });
                    return () => {};
                },
                // @ts-expect-error test double returns invalid JSON final content.
                sendSessionAndWait: async () => ({ data: { content: 'not-json' } }),
            },
        });

        assert.equal(valid.ok, true);
        assert.equal(valid.status, 'ok');
        assert.equal(valid.jsonProved, true);
        assert.deepEqual(valid.parsedJson, { byok_probe: 'ok', mode: 'json' });
        assert.equal(invalid.ok, false);
        assert.equal(invalid.status, 'json-invalid');
        assert.equal(invalid.jsonProved, false);
        assert.match(invalid.errors.at(-1) ?? '', /JSON invalido/);
    });

    it('validates configured BYOK vision probe with a hermetic image attachment', async () => {
        /** @type {any} */
        let capturedPayload = null;
        const baseDeps = {
            // @ts-expect-error test double keeps only the fields consumed by the probe.
            readConfiguredByokState: () => ({
                enabled: true,
                ready: true,
                provider: { type: 'openai', apiKey: 'secret' },
                model: 'model-vision',
                errors: [],
                warnings: [],
                summary: { model: 'model-vision', profile: 'dev', preset: 'openrouter', providerType: 'openai' },
            }),
            // @ts-expect-error test double keeps only the fields consumed by the probe.
            resolveConfiguredByokSessionOverrides: () => ({
                provider: { type: 'openai', apiKey: 'secret' },
                model: 'model-vision',
                modelCapabilities: { supports: { vision: true } },
                summary: {
                    model: 'model-vision',
                    profile: 'dev',
                    preset: 'openrouter',
                    providerType: 'openai',
                    warnings: [],
                },
            }),
            // @ts-expect-error test double calls the callback synchronously with a fake SDK session.
            withEphemeralSession: async (_config, callback) => {
                await callback({ session: { id: 'vision-session-object' }, sessionId: 'tmp-vision-probe' });
            },
            // @ts-expect-error test double records no actual permission behavior.
            createPermissionHandler: () => ({}),
        };

        const valid = await runConfiguredByokVisionProbe({
            deps: {
                ...baseDeps,
                // @ts-expect-error test double emits final content after image interpretation.
                onSessionEvents: (_session, handlers) => {
                    handlers['assistant.message']?.({ data: { content: 'VISION_PROBE_OK:red' } });
                    return () => {};
                },
                // @ts-expect-error test double records the payload with attachment.
                sendSessionAndWait: async (_session, payload) => {
                    capturedPayload = payload;
                    return { data: { content: 'VISION_PROBE_OK:red' } };
                },
            },
        });
        const invalid = await runConfiguredByokVisionProbe({
            deps: {
                ...baseDeps,
                // @ts-expect-error test double emits the wrong color.
                onSessionEvents: (_session, handlers) => {
                    handlers['assistant.message']?.({ data: { content: 'VISION_PROBE_OK:blue' } });
                    return () => {};
                },
                // @ts-expect-error test double returns the wrong color.
                sendSessionAndWait: async () => ({ data: { content: 'VISION_PROBE_OK:blue' } }),
            },
        });

        assert.equal(valid.ok, true);
        assert.equal(valid.status, 'ok');
        assert.equal(valid.visionProved, true);
        assert.equal(valid.dominantColor, 'red');
        assert.equal(valid.attachmentMimeType, BYOK_VISION_PROBE_MIME_TYPE);
        assert.equal(capturedPayload.attachments[0].type, 'blob');
        assert.equal(capturedPayload.attachments[0].mimeType, BYOK_VISION_PROBE_MIME_TYPE);
        assert.equal(capturedPayload.attachments[0].displayName, BYOK_VISION_PROBE_DISPLAY_NAME);
        assert.equal(invalid.ok, false);
        assert.equal(invalid.status, 'vision-mismatch');
        assert.equal(invalid.visionProved, false);
        assert.match(invalid.errors.at(-1) ?? '', /cor dominante inesperada|não identificou/);
    });
});
