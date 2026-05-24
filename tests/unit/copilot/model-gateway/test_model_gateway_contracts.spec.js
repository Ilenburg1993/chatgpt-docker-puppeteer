// @ts-check
/**
 * Unit tests for the canonical model gateway foundation.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';

import {
    JsonModelGatewayRegistryStore,
    ModelGatewayRegistry,
    buildEnvByokModelGatewaySnapshot,
    buildModelGatewayOperatorProjection,
    buildProviderModelId,
    buildRegistrySnapshotEvent,
    createEnvSecretRegistry,
    buildModelGatewayOnListModelsHandler,
    openAICompatibleAdapter,
    persistEnvByokModelGatewaySnapshot,
    projectModelGatewayMetrics,
    redactSecretRecord,
    redactSecretText,
    toCopilotModelInfoList,
} from '../../../../src/copilot/model-gateway/index.js';

describe('model-gateway foundation', () => {
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

        const projection = buildModelGatewayOperatorProjection(snapshot);
        assert.equal(projection.providerCount, 1);
        assert.ok(projection.modelCount >= 1);
        assert.equal(projection.providers[0].id, 'gemini');
        assert.ok(projection.models.some((model) => model.providerModel === 'gemini-2.5-flash'));
        assert.ok(projection.models.some((model) => model.tags.includes('vision')));
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
});
