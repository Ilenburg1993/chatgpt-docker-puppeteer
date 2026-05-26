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
    buildModelGatewayPreKCompatibilityReport,
    anthropicAdapter,
    buildEnvByokModelGatewaySnapshot,
    buildModelGatewayOperatorProjection,
    buildProviderModelId,
    buildCatalogRefreshCompletedEvent,
    buildCatalogRefreshEventBatch,
    buildEligibilityEvaluatedEvent,
    buildProbeCompletedEvent,
    buildRegistrySnapshotEvent,
    buildRouteDecisionEvent,
    buildRouteDecisionTraceAttributes,
    buildModelGatewayRouteCandidates,
    applyModelGatewayEligibilityToSnapshot,
    createModelRecord,
    createEnvSecretRegistry,
    explainModelGatewayAccountAccess,
    explainGatewayRouteDecision,
    resolveModelGatewayAccountAccess,
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
    projectCatalogRefreshCompletedMetrics,
    projectEligibilityEvaluatedMetrics,
    redactSecretRecord,
    redactSecretText,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    listModelGatewayRouteDecisions,
    mirrorByokProviderHealthToSqlite,
    mirrorModelGatewayCatalogSnapshotToSqlite,
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
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    createAnthropicModelsImporter,
    createCerebrasPublicModelsImporter,
    createChutesModelsImporter,
    createCloudflareWorkersAiCatalogImporter,
    createGeminiModelsImporter,
    createGroqDocsModelsImporter,
    createGroqModelsImporter,
    createHuggingFaceInferenceProvidersImporter,
    createMistralModelsImporter,
    createNvidiaNimModelsImporter,
    createOllamaCatalogImporter,
    createOpenCodeZenDocsImporter,
    createOpenCodeZenModelsImporter,
    createOpenAICompatibleModelsImporter,
    createOpenAIModelsImporter,
    createOpenRouterModelsImporter,
    createZaiModelsImporter,
    createCanonicalModelProjection,
    createCanonicalProviderProjection,
    createCatalogImportRun,
    createDefaultModelGatewayCatalogImporters,
    createKiloGatewayModelsImporter,
    createKiloGatewayProvidersImporter,
    createModelEligibilityDecision,
    createModelEligibilityRun,
    MODEL_GATEWAY_SQLITE_SCHEMA_SQL,
    MODEL_GATEWAY_SQLITE_SCHEMA_VERSION,
    MODEL_GATEWAY_SQLITE_TABLES,
    createModelMetadataEvidence,
    createModelRouteOption,
    createProviderAccountOverlay,
    createProviderCatalogSource,
    createProviderMetadataEvidence,
    createSanitizedRawPayloadRef,
    diffCanonicalModelProjections,
    explainModelGatewayCatalogEntry,
    explainModelGatewayProviderEntry,
    mergeModelMetadataEvidence,
    mergeProviderMetadataEvidence,
    explainModelGatewayEligibilityDecision,
    normalizeAccountOverlayControls,
    normalizeModelAliases,
    normalizeModelIdentityTraits,
    normalizeModelLifecycle,
    normalizeModelModalities,
    normalizeModelRoutePolicyTraits,
    normalizeModelTokenLimits,
    normalizeOpenAICompatibleModelCapabilities,
    normalizeUsdPricing,
    rankCatalogEvidenceConfidence,
    recommendCatalogDiffProbes,
    evaluateModelGatewayCatalogEligibility,
    evaluateModelGatewayEligibility,
    refreshModelGatewayCatalog,
    runCatalogImporters,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
    runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe,
    runConfiguredByokVisionProbe,
    scoreGatewayModelCandidate,
    searchModelGatewayCatalogEntries,
    summarizeModelGatewayCatalogSnapshot,
    summarizeCanonicalModelProjectionDiff,
    toOpenAIModelCatalogEntry,
    toOpenAIModelCatalogList,
    toCopilotModelInfoList,
    toCopilotRouteModelInfoList,
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

    it('builds route-option candidates as the pre-runtime selection unit', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'cloudflare-workers-ai',
            providerModel: '@cf/openai/gpt-oss-120b',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 131_072 },
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const direct = createModelRouteOption({
            providerId: 'cloudflare-workers-ai',
            providerModel: '@cf/openai/gpt-oss-120b',
            selectorKind: 'exact_model',
            selectorSyntax: '@cf/openai/gpt-oss-120b',
            normalizedPolicy: { routeLayer: 'direct_provider', wireApi: 'workers_ai_run' },
        });
        const gateway = createModelRouteOption({
            providerId: 'cloudflare-workers-ai',
            providerModel: '@cf/openai/gpt-oss-120b',
            selectorKind: 'gateway_fallback',
            selectorSyntax: 'cloudflare-gateway:@cf/openai/gpt-oss-120b',
            normalizedPolicy: {
                routeLayer: 'gateway',
                wireApi: 'cloudflare_ai_gateway_universal',
                supportsFallback: true,
            },
        });

        const candidates = buildModelGatewayRouteCandidates({
            projections: [projection],
            routeOptions: [direct, gateway],
        });

        assert.equal(candidates.length, 2);
        assert.deepEqual(
            candidates.map((candidate) => candidate['selectorKind']),
            ['exact_model', 'gateway_fallback'],
        );
        assert.equal(candidates[1]['routing']['routeLayer'], 'gateway');
        assert.equal(candidates[1]['routing']['supportsFallback'], true);
        assert.equal(candidates[1]['provenance']['candidateSource'], 'route_option');
        assert.ok(candidates[1]['routeOptionRef'].includes('gateway_fallback'));
    });

    it('projects route-option candidates to SDK model info without losing selector metadata', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'huggingface',
            providerModel: 'openai/gpt-oss-120b',
            displayName: 'GPT OSS via Hugging Face',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 131_072 },
            pricing: { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
        });
        const fastest = createModelRouteOption({
            providerId: 'huggingface',
            providerModel: 'openai/gpt-oss-120b',
            selectorKind: 'fastest',
            selectorSyntax: 'openai/gpt-oss-120b:fastest',
            normalizedPolicy: {
                routeLayer: 'provider_router',
                wireApi: 'openai_chat_completions',
                autoSelection: true,
            },
        });

        const [model] = toCopilotRouteModelInfoList({
            projections: [projection],
            routeOptions: [fastest],
        });

        const byok = /** @type {Record<string, any>} */ (model.byok ?? {});
        assert.equal(model.id, 'openai/gpt-oss-120b:fastest');
        assert.equal(byok['gatewayId'], 'huggingface:openai/gpt-oss-120b');
        assert.equal(byok['routeCandidateId'], 'huggingface:openai/gpt-oss-120b:default:fastest:openai/gpt-oss-120b:fastest');
        assert.equal(byok['providerModel'], 'openai/gpt-oss-120b');
        assert.equal(byok['sdkModelId'], 'openai/gpt-oss-120b:fastest');
        assert.equal(byok['selectorKind'], 'fastest');
        assert.equal(byok['selectorSyntax'], 'openai/gpt-oss-120b:fastest');
        assert.equal(byok['routeLayer'], 'provider_router');
        assert.equal(byok['wireApi'], 'openai_chat_completions');
        assert.equal(byok['autoSelection'], true);
        assert.ok(String(model.policy?.terms).includes('selector:fastest'));
    });

    it('scores and blocks route candidates by route layer and wire API metadata', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'cloudflare-workers-ai',
            providerModel: '@cf/openai/gpt-oss-120b',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 131_072 },
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const candidates = buildModelGatewayRouteCandidates({
            projections: [projection],
            routeOptions: [
                createModelRouteOption({
                    providerId: 'cloudflare-workers-ai',
                    providerModel: '@cf/openai/gpt-oss-120b',
                    selectorKind: 'exact_model',
                    normalizedPolicy: { routeLayer: 'direct_provider', wireApi: 'workers_ai_run' },
                }),
                createModelRouteOption({
                    providerId: 'cloudflare-workers-ai',
                    providerModel: '@cf/openai/gpt-oss-120b',
                    selectorKind: 'gateway_fallback',
                    selectorSyntax: 'cloudflare-gateway:@cf/openai/gpt-oss-120b',
                    normalizedPolicy: { routeLayer: 'gateway', wireApi: 'cloudflare_ai_gateway_universal' },
                }),
            ],
        });

        const preferred = routeGatewayModels(candidates, 'tool_agent', {
            preferredRouteLayers: ['gateway'],
            preferredWireApis: ['cloudflare_ai_gateway_universal'],
            requireAgentProbeOk: false,
        });
        assert.equal(preferred.selected?.model['selectorKind'], 'gateway_fallback');
        assert.ok(preferred.selected?.reasons.includes('preferred_route_layer:gateway'));
        assert.ok(preferred.selected?.reasons.includes('preferred_wire_api:cloudflare_ai_gateway_universal'));

        const blocked = routeGatewayModels(candidates, 'tool_agent', {
            blockRouteLayers: ['gateway'],
            requireAgentProbeOk: false,
        });
        assert.equal(blocked.selected?.model['selectorKind'], 'exact_model');
        assert.ok(blocked.rejected.some((candidate) => candidate.rejectedReasons.includes('route_layer_blocked:gateway')));
    });

    it('selects candidates by metadata budget and confidence before runtime', () => {
        const cheapCatalog = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'cheap-catalog',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 128_000 },
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 3 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });
        const expensiveManual = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'expensive-manual',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 128_000 },
            pricing: { inputUsdPerMillion: 10, outputUsdPerMillion: 40 },
            verification: { confidence: 'manual', sources: ['operator'] },
        });
        const weakSeed = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'weak-seed',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 128_000 },
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
            verification: { confidence: 'static_seed', sources: ['seed'] },
        });

        const decision = routeGatewayModels([cheapCatalog, expensiveManual, weakSeed], 'tool_agent', {
            maxPricePerMillion: 20,
            preferredMaxPricePerMillion: 5,
            minimumConfidence: 'catalog',
            requireAgentProbeOk: false,
        });

        assert.equal(decision.selected?.model['providerModel'], 'cheap-catalog');
        assert.ok(decision.selected?.reasons.includes('price_within_preference:4<=5'));
        assert.ok(decision.rejected.some((candidate) => candidate.rejectedReasons.includes('price_above_limit:50>20')));
        assert.ok(decision.rejected.some((candidate) => candidate.rejectedReasons.includes('confidence_below_minimum:static_seed<catalog')));
    });

    it('explains route rejections with stable summaries and next actions', () => {
        const weak = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'weak-chat',
            capabilities: { tools: false, streaming: true },
            limits: { contextWindowTokens: 16_000 },
            pricing: { inputUsdPerMillion: 40, outputUsdPerMillion: 40 },
            verification: { confidence: 'static_seed', sources: ['seed'] },
        });
        const route = routeGatewayModels([weak], 'tool_agent', {
            maxPricePerMillion: 20,
            minimumConfidence: 'catalog',
            requireAgentProbeOk: false,
        });

        assert.deepEqual(explainGatewayRouteDecision(route), {
            selected: false,
            selectedId: null,
            candidateCount: 0,
            rejectedCount: 1,
            fallbackChain: [],
            rejectedReasonCounts: {
                'missing_capability:tools': 1,
                'context_too_small:16000<32000': 1,
                'confidence_below_minimum:static_seed<catalog': 1,
                'price_above_limit:80>20': 1,
            },
            topRejectedReasons: [
                'confidence_below_minimum:static_seed<catalog',
                'context_too_small:16000<32000',
                'missing_capability:tools',
                'price_above_limit:80>20',
            ],
            nextActions: [
                'choose_model_with_required_capabilities',
                'choose_larger_context_model_or_compact',
                'raise_budget_or_choose_lower_cost_model',
                'refresh_catalog_or_run_probe_to_raise_confidence',
            ],
            summary: 'unselected:confidence_below_minimum:static_seed<catalog',
        });
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

    it('promotes candidates with task-relevant runtime probe proofs without mutating catalog confidence', () => {
        const catalogOnly = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'json-catalog',
            capabilities: { streaming: true, structuredOutputs: true, jsonMode: true },
            limits: { contextWindowTokens: 64_000 },
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });
        const runtimeProved = createModelRecord({
            providerId: 'kilo',
            providerModel: 'json-runtime',
            capabilities: { streaming: true, structuredOutputs: true, jsonMode: true },
            limits: { contextWindowTokens: 64_000 },
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });

        recordByokProviderModelProbeResult({
            routeProfile: 'json_extraction',
            providerId: 'kilo',
            providerModel: 'json-runtime',
            probeKind: 'json',
            status: 'ok',
            ok: true,
            providerAttempted: true,
            timestamp: 75,
        });

        const decision = routeGatewayModels([catalogOnly, runtimeProved], 'json_extraction', {
            routeProfile: 'json_extraction',
        });

        assert.equal(decision.selected?.model['id'], 'kilo:json-runtime');
        assert.ok(decision.selected?.reasons.includes('runtime_probe_verified:json'));
        assert.ok(decision.selected?.reasons.includes('preferred_probe_verified:json'));
        assert.equal(runtimeProved['verification']?.['confidence'], 'catalog');
    });

    it('can require explicit probe proofs as a pre-runtime route policy', () => {
        const unproved = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'json-unproved',
            capabilities: { streaming: true, structuredOutputs: true, jsonMode: true },
            limits: { contextWindowTokens: 64_000 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });
        const proved = createModelRecord({
            providerId: 'kilo',
            providerModel: 'json-proved',
            capabilities: { streaming: true, structuredOutputs: true, jsonMode: true },
            limits: { contextWindowTokens: 64_000 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });

        recordByokProviderModelProbeResult({
            routeProfile: 'json_extraction',
            providerId: 'kilo',
            providerModel: 'json-proved',
            probeKind: 'json',
            status: 'ok',
            ok: true,
            providerAttempted: true,
            timestamp: 80,
        });

        const decision = routeGatewayModels([unproved, proved], 'json_extraction', {
            routeProfile: 'json_extraction',
            requiredProbeKinds: ['json'],
        });

        assert.equal(decision.selected?.model['id'], 'kilo:json-proved');
        assert.ok(decision.rejected.some((candidate) => candidate.rejectedReasons.includes('required_probe_missing:json')));
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

    it('can apply pre-runtime eligibility before scoring runtime candidates', () => {
        const visible = createModelRecord({
            providerId: 'openai',
            providerModel: 'gpt-visible',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
        });
        const hidden = createModelRecord({
            providerId: 'openai',
            providerModel: 'gpt-hidden',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'openai',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-visible'],
            sourceKind: 'authenticated_catalog',
        });

        const decision = routeGatewayModels([hidden, visible], 'tool_agent', {
            evaluateEligibility: true,
            accountOverlays: [overlay],
            secretRegistry: { has: () => true },
            eligibilityPolicy: { unknownAccessPolicy: 'block' },
            requireAgentProbeOk: false,
        });

        assert.equal(decision.selected?.model['providerModel'], 'gpt-visible');
        assert.equal(decision.candidates.length, 1);
        assert.equal(decision.candidates[0].eligibility?.['disposition'], 'eligible');
        assert.deepEqual(
            decision.rejected.map((candidate) => candidate.model['providerModel']),
            ['gpt-hidden'],
        );
        assert.ok(decision.rejected[0].rejectedReasons.includes('eligibility:account_model_not_visible'));
    });

    it('uses the concrete env secret registry in pre-runtime route admission', () => {
        const model = createModelRecord({
            providerId: 'openai',
            providerModel: 'gpt-needs-key',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'openai',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-needs-key'],
            sourceKind: 'authenticated_catalog',
        });

        const missing = routeGatewayModels([model], 'tool_agent', {
            evaluateEligibility: true,
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: {} }),
            requireAgentProbeOk: false,
        });
        assert.equal(missing.selected, null);
        assert.ok(missing.rejected[0].rejectedReasons.includes('eligibility:secret_missing:OPENAI_API_KEY'));

        const configured = routeGatewayModels([model], 'tool_agent', {
            evaluateEligibility: true,
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
            requireAgentProbeOk: false,
        });
        assert.equal(configured.selected?.model['providerModel'], 'gpt-needs-key');
        assert.equal(configured.selected?.eligibility?.['disposition'], 'eligible');
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
        assert.deepEqual(event.traceAttributes, {
            'llm.provider': 'kilo',
            'llm.model': 'kilo-auto/free',
            'llm.gateway.model_id': 'kilo:kilo-auto/free',
            'llm.route.decision_id': event.decisionId,
            'llm.route.task_profile': 'repo_agent',
            'llm.route.profile': 'kilo-free',
            'llm.route.mode': 'pre-probe',
            'llm.route.selected': true,
            'llm.route.score': event.score,
            'llm.route.candidates': 1,
            'llm.route.rejected': 1,
            'llm.route.fallback_count': 1,
            'llm.route.failure': 'none',
        });
        assert.deepEqual(buildRouteDecisionTraceAttributes(event), event.traceAttributes);
        assert.equal(JSON.stringify(event).includes('do not persist'), false);
        assert.equal(metrics.counters['model_gateway.route.decision'], 1);
        assert.equal(metrics.counters['model_gateway.route.selected'], 1);
        assert.equal(metrics.gauges['model_gateway.route.candidates'], 1);
        assert.equal(recorded.decisionId, event.decisionId);
        assert.equal(ledger.length, 1);
        assert.equal(ledger[0].decisionId, event.decisionId);
    });

    it('projects catalog refresh diff kinds into stable observability event and metrics', () => {
        const event = buildCatalogRefreshCompletedEvent({
            source: 'unit-test',
            storePath: 'data/copilot/model-gateway/catalog.json',
            importerIds: ['openrouter-models', 'cerebras-public-models'],
            snapshot: {
                projections: [{ providerModel: 'a' }, { providerModel: 'b' }],
                providerProjections: [{ subjectProviderId: 'openai' }],
                importRuns: [{ status: 'completed' }],
                conflicts: [{ fieldPath: 'pricing.inputUsdPerMillion' }],
            },
            diff: {
                added: ['cerebras:gpt-oss-120b:default'],
                removed: [],
                changed: [
                    { key: 'a', changedKinds: ['pricing_changed', 'limits_changed'] },
                    { key: 'b', changedKinds: ['pricing_changed'] },
                ],
            },
            openai: { object: 'list', data: [{ id: 'a' }, { id: 'b' }] },
        });
        const metrics = projectCatalogRefreshCompletedMetrics(event);

        assert.equal(event.type, 'model_gateway:catalog:import_completed');
        assert.deepEqual(event.importerIds, ['openrouter-models', 'cerebras-public-models']);
        assert.deepEqual(event.changedKinds, ['pricing_changed', 'limits_changed']);
        assert.equal(event.addedCount, 1);
        assert.equal(event.changedCount, 2);
        assert.equal(event.conflictCount, 1);
        assert.deepEqual(event.changedKindCounts, { pricing_changed: 2, limits_changed: 1 });
        assert.equal(metrics.counters['model_gateway.catalog.refresh.completed'], 1);
        assert.equal(metrics.counters['model_gateway.catalog.diff.pricing_changed'], 2);
        assert.equal(metrics.counters['model_gateway.catalog.diff.limits_changed'], 1);
        assert.equal(metrics.gauges['model_gateway.catalog.projections'], 2);
        assert.equal(metrics.gauges['model_gateway.catalog.conflicts'], 1);
    });

    it('projects eligibility evaluation into stable observability event and metrics', () => {
        const event = buildEligibilityEvaluatedEvent({
            source: 'unit-test',
            storePath: 'data/copilot/model-gateway/catalog.json',
            persisted: true,
            run: createModelEligibilityRun({
                runId: 'eligibility-run-1',
                policyProfile: 'strict-account',
                taskProfile: 'repo_agent',
                accountScope: 'default',
                modelCount: 3,
                eligibleCount: 1,
                unknownCount: 1,
                excludedCount: 1,
            }),
        });
        const metrics = projectEligibilityEvaluatedMetrics(event);

        assert.equal(event.type, 'model_gateway:eligibility:evaluated');
        assert.equal(event.runId, 'eligibility-run-1');
        assert.equal(event.policyProfile, 'strict-account');
        assert.equal(event.taskProfile, 'repo_agent');
        assert.equal(event.persisted, true);
        assert.equal(event.modelCount, 3);
        assert.equal(event.eligibleCount, 1);
        assert.equal(event.unknownCount, 1);
        assert.equal(event.excludedCount, 1);
        assert.equal(metrics.counters['model_gateway.eligibility.evaluated'], 1);
        assert.equal(metrics.counters['model_gateway.eligibility.persisted'], 1);
        assert.equal(metrics.counters['model_gateway.eligibility.policy.strict-account'], 1);
        assert.equal(metrics.gauges['model_gateway.eligibility.excluded'], 1);
    });

    it('builds stable per-model and conflict events for catalog refreshes', () => {
        const batch = buildCatalogRefreshEventBatch({
            source: 'unit-test',
            storePath: 'data/copilot/model-gateway/catalog.json',
            importerIds: ['openrouter-models'],
            snapshot: {
                projections: [],
                providerProjections: [],
                importRuns: [],
                conflicts: [
                    {
                        projectionKey: 'openrouter:model-a:default',
                        fieldPath: 'pricing.inputUsdPerMillion',
                        selectedEvidenceId: 'catalog-price',
                        conflictingEvidenceIds: ['heuristic-price'],
                    },
                ],
            },
            diff: {
                added: ['openrouter:model-added:default'],
                removed: ['openrouter:model-removed:default'],
                changed: [
                    {
                        key: 'openrouter:model-changed:default',
                        changedFields: ['pricing'],
                        changedKinds: ['pricing_changed'],
                    },
                ],
            },
            openai: { object: 'list', data: [] },
        });

        assert.equal(batch.completedEvent.type, 'model_gateway:catalog:import_completed');
        assert.deepEqual(
            batch.modelEvents.map((event) => event.type),
            [
                'model_gateway:catalog:model_added',
                'model_gateway:catalog:model_removed',
                'model_gateway:catalog:model_changed',
            ],
        );
        assert.deepEqual(batch.modelEvents[2], {
            type: 'model_gateway:catalog:model_changed',
            timestamp: batch.modelEvents[2].timestamp,
            source: 'unit-test',
            storePath: 'data/copilot/model-gateway/catalog.json',
            key: 'openrouter:model-changed:default',
            changedFields: ['pricing'],
            changedKinds: ['pricing_changed'],
        });
        assert.deepEqual(batch.conflictEvents[0], {
            type: 'model_gateway:catalog:conflict_detected',
            timestamp: batch.conflictEvents[0].timestamp,
            source: 'unit-test',
            storePath: 'data/copilot/model-gateway/catalog.json',
            projectionKey: 'openrouter:model-a:default',
            fieldPath: 'pricing.inputUsdPerMillion',
            selectedEvidenceId: 'catalog-price',
            conflictingEvidenceIds: ['heuristic-price'],
        });
        assert.deepEqual(batch.events.map((event) => event.type), [
            'model_gateway:catalog:model_added',
            'model_gateway:catalog:model_removed',
            'model_gateway:catalog:model_changed',
            'model_gateway:catalog:conflict_detected',
            'model_gateway:catalog:import_completed',
        ]);
    });

    it('publishes a boolean pre-K compatibility gate for the current migration layer', () => {
        const report = buildModelGatewayPreKCompatibilityReport();

        assert.equal(report.stage, 'pre-k');
        assert.equal(report.ready, true);
        assert.equal(report.failed, 0);
        assert.equal(report.passed, report.total);
        assert.ok(report.checks.length >= 8);
        assert.ok(report.checks.every((check) => typeof check.passed === 'boolean'));
        assert.ok(report.checks.some((check) => check.id === 'sdk_provider_config_boundary'));
        assert.ok(report.checks.some((check) => check.id === 'route_trace_attributes_are_stable'));
    });

    it('creates secret-safe universal catalog evidence contracts', () => {
        const source = createProviderCatalogSource({
            id: 'kilo-public-models',
            providerId: 'kilo',
            kind: 'gateway',
            url: 'https://api.kilo.ai/api/gateway/models',
            authMode: 'none',
            refreshPolicy: 'scheduled',
            ttlSeconds: 3600,
        });
        const evidence = createModelMetadataEvidence({
            evidenceId: 'ev-1',
            providerId: 'kilo',
            providerModel: 'anthropic/claude-sonnet-4.5',
            routeProfile: 'kilo-free',
            fieldPath: 'capabilities.tools',
            value: { tools: true, Authorization: 'Bearer sk-secret-that-must-not-leak' },
            sourceId: source.id,
            sourceKind: source.kind,
            confidence: 'catalog',
            observedAt: '2026-05-25T00:00:00.000Z',
        });
        const providerEvidence = createProviderMetadataEvidence({
            evidenceId: 'provider-ev-1',
            providerId: 'kilo',
            subjectProviderId: 'anthropic',
            fieldPath: 'dataPolicy.retainsPrompts',
            value: { retainsPrompts: false, token: 'secret-token-that-must-not-leak' },
            sourceId: source.id,
            sourceKind: source.kind,
            confidence: 'catalog',
            observedAt: '2026-05-25T00:00:00.000Z',
        });
        const route = createModelRouteOption({
            providerId: 'kilo',
            providerModel: 'anthropic/claude-sonnet-4.5',
            selectorKind: 'gateway_auto',
            selectorSyntax: 'provider/model',
            providerSpecific: { header: 'x-kilocode-mode', token: 'secret-token-that-must-not-leak' },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'kilo',
            accountScope: 'org',
            secretRef: 'KILO_API_KEY',
            enabledModels: ['anthropic/claude-sonnet-4.5'],
            policyHeaders: { Authorization: 'Bearer sk-secret-that-must-not-leak' },
        });
        const projection = createCanonicalModelProjection({
            providerId: 'kilo',
            providerModel: 'anthropic/claude-sonnet-4.5',
            capabilities: { tools: true, vision: true },
            supportedParameters: ['tools', 'stream'],
            provenanceByField: { 'capabilities.tools': evidence.evidenceId },
            confidenceByField: { 'capabilities.tools': evidence.confidence },
            accountOverlayRefs: [overlay.secretRef],
        });

        assert.equal(source.providerId, 'kilo');
        assert.equal(evidence.redactionStatus, 'sanitized');
        assert.equal(providerEvidence.subjectProviderId, 'anthropic');
        assert.equal(providerEvidence.redactionStatus, 'sanitized');
        assert.equal(route.selectorKind, 'gateway_auto');
        assert.deepEqual(route.normalizedPolicy.routeTraits, {
            selectorKind: 'gateway-auto',
            selectionMode: 'gateway_auto',
            autoSelection: true,
        });
        assert.equal(overlay.redactionStatus, 'sanitized');
        assert.deepEqual(projection.modalities, { input: ['text'], output: ['text'] });
        const serialized = JSON.stringify({ evidence, providerEvidence, route, overlay, projection });
        assert.equal(serialized.includes('sk-secret-that-must-not-leak'), false);
        assert.equal(serialized.includes('secret-token-that-must-not-leak'), false);
    });

    it('merges catalog evidence field-wise without letting poorer fresh facts erase richer metadata', () => {
        const olderCatalog = createModelMetadataEvidence({
            evidenceId: 'catalog-context',
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            fieldPath: 'limits.contextWindowTokens',
            value: 131072,
            sourceId: 'openrouter-models',
            sourceKind: 'public_api',
            confidence: 'catalog',
            observedAt: '2026-05-24T00:00:00.000Z',
        });
        const newerHeuristic = createModelMetadataEvidence({
            evidenceId: 'heuristic-context',
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            fieldPath: 'limits.contextWindowTokens',
            value: 8192,
            sourceId: 'name-parser',
            sourceKind: 'heuristic',
            confidence: 'heuristic',
            observedAt: '2026-05-25T00:00:00.000Z',
        });
        const manualTools = createModelMetadataEvidence({
            evidenceId: 'manual-tools',
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            fieldPath: 'capabilities.tools',
            value: true,
            sourceId: 'operator',
            sourceKind: 'manual',
            confidence: 'manual',
            observedAt: '2026-05-25T01:00:00.000Z',
        });
        const canonicalSlug = createModelMetadataEvidence({
            evidenceId: 'catalog-alias',
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            fieldPath: 'aliases.canonicalSlug',
            value: 'openai/gpt-oss-120b-20260520',
            sourceId: 'openrouter-models',
            sourceKind: 'public_api',
            confidence: 'catalog',
        });
        const ownedBy = createModelMetadataEvidence({
            evidenceId: 'owner',
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            fieldPath: 'providerMetadata.ownedBy',
            value: 'openai',
            sourceId: 'openrouter-models',
            sourceKind: 'public_api',
            confidence: 'catalog',
        });

        const merged = mergeModelMetadataEvidence([newerHeuristic, olderCatalog, manualTools, canonicalSlug, ownedBy]);

        assert.equal(rankCatalogEvidenceConfidence('manual') > rankCatalogEvidenceConfidence('catalog'), true);
        assert.equal(merged.projection.providerId, 'openrouter');
        assert.equal(merged.projection.limits.contextWindowTokens, 131072);
        assert.equal(merged.projection.capabilities.tools, true);
        assert.equal(merged.projection.aliases.canonicalSlug, 'openai/gpt-oss-120b-20260520');
        assert.equal(merged.projection.providerMetadata.ownedBy, 'openai');
        assert.equal(merged.projection.provenanceByField['limits.contextWindowTokens'], 'catalog-context');
        assert.equal(merged.projection.confidenceByField['limits.contextWindowTokens'], 'catalog');
        assert.deepEqual(merged.conflicts, [
            {
                fieldPath: 'limits.contextWindowTokens',
                selectedEvidenceId: 'catalog-context',
                conflictingEvidenceIds: ['heuristic-context'],
            },
        ]);
    });

    it('merges provider metadata evidence into provider projections', () => {
        const displayName = createProviderMetadataEvidence({
            evidenceId: 'provider-display',
            providerId: 'kilo',
            subjectProviderId: 'arcee-ai',
            fieldPath: 'displayName',
            value: 'Arcee AI',
            sourceId: 'kilo-gateway-providers',
            sourceKind: 'public_gateway_api',
            confidence: 'catalog',
            observedAt: '2026-05-25T00:00:00.000Z',
        });
        const weakerPolicy = createProviderMetadataEvidence({
            evidenceId: 'provider-policy-weak',
            providerId: 'kilo',
            subjectProviderId: 'arcee-ai',
            fieldPath: 'dataPolicy.retainsPrompts',
            value: true,
            sourceId: 'heuristic',
            sourceKind: 'heuristic',
            confidence: 'heuristic',
            observedAt: '2026-05-25T01:00:00.000Z',
        });
        const catalogPolicy = createProviderMetadataEvidence({
            evidenceId: 'provider-policy-catalog',
            providerId: 'kilo',
            subjectProviderId: 'arcee-ai',
            fieldPath: 'dataPolicy.retainsPrompts',
            value: false,
            sourceId: 'kilo-gateway-providers',
            sourceKind: 'public_gateway_api',
            confidence: 'catalog',
            observedAt: '2026-05-25T00:00:00.000Z',
        });
        const projection = createCanonicalProviderProjection({
            providerId: 'kilo',
            subjectProviderId: 'arcee-ai',
            displayName: 'Arcee AI',
        });
        const merged = mergeProviderMetadataEvidence([displayName, weakerPolicy, catalogPolicy]);

        assert.equal(projection.displayName, 'Arcee AI');
        assert.equal(merged.projection.providerId, 'kilo');
        assert.equal(merged.projection.subjectProviderId, 'arcee-ai');
        assert.equal(merged.projection.displayName, 'Arcee AI');
        assert.equal(merged.projection.dataPolicy.retainsPrompts, false);
        assert.equal(merged.projection.provenanceByField['dataPolicy.retainsPrompts'], 'provider-policy-catalog');
        assert.deepEqual(merged.conflicts, [
            {
                fieldPath: 'dataPolicy.retainsPrompts',
                selectedEvidenceId: 'provider-policy-catalog',
                conflictingEvidenceIds: ['provider-policy-weak'],
            },
        ]);
    });

    it('creates sanitized import run payload refs and diffs canonical projections', () => {
        const rawRef = createSanitizedRawPayloadRef({
            providerId: 'openrouter',
            sourceId: 'openrouter-models',
            payload: {
                data: [{ id: 'openai/gpt-oss-120b', context: 131072 }],
                Authorization: 'Bearer sk-secret-that-must-not-leak',
            },
        });
        const run = createCatalogImportRun({
            runId: 'run-1',
            providerId: 'openrouter',
            sourceId: 'openrouter-models',
            rowCount: 1,
            errors: [{ message: 'token sk-secret-that-must-not-leak failed' }],
            diff: { added: ['openrouter:openai/gpt-oss-120b:default'] },
        });
        const previous = [
            createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'old-model',
            }),
            createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                limits: { contextWindowTokens: 8192 },
            }),
        ];
        const next = [
            createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                limits: { contextWindowTokens: 131072 },
            }),
            createCanonicalModelProjection({
                providerId: 'kilo',
                providerModel: 'anthropic/claude-sonnet-4.5',
            }),
        ];
        const diff = diffCanonicalModelProjections(previous, next);

        assert.match(rawRef.rawPayloadRef, /^sha256:/u);
        assert.equal(rawRef.redactionStatus, 'sanitized');
        assert.equal(run.redactionStatus, 'sanitized');
        assert.deepEqual(diff.added, ['kilo:anthropic/claude-sonnet-4.5:default']);
        assert.deepEqual(diff.removed, ['openrouter:old-model:default']);
        assert.deepEqual(diff.changed, [
            {
                key: 'openrouter:openai/gpt-oss-120b:default',
                changedFields: ['limits'],
                changedKinds: ['limits_changed'],
            },
        ]);
        assert.equal(JSON.stringify({ rawRef, run }).includes('sk-secret-that-must-not-leak'), false);
    });

    it('classifies semantic catalog diff kinds for pricing, capabilities and lifecycle changes', () => {
        const previous = [
            createCanonicalModelProjection({
                providerId: 'cerebras',
                providerModel: 'gpt-oss-120b',
                lifecycle: { status: 'active' },
                capabilities: { tools: true },
                pricing: { inputUsdPerMillion: 0.35 },
            }),
        ];
        const next = [
            createCanonicalModelProjection({
                providerId: 'cerebras',
                providerModel: 'gpt-oss-120b',
                lifecycle: { status: 'retired' },
                capabilities: { tools: true, structuredOutputs: true },
                pricing: { inputUsdPerMillion: 0.45 },
            }),
        ];
        const diff = diffCanonicalModelProjections(previous, next);

        assert.deepEqual(diff.changed, [
            {
                key: 'cerebras:gpt-oss-120b:default',
                changedFields: ['capabilities', 'lifecycle', 'pricing'],
                changedKinds: ['capabilities_changed', 'deprecation_changed', 'lifecycle_changed', 'pricing_changed'],
            },
        ]);
        assert.deepEqual(summarizeCanonicalModelProjectionDiff(diff), {
            addedCount: 0,
            removedCount: 0,
            changedCount: 1,
            changedKinds: ['capabilities_changed', 'deprecation_changed', 'lifecycle_changed', 'pricing_changed'],
            changedKindCounts: {
                capabilities_changed: 1,
                deprecation_changed: 1,
                lifecycle_changed: 1,
                pricing_changed: 1,
            },
        });
    });

    it('recommends explicit runtime probes from high-value catalog diffs without executing them', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            capabilities: {
                tools: true,
                streaming: true,
                jsonMode: true,
                vision: true,
                reasoningEffort: true,
            },
            modalities: { input: ['text', 'image'], output: ['text'] },
            limits: { contextWindowTokens: 131072, maxOutputTokens: 8192 },
        });
        const recommendations = recommendCatalogDiffProbes({
            projections: [projection],
            diff: {
                added: ['openrouter:openai/gpt-oss-120b:default'],
                changed: [],
            },
        });

        assert.deepEqual(recommendations, [
            {
                key: 'openrouter:openai/gpt-oss-120b:default',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                routeProfile: 'default',
                priority: 'high',
                probeKinds: ['chat', 'streaming', 'json', 'agent', 'vision'],
                reasons: [
                    'agentic_capability',
                    'structured_output_capability',
                    'streaming_capability',
                    'vision_capability',
                    'reasoning_capability',
                    'large_context',
                    'large_output',
                    'new_model',
                ],
                commands: [
                    '/byok probe chat model:openai/gpt-oss-120b',
                    '/byok probe streaming model:openai/gpt-oss-120b',
                    '/byok probe json model:openai/gpt-oss-120b',
                    '/byok probe agent model:openai/gpt-oss-120b',
                    '/byok probe vision model:openai/gpt-oss-120b',
                ],
            },
        ]);
    });

    it('keeps runtime probe recommendations behind eligibility unless exploration is explicit', () => {
        const visible = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'visible/model',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 131072 },
        });
        const hidden = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'hidden/model',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 131072 },
        });
        const unknown = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'unknown/model',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 131072 },
        });
        const recommendations = recommendCatalogDiffProbes({
            projections: [visible, hidden, unknown],
            eligibilityDecisions: [
                createModelEligibilityDecision({
                    providerId: 'openrouter',
                    providerModel: 'visible/model',
                    include: true,
                }),
                createModelEligibilityDecision({
                    providerId: 'openrouter',
                    providerModel: 'hidden/model',
                    include: false,
                    hardExclusions: ['account_model_not_visible'],
                }),
                createModelEligibilityDecision({
                    providerId: 'openrouter',
                    providerModel: 'unknown/model',
                    include: true,
                    disposition: 'unknown_policy_allows_probe',
                    softPenalties: ['account_visibility_unknown'],
                }),
            ],
            requireEligibilityDecision: true,
            diff: {
                added: [
                    'openrouter:visible/model:default',
                    'openrouter:hidden/model:default',
                    'openrouter:unknown/model:default',
                ],
                changed: [],
            },
        });

        assert.deepEqual(
            recommendations.map((item) => [item.key, item.eligibilityStatus]),
            [
                ['openrouter:unknown/model:default', 'unknown'],
                ['openrouter:visible/model:default', 'eligible'],
            ],
        );
    });

    it('persists a redacted JSON catalog snapshot before the SQLite store', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-model-catalog-'));
        try {
            const filePath = join(dir, 'catalog.json');
            const source = createProviderCatalogSource({
                id: 'openrouter-models',
                providerId: 'openrouter',
                kind: 'public_api',
                url: 'https://openrouter.ai/api/v1/models',
            });
            const rawRef = createSanitizedRawPayloadRef({
                providerId: 'openrouter',
                sourceId: source.id,
                payload: { Authorization: 'Bearer sk-secret-that-must-not-leak', data: [{ id: 'm' }] },
            });
            const evidence = createModelMetadataEvidence({
                evidenceId: 'ev-price',
                providerId: 'openrouter',
                providerModel: 'm',
                fieldPath: 'pricing.inputUsdPerMillion',
                value: 0,
                sourceId: source.id,
                rawPayloadRef: rawRef.rawPayloadRef,
            });
            const projection = createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'm',
                limits: { contextWindowTokens: 131072 },
                pricing: { inputUsdPerMillion: 0 },
            });
            const store = new JsonModelGatewayCatalogStore({ filePath });

            await store.writeSnapshot({
                source: 'unit-test',
                sources: [source],
                evidences: [evidence],
                projections: [projection],
                rawPayloadRefs: [rawRef],
                modelEligibilityRuns: [
                    createModelEligibilityRun({
                        runId: 'eligibility-run-1',
                        modelCount: 1,
                        eligibleCount: 1,
                        policyInputs: { authorization: 'Bearer sk-secret-that-must-not-leak' },
                    }),
                ],
                modelEligibilityDecisions: [
                    createModelEligibilityDecision({
                        providerId: 'openrouter',
                        providerModel: 'm',
                        include: true,
                        reasons: ['account_overlay_available'],
                    }),
                ],
                importRuns: [
                    createCatalogImportRun({
                        runId: 'run-1',
                        providerId: 'openrouter',
                        sourceId: source.id,
                        rowCount: 1,
                        errors: ['sk-secret-that-must-not-leak'],
                    }),
                ],
            });
            const raw = await readFile(filePath, 'utf8');
            const loaded = await store.readSnapshot();

            assert.equal(raw.includes('sk-secret-that-must-not-leak'), false);
            assert.equal(loaded.source, 'unit-test');
            assert.equal(loaded.sources.length, 1);
            assert.equal(loaded.evidences.length, 1);
            assert.equal(loaded.projections.length, 1);
            assert.equal(loaded.projections[0].limits.contextWindowTokens, 131072);
            assert.equal(loaded.rawPayloadRefs.length, 1);
            assert.equal(loaded.importRuns.length, 1);
            assert.equal(loaded.modelEligibilityRuns.length, 1);
            assert.equal(loaded.modelEligibilityDecisions.length, 1);
            assert.equal(JSON.stringify(loaded.modelEligibilityRuns).includes('sk-secret-that-must-not-leak'), false);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('defines an executable SQLite schema for normalized catalog, overlay and eligibility layers', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            db.pragma('foreign_keys = ON');
            db.exec(MODEL_GATEWAY_SQLITE_SCHEMA_SQL);

            const tableRows = db
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'copilot_model_gateway_%' ORDER BY name",
                )
                .all()
                .map(/** @param {{ name: string }} row */ (row) => row.name);
            const tableNames = new Set(tableRows);

            for (const table of MODEL_GATEWAY_SQLITE_TABLES) {
                assert.equal(tableNames.has(table), true, `${table} should exist`);
                assert.equal(MODEL_GATEWAY_SQLITE_SCHEMA_SQL.includes(` ${table} `), true);
            }

            db.prepare(
                `
                    INSERT INTO copilot_model_gateway_catalog_sources
                        (source_id, provider_id, source_kind, auth_mode, trust_tier, refresh_policy, observed_at_ms, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                'openrouter-models',
                'openrouter',
                'public_api',
                'none',
                'catalog',
                'scheduled',
                1,
                JSON.stringify({ redacted: true }),
            );
            db.prepare(
                `
                    INSERT INTO copilot_model_gateway_model_projections
                        (projection_key, provider_id, provider_model, route_profile, display_name, lifecycle_status, updated_at_ms, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                'openrouter:model-a:default',
                'openrouter',
                'model-a',
                'default',
                'Model A',
                'active',
                2,
                JSON.stringify({ id: 'model-a' }),
            );
            db.prepare(
                `
                    INSERT INTO copilot_model_gateway_eligibility_runs
                        (run_id, policy_profile, task_profile, account_scope, status, started_at_ms, completed_at_ms,
                         model_count, eligible_count, unknown_count, excluded_count, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run('eligibility-run-1', 'strict-account', 'repo_agent', 'default', 'completed', 3, 4, 1, 1, 0, 0, '{}');
            db.prepare(
                `
                    INSERT INTO copilot_model_gateway_eligibility_decisions
                        (decision_key, run_id, provider_id, provider_model, route_profile, selector_kind, account_scope,
                         policy_profile, task_profile, include, disposition, primary_reason, observed_at_ms, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                'strict-account:repo_agent:default:openrouter:model-a:default:exact_model',
                'eligibility-run-1',
                'openrouter',
                'model-a',
                'default',
                'exact_model',
                'default',
                'strict-account',
                'repo_agent',
                1,
                'eligible',
                'account_overlay_available',
                5,
                '{}',
            );
            db.prepare(
                `
                    INSERT INTO copilot_model_gateway_runtime_probe_runs
                        (run_id, probe_profile, account_scope, status, started_at_ms, completed_at_ms,
                         model_count, success_count, failure_count, skipped_count, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run('probe-run-1', 'cheap-basic', 'default', 'completed', 6, 7, 1, 1, 0, 0, '{}');
            db.prepare(
                `
                    INSERT INTO copilot_model_gateway_runtime_probe_results
                        (result_key, run_id, provider_id, provider_model, route_profile, probe_kind, wire_api,
                         ok, status, observed_at_ms, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                'probe-run-1:openrouter:model-a:chat',
                'probe-run-1',
                'openrouter',
                'model-a',
                'default',
                'chat',
                'openai_chat_completions',
                1,
                'ok',
                8,
                '{}',
            );
            db.prepare(
                `
                    INSERT INTO copilot_model_gateway_route_decisions
                        (decision_id, task_profile, route_profile, policy_profile, provider_id, provider_model,
                         selected, decided_at_ms, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                'route-decision-1',
                'repo_agent',
                'default',
                'strict-account',
                'openrouter',
                'model-a',
                1,
                9,
                '{}',
            );

            const row = /** @type {{ include: number, disposition: string } | undefined} */ (
                db.prepare(
                    `
                        SELECT include, disposition
                        FROM copilot_model_gateway_eligibility_decisions
                        WHERE provider_id = ? AND provider_model = ?
                    `,
                ).get('openrouter', 'model-a')
            );

            assert.deepEqual(row, { include: 1, disposition: 'eligible' });
        } finally {
            db.close();
        }
    });

    it('guards SQLite catalog stores against unknown future schema versions', async () => {
        const { default: Database } = await import('better-sqlite3');
        const fresh = new Database(':memory:');
        const future = new Database(':memory:');
        try {
            assert.equal(fresh.pragma('user_version', { simple: true }), 0);
            new SqliteModelGatewayCatalogStore({ db: fresh });
            assert.equal(fresh.pragma('user_version', { simple: true }), MODEL_GATEWAY_SQLITE_SCHEMA_VERSION);

            future.pragma(`user_version = ${MODEL_GATEWAY_SQLITE_SCHEMA_VERSION + 100}`);
            assert.throws(
                () => new SqliteModelGatewayCatalogStore({ db: future }),
                /database schema version .* newer than supported version/u,
            );
        } finally {
            fresh.close();
            future.close();
        }
    });

    it('round-trips a redacted catalog snapshot through the normalized SQLite store', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const source = createProviderCatalogSource({
                id: 'kilo-models',
                providerId: 'kilo',
                kind: 'gateway',
                url: 'https://kilocode.ai/api/gateway/models',
            });
            const evidence = createModelMetadataEvidence({
                evidenceId: 'kilo-model-tools',
                providerId: 'kilo',
                providerModel: 'anthropic/claude-sonnet-4.5',
                fieldPath: 'capabilities.tools',
                value: { tools: true, token: 'secret-token-that-must-not-leak' },
                sourceId: source.id,
                confidence: 'catalog',
            });
            const route = createModelRouteOption({
                providerId: 'kilo',
                providerModel: 'anthropic/claude-sonnet-4.5',
                routeProfile: 'kilo-free',
                selectorKind: 'gateway_auto',
                selectorSyntax: 'provider/model',
                normalizedPolicy: { routeLayer: 'gateway', wireApi: 'openai_chat_completions' },
            });
            const overlay = createProviderAccountOverlay({
                providerId: 'kilo',
                secretRef: 'KILO_API_KEY',
                enabledModels: ['anthropic/claude-sonnet-4.5'],
                policyHeaders: { Authorization: 'Bearer sk-secret-that-must-not-leak' },
            });
            const projection = createCanonicalModelProjection({
                providerId: 'kilo',
                providerModel: 'anthropic/claude-sonnet-4.5',
                routeProfile: 'kilo-free',
                capabilities: { tools: true },
                accountOverlayRefs: [overlay.accountOverlayId],
            });
            const eligibility = createModelEligibilityDecision({
                providerId: 'kilo',
                providerModel: 'anthropic/claude-sonnet-4.5',
                routeProfile: 'kilo-free',
                include: true,
                reasons: ['account_model_visible'],
                policyInputs: { apiKey: 'sk-secret-that-must-not-leak' },
            });
            const store = new SqliteModelGatewayCatalogStore({ db });

            const snapshot = {
                source: 'sqlite-unit-test',
                sources: [source],
                evidences: [evidence],
                routeOptions: [route],
                accountOverlays: [overlay],
                projections: [projection],
                modelEligibilityRuns: [
                    createModelEligibilityRun({
                        runId: 'eligibility-run-sqlite',
                        modelCount: 1,
                        eligibleCount: 1,
                    }),
                ],
                modelEligibilityDecisions: [eligibility],
            };

            await store.writeSnapshot(snapshot);
            await store.writeSnapshot(snapshot);
            const loaded = await store.readSnapshot();
            const openai = await store.readOpenAIModelCatalogList();
            const serializedRows = /** @type {{ payload: string | null } | undefined} */ (
                db.prepare(
                    `
                        SELECT group_concat(payload_json, char(10)) AS payload
                        FROM (
                            SELECT payload_json FROM copilot_model_gateway_snapshots
                            UNION ALL SELECT payload_json FROM copilot_model_gateway_model_evidence
                            UNION ALL SELECT payload_json FROM copilot_model_gateway_account_overlays
                            UNION ALL SELECT payload_json FROM copilot_model_gateway_eligibility_decisions
                        )
                    `,
                )
                    .get()
            );

            assert.equal(loaded.source, 'sqlite-unit-test');
            assert.equal(loaded.sources.length, 1);
            assert.equal(loaded.evidences.length, 1);
            assert.equal(loaded.routeOptions.length, 1);
            assert.equal(loaded.accountOverlays.length, 1);
            assert.equal(loaded.projections.length, 1);
            assert.equal(loaded.modelEligibilityRuns.length, 1);
            assert.equal(loaded.modelEligibilityDecisions.length, 1);
            assert.equal(openai.object, 'list');
            assert.equal(openai.data.length, 1);
            assert.equal(openai.data[0].x_model_gateway.eligibility.status, 'eligible');
            assert.equal(JSON.stringify(loaded).includes('sk-secret-that-must-not-leak'), false);
            assert.equal(JSON.stringify(serializedRows).includes('secret-token-that-must-not-leak'), false);
        } finally {
            db.close();
        }
    });

    it('persists sanitized route decision events in the SQLite route-decision layer', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const model = createModelRecord({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                capabilities: { tools: true, streaming: true },
                limits: { contextWindowTokens: 131_072 },
            });
            const route = routeGatewayModels([model], 'tool_agent', { requireAgentProbeOk: false });
            const event = buildRouteDecisionEvent({
                taskProfile: 'tool_agent',
                routeProfile: 'default',
                mode: 'pre-probe',
                source: 'unit-test',
                route,
                estimatedInputTokens: 123,
                estimatedOutputTokens: 456,
                estimatedCostUsd: 0.01,
            });

            const summary = await store.writeRouteDecisionEvents([event]);
            await store.writeRouteDecisionEvents([event]);
            const loaded = await store.readRouteDecisionEvents({ limit: 5 });
            const rows = /** @type {{ count: number } | undefined} */ (
                db.prepare('SELECT COUNT(*) AS count FROM copilot_model_gateway_route_decisions').get()
            );

            assert.deepEqual(summary, { routeDecisions: 1 });
            assert.equal(rows?.count, 1);
            assert.equal(loaded.length, 1);
            assert.equal(loaded[0].decisionId, event.decisionId);
            assert.equal(loaded[0].providerId, 'openrouter');
            assert.equal(JSON.stringify(loaded).includes('sk-'), false);
        } finally {
            db.close();
        }
    });

    it('mirrors the debug JSON catalog snapshot into SQLite without changing the source snapshot', async () => {
        const { default: Database } = await import('better-sqlite3');
        const dir = await mkdtemp(join(tmpdir(), 'copilot-model-sqlite-mirror-'));
        const db = new Database(':memory:');
        try {
            const filePath = join(dir, 'catalog.json');
            const jsonStore = new JsonModelGatewayCatalogStore({ filePath });
            const sqliteStore = new SqliteModelGatewayCatalogStore({ db });
            const projection = createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                capabilities: { tools: true, streaming: true },
            });
            const route = createModelRouteOption({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                selectorKind: 'provider_model',
                selectorSyntax: 'openai/gpt-oss-120b',
                normalizedPolicy: { routeLayer: 'gateway', wireApi: 'openai_chat_completions' },
            });

            await jsonStore.writeSnapshot({
                source: 'json-source',
                projections: [projection],
                routeOptions: [route],
                modelEligibilityDecisions: [
                    createModelEligibilityDecision({
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        include: true,
                        reasons: ['account_overlay_available'],
                    }),
                ],
            });

            const mirrored = await mirrorModelGatewayCatalogSnapshotToSqlite({
                sourceStore: jsonStore,
                sqliteStore,
            });
            const jsonAfter = await jsonStore.readSnapshot();
            const sqliteSummary = summarizeModelGatewayCatalogSnapshot(mirrored.sqliteSnapshot);

            assert.equal(mirrored.sourceSnapshot.source, 'json-source');
            assert.equal(mirrored.sqliteSnapshot.source, 'json-source');
            assert.deepEqual(mirrored.sourceCounts, mirrored.sqliteCounts);
            assert.equal(sqliteSummary.projections, 1);
            assert.equal(sqliteSummary.routeOptions, 1);
            assert.equal(sqliteSummary.modelEligibilityDecisions, 1);
            assert.equal(jsonAfter.projections.length, 1);
            assert.equal(jsonAfter.routeOptions.length, 1);
        } finally {
            db.close();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('explains a catalog model by joining projection, routes, overlays and eligibility without runtime', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            displayName: 'GPT OSS 120B',
            capabilities: { tools: true, streaming: true },
            supportedParameters: ['tools', 'stream'],
            provenanceByField: { 'capabilities.tools': 'ev-tools' },
            confidenceByField: { 'capabilities.tools': 'catalog' },
        });
        const route = createModelRouteOption({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            selectorKind: 'provider_model',
            selectorSyntax: 'openai/gpt-oss-120b',
            normalizedPolicy: { routeLayer: 'gateway', wireApi: 'openai_chat_completions' },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'openrouter',
            secretRef: 'OPEN_ROUTER_KEY',
            enabledModels: ['openai/gpt-oss-120b'],
        });
        const eligibility = createModelEligibilityDecision({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            include: true,
            reasons: ['account_model_visible'],
            requiredRuntimeProbes: ['chat', 'agent'],
        });

        const explanation = explainModelGatewayCatalogEntry(
            {
                sources: [],
                providerEvidences: [],
                evidences: [],
                routeOptions: [route],
                accountOverlays: [overlay],
                providerProjections: [],
                projections: [projection],
                importRuns: [],
                rawPayloadRefs: [],
                conflicts: [],
                modelEligibilityRuns: [],
                modelEligibilityDecisions: [eligibility],
                schemaVersion: 1,
                generatedAt: null,
                source: 'unit-test',
            },
            'gpt-oss',
        );

        assert.equal(explanation.found, true);
        assert.equal(explanation.key, 'openrouter:openai/gpt-oss-120b:default');
        assert.equal(explanation.routeOptions.length, 1);
        assert.equal(explanation.accountOverlays.length, 1);
        assert.equal(explanation.eligibility?.status, 'eligible');
        assert.equal(explanation.openai?.x_model_gateway.eligibility.status, 'eligible');
        assert.deepEqual(explanation.metadataCoverage, {
            confidenceFields: 1,
            provenanceFields: 1,
            supportedParameters: 2,
            unsupportedParameters: 0,
        });
        assert.ok(explanation.nextActions.includes('run_runtime_probes:chat,agent'));
    });

    it('mirrors runtime health/probe facts into SQLite and joins them into catalog explain', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const projection = createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                capabilities: { tools: true, streaming: true },
            });
            const snapshot = {
                sources: [],
                providerEvidences: [],
                evidences: [],
                routeOptions: [],
                accountOverlays: [],
                providerProjections: [],
                projections: [projection],
                importRuns: [],
                rawPayloadRefs: [],
                conflicts: [],
                modelEligibilityRuns: [],
                modelEligibilityDecisions: [],
                schemaVersion: 1,
                generatedAt: null,
                source: 'unit-test',
            };
            const healthRecord = {
                key: 'default|openrouter|openai/gpt-oss-120b',
                routeProfile: 'default',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                lastStatus: 'ok',
                lastSuccessAt: 1_000,
                successCount: 1,
                failureCount: 0,
                agentProbeStatus: 'ok',
                lastAgentProbeSuccessAt: 1_500,
                agentProbeSuccessCount: 1,
                agentProbeFailureCount: 0,
                probes: {
                    chat: {
                        kind: 'chat',
                        status: 'ok',
                        ok: true,
                        providerAttempted: true,
                        count: 1,
                        successCount: 1,
                        failureCount: 0,
                        lastAt: 1_000,
                    },
                    agent: {
                        kind: 'agent',
                        status: 'ok',
                        ok: true,
                        providerAttempted: true,
                        count: 1,
                        successCount: 1,
                        failureCount: 0,
                        lastAt: 1_500,
                    },
                },
            };

            const mirrored = await mirrorByokProviderHealthToSqlite({
                sqliteStore: store,
                records: [healthRecord],
                observedAt: 2_000,
            });
            const runtime = await store.readRuntimeHealthForModel({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
            });
            const explanation = explainModelGatewayCatalogEntry(snapshot, 'gpt-oss', {
                runtimeHealthRecords: runtime.health ? [runtime.health] : [],
                runtimeProbeResults: runtime.probes,
            });

            assert.equal(mirrored.records, 1);
            assert.equal(mirrored.healthObservations, 1);
            assert.equal(mirrored.probeResults, 2);
            assert.equal(runtime.health?.['lastStatus'], 'ok');
            assert.equal(runtime.probes.length, 2);
            assert.equal(explanation.runtimeHealth?.status, 'ok');
            assert.equal(explanation.runtimeProbes.length, 2);
            assert.equal(explanation.nextActions.includes('run_runtime_probes_for_current_route'), false);
        } finally {
            db.close();
        }
    });

    it('searches catalog metadata before runtime using routes, overlays and eligibility as ranking hints', () => {
        const openrouterProjection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            displayName: 'GPT OSS 120B',
            capabilities: { tools: true, streaming: true, reasoningEffort: true },
            supportedParameters: ['tools', 'stream'],
        });
        const tinyProjection = createCanonicalModelProjection({
            providerId: 'tiny',
            providerModel: 'chat-only',
            capabilities: { tools: false, streaming: true },
        });
        const results = searchModelGatewayCatalogEntries(
            {
                sources: [],
                providerEvidences: [],
                evidences: [],
                routeOptions: [
                    createModelRouteOption({
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        selectorKind: 'provider_model',
                    }),
                ],
                accountOverlays: [
                    createProviderAccountOverlay({
                        providerId: 'openrouter',
                        enabledModels: ['openai/gpt-oss-120b'],
                    }),
                ],
                providerProjections: [],
                projections: [tinyProjection, openrouterProjection],
                importRuns: [],
                rawPayloadRefs: [],
                conflicts: [],
                modelEligibilityRuns: [],
                modelEligibilityDecisions: [
                    createModelEligibilityDecision({
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        include: true,
                    }),
                ],
                schemaVersion: 1,
                generatedAt: null,
                source: 'unit-test',
            },
            { query: 'gpt oss', requireTools: true, onlyEligible: true, limit: 5 },
        );

        assert.equal(results.length, 1);
        assert.equal(results[0].key, 'openrouter:openai/gpt-oss-120b:default');
        assert.equal(results[0].routeOptionCount, 1);
        assert.equal(results[0].accountOverlayCount, 1);
        assert.equal(results[0].eligibilityStatus, 'eligible');
        assert.ok(results[0].score > 0);
    });

    it('explains provider catalog coverage with sources, overlays, routes and conflicts', () => {
        const source = createProviderCatalogSource({
            id: 'openrouter-models',
            providerId: 'openrouter',
            kind: 'public_api',
        });
        const providerProjection = createCanonicalProviderProjection({
            providerId: 'openrouter',
            subjectProviderId: 'openai',
            displayName: 'OpenAI via OpenRouter',
        });
        const projection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            displayName: 'GPT OSS 120B',
        });
        const explanation = explainModelGatewayProviderEntry(
            {
                sources: [source],
                providerEvidences: [
                    createProviderMetadataEvidence({
                        evidenceId: 'provider-display',
                        providerId: 'openrouter',
                        subjectProviderId: 'openai',
                        fieldPath: 'displayName',
                        value: 'OpenAI',
                        sourceId: source.id,
                    }),
                ],
                evidences: [],
                routeOptions: [
                    createModelRouteOption({
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        selectorKind: 'provider_model',
                    }),
                ],
                accountOverlays: [
                    createProviderAccountOverlay({
                        providerId: 'openrouter',
                        enabledModels: ['openai/gpt-oss-120b'],
                    }),
                ],
                providerProjections: [providerProjection],
                projections: [projection],
                importRuns: [],
                rawPayloadRefs: [],
                conflicts: [
                    {
                        projectionKey: 'openrouter:openai/gpt-oss-120b:default',
                        fieldPath: 'pricing.inputUsdPerMillion',
                    },
                ],
                modelEligibilityRuns: [],
                modelEligibilityDecisions: [],
                schemaVersion: 1,
                generatedAt: null,
                source: 'unit-test',
            },
            'openrouter',
        );

        assert.equal(explanation.found, true);
        assert.equal(explanation.providerId, 'openrouter');
        assert.equal(explanation.sources.length, 1);
        assert.equal(explanation.providerEvidences.length, 1);
        assert.equal(explanation.projections.length, 1);
        assert.equal(explanation.routeOptions.length, 1);
        assert.equal(explanation.accountOverlays.length, 1);
        assert.equal(explanation.conflicts.length, 1);
        assert.ok(explanation.nextActions.includes('inspect_provider_conflicts'));
    });

    it('runs catalog importers into a secret-safe snapshot', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-model-importers-'));
        try {
            const filePath = join(dir, 'catalog.json');
            const store = new JsonModelGatewayCatalogStore({ filePath });
            const dates = [
                new Date('2026-05-25T12:00:00.000Z'),
                new Date('2026-05-25T12:00:01.000Z'),
                new Date('2026-05-25T12:00:02.000Z'),
                new Date('2026-05-25T12:00:03.000Z'),
            ];
            const snapshot = await runCatalogImporters({
                store,
                now: () => dates.shift() ?? new Date('2026-05-25T12:00:04.000Z'),
                importers: [
                    {
                        id: 'openrouter-models',
                        providerId: 'openrouter',
                        sourceKind: 'public_api',
                        requiresAuth: false,
                        url: 'https://openrouter.ai/api/v1/models',
                        fetchRaw: () => ({
                            Authorization: 'Bearer sk-secret-that-must-not-leak',
                            data: [{ id: 'm', contextWindowTokens: 131072 }],
                        }),
                        parseRows: (raw) => /** @type {{ data: unknown[] }} */ (raw).data,
                        toEvidenceFacts: (rows, context) =>
                            rows.map((row) =>
                                createModelMetadataEvidence({
                                    evidenceId: 'openrouter-m-context',
                                    providerId: 'openrouter',
                                    providerModel: /** @type {{ id: string }} */ (row).id,
                                    fieldPath: 'limits.contextWindowTokens',
                                    value: /** @type {{ contextWindowTokens: number }} */ (row).contextWindowTokens,
                                    sourceId: /** @type {{ id: string }} */ (context.source).id,
                                    rawPayloadRef: context.rawPayloadRef,
                                }),
                            ),
                        toAccountOverlays: (rows, context) => [
                            createProviderAccountOverlay({
                                providerId: 'openrouter',
                                accountScope: 'public-catalog',
                                sourceId: /** @type {{ id: string }} */ (context.source).id,
                                sourceKind: 'public_api',
                                confidence: 'catalog',
                                enabledModels: rows.map((row) => /** @type {{ id: string }} */ (row).id),
                            }),
                        ],
                    },
                    {
                        id: 'broken-auth-catalog',
                        providerId: 'groq',
                        sourceKind: 'authenticated_api',
                        requiresAuth: true,
                        fetchRaw: () => {
                            throw new Error('token gsk-secret-that-must-not-leak rejected');
                        },
                        parseRows: () => [],
                        toEvidenceFacts: () => [],
                    },
                ],
            });
            const raw = await readFile(filePath, 'utf8');
            const loaded = await store.readSnapshot();

            assert.equal(raw.includes('sk-secret-that-must-not-leak'), false);
            assert.equal(raw.includes('gsk-secret-that-must-not-leak'), false);
            assert.equal(snapshot.evidences.length, 1);
            assert.equal(snapshot.accountOverlays.length, 1);
            assert.equal(snapshot.rawPayloadRefs.length, 1);
            assert.deepEqual(
                snapshot.importRuns.map((run) => run.status),
                ['completed', 'failed'],
            );
            assert.equal(loaded.sources.length, 2);
            assert.equal(loaded.evidences[0].value, 131072);
            assert.deepEqual(loaded.accountOverlays[0].enabledModels, ['m']);
            assert.equal(JSON.stringify(loaded.importRuns).includes('gsk-secret-that-must-not-leak'), false);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('extracts rich OpenRouter model metadata as catalog evidence', async () => {
        const fakeFetch = /** @type {typeof fetch} */ (
            async () =>
                /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            {
                                id: 'x-ai/grok-build-0.1',
                                canonical_slug: 'x-ai/grok-build-0.1-20260520',
                                name: 'xAI: Grok Build 0.1',
                                description: 'coding model',
                                context_length: 256000,
                                architecture: {
                                    modality: 'text+image->text',
                                    input_modalities: ['text', 'image'],
                                    output_modalities: ['text'],
                                    tokenizer: 'Grok',
                                    instruct_type: null,
                                },
                                pricing: {
                                    prompt: '0.000001',
                                    completion: '0.000002',
                                    input_cache_read: '0.0000002',
                                    web_search: '0.005',
                                },
                                top_provider: {
                                    context_length: 256000,
                                    max_completion_tokens: 65536,
                                    is_moderated: false,
                                },
                                supported_parameters: ['tools', 'tool_choice', 'response_format', 'structured_outputs'],
                                default_parameters: {
                                    temperature: null,
                                    top_p: null,
                                    top_k: null,
                                    frequency_penalty: null,
                                    presence_penalty: null,
                                    repetition_penalty: null,
                                },
                                links: {
                                    details: '/api/v1/models/x-ai/grok-build-0.1-20260520/endpoints',
                                },
                            },
                        ],
                    }),
                })
        );
        const snapshot = await runCatalogImporters({
            importers: [createOpenRouterModelsImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T12:10:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(snapshot.sources[0].url, 'https://openrouter.ai/api/v1/models');
        assert.equal(snapshot.importRuns[0].status, 'completed');
        assert.equal(snapshot.routeOptions[0].selectorKind, 'aggregator_auto');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.supportsFallbackChain, true);
        assert.equal(byPath.get('limits.contextWindowTokens'), 256000);
        assert.equal(byPath.get('limits.maxOutputTokens'), 65536);
        assert.equal(byPath.get('pricing.inputUsdPerMillion'), 1);
        assert.equal(byPath.get('pricing.outputUsdPerMillion'), 2);
        assert.equal(byPath.get('pricing.currency'), 'USD');
        assert.equal(byPath.get('pricing.tokenUnit'), 'per_million_tokens');
        assert.equal(byPath.get('pricing.requestUnit'), 'per_request');
        assert.equal(byPath.get('pricing.webSearchUsdPerRequest'), 0.005);
        assert.deepEqual(byPath.get('modalities.input'), ['text', 'image']);
        assert.ok(/** @type {string[]} */ (byPath.get('supportedParameters')).includes('tools'));
        assert.equal(byPath.get('capabilities.tools'), true);
        assert.equal(byPath.get('capabilities.forcedToolChoice'), true);
        assert.equal(byPath.get('capabilities.structuredOutputs'), true);
        assert.equal(byPath.get('capabilities.vision'), true);
        assert.equal(byPath.get('aliases.version'), '2026-05-20');
        assert.equal(byPath.get('lifecycle.status'), 'active');
        assert.equal(byPath.get('providerMetadata.modelTraits.family'), 'grok');
        assert.equal(byPath.get('providerMetadata.openrouter.detailsPath'), '/api/v1/models/x-ai/grok-build-0.1-20260520/endpoints');
        assert.deepEqual(byPath.get('providerMetadata.openrouter.defaultParameters'), {
            temperature: null,
            top_p: null,
            top_k: null,
            frequency_penalty: null,
            presence_penalty: null,
            repetition_penalty: null,
        });
    });

    it('extracts Kilo Gateway public model metadata without proving runtime access', async () => {
        const fakeFetch = /** @type {typeof fetch} */ (
            async () =>
                /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => [
                        {
                            id: 'anthropic/claude-sonnet-4.6',
                            name: 'Claude Sonnet 4.6',
                            created: 1779376861,
                            description: 'Balanced performance and cost',
                            architecture: {
                                input_modalities: ['text', 'image', 'pdf'],
                                output_modalities: ['text'],
                                tokenizer: 'Claude',
                            },
                            top_provider: {
                                is_moderated: false,
                                context_length: 200000,
                                max_completion_tokens: 64000,
                            },
                            pricing: {
                                prompt: '0.000003',
                                completion: '0.000015',
                                input_cache_read: '0.0000003',
                                input_cache_write: '0.00000375',
                                request: '0',
                                web_search: '0',
                            },
                            context_length: 200000,
                            supported_parameters: ['max_tokens', 'temperature', 'tools', 'reasoning', 'include_reasoning'],
                            opencode: {
                                ai_sdk_provider: 'anthropic',
                                family: 'claude',
                                prompt: 'anthropic',
                            },
                            preferredIndex: 1,
                            isFree: false,
                        },
                        {
                            id: 'kilo-auto/frontier',
                            name: 'Auto Frontier',
                            description: 'Highest performance and capability for any task',
                            architecture: {
                                input_modalities: ['text'],
                                output_modalities: ['text'],
                            },
                            context_length: 1000000,
                            supported_parameters: ['tools', 'reasoning'],
                            pricing: {
                                prompt: '0.000005',
                                completion: '0.000025',
                            },
                            isFree: false,
                        },
                    ],
                })
        );
        const snapshot = await runCatalogImporters({
            importers: [createKiloGatewayModelsImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T12:30:00.000Z'),
        });
        const byPath = new Map(
            snapshot.evidences
                .filter((item) => item.providerModel === 'anthropic/claude-sonnet-4.6')
                .map((item) => [item.fieldPath, item.value]),
        );

        assert.equal(snapshot.sources[0].url, 'https://api.kilo.ai/api/gateway/models');
        assert.equal(snapshot.sources[0].trustTier, 'provider_catalog');
        assert.equal(snapshot.importRuns[0].status, 'completed');
        assert.deepEqual(
            snapshot.routeOptions.map((option) => [option.providerModel, option.selectorKind]),
            [
                ['anthropic/claude-sonnet-4.6', 'provider_model'],
                ['kilo-auto/frontier', 'gateway_auto'],
            ],
        );
        assert.deepEqual(snapshot.routeOptions[0].providerSpecific.acceptedHeaders, [
            'x-kilocode-mode',
            'X-KiloCode-OrganizationId',
            'X-KiloCode-TaskId',
        ]);
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.internalByokProviderFailureFallback, false);
        assert.equal(byPath.get('displayName'), 'Claude Sonnet 4.6');
        assert.equal(byPath.get('limits.contextWindowTokens'), 200000);
        assert.equal(byPath.get('limits.maxOutputTokens'), 64000);
        assert.deepEqual(byPath.get('modalities.input'), ['text', 'image', 'pdf']);
        assert.equal(byPath.get('capabilities.tools'), true);
        assert.equal(byPath.get('capabilities.reasoningEffort'), true);
        assert.equal(byPath.get('pricing.inputUsdPerMillion'), 3);
        assert.equal(byPath.get('pricing.outputUsdPerMillion'), 15);
        assert.equal(byPath.get('providerMetadata.kilo.upstreamProvider'), 'anthropic');
        assert.equal(byPath.get('providerMetadata.modelTraits.family'), 'claude');
        assert.equal(byPath.get('providerMetadata.modelTraits.tier'), 'sonnet');
        assert.equal(byPath.get('providerMetadata.modelTraits.generation'), '4.6');
        assert.equal(byPath.get('providerMetadata.kilo.isFree'), false);
        assert.deepEqual(byPath.get('providerMetadata.kilo.opencode'), {
            ai_sdk_provider: 'anthropic',
            family: 'claude',
            prompt: 'anthropic',
        });
    });

    it('extracts Kilo Gateway provider metadata separately from model evidence', async () => {
        const fakeFetch = /** @type {typeof fetch} */ (
            async () =>
                /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => [
                        {
                            name: 'Arcee AI',
                            displayName: 'Arcee AI',
                            slug: 'arcee-ai',
                            dataPolicy: {
                                training: false,
                                retainsPrompts: false,
                                canPublish: false,
                            },
                            headquarters: 'US',
                            datacenters: ['US'],
                            icon: {
                                url: 'https://example.test/arcee.png',
                            },
                        },
                    ],
                })
        );
        const snapshot = await runCatalogImporters({
            importers: [createKiloGatewayProvidersImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T12:35:00.000Z'),
        });
        const byPath = new Map(snapshot.providerEvidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(snapshot.sources[0].url, 'https://api.kilo.ai/api/gateway/providers');
        assert.equal(snapshot.evidences.length, 0);
        assert.equal(snapshot.providerEvidences.length, 9);
        assert.equal(snapshot.providerEvidences[0].subjectProviderId, 'arcee-ai');
        assert.equal(byPath.get('displayName'), 'Arcee AI');
        assert.equal(byPath.get('dataPolicy.training'), false);
        assert.equal(byPath.get('dataPolicy.retainsPrompts'), false);
        assert.deepEqual(byPath.get('providerMetadata.kilo.datacenters'), ['US']);
        assert.equal(byPath.get('providerMetadata.kilo.iconUrl'), 'https://example.test/arcee.png');
    });

    it('extracts account-scoped OpenAI model identity without serializing the API key', async () => {
        const secret = 'sk-openai-secret-that-must-not-leak';
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                authorizationHeader = /** @type {{ headers?: { authorization?: string } }} */ (init)?.headers?.authorization ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            {
                                id: 'gpt-test',
                                object: 'model',
                                created: 1779376861,
                                owned_by: 'openai',
                            },
                        ],
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createOpenAIModelsImporter({ fetchImpl: fakeFetch, apiKey: secret })],
            now: () => new Date('2026-05-25T12:20:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].authMode, 'api_key');
        assert.equal(snapshot.accountOverlays.length, 1);
        assert.equal(snapshot.accountOverlays[0].secretRef, 'OPENAI_API_KEY');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['gpt-test']);
        assert.equal(snapshot.accountOverlays[0].providerMetadata.semantics, 'account_visible_models');
        assert.equal(snapshot.routeOptions[0].providerId, 'openai');
        assert.equal(snapshot.routeOptions[0].selectorKind, 'exact_model');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.wireApi, 'openai_responses');
        assert.equal(snapshot.importRuns[0].status, 'completed');
        assert.equal(byPath.get('displayName'), 'gpt-test');
        assert.equal(byPath.get('lifecycle.createdAt'), '2026-05-21T15:21:01.000Z');
        assert.equal(byPath.get('capabilities.chat'), true);
        assert.equal(byPath.get('capabilities.tools'), true);
        assert.equal(byPath.get('providerMetadata.ownedBy'), 'openai');
        assert.equal(byPath.get('providerMetadata.openai.family'), 'chat');
        assert.equal(byPath.get('providerMetadata.modelTraits.family'), 'gpt');
    });

    it('imports generic OpenAI-compatible model lists as identity, route and account overlay metadata', async () => {
        const secret = 'generic-secret-that-must-not-leak';
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                authorizationHeader = /** @type {{ headers?: { authorization?: string } }} */ (init)?.headers?.authorization ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            {
                                id: 'llama-3.3-70b-versatile',
                                object: 'model',
                                created: 1779376861,
                                owned_by: 'meta',
                            },
                        ],
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [
                createOpenAICompatibleModelsImporter({
                    providerId: 'groq',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    fetchImpl: fakeFetch,
                    apiKey: secret,
                    secretRef: 'GROQ_API_KEY',
                }),
            ],
            now: () => new Date('2026-05-25T12:40:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].url, 'https://api.groq.com/openai/v1/models');
        assert.equal(snapshot.sources[0].authMode, 'api_key');
        assert.equal(snapshot.routeOptions[0].selectorKind, 'exact_model');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.routeLayer, 'openai_compatible');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['llama-3.3-70b-versatile']);
        assert.equal(snapshot.accountOverlays[0].providerMetadata.openAICompatible, true);
        assert.equal(byPath.get('displayName'), 'llama-3.3-70b-versatile');
        assert.equal(byPath.get('providerMetadata.ownedBy'), 'meta');
        assert.equal(byPath.get('providerMetadata.modelTraits.family'), 'llama');
        assert.equal(byPath.get('providerMetadata.modelTraits.generation'), '3.3');
        assert.equal(byPath.get('providerMetadata.modelTraits.parameterCountBillions'), 70);
    });

    it('imports Chutes rich model metadata beyond generic OpenAI-compatible identity', async () => {
        const secret = 'chutes-secret-that-must-not-leak';
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                authorizationHeader = /** @type {{ headers?: { authorization?: string } }} */ (init)?.headers?.authorization ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        object: 'list',
                        data: [
                            {
                                id: 'Qwen/Qwen3-32B-TEE',
                                root: 'Qwen/Qwen3-32B',
                                object: 'model',
                                parent: null,
                                created: 1779376861,
                                pricing: {
                                    prompt: 0.104,
                                    completion: 0.312,
                                    input_cache_read: 0.052,
                                },
                                chute_id: 'qwen3-32b-tee',
                                owned_by: 'chutes',
                                quantization: 'fp8',
                                max_model_len: 262144,
                                context_length: 262144,
                                input_modalities: ['text', 'image'],
                                max_output_length: 32768,
                                output_modalities: ['text'],
                                supported_features: ['json_mode', 'tools', 'structured_outputs', 'reasoning'],
                                confidential_compute: true,
                                supported_sampling_parameters: ['temperature', 'top_p', 'stream'],
                            },
                        ],
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createChutesModelsImporter({ fetchImpl: fakeFetch, apiKey: secret, secretRef: 'CHUTES_AI' })],
            now: () => new Date('2026-05-25T20:30:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].providerId, 'chutes');
        assert.equal(snapshot.sources[0].url, 'https://llm.chutes.ai/v1/models');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['Qwen/Qwen3-32B-TEE']);
        assert.equal(snapshot.accountOverlays[0].secretRef, 'CHUTES_AI');
        assert.equal(snapshot.accountOverlays[0].providerMetadata.publicCatalogAvailable, true);
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.openAICompatibleBaseUrl, 'https://llm.chutes.ai/v1');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.confidentialCompute, true);
        assert.equal(byPath.get('aliases.providerModel'), 'Qwen/Qwen3-32B-TEE');
        assert.equal(byPath.get('aliases.canonicalSlug'), 'Qwen/Qwen3-32B');
        assert.equal(byPath.get('limits.contextWindowTokens'), 262144);
        assert.equal(byPath.get('limits.maxOutputTokens'), 32768);
        assert.deepEqual(byPath.get('modalities.input'), ['text', 'image']);
        assert.equal(byPath.get('capabilities.tools'), true);
        assert.equal(byPath.get('capabilities.jsonMode'), true);
        assert.equal(byPath.get('capabilities.structuredOutputs'), true);
        assert.equal(byPath.get('capabilities.reasoning'), true);
        assert.equal(byPath.get('capabilities.confidentialCompute'), true);
        assert.equal(byPath.get('pricing.inputUsdPerMillion'), 0.104);
        assert.equal(byPath.get('pricing.outputUsdPerMillion'), 0.312);
        assert.equal(byPath.get('pricing.cacheReadUsdPerMillion'), 0.052);
        assert.equal(byPath.get('providerMetadata.chutes.quantization'), 'fp8');
        assert.equal(byPath.get('providerMetadata.modelTraits.family'), 'qwen');
        assert.equal(byPath.get('providerMetadata.modelTraits.parameterCountBillions'), 32);
        assert.equal(byPath.get('providerMetadata.modelTraits.quantization'), 'fp8');
    });

    it('imports Z.AI pricing docs as normalized OpenAI-compatible catalog metadata', async () => {
        const secret = 'zai-secret-that-must-not-leak';
        /** @type {string | null} */
        let acceptHeader = null;
        const markdown = [
            '### Text Models',
            '| Model | Input | Cached Input | Cache Write | Output |',
            '| --- | --- | --- | --- | --- |',
            '| GLM-5.1 | $1.4 | $0.26 | Limited-time Free | $4.4 |',
            '| GLM-4.7-Flash | Free | Free | Free | Free |',
            '',
            '### Vision Models',
            '| Model | Input | Cached Input | Cache Write | Output |',
            '| --- | --- | --- | --- | --- |',
            '| GLM-5V-Turbo | $1.2 | $0.24 | Limited-time Free | $4 |',
        ].join('\n');
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                acceptHeader = /** @type {{ headers?: { accept?: string } }} */ (init)?.headers?.accept ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    text: async () => markdown,
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createZaiModelsImporter({ fetchImpl: fakeFetch, apiKey: secret, secretRef: 'Z_AI_KEY' })],
            now: () => new Date('2026-05-25T20:35:00.000Z'),
        });
        const byModelPath = new Map(snapshot.evidences.map((item) => [`${item.providerModel}:${item.fieldPath}`, item.value]));

        assert.equal(acceptHeader?.includes('text/markdown'), true);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].providerId, 'zai');
        assert.equal(snapshot.sources[0].kind, 'public_docs');
        assert.equal(snapshot.sources[0].authMode, 'none');
        assert.equal(snapshot.sources[0].url, 'https://docs.z.ai/guides/overview/pricing.md');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['glm-5.1', 'glm-4.7-flash', 'glm-5v-turbo']);
        assert.equal(snapshot.accountOverlays[0].secretRef, 'Z_AI_KEY');
        assert.equal(snapshot.accountOverlays[0].providerMetadata.openAICompatible, true);
        assert.equal(snapshot.routeOptions.find((route) => route.providerModel === 'glm-5.1')?.normalizedPolicy.supportsThinking, true);
        assert.equal(snapshot.routeOptions.find((route) => route.providerModel === 'glm-5v-turbo')?.normalizedPolicy.visionFamily, true);
        assert.equal(byModelPath.get('glm-5.1:displayName'), 'GLM-5.1');
        assert.equal(byModelPath.get('glm-5.1:pricing.inputUsdPerMillion'), 1.4);
        assert.equal(byModelPath.get('glm-5.1:pricing.cacheReadUsdPerMillion'), 0.26);
        assert.equal(byModelPath.get('glm-5.1:pricing.outputUsdPerMillion'), 4.4);
        assert.equal(byModelPath.get('glm-4.7-flash:pricing.inputUsdPerMillion'), 0);
        assert.deepEqual(byModelPath.get('glm-5v-turbo:modalities.input'), ['text', 'image']);
        assert.equal(byModelPath.get('glm-5v-turbo:capabilities.vision'), true);
        assert.equal(byModelPath.get('glm-5v-turbo:providerMetadata.modelTraits.family'), 'glm');
        assert.equal(byModelPath.get('glm-5v-turbo:providerMetadata.modelTraits.generation'), '5v');
        assert.equal(byModelPath.get('glm-5v-turbo:providerMetadata.modelTraits.tier'), 'turbo');
        assert.equal(byModelPath.get('glm-5.1:providerMetadata.zai.openApiUrl'), 'https://docs.z.ai/openapi.json');
    });

    it('imports Mistral model cards with capabilities, aliases and deprecation metadata', async () => {
        const secret = 'mistral-secret-that-must-not-leak';
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                authorizationHeader = /** @type {{ headers?: { authorization?: string } }} */ (init)?.headers?.authorization ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        object: 'list',
                        data: [
                            {
                                id: 'mistral-large-latest',
                                object: 'model',
                                created: 1779376861,
                                owned_by: 'mistral',
                                name: 'Mistral Large Latest',
                                description: 'Frontier model with tool and vision support.',
                                root: 'mistral-large-2512',
                                capabilities: {
                                    completion_chat: true,
                                    completion_fim: true,
                                    function_calling: true,
                                    fine_tuning: false,
                                    vision: true,
                                    classification: false,
                                },
                                max_context_length: 131072,
                                aliases: ['mistral-large-latest', 'mistral-large-2512'],
                                deprecation: '2026-12-31T00:00:00.000Z',
                                deprecation_replacement_model: 'mistral-large-next',
                                default_model_temperature: 0.7,
                                TYPE: 'base',
                                archived: false,
                            },
                        ],
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createMistralModelsImporter({ fetchImpl: fakeFetch, apiKey: secret, secretRef: 'MISTRAL_API_KEY' })],
            now: () => new Date('2026-05-25T12:45:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].providerId, 'mistral');
        assert.equal(snapshot.accountOverlays[0].secretRef, 'MISTRAL_API_KEY');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['mistral-large-latest']);
        assert.equal(snapshot.routeOptions[0].selectorKind, 'exact_model');
        assert.equal(byPath.get('limits.contextWindowTokens'), 131072);
        assert.equal(byPath.get('capabilities.tools'), true);
        assert.equal(byPath.get('capabilities.vision'), true);
        assert.equal(byPath.get('capabilities.codeCompletion'), true);
        assert.deepEqual(byPath.get('modalities.input'), ['text', 'image']);
        assert.equal(byPath.get('lifecycle.status'), 'scheduled_retirement');
        assert.equal(byPath.get('lifecycle.replacementModel'), 'mistral-large-next');
        assert.deepEqual(byPath.get('aliases.mistralAliases'), ['mistral-large-latest', 'mistral-large-2512']);
        assert.equal(byPath.get('providerMetadata.mistral.defaultTemperature'), 0.7);
        assert.equal(byPath.get('providerMetadata.modelTraits.family'), 'mistral');
    });

    it('imports paginated Anthropic model identity with account overlay metadata', async () => {
        const secret = 'anthropic-secret-that-must-not-leak';
        /** @type {Array<{ url: string; apiKey: string | null; apiVersion: string | null }>} */
        const requests = [];
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url, init) => {
                const headers = /** @type {{ 'x-api-key'?: string; 'anthropic-version'?: string }} */ (init)?.headers ?? {};
                const parsedUrl = new URL(String(url));
                requests.push({
                    url: String(url),
                    apiKey: headers['x-api-key'] ?? null,
                    apiVersion: headers['anthropic-version'] ?? null,
                });
                if (parsedUrl.pathname.endsWith('/v1/models/claude-sonnet-4-5-20250929')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: 'claude-sonnet-4-5-20250929',
                            type: 'model',
                            display_name: 'Claude Sonnet 4.5',
                            created_at: '2025-09-29T00:00:00.000Z',
                            supports_batch: true,
                            supports_prompt_caching: true,
                        }),
                    });
                }
                if (parsedUrl.pathname.endsWith('/v1/models/claude-haiku-4-5-20251001')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: 'claude-haiku-4-5-20251001',
                            type: 'model',
                            display_name: 'Claude Haiku 4.5',
                            created_at: '2025-10-01T00:00:00.000Z',
                        }),
                    });
                }
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () =>
                        !parsedUrl.searchParams.get('after_id')
                            ? {
                                  data: [
                                      {
                                          id: 'claude-sonnet-4-5-20250929',
                                          type: 'model',
                                          display_name: 'Claude Sonnet 4.5',
                                          created_at: '2025-09-29T00:00:00.000Z',
                                      },
                                  ],
                                  has_more: true,
                                  last_id: 'claude-sonnet-4-5-20250929',
                              }
                            : {
                                  data: [
                                      {
                                          id: 'claude-haiku-4-5-20251001',
                                          type: 'model',
                                          display_name: 'Claude Haiku 4.5',
                                          created_at: '2025-10-01T00:00:00.000Z',
                                      },
                                  ],
                                  has_more: false,
                                  last_id: 'claude-haiku-4-5-20251001',
                              },
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [
                createAnthropicModelsImporter({
                    fetchImpl: fakeFetch,
                    apiKey: secret,
                    secretRef: 'ANTHROPIC_API_KEY',
                }),
            ],
            now: () => new Date('2026-05-25T13:05:00.000Z'),
        });
        const byModel = new Map(
            snapshot.evidences.map((item) => [`${item.providerId}:${item.providerModel}:${item.fieldPath}`, item.value]),
        );

        assert.equal(requests.length, 4);
        assert.equal(requests[0].apiKey, secret);
        assert.equal(requests[0].apiVersion, '2023-06-01');
        assert.equal(requests[2].url.endsWith('/v1/models/claude-sonnet-4-5-20250929'), true);
        assert.equal(requests[3].url.endsWith('/v1/models/claude-haiku-4-5-20251001'), true);
        assert.equal(new URL(requests[0].url).searchParams.get('limit'), '1000');
        assert.equal(new URL(requests[1].url).searchParams.get('after_id'), 'claude-sonnet-4-5-20250929');
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].providerId, 'anthropic');
        assert.equal(snapshot.sources[0].authMode, 'api_key');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, [
            'claude-sonnet-4-5-20250929',
            'claude-haiku-4-5-20251001',
        ]);
        assert.equal(snapshot.accountOverlays[0].secretRef, 'ANTHROPIC_API_KEY');
        assert.equal(snapshot.accountOverlays[0].providerMetadata.anthropicVersion, '2023-06-01');
        assert.equal(snapshot.routeOptions[0].selectorKind, 'exact_model');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.wireApi, 'anthropic_messages');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.supportsTools, true);
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:displayName'), 'Claude Sonnet 4.5');
        assert.equal(
            byModel.get('anthropic:claude-sonnet-4-5-20250929:lifecycle.createdAt'),
            '2025-09-29T00:00:00.000Z',
        );
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:capabilities.tools'), true);
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:capabilities.reasoning'), true);
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:capabilities.batch'), true);
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:capabilities.promptCaching'), true);
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:providerMetadata.ownedBy'), 'anthropic');
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:providerMetadata.anthropic.type'), 'model');
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:providerMetadata.anthropic.tier'), 'sonnet');
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:providerMetadata.anthropic.generation'), '4.5');
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:providerMetadata.modelTraits.family'), 'claude');
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:providerMetadata.modelTraits.tier'), 'sonnet');
        assert.equal(byModel.get('anthropic:claude-sonnet-4-5-20250929:providerMetadata.modelTraits.generation'), '4.5');
    });

    it('imports Gemini list and get metadata with limits, methods and route policy', async () => {
        const secret = 'gemini-secret-that-must-not-leak';
        /** @type {string[]} */
        const requestUrls = [];
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url) => {
                requestUrls.push(String(url));
                const parsedUrl = new URL(String(url));
                assert.equal(parsedUrl.searchParams.get('key'), secret);
                if (parsedUrl.pathname.endsWith('/models') && !parsedUrl.searchParams.get('pageToken')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            models: [
                                {
                                    name: 'models/gemini-2.5-flash',
                                    baseModelId: 'gemini-2.5-flash',
                                    version: '001',
                                    displayName: 'Gemini 2.5 Flash',
                                    description: 'Fast multimodal model.',
                                    inputTokenLimit: 1048576,
                                    outputTokenLimit: 65536,
                                    supportedGenerationMethods: ['generateContent', 'countTokens'],
                                    thinking: true,
                                    temperature: 1,
                                    maxTemperature: 2,
                                    topP: 0.95,
                                    topK: 64,
                                },
                            ],
                            nextPageToken: 'next-page',
                        }),
                    });
                }
                if (parsedUrl.pathname.endsWith('/models') && parsedUrl.searchParams.get('pageToken') === 'next-page') {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            models: [
                                {
                                    name: 'models/text-embedding-004',
                                    baseModelId: 'text-embedding-004',
                                    displayName: 'Text Embedding 004',
                                    inputTokenLimit: 2048,
                                    outputTokenLimit: 1,
                                    supportedGenerationMethods: ['embedContent', 'batchEmbedContents'],
                                },
                            ],
                        }),
                    });
                }
                if (parsedUrl.pathname.endsWith('/models/gemini-2.5-flash')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            name: 'models/gemini-2.5-flash',
                            baseModelId: 'gemini-2.5-flash',
                            version: '002',
                            displayName: 'Gemini 2.5 Flash Latest',
                            supportedGenerationMethods: ['generateContent', 'streamGenerateContent', 'countTokens'],
                            thinking: true,
                        }),
                    });
                }
                if (parsedUrl.pathname.endsWith('/models/text-embedding-004')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            name: 'models/text-embedding-004',
                            supportedGenerationMethods: ['embedContent', 'batchEmbedContents'],
                        }),
                    });
                }
                return /** @type {Response} */ ({ ok: false, status: 404, json: async () => ({}) });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [
                createGeminiModelsImporter({
                    fetchImpl: fakeFetch,
                    apiKey: secret,
                    secretRef: 'GEMINI_API_KEY',
                }),
            ],
            now: () => new Date('2026-05-25T13:20:00.000Z'),
        });
        const byModel = new Map(
            snapshot.evidences.map((item) => [`${item.providerId}:${item.providerModel}:${item.fieldPath}`, item.value]),
        );

        assert.equal(requestUrls.length, 4);
        assert.equal(new URL(requestUrls[0]).searchParams.get('pageSize'), '1000');
        assert.equal(new URL(requestUrls[1]).searchParams.get('pageToken'), 'next-page');
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].providerId, 'gemini');
        assert.equal(snapshot.accountOverlays[0].secretRef, 'GEMINI_API_KEY');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['gemini-2.5-flash', 'text-embedding-004']);
        assert.equal(snapshot.accountOverlays[0].providerMetadata.authPlacement, 'query_key');
        assert.equal(byModel.get('gemini:gemini-2.5-flash:displayName'), 'Gemini 2.5 Flash Latest');
        assert.equal(byModel.get('gemini:gemini-2.5-flash:limits.contextWindowTokens'), 1048576);
        assert.equal(byModel.get('gemini:gemini-2.5-flash:limits.maxOutputTokens'), 65536);
        assert.equal(byModel.get('gemini:gemini-2.5-flash:capabilities.chat'), true);
        assert.equal(byModel.get('gemini:gemini-2.5-flash:capabilities.streaming'), true);
        assert.equal(byModel.get('gemini:gemini-2.5-flash:capabilities.reasoning'), true);
        assert.equal(byModel.get('gemini:gemini-2.5-flash:providerMetadata.gemini.version'), '002');
        assert.equal(byModel.get('gemini:gemini-2.5-flash:providerMetadata.modelTraits.family'), 'gemini');
        assert.equal(byModel.get('gemini:gemini-2.5-flash:providerMetadata.modelTraits.generation'), '2.5');
        assert.equal(byModel.get('gemini:gemini-2.5-flash:providerMetadata.modelTraits.tier'), 'flash');
        assert.deepEqual(byModel.get('gemini:gemini-2.5-flash:providerMetadata.gemini.supportedGenerationMethods'), [
            'generateContent',
            'streamGenerateContent',
            'countTokens',
        ]);
        assert.equal(byModel.get('gemini:text-embedding-004:capabilities.embeddings'), true);
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.routeLayer, 'openai_compatible');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.directWireApi, 'gemini_generate_content');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.resourceName, 'models/gemini-2.5-flash');
    });

    it('imports Ollama local tags and show metadata as private local catalog evidence', async () => {
        /** @type {Array<{ url: string; body: unknown }>} */
        const requests = [];
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url, init) => {
                requests.push({
                    url: String(url),
                    body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
                });
                if (String(url).endsWith('/api/tags')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            models: [
                                {
                                    name: 'gemma3:4b',
                                    model: 'gemma3:4b',
                                    modified_at: '2025-10-03T23:34:03.409490317-07:00',
                                    size: 3338801804,
                                    digest: 'sha256-local-digest',
                                    details: {
                                        format: 'gguf',
                                        family: 'gemma',
                                        families: ['gemma'],
                                        parameter_size: '4.3B',
                                        quantization_level: 'Q4_K_M',
                                    },
                                },
                            ],
                        }),
                    });
                }
                if (String(url).endsWith('/api/show')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            parameters: 'temperature 0.7\nnum_ctx 8192',
                            template: '{{ .Prompt }}',
                            license: 'Local model license',
                            capabilities: ['completion', 'vision'],
                            modified_at: '2025-10-04T00:00:00.000Z',
                            details: {
                                parent_model: '',
                                format: 'gguf',
                                family: 'gemma3',
                                families: ['gemma3'],
                                parameter_size: '4.3B',
                                quantization_level: 'Q4_K_M',
                            },
                            model_info: {
                                'gemma3.context_length': 131072,
                                'general.architecture': 'gemma3',
                                'general.parameter_count': 4299915632,
                            },
                        }),
                    });
                }
                return /** @type {Response} */ ({ ok: false, status: 404, json: async () => ({}) });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createOllamaCatalogImporter({ fetchImpl: fakeFetch, baseUrl: 'http://127.0.0.1:11434' })],
            now: () => new Date('2026-05-25T13:35:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(requests.length, 2);
        assert.equal(requests[0].url, 'http://127.0.0.1:11434/api/tags');
        assert.deepEqual(requests[1].body, { model: 'gemma3:4b', verbose: false });
        assert.equal(snapshot.sources[0].providerId, 'ollama-local');
        assert.equal(snapshot.sources[0].kind, 'local_daemon');
        assert.equal(snapshot.evidences[0].confidence, 'catalog');
        assert.equal(byPath.get('limits.contextWindowTokens'), 8192);
        assert.equal(byPath.get('capabilities.chat'), true);
        assert.equal(byPath.get('capabilities.vision'), true);
        assert.deepEqual(byPath.get('modalities.input'), ['text', 'image']);
        assert.equal(byPath.get('providerMetadata.ollama.digest'), 'sha256-local-digest');
        assert.equal(byPath.get('providerMetadata.ollama.family'), 'gemma3');
        assert.equal(byPath.get('providerMetadata.ollama.quantizationLevel'), 'Q4_K_M');
        assert.deepEqual(byPath.get('providerMetadata.ollama.parameters'), { temperature: 0.7, num_ctx: 8192 });
        assert.equal(snapshot.routeOptions[0].providerId, 'ollama-local');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.localPrivate, true);
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.openAICompatibleBaseUrl, 'http://127.0.0.1:11434/v1');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['gemma3:4b']);
        assert.equal(snapshot.accountOverlays[0].providerMetadata.semantics, 'locally_installed_models');
    });

    it('imports Groq list and retrieve metadata with context window and active overlays', async () => {
        const secret = 'groq-secret-that-must-not-leak';
        /** @type {Array<{ url: string; authorization: string | null }>} */
        const requests = [];
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url, init) => {
                const headers = /** @type {{ authorization?: string }} */ (init)?.headers ?? {};
                requests.push({ url: String(url), authorization: headers.authorization ?? null });
                if (String(url).endsWith('/models')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            object: 'list',
                            data: [
                                {
                                    id: 'openai/gpt-oss-120b',
                                    object: 'model',
                                    created: 1754438400,
                                    owned_by: 'OpenAI',
                                    active: true,
                                    context_window: 131072,
                                    public_apps: null,
                                },
                                {
                                    id: 'old-model',
                                    object: 'model',
                                    created: 1700000000,
                                    owned_by: 'groq',
                                    active: false,
                                    context_window: 8192,
                                },
                            ],
                        }),
                    });
                }
                if (String(url).endsWith('/models/openai%2Fgpt-oss-120b')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: 'openai/gpt-oss-120b',
                            object: 'model',
                            created: 1754438400,
                            owned_by: 'OpenAI',
                            active: true,
                            context_window: 131072,
                            max_completion_tokens: 32768,
                            public_apps: ['playground'],
                        }),
                    });
                }
                if (String(url).endsWith('/models/old-model')) {
                    return /** @type {Response} */ ({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: 'old-model',
                            object: 'model',
                            created: 1700000000,
                            owned_by: 'groq',
                            active: false,
                            context_window: 8192,
                            max_completion_tokens: 4096,
                        }),
                    });
                }
                return /** @type {Response} */ ({ ok: false, status: 404, json: async () => ({}) });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createGroqModelsImporter({ fetchImpl: fakeFetch, apiKey: secret, secretRef: 'GROQ_API_KEY' })],
            now: () => new Date('2026-05-25T13:50:00.000Z'),
        });
        const byModel = new Map(
            snapshot.evidences.map((item) => [`${item.providerId}:${item.providerModel}:${item.fieldPath}`, item.value]),
        );

        assert.equal(requests.length, 3);
        assert.equal(requests.every((request) => request.authorization === `Bearer ${secret}`), true);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(requests[1].url, 'https://api.groq.com/openai/v1/models/openai%2Fgpt-oss-120b');
        assert.equal(snapshot.sources[0].providerId, 'groq');
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:limits.contextWindowTokens'), 131072);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:limits.maxOutputTokens'), 32768);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:capabilities.chat'), true);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:capabilities.tools'), true);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:capabilities.reasoning'), true);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:providerMetadata.groq.maxCompletionTokens'), 32768);
        assert.deepEqual(byModel.get('groq:openai/gpt-oss-120b:providerMetadata.groq.publicApps'), ['playground']);
        assert.equal(byModel.get('groq:old-model:providerMetadata.groq.active'), false);
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['openai/gpt-oss-120b']);
        assert.deepEqual(snapshot.accountOverlays[0].blockedModels, ['old-model']);
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.openAICompatibleBaseUrl, 'https://api.groq.com/openai/v1');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.supportsBatch, true);
        assert.equal(snapshot.accountOverlays[0].providerMetadata.batchEndpoint, '/openai/v1/batches');
    });

    it('imports Groq public docs pricing, rate limits and speed as separate catalog evidence', async () => {
        const modelsHtml = `
            <table>
                <tr>
                    <th>MODEL ID</th><th>SPEED (T/SEC)</th><th>PRICE PER 1M TOKENS</th>
                    <th>RATE LIMITS</th><th>CONTEXT WINDOW</th><th>MAX OUTPUT</th><th>FILE SIZE</th>
                </tr>
                <tr>
                    <td>
                        <div id="openai/gpt-oss-120b">
                            <a>OpenAI GPT-OSS 120B</a>
                            <span class="font-mono">openai/gpt-oss-120b</span>
                        </div>
                    </td>
                    <td>500</td>
                    <td><span>$0.15 input</span><span>$0.60 output</span></td>
                    <td><span>250K TPM</span><span>1K RPM</span></td>
                    <td>131,072</td>
                    <td>65,536</td>
                    <td>-</td>
                </tr>
                <tr>
                    <td>
                        <div id="whisper-large-v3-turbo">
                            <a>Whisper Large V3 Turbo</a>
                            <span class="font-mono">whisper-large-v3-turbo</span>
                        </div>
                    </td>
                    <td>216</td>
                    <td><span>$0.04 per hour</span></td>
                    <td><span>400 RPM</span></td>
                    <td>-</td>
                    <td>-</td>
                    <td>100 MB</td>
                </tr>
            </table>
        `;
        const pricingHtml = `
            <main>
                <section>
                    openai/gpt-oss-120b $$0.15 Uncached Input Tokens $$0.075 Cached Input Tokens $$0.60 Output Tokens
                    openai/gpt-oss-20b $$0.075 Uncached Input Tokens $$0.0375 Cached Input Tokens $$0.30 Output Tokens
                </section>
                <section>
                    Built-In Tools Basic Search $$5 / 1000 requests
                    Advanced Search $$8 / 1000 requests
                    Visit Website $$1 / 1000 requests
                    Code Execution $$0.18 / hour
                    Browser Automation $$0.08 / hour
                </section>
            </main>
        `;
        const requestUrls = /** @type {string[]} */ ([]);
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url) => {
                requestUrls.push(String(url));
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    text: async () => (String(url).includes('/pricing') ? pricingHtml : modelsHtml),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createGroqDocsModelsImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T20:55:00.000Z'),
        });
        const byModel = new Map(
            snapshot.evidences.map((item) => [`${item.providerId}:${item.providerModel}:${item.fieldPath}`, item.value]),
        );
        const byProviderPath = new Map(snapshot.providerEvidences.map((item) => [item.fieldPath, item.value]));

        assert.deepEqual(requestUrls, ['https://console.groq.com/docs/models', 'https://groq.com/pricing']);
        assert.equal(snapshot.sources[0].kind, 'public_docs');
        assert.equal(snapshot.sources[0].authMode, 'none');
        assert.equal(snapshot.importRuns[0].rowCount, 2);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:displayName'), 'OpenAI GPT-OSS 120B');
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:limits.contextWindowTokens'), 131072);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:limits.maxOutputTokens'), 65536);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:limits.tokensPerMinute'), 250000);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:limits.requestsPerMinute'), 1000);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:pricing.inputUsdPerMillion'), 0.15);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:pricing.cacheReadUsdPerMillion'), 0.075);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:pricing.outputUsdPerMillion'), 0.6);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:capabilities.reasoning'), true);
        assert.equal(byModel.get('groq:openai/gpt-oss-120b:providerMetadata.groqDocs.speedTokensPerSecond'), 500);
        assert.equal(byModel.get('groq:whisper-large-v3-turbo:capabilities.asr'), true);
        assert.deepEqual(byModel.get('groq:whisper-large-v3-turbo:modalities.input'), ['audio']);
        assert.equal(byModel.get('groq:whisper-large-v3-turbo:providerMetadata.groqDocs.fileSizeLimit'), '100 MB');
        assert.deepEqual(byProviderPath.get('providerMetadata.groqDocs.builtInToolPricing'), {
            basicSearchUsdPerThousandRequests: 5,
            advancedSearchUsdPerThousandRequests: 8,
            visitWebsiteUsdPerThousandRequests: 1,
            codeExecutionUsdPerHour: 0.18,
            browserAutomationUsdPerHour: 0.08,
        });
    });

    it('imports Hugging Face Inference Providers variants and route selectors', async () => {
        const secret = 'hf-secret-that-must-not-leak';
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                authorizationHeader = /** @type {{ authorization?: string }} */ (init)?.headers?.authorization ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            {
                                id: 'openai/gpt-oss-120b',
                                name: 'OpenAI GPT OSS 120B',
                                providers: [
                                    {
                                        provider: 'groq',
                                        routing: ['fastest'],
                                        pricing: { input: 0.1, output: 0.5 },
                                        context_length: 131072,
                                        latency: 0.16,
                                        throughput: 810,
                                        tools: true,
                                        structured: false,
                                    },
                                    {
                                        provider: 'together',
                                        routing: ['cheapest', 'preferred'],
                                        pricing: { input: 0.09, output: 0.45 },
                                        context_length: 131072,
                                        latency: 0.62,
                                        throughput: 44,
                                        tools: true,
                                        structured: true,
                                    },
                                ],
                            },
                        ],
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [
                createHuggingFaceInferenceProvidersImporter({
                    fetchImpl: fakeFetch,
                    apiKey: secret,
                    secretRef: 'HF_TOKEN',
                }),
            ],
            now: () => new Date('2026-05-25T14:05:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));
        const bySelector = new Map(snapshot.routeOptions.map((route) => [route.selectorSyntax, route]));

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].providerId, 'huggingface');
        assert.equal(byPath.get('limits.contextWindowTokens'), 131072);
        assert.equal(byPath.get('capabilities.tools'), true);
        assert.equal(byPath.get('capabilities.structuredOutputs'), true);
        assert.equal(byPath.get('providerMetadata.huggingface.fastestProvider'), 'groq');
        assert.equal(byPath.get('providerMetadata.huggingface.cheapestProvider'), 'together');
        assert.equal(byPath.get('providerMetadata.modelTraits.family'), 'gpt-oss');
        assert.equal(byPath.get('providerMetadata.modelTraits.parameterCountBillions'), 120);
        assert.equal(bySelector.get('openai/gpt-oss-120b:fastest')?.normalizedPolicy.selectedProviderHint, 'groq');
        assert.equal(bySelector.get('openai/gpt-oss-120b:cheapest')?.normalizedPolicy.selectedProviderHint, 'together');
        assert.equal(bySelector.get('openai/gpt-oss-120b:preferred')?.normalizedPolicy.selectedProviderHint, 'together');
        assert.equal(bySelector.get('openai/gpt-oss-120b:groq')?.selectorKind, 'provider_explicit');
        assert.equal(bySelector.get('openai/gpt-oss-120b:together')?.providerSpecific.huggingFaceProvider, 'together');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['openai/gpt-oss-120b']);
        assert.deepEqual(snapshot.accountOverlays[0].providerMetadata.routePolicySuffixes, ['fastest', 'cheapest', 'preferred']);
    });

    it('imports OpenCode Zen models with family-specific endpoints and account overlay', async () => {
        const secret = 'opencode-secret-that-must-not-leak';
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                authorizationHeader = /** @type {{ authorization?: string }} */ (init)?.headers?.authorization ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        object: 'list',
                        data: [
                            { id: 'gpt-5.1-codex', object: 'model', created: 1779739295, owned_by: 'opencode' },
                            { id: 'claude-sonnet-4-5', object: 'model', created: 1779739295, owned_by: 'opencode' },
                            { id: 'gemini-3.5-flash', object: 'model', created: 1779739295, owned_by: 'opencode' },
                            { id: 'glm-5.1', object: 'model', created: 1779739295, owned_by: 'opencode' },
                            { id: 'deepseek-v4-flash-free', object: 'model', created: 1779739295, owned_by: 'opencode' },
                        ],
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [
                createOpenCodeZenModelsImporter({
                    fetchImpl: fakeFetch,
                    apiKey: secret,
                    secretRef: 'OPENCODE_API_KEY',
                    now: () => new Date('2026-05-25T14:20:00.000Z'),
                }),
            ],
            now: () => new Date('2026-05-25T14:20:00.000Z'),
        });
        const byModel = new Map(
            snapshot.evidences.map((item) => [`${item.providerId}:${item.providerModel}:${item.fieldPath}`, item.value]),
        );
        const byRoute = new Map(snapshot.routeOptions.map((route) => [route.providerModel, route]));

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].providerId, 'opencode');
        assert.equal(byModel.get('opencode:gpt-5.1-codex:providerMetadata.opencode.wireApi'), 'openai_responses');
        assert.equal(byModel.get('opencode:gpt-5.1-codex:providerMetadata.modelTraits.family'), 'gpt');
        assert.equal(byModel.get('opencode:gpt-5.1-codex:providerMetadata.modelTraits.generation'), '5.1');
        assert.equal(byModel.get('opencode:gpt-5.1-codex:providerMetadata.modelTraits.tier'), 'codex');
        assert.equal(byModel.get('opencode:claude-sonnet-4-5:providerMetadata.opencode.wireApi'), 'anthropic_messages');
        assert.equal(byModel.get('opencode:claude-sonnet-4-5:providerMetadata.modelTraits.family'), 'claude');
        assert.equal(byModel.get('opencode:claude-sonnet-4-5:providerMetadata.modelTraits.tier'), 'sonnet');
        assert.equal(byModel.get('opencode:gemini-3.5-flash:providerMetadata.opencode.wireApi'), 'google_generative_model');
        assert.equal(byModel.get('opencode:glm-5.1:providerMetadata.opencode.wireApi'), 'openai_chat_completions');
        assert.equal(byModel.get('opencode:deepseek-v4-flash-free:providerMetadata.opencode.free'), true);
        assert.equal(byModel.get('opencode:gpt-5.1-codex:lifecycle.status'), 'scheduled_retirement');
        assert.equal(byModel.get('opencode:gpt-5.1-codex:pricing.inputUsdPerMillion'), 1.07);
        assert.equal(byModel.get('opencode:glm-5.1:pricing.outputUsdPerMillion'), 4.4);
        assert.equal(byRoute.get('gpt-5.1-codex')?.normalizedPolicy.endpoint, 'https://opencode.ai/zen/v1/responses');
        assert.equal(byRoute.get('claude-sonnet-4-5')?.normalizedPolicy.endpoint, 'https://opencode.ai/zen/v1/messages');
        assert.equal(
            byRoute.get('gemini-3.5-flash')?.normalizedPolicy.endpoint,
            'https://opencode.ai/zen/v1/models/gemini-3.5-flash',
        );
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, [
            'gpt-5.1-codex',
            'claude-sonnet-4-5',
            'gemini-3.5-flash',
            'glm-5.1',
            'deepseek-v4-flash-free',
        ]);
        assert.equal(snapshot.accountOverlays[0].secretRef, 'OPENCODE_API_KEY');
    });

    it('imports OpenCode Zen public docs with endpoint, pricing tier and deprecation metadata', async () => {
        const docsHtml = `
            <table>
                <thead><tr><th>Model</th><th>Model ID</th><th>Endpoint</th><th>AI SDK Package</th></tr></thead>
                <tbody>
                    <tr><td>GPT 5.1 Codex</td><td>gpt-5.1-codex</td><td><code>https://opencode.ai/zen/v1/responses</code></td><td><code>@ai-sdk/openai</code></td></tr>
                    <tr><td>Claude Sonnet 4.5</td><td>claude-sonnet-4-5</td><td><code>https://opencode.ai/zen/v1/messages</code></td><td><code>@ai-sdk/anthropic</code></td></tr>
                    <tr><td>Gemini 3.5 Flash</td><td>gemini-3.5-flash</td><td><code>https://opencode.ai/zen/v1/models/gemini-3.5-flash</code></td><td><code>@ai-sdk/google</code></td></tr>
                    <tr><td>GLM 5.1</td><td>glm-5.1</td><td><code>https://opencode.ai/zen/v1/chat/completions</code></td><td><code>@ai-sdk/openai-compatible</code></td></tr>
                </tbody>
            </table>
            <table>
                <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th></tr></thead>
                <tbody>
                    <tr><td>GPT 5.1 Codex</td><td>$1.07</td><td>$8.50</td><td>$0.107</td><td>-</td></tr>
                    <tr><td>Claude Sonnet 4.5 (&lt;= 200K tokens)</td><td>$3.00</td><td>$15.00</td><td>$0.30</td><td>$3.75</td></tr>
                    <tr><td>Claude Sonnet 4.5 (> 200K tokens)</td><td>$6.00</td><td>$22.50</td><td>$0.60</td><td>$7.50</td></tr>
                    <tr><td>GLM 5.1</td><td>$1.40</td><td>$4.40</td><td>$0.26</td><td>-</td></tr>
                </tbody>
            </table>
            <table>
                <thead><tr><th>Model</th><th>Deprecation date</th></tr></thead>
                <tbody><tr><td>GPT 5.1 Codex</td><td>July 23, 2026</td></tr></tbody>
            </table>
        `;
        const fakeFetch = /** @type {typeof fetch} */ (
            async () =>
                /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    text: async () => docsHtml,
                })
        );
        const snapshot = await runCatalogImporters({
            importers: [createOpenCodeZenDocsImporter({ fetchImpl: fakeFetch, now: () => new Date('2026-05-25T15:00:00.000Z') })],
            now: () => new Date('2026-05-25T15:00:00.000Z'),
        });
        const byModel = new Map(
            snapshot.evidences.map((item) => [`${item.providerId}:${item.providerModel}:${item.fieldPath}`, item.value]),
        );
        const byRoute = new Map(snapshot.routeOptions.map((route) => [route.providerModel, route]));

        assert.equal(snapshot.sources[0].kind, 'public_docs');
        assert.equal(snapshot.importRuns[0].rowCount, 4);
        assert.equal(byModel.get('opencode:gpt-5.1-codex:displayName'), 'GPT 5.1 Codex');
        assert.equal(byModel.get('opencode:gpt-5.1-codex:pricing.inputUsdPerMillion'), 1.07);
        assert.equal(byModel.get('opencode:gpt-5.1-codex:pricing.cacheReadUsdPerMillion'), 0.107);
        assert.equal(byModel.get('opencode:gpt-5.1-codex:lifecycle.status'), 'scheduled_retirement');
        assert.equal(byModel.get('opencode:gpt-5.1-codex:lifecycle.expiresAt'), '2026-07-23T00:00:00.000Z');
        assert.equal(byModel.get('opencode:gpt-5.1-codex:providerMetadata.modelTraits.family'), 'gpt');
        assert.equal(byModel.get('opencode:gpt-5.1-codex:providerMetadata.modelTraits.tier'), 'codex');
        assert.equal(byModel.get('opencode:claude-sonnet-4-5:pricing.outputUsdPerMillion'), 15);
        assert.deepEqual(byModel.get('opencode:claude-sonnet-4-5:providerMetadata.opencode.pricingTiers'), [
            {
                label: '<= 200K tokens',
                inputUsdPerMillion: 3,
                outputUsdPerMillion: 15,
                cacheReadUsdPerMillion: 0.3,
                cacheWriteUsdPerMillion: 3.75,
            },
            {
                label: '> 200K tokens',
                inputUsdPerMillion: 6,
                outputUsdPerMillion: 22.5,
                cacheReadUsdPerMillion: 0.6,
                cacheWriteUsdPerMillion: 7.5,
            },
        ]);
        assert.equal(byModel.get('opencode:glm-5.1:providerMetadata.opencode.wireApi'), 'openai_chat_completions');
        assert.equal(byRoute.get('gpt-5.1-codex')?.normalizedPolicy.docsDerived, true);
        assert.equal(byRoute.get('claude-sonnet-4-5')?.normalizedPolicy.wireApi, 'anthropic_messages');
        assert.equal(byRoute.get('gemini-3.5-flash')?.normalizedPolicy.aiSdkPackage, '@ai-sdk/google');
    });

    it('imports Cloudflare markdown model cards with task, hosting and capability metadata', async () => {
        /** @type {string | null} */
        let acceptHeader = null;
        const markdown = `
            [![OpenAI logo](https://developers.cloudflare.com/_astro/openai.svg)gpt-oss-120bText Generation • OpenAI • HostedOpenAI open-weight model with a 128k context window for agentic workloads.Function callingReasoning](https://developers.cloudflare.com/ai/models/@cf/openai/gpt-oss-120b/)
            [![Inworld logo](https://developers.cloudflare.com/_astro/inworld.svg)tts-2Text-to-Speech • Inworld • ProxiedNatural steering for speech generation.Real-time](https://developers.cloudflare.com/ai/models/inworld/tts-2/)
        `;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                acceptHeader = /** @type {{ headers?: { accept?: string } }} */ (init)?.headers?.accept ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'text/markdown' }),
                    text: async () => markdown,
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createCloudflareWorkersAiCatalogImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T15:15:00.000Z'),
        });
        const byModel = new Map(
            snapshot.evidences.map((item) => [`${item.providerId}:${item.providerModel}:${item.fieldPath}`, item.value]),
        );

        assert.equal(acceptHeader?.includes('text/markdown'), true);
        assert.equal(snapshot.importRuns[0].rowCount, 2);
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/openai/gpt-oss-120b:displayName'), 'gpt-oss-120b');
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/openai/gpt-oss-120b:providerMetadata.cloudflare.task'), 'Text Generation');
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/openai/gpt-oss-120b:providerMetadata.cloudflare.author'), 'OpenAI');
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/openai/gpt-oss-120b:providerMetadata.cloudflare.hosting'), 'Hosted');
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/openai/gpt-oss-120b:limits.contextWindowTokens'), 128000);
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/openai/gpt-oss-120b:capabilities.tools'), true);
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/openai/gpt-oss-120b:capabilities.reasoning'), true);
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/openai/gpt-oss-120b:providerMetadata.modelTraits.family'), 'gpt-oss');
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/openai/gpt-oss-120b:providerMetadata.modelTraits.parameterCountBillions'), 120);
        assert.deepEqual(byModel.get('cloudflare-workers-ai:inworld/tts-2:modalities.output'), ['audio']);
        assert.equal(byModel.get('cloudflare-workers-ai:inworld/tts-2:capabilities.realTime'), true);
    });

    it('imports Cloudflare Workers AI catalog metadata and gateway route options', async () => {
        const secret = 'cloudflare-secret-that-must-not-leak';
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                authorizationHeader = /** @type {{ authorization?: string }} */ (init)?.headers?.authorization ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: async () => ({
                        data: [
                            {
                                id: '@cf/meta/llama-3.1-8b-instruct',
                                name: 'Llama 3.1 8B Instruct',
                                task: 'Text Generation',
                                author: 'Meta',
                                platform: 'Workers AI',
                                hosting: 'Hosted',
                                context_window: 131072,
                                capabilities: { function_calling: true, batch: true },
                            },
                            {
                                id: '@cf/llava-hf/llava-1.5-7b-hf',
                                name: 'LLaVA 1.5 7B',
                                task: 'Image-to-Text',
                                author: 'llava-hf',
                                platform: 'Workers AI',
                                hosting: 'Hosted',
                                capabilities: { vision: true },
                            },
                        ],
                    }),
                    text: async () => '',
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [
                createCloudflareWorkersAiCatalogImporter({
                    fetchImpl: fakeFetch,
                    apiToken: secret,
                    secretRef: 'CLOUDFLARE_KEY',
                    accountId: 'account-1',
                    gatewayId: 'gateway-1',
                }),
            ],
            now: () => new Date('2026-05-25T14:35:00.000Z'),
        });
        const byModel = new Map(
            snapshot.evidences.map((item) => [`${item.providerId}:${item.providerModel}:${item.fieldPath}`, item.value]),
        );
        const gatewayRoute = snapshot.routeOptions.find((route) => route.selectorKind === 'gateway_fallback');

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].providerId, 'cloudflare-workers-ai');
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/meta/llama-3.1-8b-instruct:limits.contextWindowTokens'), 131072);
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/meta/llama-3.1-8b-instruct:capabilities.tools'), true);
        assert.equal(byModel.get('cloudflare-workers-ai:@cf/meta/llama-3.1-8b-instruct:capabilities.batch'), true);
        assert.deepEqual(byModel.get('cloudflare-workers-ai:@cf/llava-hf/llava-1.5-7b-hf:modalities.input'), ['image']);
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.endpoint.includes('/accounts/account-1/ai/run/@cf/meta/'), true);
        assert.equal(gatewayRoute?.normalizedPolicy.universalEndpoint, 'https://gateway.ai.cloudflare.com/v1/account-1/gateway-1');
        assert.equal(gatewayRoute?.normalizedPolicy.supportsFallback, true);
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, [
            '@cf/meta/llama-3.1-8b-instruct',
            '@cf/llava-hf/llava-1.5-7b-hf',
        ]);
        assert.equal(snapshot.accountOverlays[0].secretRef, 'CLOUDFLARE_KEY');
        assert.equal(snapshot.accountOverlays[0].providerMetadata.gatewayIdConfigured, true);
    });

    it('imports NVIDIA NIM account models with OpenAI-compatible and management endpoint metadata', async () => {
        const secret = 'nvidia-secret-that-must-not-leak';
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                authorizationHeader = /** @type {{ authorization?: string }} */ (init)?.headers?.authorization ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        object: 'list',
                        data: [
                            {
                                id: 'openai/gpt-oss-120b',
                                object: 'model',
                                created: 1754438400,
                                owned_by: 'OpenAI',
                            },
                            {
                                id: 'nvidia/nemotron-nano-12b-v2-vl',
                                object: 'model',
                                created: 1770000000,
                                owned_by: 'nvidia',
                            },
                        ],
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [
                createNvidiaNimModelsImporter({
                    fetchImpl: fakeFetch,
                    apiKey: secret,
                    secretRef: 'NVIDIA_KEY',
                }),
            ],
            now: () => new Date('2026-05-25T14:50:00.000Z'),
        });
        const byModel = new Map(
            snapshot.evidences.map((item) => [`${item.providerId}:${item.providerModel}:${item.fieldPath}`, item.value]),
        );

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].providerId, 'nvidia-nim');
        assert.equal(byModel.get('nvidia-nim:openai/gpt-oss-120b:capabilities.reasoning'), true);
        assert.equal(byModel.get('nvidia-nim:openai/gpt-oss-120b:providerMetadata.modelTraits.family'), 'gpt-oss');
        assert.equal(byModel.get('nvidia-nim:openai/gpt-oss-120b:providerMetadata.modelTraits.parameterCountBillions'), 120);
        assert.equal(byModel.get('nvidia-nim:nvidia/nemotron-nano-12b-v2-vl:capabilities.vision'), true);
        assert.equal(byModel.get('nvidia-nim:nvidia/nemotron-nano-12b-v2-vl:providerMetadata.modelTraits.family'), 'nemotron');
        assert.equal(byModel.get('nvidia-nim:nvidia/nemotron-nano-12b-v2-vl:providerMetadata.modelTraits.tier'), 'nano');
        assert.deepEqual(
            byModel.get('nvidia-nim:nvidia/nemotron-nano-12b-v2-vl:providerMetadata.modelTraits.modalityHints'),
            ['vision'],
        );
        assert.deepEqual(byModel.get('nvidia-nim:openai/gpt-oss-120b:providerMetadata.nvidia.managementEndpoints'), [
            '/v1/health/ready',
            '/v1/metadata',
            '/v1/version',
            '/v1/metrics',
            '/v1/license',
            '/v1/manifest',
        ]);
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.openAICompatibleBaseUrl, 'https://integrate.api.nvidia.com/v1');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.hostedOrSelfHosted, 'hosted');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, [
            'openai/gpt-oss-120b',
            'nvidia/nemotron-nano-12b-v2-vl',
        ]);
        assert.equal(snapshot.accountOverlays[0].secretRef, 'NVIDIA_KEY');
    });

    it('extracts Cerebras public rich model metadata without proving runtime access', async () => {
        const fakeFetch = /** @type {typeof fetch} */ (
            async () =>
                /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        object: 'list',
                        data: [
                            {
                                id: 'gpt-oss-120b',
                                object: 'model',
                                created: 1754438400,
                                owned_by: 'OpenAI',
                                name: 'OpenAI GPT OSS',
                                description: 'Efficient reasoning across science, math, and coding applications.',
                                hugging_face_id: 'openai/gpt-oss-120b',
                                pricing: {
                                    prompt: '0.00000035',
                                    completion: '0.00000075',
                                },
                                capabilities: {
                                    streaming: true,
                                    function_calling: true,
                                    structured_outputs: true,
                                    vision: false,
                                    json_mode: true,
                                    tools: true,
                                    tool_choice: true,
                                    parallel_tool_calls: false,
                                    response_format: true,
                                    reasoning: true,
                                },
                                supported_parameters: {
                                    temperature: true,
                                    top_p: true,
                                    seed: true,
                                    logprobs: false,
                                    max_completion_tokens: true,
                                },
                                architecture: {
                                    modality: 'text',
                                    tokenizer: 'GPT',
                                    instruct_type: 'harmony',
                                },
                                limits: {
                                    max_context_length: 131072,
                                    max_completion_tokens: 40960,
                                },
                                datacenter_locations: [],
                                deprecated: false,
                                preview: false,
                                quantization: 'FP16/8 (weights only)',
                            },
                        ],
                    }),
                })
        );
        const snapshot = await runCatalogImporters({
            importers: [createCerebrasPublicModelsImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T12:45:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(snapshot.sources[0].url, 'https://api.cerebras.ai/public/v1/models');
        assert.equal(snapshot.sources[0].trustTier, 'provider_catalog');
        assert.equal(snapshot.routeOptions[0].selectorKind, 'exact_model');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.routeLayer, 'direct_provider');
        assert.equal(byPath.get('displayName'), 'OpenAI GPT OSS');
        assert.equal(byPath.get('aliases.huggingFaceId'), 'openai/gpt-oss-120b');
        assert.equal(byPath.get('lifecycle.createdAt'), '2025-08-06T00:00:00.000Z');
        assert.equal(byPath.get('limits.contextWindowTokens'), 131072);
        assert.equal(byPath.get('limits.maxOutputTokens'), 40960);
        assert.equal(byPath.get('capabilities.tools'), true);
        assert.equal(byPath.get('capabilities.structuredOutputs'), true);
        assert.equal(byPath.get('capabilities.reasoningEffort'), true);
        assert.deepEqual(byPath.get('supportedParameters'), ['temperature', 'top_p', 'seed', 'max_completion_tokens']);
        assert.equal(byPath.get('pricing.inputUsdPerMillion'), 0.35);
        assert.equal(byPath.get('pricing.outputUsdPerMillion'), 0.75);
        assert.equal(byPath.get('providerMetadata.ownedBy'), 'OpenAI');
        assert.equal(byPath.get('providerMetadata.cerebras.quantization'), 'FP16/8 (weights only)');
    });

    it('normalizes universal projections to OpenAI model schema with gateway extensions', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'x-ai/grok-build-0.1',
            displayName: 'xAI: Grok Build 0.1',
            description: 'coding model',
            lifecycle: { createdAt: '2026-05-21T15:21:01.000Z' },
            aliases: { canonicalSlug: 'x-ai/grok-build-0.1-20260520' },
            modalities: { input: ['text', 'image'], output: ['text'] },
            capabilities: { tools: true, structuredOutputs: true },
            supportedParameters: ['tools', 'tool_choice', 'response_format'],
            limits: { contextWindowTokens: 256000, maxOutputTokens: 65536 },
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
            providerMetadata: { ownedBy: 'x-ai' },
            routingHints: { openrouterTopProvider: { is_moderated: false } },
            provenanceByField: { 'limits.contextWindowTokens': 'openrouter-context' },
            confidenceByField: { 'limits.contextWindowTokens': 'catalog' },
        });
        const providerProjection = createCanonicalProviderProjection({
            providerId: 'openrouter',
            subjectProviderId: 'x-ai',
            displayName: 'xAI',
            dataPolicy: { retainsPrompts: false },
            providerMetadata: { headquarters: 'US' },
        });
        const entry = toOpenAIModelCatalogEntry(projection);
        const list = toOpenAIModelCatalogList([projection], {
            providerProjections: [providerProjection],
            eligibilityDecisions: [
                createModelEligibilityDecision({
                    providerId: 'openrouter',
                    providerModel: 'x-ai/grok-build-0.1',
                    include: false,
                    hardExclusions: ['account_model_not_visible'],
                    requiredRuntimeProbes: ['chat'],
                }),
            ],
        });

        assert.equal(entry.id, 'x-ai/grok-build-0.1');
        assert.equal(entry.object, 'model');
        assert.equal(entry.created, 1779376861);
        assert.equal(entry.owned_by, 'x-ai');
        assert.equal(entry.x_model_gateway.provider_id, 'openrouter');
        assert.equal(entry.x_model_gateway.display_name, 'xAI: Grok Build 0.1');
        assert.deepEqual(entry.x_model_gateway.aliases, { canonicalSlug: 'x-ai/grok-build-0.1-20260520' });
        assert.deepEqual(entry.x_model_gateway.modalities, { input: ['text', 'image'], output: ['text'] });
        assert.deepEqual(entry.x_model_gateway.supported_parameters, ['tools', 'tool_choice', 'response_format']);
        assert.equal(/** @type {{ contextWindowTokens: number }} */ (entry.x_model_gateway.limits).contextWindowTokens, 256000);
        assert.equal(entry.x_model_gateway.provider_projection, null);
        assert.equal(list.data[0].x_model_gateway.provider_projection?.subject_provider_id, 'x-ai');
        assert.deepEqual(list.data[0].x_model_gateway.provider_projection?.data_policy, { retainsPrompts: false });
        assert.deepEqual(list.data[0].x_model_gateway.eligibility, {
            include: false,
            status: 'excluded',
            disposition: 'excluded',
            primary_reason: 'account_model_not_visible',
            hard_exclusions: ['account_model_not_visible'],
            soft_penalties: [],
            required_runtime_probes: ['chat'],
            next_actions: ['refresh_account_overlay_or_choose_visible_model'],
        });
    });

    it('normalizes OpenAI-compatible modalities and catalog capability hints', () => {
        const modalities = normalizeModelModalities({
            expression: 'text+image->text',
            input: ['text', 'vision'],
        });
        const capabilities = normalizeOpenAICompatibleModelCapabilities({
            supportedParameters: ['tools', 'tool_choice', 'structured_outputs', 'include_reasoning', 'response_format'],
            inputModalities: modalities.input,
            outputModalities: modalities.output,
        });

        assert.deepEqual(modalities, { input: ['text', 'image'], output: ['text'] });
        assert.deepEqual(capabilities, {
            tools: true,
            forcedToolChoice: true,
            jsonMode: true,
            structuredOutputs: true,
            reasoningEffort: true,
            vision: true,
        });
    });

    it('normalizes token limits and USD pricing units from provider catalogs', () => {
        assert.deepEqual(
            normalizeModelTokenLimits({
                contextWindowTokens: '256000',
                maxOutputTokens: 65536,
                maxRequestTokens: '128000',
                tokensPerMinute: undefined,
            }),
            {
                contextWindowTokens: 256000,
                maxOutputTokens: 65536,
                maxRequestTokens: 128000,
            },
        );
        assert.deepEqual(
            normalizeUsdPricing({
                inputPerTokenUsd: '0.000001',
                outputPerTokenUsd: '0.000002',
                cacheReadPerTokenUsd: '0.0000002',
                webSearchUsdPerRequest: '0.005',
            }),
            {
                currency: 'USD',
                tokenUnit: 'per_million_tokens',
                requestUnit: 'per_request',
                inputUsdPerMillion: 1,
                outputUsdPerMillion: 2,
                cacheReadUsdPerMillion: 0.2,
                webSearchUsdPerRequest: 0.005,
            },
        );
    });

    it('normalizes aliases, version hints and lifecycle without proving runtime access', () => {
        assert.deepEqual(
            normalizeModelAliases({
                providerModel: 'codestral-latest',
                canonicalSlug: 'mistral/codestral-20260520',
                huggingFaceId: 'mistralai/Codestral',
            }),
            {
                providerModel: 'codestral-latest',
                canonicalSlug: 'mistral/codestral-20260520',
                huggingFaceId: 'mistralai/Codestral',
                version: '2026-05-20',
                isLatestAlias: true,
            },
        );
        assert.deepEqual(
            normalizeModelLifecycle({
                created: 1779376861,
                expiresAt: '2026-05-26T00:00:00.000Z',
                knowledgeCutoff: '2025-12-01T00:00:00.000Z',
                providerModel: 'vendor/model-preview',
                nowMs: Date.parse('2026-05-25T00:00:00.000Z'),
            }),
            {
                createdAt: '2026-05-21T15:21:01.000Z',
                expiresAt: '2026-05-26T00:00:00.000Z',
                knowledgeCutoff: '2025-12-01T00:00:00.000Z',
                channel: 'preview',
                status: 'scheduled_retirement',
            },
        );
    });

    it('normalizes provider-neutral model identity traits without proving capabilities', () => {
        assert.deepEqual(
            normalizeModelIdentityTraits({
                providerModel: 'Qwen/Qwen3-32B-TEE',
                canonicalSlug: 'Qwen/Qwen3-32B',
                quantization: 'FP8',
            }),
            {
                family: 'qwen',
                series: 'qwen3',
                generation: '3',
                sizeLabel: '32b',
                parameterCountBillions: 32,
                quantization: 'fp8',
                architectureHints: ['confidential_compute'],
            },
        );

        assert.deepEqual(
            normalizeModelIdentityTraits({
                providerModel: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
            }),
            {
                family: 'mixtral',
                series: 'mixtral',
                sizeLabel: '8x7b',
                parameterCountBillions: 56,
                expertCount: 8,
                expertParameterCountBillions: 7,
                architectureHints: ['instruction_tuned', 'mixture_of_experts'],
            },
        );

        assert.deepEqual(
            normalizeModelIdentityTraits({
                providerModel: '@cf/openai/gpt-oss-120b',
                displayName: 'gpt-oss-120b',
            }),
            {
                family: 'gpt-oss',
                series: 'gpt-oss',
                sizeLabel: '120b',
                parameterCountBillions: 120,
            },
        );
    });

    it('normalizes route policy traits without replacing provider-specific routing metadata', () => {
        assert.deepEqual(
            normalizeModelRoutePolicyTraits({
                selectorKind: 'gateway_fallback',
                normalizedPolicy: {
                    routeLayer: 'gateway',
                    wireApi: 'cloudflare_ai_gateway_universal',
                    supportsFallback: true,
                    supportsRetry: true,
                    supportsCache: true,
                },
                providerSpecific: {
                    upstreamProvider: 'workers-ai',
                    acceptedHeaders: ['x-custom-route'],
                },
            }),
            {
                selectorKind: 'gateway-fallback',
                selectionMode: 'gateway_fallback',
                routeLayer: 'gateway',
                endpointKind: 'gateway',
                wireApi: 'cloudflare-ai-gateway-universal',
                autoSelection: true,
                policyHints: ['fallback', 'retry', 'cache', 'upstream_provider', 'custom_headers'],
            },
        );

        assert.deepEqual(
            normalizeModelRoutePolicyTraits({
                selectorKind: 'fastest',
                normalizedPolicy: {
                    routeLayer: 'openai_compatible_aggregator',
                    openAICompatibleBaseUrl: 'https://router.huggingface.co/v1',
                    providerSelectionPolicy: 'fastest',
                    supportsProviderOrder: true,
                },
                providerSpecific: {
                    huggingFaceProvider: 'groq',
                },
            }),
            {
                selectorKind: 'fastest',
                selectionMode: 'provider_policy',
                routeLayer: 'openai-compatible-aggregator',
                endpointKind: 'aggregator',
                openAICompatible: true,
                autoSelection: true,
                policyHints: ['provider_order', 'explicit_upstream_provider'],
            },
        );
    });

    it('normalizes account overlay controls separately from runtime proof', () => {
        const controls = normalizeAccountOverlayControls({
            enabledModels: ['gpt-paid', 'gpt-paid', 'gpt-free'],
            blockedModels: ['legacy-disabled'],
            byokProviderKeys: ['anthropic', 'openai'],
            dailyRequests: '1000',
            dailyTokens: 250000,
            monthlyBudgetUsd: '75.5',
            remainingCreditsUsd: 12,
            maxConcurrentRequests: 5,
            requestsPerMinute: 60,
            tokensPerMinute: '90000',
            requestsPerDay: 1000,
            hardLimitUsd: 100,
            remainingUsd: '12.25',
            billingStatus: 'active',
            plan: 'team',
            freeTier: 'false',
            providerMetadata: { endpoint: '/account/limits' },
        });

        assert.deepEqual(controls.enabledModels, ['gpt-paid', 'gpt-free']);
        assert.deepEqual(controls.blockedModels, ['legacy-disabled']);
        assert.deepEqual(controls.byokProviderKeys, ['anthropic', 'openai']);
        assert.deepEqual(controls.quota, {
            dailyRequests: 1000,
            dailyTokens: 250000,
            monthlyBudgetUsd: 75.5,
            remainingCreditsUsd: 12,
            maxConcurrentRequests: 5,
        });
        assert.deepEqual(controls.rateLimits, {
            requestsPerMinute: 60,
            tokensPerMinute: 90000,
            requestsPerDay: 1000,
        });
        assert.deepEqual(controls.spendingLimits, {
            currency: 'USD',
            hardLimitUsd: 100,
            remainingUsd: 12.25,
        });
        assert.deepEqual(controls.providerMetadata, {
            endpoint: '/account/limits',
            billingStatus: 'active',
            plan: 'team',
            freeTier: false,
        });
    });

    it('creates sanitized pre-runtime eligibility decisions without mutating catalog facts', () => {
        const decision = createModelEligibilityDecision({
            providerId: 'openai',
            providerModel: 'gpt-paid',
            include: true,
            hardExclusions: ['account_model_not_visible'],
            softPenalties: ['price_unknown'],
            policyInputs: {
                authorization: 'Bearer secret-value-that-must-not-leak',
                unknownAccessPolicy: 'block',
            },
        });

        assert.equal(decision.include, false);
        assert.equal(decision.disposition, 'excluded');
        assert.deepEqual(decision.hardExclusions, ['account_model_not_visible']);
        assert.deepEqual(decision.softPenalties, ['price_unknown']);
        assert.equal(decision.redactionStatus, 'sanitized');
        assert.equal(JSON.stringify(decision).includes('secret-value-that-must-not-leak'), false);
    });

    it('resolves account access from overlays and env secrets before eligibility or runtime', () => {
        const overlay = createProviderAccountOverlay({
            providerId: 'openai',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-visible'],
            blockedModels: ['gpt-blocked'],
        });

        const visible = resolveModelGatewayAccountAccess({
            providerId: 'openai',
            providerModel: 'gpt-visible',
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
        });
        assert.equal(visible.status, 'visible');
        assert.equal(visible.canAttempt, true);
        assert.equal(visible.secretConfigured, true);
        assert.equal(visible.modelVisible, true);
        assert.deepEqual(visible.overlayRefs, [overlay.accountOverlayId]);

        const missingSecret = resolveModelGatewayAccountAccess({
            providerId: 'openai',
            providerModel: 'gpt-visible',
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: {} }),
        });
        assert.equal(missingSecret.status, 'missing_secret');
        assert.equal(missingSecret.canAttempt, false);
        assert.ok(missingSecret.hardReasons.includes('secret_missing:OPENAI_API_KEY'));

        const blocked = resolveModelGatewayAccountAccess({
            providerId: 'openai',
            providerModel: 'gpt-blocked',
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
        });
        assert.equal(blocked.status, 'blocked');
        assert.ok(blocked.hardReasons.includes('account_model_blocked'));
    });

    it('explains account model visibility with stable next actions', () => {
        const overlay = createProviderAccountOverlay({
            providerId: 'openai',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-visible'],
        });
        const access = resolveModelGatewayAccountAccess({
            providerId: 'openai',
            providerModel: 'gpt-hidden',
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
        });

        assert.deepEqual(explainModelGatewayAccountAccess(access), {
            key: 'openai:gpt-hidden:default',
            status: 'not_visible',
            canAttempt: false,
            primaryReason: 'account_model_not_visible',
            hardReasons: ['account_model_not_visible'],
            softReasons: [],
            reasons: ['secret_configured:OPENAI_API_KEY', 'account_overlay_available'],
            overlayRefs: [overlay.accountOverlayId],
            nextActions: ['choose_visible_model_or_refresh_overlay'],
            summary: 'not_visible:account_model_not_visible',
        });
    });

    it('classifies expired overlays and exhausted account controls before runtime', () => {
        const expiredOverlay = createProviderAccountOverlay({
            providerId: 'openai',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-visible'],
            expiresAt: '2026-05-24T00:00:00.000Z',
        });
        const stale = resolveModelGatewayAccountAccess({
            providerId: 'openai',
            providerModel: 'gpt-visible',
            accountOverlays: [expiredOverlay],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
            now: '2026-05-25T00:00:00.000Z',
        });
        assert.equal(stale.status, 'expired');
        assert.equal(stale.canAttempt, true);
        assert.ok(stale.softReasons.includes('account_overlay_expired'));
        assert.ok(stale.softReasons.includes('account_overlay_missing'));

        const quotaOverlay = createProviderAccountOverlay({
            providerId: 'openai',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-visible'],
            quota: { dailyRequests: 0 },
            spendingLimits: { remainingUsd: 0 },
        });
        const exhausted = evaluateModelGatewayEligibility({
            projection: createCanonicalModelProjection({
                providerId: 'openai',
                providerModel: 'gpt-visible',
                pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
            }),
            accountOverlays: [quotaOverlay],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
            now: '2026-05-25T00:00:00.000Z',
        });
        assert.equal(exhausted.include, false);
        assert.ok(exhausted.hardExclusions.includes('account_quota_exhausted'));
        assert.ok(exhausted.hardExclusions.includes('account_spending_exhausted'));
        assert.equal(exhausted.policyInputs['accountAccess']['status'], 'spending_exhausted');
    });

    it('evaluates hard pre-runtime exclusions from secrets, account overlays and access visibility', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openai',
            providerModel: 'gpt-paid',
            lifecycle: { status: 'active' },
            pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
            confidenceByField: { 'displayName': 'authenticated_catalog' },
        });
        const route = createModelRouteOption({
            providerId: 'openai',
            providerModel: 'gpt-paid',
            selectorKind: 'exact_model',
            normalizedPolicy: { routeLayer: 'direct_provider', wireApi: 'openai_responses' },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'openai',
            accountScope: 'default',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-other'],
            sourceKind: 'authenticated_catalog',
        });

        const decision = evaluateModelGatewayEligibility({
            projection,
            routeOption: route,
            accountOverlays: [overlay],
            secretRegistry: { has: () => false },
        });

        assert.equal(decision.include, false);
        assert.equal(decision.disposition, 'deferred_missing_secret');
        assert.deepEqual(decision.hardExclusions.sort(), ['account_model_not_visible', 'secret_missing:OPENAI_API_KEY'].sort());
        assert.deepEqual(decision.overlayRefs, [overlay.accountOverlayId]);
        assert.equal(JSON.stringify(decision).includes('OPENAI_API_KEY'), true);
    });

    it('allows unknown account visibility only when policy permits a cheap runtime probe', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'new/model',
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const decision = evaluateModelGatewayEligibility({
            projection,
            routeOption: createModelRouteOption({
                providerId: 'openrouter',
                providerModel: 'new/model',
                selectorKind: 'gateway_auto',
                selectorSyntax: 'openrouter:auto:new/model',
                normalizedPolicy: { routeLayer: 'gateway', autoSelection: true },
            }),
            accountOverlays: [],
            policy: { unknownAccessPolicy: 'allow_probe' },
        });

        assert.equal(decision.include, true);
        assert.equal(decision.disposition, 'unknown_policy_allows_probe');
        assert.equal(decision.softPenalties.includes('account_overlay_missing'), true);
        assert.equal(decision.softPenalties.includes('account_visibility_unknown'), true);
        assert.equal(decision.softPenalties.includes('route_auto_selects_upstream'), true);
        assert.deepEqual(decision.requiredRuntimeProbes, ['chat']);

        const blocked = evaluateModelGatewayEligibility({
            projection,
            accountOverlays: [],
            policy: { unknownAccessPolicy: 'block' },
        });
        assert.equal(blocked.include, false);
        assert.equal(blocked.disposition, 'unknown_policy_blocks_probe');
        assert.equal(blocked.hardExclusions.includes('account_access_unknown'), true);
    });

    it('blocks models before runtime when catalog pricing exceeds hard budget policy', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openai',
            providerModel: 'gpt-premium',
            pricing: { inputUsdPerMillion: 9, outputUsdPerMillion: 60, requestUsd: 0.01 },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'openai',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-premium'],
        });

        const decision = evaluateModelGatewayEligibility({
            projection,
            accountOverlays: [overlay],
            secretRegistry: { has: () => true },
            policy: {
                maxInputUsdPerMillion: 5,
                maxOutputUsdPerMillion: 50,
                maxRequestUsd: 0.02,
            },
        });

        assert.equal(decision.include, false);
        assert.equal(decision.disposition, 'excluded');
        assert.equal(decision.hardExclusions.includes('budget_exceeded:inputUsdPerMillion'), true);
        assert.equal(decision.hardExclusions.includes('budget_exceeded:outputUsdPerMillion'), true);
        assert.equal(decision.hardExclusions.includes('budget_exceeded:requestUsd'), false);
        assert.equal(decision.policyInputs['budget']['observedPricing']['inputUsdPerMillion'], 9);
        assert.equal(
            explainModelGatewayEligibilityDecision(decision).nextActions.includes('choose_lower_cost_model_or_raise_budget'),
            true,
        );
    });

    it('keeps models eligible with soft budget penalties when only preferences are exceeded', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'anthropic',
            providerModel: 'claude-balanced',
            pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 14 },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'anthropic',
            secretRef: 'ANTHROPIC_API_KEY',
            enabledModels: ['claude-balanced'],
        });

        const decision = evaluateModelGatewayEligibility({
            projection,
            accountOverlays: [overlay],
            secretRegistry: { has: () => true },
            policy: {
                maxInputUsdPerMillion: 10,
                maxOutputUsdPerMillion: 20,
                preferredInputUsdPerMillion: 2,
                preferredOutputUsdPerMillion: 10,
            },
        });

        assert.equal(decision.include, true);
        assert.equal(decision.disposition, 'eligible');
        assert.deepEqual(decision.hardExclusions, []);
        assert.equal(decision.softPenalties.includes('price_above_preference:inputUsdPerMillion'), true);
        assert.equal(decision.softPenalties.includes('price_above_preference:outputUsdPerMillion'), true);
        assert.equal(decision.reasons.includes('budget_within_hard_limits'), true);
        assert.equal(
            explainModelGatewayEligibilityDecision(decision).nextActions.includes('prefer_lower_cost_model_when_possible'),
            true,
        );
    });

    it('excludes Cloudflare gateway routes before runtime when account or gateway config is missing', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'cloudflare-workers-ai',
            providerModel: '@cf/openai/gpt-oss-120b',
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const route = createModelRouteOption({
            providerId: 'cloudflare-workers-ai',
            providerModel: '@cf/openai/gpt-oss-120b',
            selectorKind: 'gateway_fallback',
            selectorSyntax: 'cloudflare-gateway:@cf/openai/gpt-oss-120b',
            normalizedPolicy: {
                routeLayer: 'gateway',
                wireApi: 'cloudflare_ai_gateway_universal',
                supportsFallback: true,
            },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'cloudflare-workers-ai',
            secretRef: 'CLOUDFLARE_API_TOKEN',
            enabledModels: ['@cf/openai/gpt-oss-120b'],
            providerMetadata: { accountIdConfigured: false, gatewayIdConfigured: false },
        });

        const decision = evaluateModelGatewayEligibility({
            projection,
            routeOption: route,
            accountOverlays: [overlay],
            secretRegistry: { has: () => true },
        });

        assert.equal(decision.include, false);
        assert.equal(decision.hardExclusions.includes('cloudflare_account_id_missing'), true);
        assert.equal(decision.hardExclusions.includes('cloudflare_gateway_id_missing'), true);
    });

    it('treats local Ollama installation metadata as eligibility input, not runtime proof', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'ollama-local',
            providerModel: 'gemma3:4b',
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const route = createModelRouteOption({
            providerId: 'ollama-local',
            providerModel: 'gemma3:4b',
            normalizedPolicy: { routeLayer: 'local_daemon', localPrivate: true },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'ollama-local',
            enabledModels: ['llama3.2:3b'],
            providerMetadata: { semantics: 'locally_installed_models' },
        });

        const decision = evaluateModelGatewayEligibility({
            projection,
            routeOption: route,
            accountOverlays: [overlay],
        });

        assert.equal(decision.include, false);
        assert.equal(decision.hardExclusions.includes('account_model_not_visible'), true);
        assert.equal(decision.hardExclusions.includes('ollama_local_model_not_installed'), true);
    });

    it('explains eligibility decisions with stable next actions for terminal rendering', () => {
        const missingSecret = createModelEligibilityDecision({
            providerId: 'openai',
            providerModel: 'gpt-paid',
            secretRef: 'OPENAI_API_KEY',
            include: false,
            hardExclusions: ['secret_missing:OPENAI_API_KEY', 'account_model_not_visible'],
            requiredRuntimeProbes: ['chat'],
        });

        assert.deepEqual(explainModelGatewayEligibilityDecision(missingSecret), {
            key: 'openai:gpt-paid:default:exact_model:gpt-paid',
            include: false,
            disposition: 'excluded',
            status: 'excluded',
            primaryReason: 'secret_missing:OPENAI_API_KEY',
            hardExclusions: ['secret_missing:OPENAI_API_KEY', 'account_model_not_visible'],
            softPenalties: [],
            reasons: [],
            requiredRuntimeProbes: ['chat'],
            nextActions: ['configure_required_secret', 'refresh_account_overlay_or_choose_visible_model'],
            summary: 'excluded:secret_missing:OPENAI_API_KEY',
        });

        const unknownAllowed = createModelEligibilityDecision({
            providerId: 'openrouter',
            providerModel: 'new/model',
            include: true,
            disposition: 'unknown_policy_allows_probe',
            softPenalties: ['account_visibility_unknown'],
            requiredRuntimeProbes: ['chat', 'json'],
        });

        assert.deepEqual(explainModelGatewayEligibilityDecision(unknownAllowed).nextActions, [
            'run_low_cost_access_probe',
            'run_runtime_probes:chat,json',
        ]);
    });

    it('evaluates and applies catalog-wide eligibility as a derived snapshot layer', async () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openai',
            providerModel: 'gpt-visible',
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
        });
        const hidden = createCanonicalModelProjection({
            providerId: 'openai',
            providerModel: 'gpt-hidden',
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'openai',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-visible'],
        });
        const snapshot = {
            projections: [hidden, projection],
            routeOptions: [
                createModelRouteOption({
                    providerId: 'openai',
                    providerModel: 'gpt-visible',
                    selectorKind: 'exact_model',
                    normalizedPolicy: { routeLayer: 'direct_provider', wireApi: 'openai_responses' },
                }),
            ],
            accountOverlays: [overlay],
        };
        const evaluated = evaluateModelGatewayCatalogEligibility({
            snapshot,
            secretRegistry: { has: () => true },
            policy: { unknownAccessPolicy: 'block', policyProfile: 'strict-account' },
            now: () => new Date('2026-05-25T22:30:00.000Z'),
        });

        assert.equal(evaluated.summary.modelCount, 2);
        assert.equal(evaluated.summary.eligibleCount, 1);
        assert.equal(evaluated.summary.excludedCount, 1);
        assert.equal(evaluated.run.policyProfile, 'strict-account');
        assert.equal(evaluated.decisions.find((decision) => decision.providerModel === 'gpt-visible')?.include, true);
        assert.deepEqual(
            evaluated.decisions.find((decision) => decision.providerModel === 'gpt-hidden')?.hardExclusions,
            ['account_model_not_visible'],
        );

        const nextSnapshot = applyModelGatewayEligibilityToSnapshot(snapshot, evaluated.decisions, evaluated.run);
        assert.equal(nextSnapshot.source, 'eligibility-refresh');
        assert.equal(nextSnapshot.modelEligibilityRuns.length, 1);
        assert.equal(nextSnapshot.modelEligibilityDecisions.length, 2);
    });

    it('refreshes catalog snapshots, replaces source evidence, diffs projections and emits OpenAI schema', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-model-refresh-'));
        try {
            const filePath = join(dir, 'catalog.json');
            const store = new JsonModelGatewayCatalogStore({ filePath });
            await store.writeSnapshot({
                source: 'previous',
                evidences: [
                    createModelMetadataEvidence({
                        evidenceId: 'old-source-old-model',
                        providerId: 'openrouter',
                        providerModel: 'old-model',
                        fieldPath: 'displayName',
                        value: 'Old Model',
                        sourceId: 'openrouter-models',
                        confidence: 'catalog',
                    }),
                    createModelMetadataEvidence({
                        evidenceId: 'manual-local-private',
                        providerId: 'ollama',
                        providerModel: 'local-model',
                        fieldPath: 'displayName',
                        value: 'Local Model',
                        sourceId: 'operator',
                        confidence: 'manual',
                    }),
                ],
                projections: [
                    createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'old-model', displayName: 'Old Model' }),
                    createCanonicalModelProjection({ providerId: 'ollama', providerModel: 'local-model', displayName: 'Local Model' }),
                ],
            });
            const result = await refreshModelGatewayCatalog({
                store,
                now: () => new Date('2026-05-25T12:30:00.000Z'),
                importers: [
                    {
                        id: 'openrouter-models',
                        providerId: 'openrouter',
                        sourceKind: 'public_api',
                        requiresAuth: false,
                        fetchRaw: () => ({ data: [{ id: 'new-model', name: 'New Model' }] }),
                        parseRows: (raw) => /** @type {{ data: unknown[] }} */ (raw).data,
                        toEvidenceFacts: (rows, context) =>
                            rows.map((row) =>
                                createModelMetadataEvidence({
                                    evidenceId: 'new-source-new-model',
                                    providerId: 'openrouter',
                                    providerModel: /** @type {{ id: string }} */ (row).id,
                                    fieldPath: 'displayName',
                                    value: /** @type {{ name: string }} */ (row).name,
                                    sourceId: /** @type {{ id: string }} */ (context.source).id,
                                    confidence: 'catalog',
                                    rawPayloadRef: context.rawPayloadRef,
                                }),
                            ),
                    },
                ],
            });
            const stored = await store.readSnapshot();

            assert.deepEqual(result.diff.added, ['openrouter:new-model:default']);
            assert.deepEqual(result.diff.removed, ['openrouter:old-model:default']);
            assert.equal(result.snapshot.projections.some((projection) => projection.providerModel === 'local-model'), true);
            assert.equal(result.snapshot.projections.some((projection) => projection.providerModel === 'old-model'), false);
            assert.equal(stored.projections.length, 2);
            assert.deepEqual(
                result.openai.data.map((entry) => entry.id).sort(),
                ['local-model', 'new-model'],
            );
            assert.equal(result.openai.data.find((entry) => entry.id === 'new-model')?.object, 'model');
            const refreshRun = stored.importRuns.find((run) => run.providerId === 'model-gateway' && run.sourceId === 'catalog-refresh');
            assert.equal(refreshRun?.status, 'completed');
            assert.deepEqual(refreshRun?.diff?.added, ['openrouter:new-model:default']);
            assert.deepEqual(refreshRun?.diff?.removed, ['openrouter:old-model:default']);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('builds default public and authenticated catalog importers without exposing secrets', () => {
        const secret = 'sk-openai-secret-that-must-not-leak';
        const importers = createDefaultModelGatewayCatalogImporters({
            env: { OPENAI_API_KEY: secret },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const publicOnly = createDefaultModelGatewayCatalogImporters({
            env: {},
            includeAuthenticated: true,
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const groqAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { GROQ_KEY: 'gsk-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const genericAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { CEREBRAS_KEY: 'cerebras-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const mistralAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { MISTRAL_KEY: 'mistral-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const anthropicAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { ANTHROPIC_KEY: 'anthropic-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const geminiAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { GOOGLE_API_KEY: 'gemini-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const ollamaLocal = createDefaultModelGatewayCatalogImporters({
            env: { OLLAMA_BASE_URL: 'http://127.0.0.1:11434' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ models: [] }) })),
        });
        const huggingFaceAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { HF_TOKEN: 'hf-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const openCodeAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { OPENCODE_API_KEY: 'opencode-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const cloudflareAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: {
                CLOUDFLARE_KEY: 'cloudflare-secret-that-must-not-leak',
                CLOUDFLARE_ACCOUNT_ID: 'account-1',
                CLOUDFLARE_AI_GATEWAY_ID: 'gateway-1',
            },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ data: [] }),
                text: async () => '',
            })),
        });
        const nvidiaAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { NVIDIA_KEY: 'nvidia-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const chutesAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { CHUTES_AI: 'chutes-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
        });
        const zaiAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { Z_AI_KEY: 'zai-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({
                ok: true,
                status: 200,
                text: async () => '',
            })),
        });

        assert.deepEqual(
            importers.map((importer) => importer.id),
            [
                'openrouter-models',
                'kilo-gateway-models',
                'kilo-gateway-providers',
                'cerebras-public-models',
                'groq-docs-models',
                'opencode-zen-docs',
                'cloudflare-workers-ai-catalog',
                'openai-models',
            ],
        );
        assert.deepEqual(
            publicOnly.map((importer) => importer.id),
            [
                'openrouter-models',
                'kilo-gateway-models',
                'kilo-gateway-providers',
                'cerebras-public-models',
                'groq-docs-models',
                'opencode-zen-docs',
                'cloudflare-workers-ai-catalog',
            ],
        );
        assert.equal(groqAuthenticated.some((importer) => importer.id === 'groq-models'), true);
        assert.equal(genericAuthenticated.some((importer) => importer.id === 'cerebras-openai-compatible-models'), true);
        assert.equal(mistralAuthenticated.some((importer) => importer.id === 'mistral-models'), true);
        assert.equal(anthropicAuthenticated.some((importer) => importer.id === 'anthropic-models'), true);
        assert.equal(geminiAuthenticated.some((importer) => importer.id === 'gemini-models'), true);
        assert.equal(ollamaLocal.some((importer) => importer.id === 'ollama-catalog'), true);
        assert.equal(huggingFaceAuthenticated.some((importer) => importer.id === 'huggingface-inference-providers'), true);
        assert.equal(openCodeAuthenticated.some((importer) => importer.id === 'opencode-zen-models'), true);
        assert.equal(cloudflareAuthenticated.some((importer) => importer.id === 'cloudflare-workers-ai-catalog'), true);
        assert.equal(nvidiaAuthenticated.some((importer) => importer.id === 'nvidia-nim-models'), true);
        assert.equal(chutesAuthenticated.some((importer) => importer.id === 'chutes-models'), true);
        assert.equal(zaiAuthenticated.some((importer) => importer.id === 'zai-models'), true);
        assert.equal(JSON.stringify(importers).includes(secret), false);
        assert.equal(JSON.stringify(groqAuthenticated).includes('gsk-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(genericAuthenticated).includes('gsk-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(genericAuthenticated).includes('cerebras-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(mistralAuthenticated).includes('mistral-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(anthropicAuthenticated).includes('anthropic-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(geminiAuthenticated).includes('gemini-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(huggingFaceAuthenticated).includes('hf-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(openCodeAuthenticated).includes('opencode-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(cloudflareAuthenticated).includes('cloudflare-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(nvidiaAuthenticated).includes('nvidia-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(chutesAuthenticated).includes('chutes-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(zaiAuthenticated).includes('zai-secret-that-must-not-leak'), false);
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
            'opencode',
            'cerebras',
            'chutes',
            'zai',
        ]) {
            assert.ok(ids.has(expected), `endpoint inventory missing ${expected}`);
        }

        const kilo = resolveProviderEndpointInventory('kilo');
        const hf = resolveProviderEndpointInventory('huggingface');
        const cloudflare = resolveProviderEndpointInventory('cloudflare-workers-ai');
        const openCode = resolveProviderEndpointInventory('opencode');

        assert.equal(kilo?.providerKind, 'gateway');
        assert.ok(kilo?.modelCatalogSources.some((source) => source.url.endsWith('/api/gateway/models')));
        assert.ok(hf?.routeSelectors.includes('fastest'));
        assert.ok(hf?.routeSelectors.includes('cheapest'));
        assert.ok(cloudflare?.routeSelectors.includes('gateway_fallback'));
        assert.ok(openCode?.runtimeEndpoints.some((endpoint) => endpoint.kind === 'openai_responses'));
        assert.ok(openCode?.runtimeEndpoints.some((endpoint) => endpoint.kind === 'anthropic_messages'));
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
