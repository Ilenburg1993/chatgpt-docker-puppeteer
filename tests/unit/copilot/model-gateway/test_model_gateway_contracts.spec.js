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
    buildProbeCompletedEvent,
    buildRegistrySnapshotEvent,
    buildRouteDecisionEvent,
    buildRouteDecisionTraceAttributes,
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
    JsonModelGatewayCatalogStore,
    createOpenAIModelsImporter,
    createOpenRouterModelsImporter,
    createCanonicalModelProjection,
    createCatalogImportRun,
    createDefaultModelGatewayCatalogImporters,
    createKiloGatewayModelsImporter,
    createModelMetadataEvidence,
    createModelRouteOption,
    createProviderAccountOverlay,
    createProviderCatalogSource,
    createSanitizedRawPayloadRef,
    diffCanonicalModelProjections,
    mergeModelMetadataEvidence,
    normalizeAccountOverlayControls,
    normalizeModelAliases,
    normalizeModelLifecycle,
    normalizeModelModalities,
    normalizeModelTokenLimits,
    normalizeOpenAICompatibleModelCapabilities,
    normalizeUsdPricing,
    rankCatalogEvidenceConfidence,
    refreshModelGatewayCatalog,
    runCatalogImporters,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
    runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe,
    runConfiguredByokVisionProbe,
    scoreGatewayModelCandidate,
    toOpenAIModelCatalogEntry,
    toOpenAIModelCatalogList,
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
        assert.equal(route.selectorKind, 'gateway_auto');
        assert.equal(overlay.redactionStatus, 'sanitized');
        assert.deepEqual(projection.modalities, { input: ['text'], output: ['text'] });
        const serialized = JSON.stringify({ evidence, route, overlay, projection });
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
            },
        ]);
        assert.equal(JSON.stringify({ rawRef, run }).includes('sk-secret-that-must-not-leak'), false);
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
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
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
                    ],
                })
        );
        const snapshot = await runCatalogImporters({
            importers: [createKiloGatewayModelsImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T12:30:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(snapshot.sources[0].url, 'https://api.kilo.ai/api/gateway/models');
        assert.equal(snapshot.sources[0].trustTier, 'provider_catalog');
        assert.equal(snapshot.importRuns[0].status, 'completed');
        assert.equal(byPath.get('displayName'), 'Claude Sonnet 4.6');
        assert.equal(byPath.get('limits.contextWindowTokens'), 200000);
        assert.equal(byPath.get('limits.maxOutputTokens'), 64000);
        assert.deepEqual(byPath.get('modalities.input'), ['text', 'image', 'pdf']);
        assert.equal(byPath.get('capabilities.tools'), true);
        assert.equal(byPath.get('capabilities.reasoningEffort'), true);
        assert.equal(byPath.get('pricing.inputUsdPerMillion'), 3);
        assert.equal(byPath.get('pricing.outputUsdPerMillion'), 15);
        assert.equal(byPath.get('providerMetadata.kilo.upstreamProvider'), 'anthropic');
        assert.equal(byPath.get('providerMetadata.kilo.isFree'), false);
        assert.deepEqual(byPath.get('providerMetadata.kilo.opencode'), {
            ai_sdk_provider: 'anthropic',
            family: 'claude',
            prompt: 'anthropic',
        });
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
        assert.equal(snapshot.importRuns[0].status, 'completed');
        assert.equal(byPath.get('displayName'), 'gpt-test');
        assert.equal(byPath.get('lifecycle.createdAt'), '2026-05-21T15:21:01.000Z');
        assert.equal(byPath.get('providerMetadata.ownedBy'), 'openai');
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
        const entry = toOpenAIModelCatalogEntry(projection);
        const list = toOpenAIModelCatalogList([projection]);

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
        assert.deepEqual(list, { object: 'list', data: [entry] });
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

        assert.deepEqual(
            importers.map((importer) => importer.id),
            ['openrouter-models', 'kilo-gateway-models', 'openai-models'],
        );
        assert.deepEqual(
            publicOnly.map((importer) => importer.id),
            ['openrouter-models', 'kilo-gateway-models'],
        );
        assert.equal(JSON.stringify(importers).includes(secret), false);
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
