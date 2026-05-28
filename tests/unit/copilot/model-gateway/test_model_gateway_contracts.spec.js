// @ts-check
/**
 * Unit tests for the canonical model gateway foundation.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

import {
    JsonModelGatewayRegistryStore,
    listProviderEndpointInventory,
    listProviderEndpointSourceRecords,
    listProviderGatewayTraits,
    listProviderWireProbeMatrix,
    listModelGatewayCanonicalCommands,
    MODEL_GATEWAY_CANONICAL_COMMAND_PHASES,
    listModelGatewayTaskProfiles,
    MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON,
    ModelGatewayRegistry,
    MODEL_GATEWAY_TASK_PROFILES,
    buildModelGatewayPreBuildReadinessReport,
    buildModelGatewayPreKCompatibilityReport,
    classifyByokProviderFailure,
    anthropicAdapter,
    buildEnvByokModelGatewaySnapshot,
    buildModelGatewayOperatorProjection,
    buildScopedSecretEnvKey,
    buildProviderModelId,
    buildCatalogRefreshCompletedEvent,
    buildCatalogRefreshEventBatch,
    buildEligibilityEvaluatedEvent,
    auditProviderEndpointImporterCoverage,
    auditCatalogImporterSet,
    buildProbeCompletedEvent,
    buildRegistrySnapshotEvent,
    buildRouteDecisionEvent,
    buildRouteDecisionTraceAttributes,
    buildModelGatewayRouteCandidates,
    applyModelGatewayEligibilityToSnapshot,
    applyModelGatewaySelectionTraceRetention,
    buildModelGatewayRuntimeSelectorProbeEnv,
    buildModelGatewayRuntimeSelectorPlan,
    buildModelGatewaySelectionDecisionTrace,
    compareModelGatewaySelectionDecisionTraces,
    compareModelGatewaySelectionAudits,
    explainModelGatewaySelectionComparison,
    DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR,
    MODEL_GATEWAY_SELECTION_POLICY_MODE,
    listModelGatewaySelectionDecisionTraceFiles,
    persistModelGatewaySelectionDecisionTrace,
    readModelGatewaySelectionDecisionTrace,
    resolveModelGatewaySelectionPolicy,
    selectModelGatewayRuntimeRoute,
    createModelRecord,
    createEnvSecretRegistry,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    evaluateModelGatewayAccountOverlayFreshness,
    explainModelGatewayAccountLimitOverlays,
    explainModelGatewayAccountAccess,
    explainGatewayRouteDecision,
    normalizeModelGatewayAccountLimitState,
    resolveModelGatewayAccountOverlayFreshnessPolicy,
    resolveModelGatewayAccountResetWindow,
    resolveModelGatewayEligibilityPolicy,
    resolveModelGatewayAccountAccess,
    buildModelGatewayOnListModelsHandler,
    evaluateModelGatewayRuntimeSelectorRouteEnv,
    evaluateGatewayModelHealthRoute,
    evaluateGatewayProviderHealthCooldown,
    listModelGatewayProviderQuotaCapabilities,
    executeModelGatewayRuntimeSelectorPlan,
    executeModelGatewayRuntimeSelectorPlanWithFallbacks,
    readGatewayModelHealthFromRecords,
    resolveModelGatewayRuntimeRetryDecision,
    evaluateModelGatewayProviderEnvRequirements,
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
    projectModelGatewayMetadataCoverageMetrics,
    projectModelGatewayProviderFreshnessMetrics,
    renderModelGatewayCanonicalCommandLines,
    renderModelGatewayLocalProviderOptInGuidance,
    auditModelGatewayValueRedaction,
    collectModelGatewaySecretAuditEnvValues,
    createModelGatewayRouteDecisionCapture,
    dedupeModelGatewayRouteDecisionEvents,
    redactSecretRecord,
    redactSecretText,
    byokProviderHealthRecordKey,
    byokProviderHealthRecordLastObservedAt,
    clearByokProviderModelHealth,
    listByokProviderModelHealth,
    flushAndMirrorByokProviderHealthToSqlite,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    mergeByokProviderHealthRecords,
    listModelGatewayRouteDecisions,
    installByokProviderHealthSqliteMirror,
    mirrorByokProviderHealthToSqlite,
    mirrorModelGatewayCatalogSnapshotToSqlite,
    recordModelGatewayRouteDecision,
    resolveModelGatewayProviderAdapter,
    resolveProviderEndpointInventory,
    resolveProviderGatewayTraits,
    resolveModelGatewayTaskProfile,
    resetByokProviderHealthForTests,
    resetModelGatewayRouteDecisionLedgerForTests,
    routeGatewayModels,
    routeModelGatewayCatalogSnapshot,
    BYOK_AGENT_PROBE_ANSWER,
    BYOK_AGENT_PROBE_QUESTION,
    BYOK_AGENT_PROBE_READ_PATH,
    BYOK_AGENT_PROBE_READ_TOOL,
    BYOK_AGENT_PROBE_TOOL,
    BYOK_VISION_PROBE_DISPLAY_NAME,
    BYOK_VISION_PROBE_MIME_TYPE,
    compareModelGatewayCatalogSnapshotParity,
    DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
    MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION,
    MODEL_GATEWAY_RAW_PAYLOAD_STORAGE_POLICY,
    classifyModelGatewayCatalogImporterFailure,
    createAnthropicDocsModelsImporter,
    createAnthropicModelsImporter,
    createCatalogModelTombstones,
    createCerebrasModelsImporter,
    createCerebrasPublicModelsImporter,
    createChutesModelsImporter,
    createCloudflareWorkersAiAccountImporter,
    createCloudflareWorkersAiCatalogImporter,
    createGeminiDocsModelsImporter,
    createGeminiModelsImporter,
    createGroqDocsModelsImporter,
    createGroqModelsImporter,
    createHuggingFaceInferenceProvidersImporter,
    createMistralModelsImporter,
    createNvidiaNimModelsImporter,
    createOllamaCatalogImporter,
    createOpenCodeZenDocsImporter,
    createOpenCodeZenModelsImporter,
    createOpenAiDocsModelsImporter,
    createOpenAICompatibleModelsImporter,
    createOpenAIModelsImporter,
    createOpenRouterKeyAccountImporter,
    createOpenRouterModelsImporter,
    createZaiModelsImporter,
    createZaiOpenApiImporter,
    createCanonicalModelProjection,
    createCanonicalProviderProjection,
    createCatalogImportRun,
    createDefaultModelGatewayCatalogImporters,
    createKiloGatewayAccountImporter,
    createKiloGatewayModelsImporter,
    createKiloGatewayProvidersImporter,
    createMistralDocsModelsImporter,
    createModelGatewayCatalogSnapshotId,
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
    diffModelGatewayEligibilityDecisions,
    describeCatalogImporter,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    summarizeModelGatewayRuntimeAccountOverlays,
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
    normalizeModelPricingTaxonomy,
    normalizeModelRoutePolicyTraits,
    normalizeModelTokenLimits,
    normalizeProviderEndpointRichness,
    normalizeOpenAICompatibleModelCapabilities,
    normalizeRateLimitTaxonomy,
    normalizeRuntimeAgenticCapabilityTaxonomy,
    normalizeDataPolicyTaxonomy,
    normalizeStoredCatalogSnapshot,
    normalizeUsdPricing,
    parseAnthropicDocsRows,
    parseGeminiDocsRows,
    parseMistralDocsRows,
    parseOpenAiDocsRows,
    parseOpenRouterKeyRows,
    planModelGatewayCatalogRefresh,
    parseModelGatewayRefreshLogText,
    rankCatalogEvidenceConfidence,
    recommendCatalogDiffProbes,
    evaluateModelGatewayCatalogEligibility,
    evaluateModelGatewayEligibility,
    filterModelGatewayRuntimeEligibilityOverlayDecisions,
    listModelGatewayEligibilityPolicyPresets,
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
    summarizeModelGatewayEligibilityDiff,
    summarizeModelGatewayRefreshLogText,
    summarizeModelGatewayAccountOverlayFreshness,
    summarizeModelGatewayAccountOverlays,
    summarizeModelGatewayAccountResetWindows,
    summarizeModelGatewayProviderQuotaCapabilities,
    summarizeModelGatewayLocalProviderOptInBlocks,
    summarizeModelGatewaySdkQuotaSnapshots,
    summarizeModelGatewayMetadataCoverage,
    summarizeModelGatewayProviderFreshness,
    summarizeModelGatewayProviderEnvRequirements,
    summarizeProviderWireProbeMatrix,
    toOpenAIModelCatalogEntry,
    toOpenAIModelCatalogList,
    toCopilotModelInfoList,
    toCopilotRouteModelInfoList,
    estimateProbeCostUsd,
    planCostBoundedCatalogProbes,
    planModelGatewayProbeBackoff,
    applyModelGatewayCatalogRetention,
    auditModelGatewayCatalogSnapshotIntegrity,
    isModelGatewayCatalogRefreshLocked,
    resolveModelDeprecationAlias,
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

    it('clears runtime health by provider/model/profile scope without dropping unrelated records', () => {
        recordByokProviderModelCallFailure({
            routeProfile: 'repo_agent',
            providerId: 'openrouter',
            providerModel: 'model-a',
            message: 'rate limit',
            errorContext: 'provider.rate_limit',
            timestamp: 10,
        });
        recordByokProviderModelCallSuccess({
            routeProfile: 'tool_agent',
            providerId: 'groq',
            providerModel: 'model-b',
            timestamp: 20,
        });

        clearByokProviderModelHealth({ providerId: 'openrouter', providerModel: 'model-a', routeProfile: 'repo_agent' });

        const records = listByokProviderModelHealth();
        assert.equal(records.length, 1);
        assert.equal(records[0].providerId, 'groq');
        assert.equal(records[0].providerModel, 'model-b');
    });

    it('classifies provider quota, auth and reset-window failures consistently', () => {
        const originalNow = Date.now;
        Date.now = () => 1_779_930_000_000;
        try {
            const retryText = classifyByokProviderFailure(
                Object.assign(new Error('Rate limit exceeded, try again in 2 minutes'), { status: 429 }),
            );
            const epochReset = classifyByokProviderFailure(
                Object.assign(new Error('HTTP 429 too many requests'), {
                    status: 429,
                    headers: { 'x-ratelimit-reset': '1779930123' },
                }),
            );
            const durationReset = classifyByokProviderFailure(
                Object.assign(new Error('HTTP 429 too many requests'), {
                    status: 429,
                    headers: { 'x-ratelimit-reset': '90' },
                }),
            );
            const credits = classifyByokProviderFailure(Object.assign(new Error('payment required: add credits'), { status: 402 }));
            const auth = classifyByokProviderFailure(Object.assign(new Error('invalid api key'), { status: 401 }));

            assert.equal(retryText.kind, 'rate-limit');
            assert.equal(retryText.retryAfterSeconds, 120);
            assert.equal(retryText.resetAt, '2026-05-28T01:02:00.000Z');
            assert.equal(epochReset.kind, 'rate-limit');
            assert.equal(epochReset.resetAt, '2026-05-28T01:02:03.000Z');
            assert.equal(durationReset.resetAt, '2026-05-28T01:01:30.000Z');
            assert.equal(credits.kind, 'credits');
            assert.equal(credits.statusCode, 402);
            assert.equal(auth.kind, 'auth');
            assert.equal(auth.statusCode, 401);
        } finally {
            Date.now = originalNow;
        }
    });

    it('keeps runtime eligibility overlays concrete without promoting unknown access blockers', () => {
        const decisions = [
            { id: 'unknown', hardExclusions: ['account_access_unknown'] },
            { id: 'missing-overlay', hardExclusions: ['account_overlay_missing'] },
            { id: 'fatal-health', hardExclusions: ['health_fatal'] },
            { id: 'rate-limit', hardExclusions: ['account_rate_limited'] },
            { id: 'quota', hardExclusions: ['account_quota_exhausted'] },
        ];

        assert.deepEqual(
            filterModelGatewayRuntimeEligibilityOverlayDecisions(decisions).map((decision) => decision['id']),
            ['fatal-health', 'rate-limit', 'quota'],
        );
    });

    it('routes against explicit merged runtime health records without hydrating global health state', () => {
        const openrouter = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'model-a',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
        });
        const groq = createModelRecord({
            providerId: 'groq',
            providerModel: 'model-b',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
        });
        const runtimeHealthRecords = [
            {
                routeProfile: 'repo_agent',
                providerId: 'openrouter',
                providerModel: 'model-a',
                lastStatus: 'failed',
                lastFailureAt: 30,
                lastSuccessAt: 10,
                probes: {},
            },
            {
                routeProfile: 'repo_agent',
                providerId: 'groq',
                providerModel: 'model-b',
                lastStatus: 'ok',
                lastSuccessAt: 40,
                agentProbeStatus: 'ok',
                lastAgentProbeSuccessAt: 45,
                probes: { agent: { status: 'ok', ok: true, providerAttempted: true, lastAt: 45 } },
            },
        ];

        const route = routeGatewayModels([openrouter, groq], 'repo_agent', {
            routeProfile: 'repo_agent',
            runtimeHealthRecords,
        });

        assert.equal(readGatewayModelHealthFromRecords(groq, runtimeHealthRecords, { routeProfile: 'repo_agent' })?.lastStatus, 'ok');
        assert.equal(route.selected?.model['id'], 'groq:model-b');
        assert.ok(route.selected?.reasons.includes('agent_probe_verified'));
        assert.ok(route.rejected.some((candidate) => candidate.rejectedReasons.includes('chat_health_failed')));
        assert.equal(listByokProviderModelHealth().length, 0);
    });

    it('uses profileless runtime health as fallback evidence for route-scoped selection', () => {
        const model = createModelRecord({
            providerId: 'nvidia-nim',
            providerModel: 'openai/gpt-oss-120b',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });
        const runtimeHealthRecords = [
            {
                routeProfile: null,
                providerId: 'nvidia-nim',
                providerModel: 'openai/gpt-oss-120b',
                lastStatus: 'failed',
                lastFailureAt: 100,
                lastSuccessAt: 0,
                agentProbeStatus: null,
                probes: {},
            },
        ];

        assert.equal(
            readGatewayModelHealthFromRecords(model, runtimeHealthRecords, { routeProfile: 'code' })?.lastStatus,
            'failed',
        );
        const route = routeGatewayModels([model], 'code', {
            routeProfile: 'code',
            runtimeHealthRecords,
        });

        assert.equal(route.selected, null);
        assert.ok(route.rejected.some((candidate) => candidate.rejectedReasons.includes('chat_health_failed')));
    });

    it('mirrors dedicated agent probe health into the generic probe ledger', () => {
        recordByokProviderModelAgentProbeFailure({
            routeProfile: 'repo_agent',
            providerId: 'openrouter',
            providerModel: 'agent-model',
            message: 'tool call failed',
            errorContext: 'probe.agent',
            timestamp: 10,
        });
        recordByokProviderModelAgentProbeSuccess({
            routeProfile: 'repo_agent',
            providerId: 'openrouter',
            providerModel: 'agent-model',
            timestamp: 20,
        });

        const health = listByokProviderModelHealth()[0];
        assert.equal(health.agentProbeStatus, 'ok');
        assert.equal(health.agentProbeFailureCount, 1);
        assert.equal(health.agentProbeSuccessCount, 1);
        assert.equal(health.probes.agent.status, 'ok');
        assert.equal(health.probes.agent.ok, true);
        assert.equal(health.probes.agent.count, 2);
        assert.equal(health.probes.agent.failureCount, 1);
        assert.equal(health.probes.agent.successCount, 1);
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
                'local_private_strict',
            ],
        );
        assert.equal(resolveModelGatewayTaskProfile('repo-agent')?.requireAgentProbeOk, true);
        assert.deepEqual(MODEL_GATEWAY_TASK_PROFILES.vision.requires, ['text', 'streaming']);
        assert.deepEqual(MODEL_GATEWAY_TASK_PROFILES.vision.softRequires, ['vision']);
        assert.deepEqual(MODEL_GATEWAY_TASK_PROFILES.local_private.requires, [
            'text',
            'streaming',
            'local',
            'privacy',
            'no_remote_secrets',
        ]);
        assert.deepEqual(MODEL_GATEWAY_TASK_PROFILES.local_private.supplyWarns, ['local', 'privacy', 'no_remote_secrets']);
        assert.equal(MODEL_GATEWAY_TASK_PROFILES.local_private.localProviderOptIn, true);
        assert.equal(MODEL_GATEWAY_TASK_PROFILES.local_private.defaultAudit, false);
        assert.equal(MODEL_GATEWAY_TASK_PROFILES.local_private_strict.defaultAudit, false);
        assert.equal(MODEL_GATEWAY_TASK_PROFILES.local_private_strict.localProviderOptIn, true);
        assert.deepEqual(MODEL_GATEWAY_TASK_PROFILES.local_private_strict.requires, [
            'text',
            'streaming',
            'local',
            'privacy',
            'no_remote_secrets',
        ]);
        assert.equal(resolveModelGatewayTaskProfile('missing'), null);
    });

    it('centralizes local provider opt-in diagnostics for terminal and scripts', () => {
        const summary = summarizeModelGatewayLocalProviderOptInBlocks({
            summary: {
                rejectedReasonCounts: {
                    [MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON]: 2,
                },
            },
            profiles: [
                {
                    profileId: 'cheap_chat',
                    topRejectedReasons: [MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON],
                },
                {
                    profileId: 'repo_agent',
                    topRejectedReasons: ['missing_capability:tools'],
                },
            ],
        });

        assert.equal(summary.hasBlocks, true);
        assert.equal(summary.rejectedCount, 2);
        assert.deepEqual(summary.blockedProfileIds, ['cheap_chat']);
        assert.equal(summary.reason, MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON);
        assert.match(
            renderModelGatewayLocalProviderOptInGuidance({ profileIds: summary.blockedProfileIds }),
            /provider:ollama/,
        );
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

    it('routes a complete catalog snapshot through route options, overlays and eligibility', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            capabilities: { streaming: true },
            limits: { contextWindowTokens: 131_072 },
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const routeOption = createModelRouteOption({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            selectorKind: 'provider_explicit',
            selectorSyntax: 'openai/gpt-oss-120b:groq',
            normalizedPolicy: { routeLayer: 'openai_compatible_aggregator', wireApi: 'openai_chat_completions' },
            providerSpecific: { upstreamProvider: 'groq' },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'openrouter',
            enabledModels: ['openai/gpt-oss-120b'],
        });
        const eligibility = createModelEligibilityDecision({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            selectorKind: 'provider_explicit',
            selectorSyntax: 'openai/gpt-oss-120b:groq',
            include: true,
        });

        const route = routeModelGatewayCatalogSnapshot(
            {
                projections: [projection],
                routeOptions: [routeOption],
                accountOverlays: [overlay],
                modelEligibilityDecisions: [eligibility],
            },
            'cheap_chat',
            { evaluateEligibility: true, requireAgentProbeOk: false },
        );

        assert.equal(route.selected?.model['selectorKind'], 'provider_explicit');
        assert.equal(route.selected?.eligibility?.['disposition'], 'eligible');
        assert.deepEqual(route.snapshotContext, {
            projectionCount: 1,
            routeOptionCount: 1,
            accountOverlayCount: 1,
            eligibilityDecisionCount: 1,
            candidateCount: 1,
        });
    });

    it('audits pre-runtime selection across task profiles without requiring runtime probes', async () => {
        const snapshot = {
            projections: [
                createCanonicalModelProjection({
                    providerId: 'openrouter',
                    providerModel: 'openai/gpt-oss-120b',
                    capabilities: { streaming: true, tools: true, reasoningEffort: true },
                    limits: { contextWindowTokens: 131_072 },
                    pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
                    routingHints: { tier: 'free' },
                }),
            ],
            routeOptions: [
                createModelRouteOption({
                    providerId: 'openrouter',
                    providerModel: 'openai/gpt-oss-120b',
                    selectorKind: 'provider_explicit',
                    selectorSyntax: 'openai/gpt-oss-120b:groq',
                    normalizedPolicy: { routeLayer: 'openai_compatible_aggregator', wireApi: 'openai_chat_completions' },
                    providerSpecific: { upstreamProvider: 'groq' },
                }),
            ],
            accountOverlays: [
                createProviderAccountOverlay({
                    providerId: 'openrouter',
                    secretRef: 'OPENROUTER_API_KEY',
                    enabledModels: ['openai/gpt-oss-120b'],
                }),
            ],
        };

        const audit = auditModelGatewayPreRuntimeSelection(snapshot, {
            profiles: ['repo_agent', 'tool_agent'],
            secretRegistry: { has: () => true },
        });

        assert.equal(audit.schema, 'model-gateway-pre-runtime-selection-audit');
        assert.equal(audit.ok, true);
        assert.equal(audit.summary.selectedProfileCount, 2);
        assert.equal(audit.summary.selectedProviders.openrouter, 2);
        assert.equal(audit.summary.selectedSelectorKinds.provider_explicit, 2);
        assert.equal(audit.profiles[0].selected?.['selectorSyntax'], 'openai/gpt-oss-120b:groq');
        assert.equal(audit.profiles[0].selected?.['accountScope'], 'default');
        assert.equal(audit.profiles[0].selected?.['accountAccess']?.['canAttempt'], true);
        assert.deepEqual(audit.profiles[0].selected?.['accountAccess']?.['hardReasons'], []);
        assert.equal(audit.profiles[0].selected?.['taskProfile'], 'repo_agent');
        assert.equal(audit.profiles[0].decisionLayers['runtimeProbeProofCount'], 0);
        assert.deepEqual(audit.profiles[0].capabilitySupply.required, { text: 1, streaming: 1, tools: 1 });
        assert.equal(audit.profiles[0].capabilitySupply.preferred.reasoningEffort, 1);
        assert.equal(audit.profiles[0].supplyWarnings.includes('preferred_supply_zero:runtime_proved'), false);

        const postRuntimeAudit = auditModelGatewayPostRuntimeSelection(snapshot, {
            profiles: ['repo_agent'],
            secretRegistry: { has: () => true },
            runtimeHealthRecords: [
                {
                    routeProfile: 'repo_agent',
                    providerId: 'openrouter',
                    providerModel: 'openai/gpt-oss-120b',
                    lastStatus: 'ok',
                    lastSuccessAt: 100,
                    agentProbeStatus: 'ok',
                    lastAgentProbeSuccessAt: 110,
                    probes: { agent: { status: 'ok', ok: true, providerAttempted: true, lastAt: 110 } },
                },
            ],
        });

        assert.equal(postRuntimeAudit.schema, 'model-gateway-post-runtime-selection-audit');
        assert.equal(postRuntimeAudit.runtimeMode, 'observed_runtime_health');
        assert.equal(postRuntimeAudit.summary.selectedProfileCount, 1);
        assert.equal(postRuntimeAudit.summary.healthRecordCount, 1);
        assert.equal(postRuntimeAudit.summary.runtimeChatOkCount, 1);
        assert.equal(postRuntimeAudit.summary.runtimeAgentProbeProofCount, 1);
        assert.equal(postRuntimeAudit.summary.runtimeProbeProofCount, 1);
        assert.equal(postRuntimeAudit.summary.runtimeHealthProofCount, 1);
        assert.equal(postRuntimeAudit.profiles[0].selected?.['runtimeHealth']?.['agentProbeStatus'], 'ok');
        assert.ok(
            Array.isArray(postRuntimeAudit.profiles[0].selected?.['runtimeHealth']?.['verifiedProbes']) &&
                postRuntimeAudit.profiles[0].selected?.['runtimeHealth']?.['verifiedProbes'].includes('agent'),
        );
        const comparison = compareModelGatewaySelectionAudits(audit, postRuntimeAudit);
        assert.equal(comparison.schema, 'model-gateway-selection-comparison');
        assert.equal(comparison.summary.profileCount, 2);
        assert.equal(comparison.summary.changedCount, 1);
        assert.equal(comparison.summary.postRuntimeProofSelectedCount, 1);
        assert.equal(comparison.rows[0].postSelectedHasRuntimeProof, true);
        const comparisonExplanation = explainModelGatewaySelectionComparison(comparison);
        assert.equal(comparisonExplanation.schema, 'model-gateway-selection-comparison-explain');
        assert.equal(comparisonExplanation.summary.reasonCounts.same_route_runtime_proved, 1);
        assert.equal(comparisonExplanation.summary.reasonCounts.post_runtime_lost_route, 1);
        assert.ok(comparisonExplanation.summary.nextActions.includes('record_runtime_proof_and_keep_route'));

        const metadataFirst = resolveModelGatewaySelectionPolicy(comparison);
        assert.equal(metadataFirst.schema, 'model-gateway-selection-policy-resolution');
        assert.equal(metadataFirst.mode, MODEL_GATEWAY_SELECTION_POLICY_MODE.METADATA_FIRST);
        assert.equal(metadataFirst.ok, true);
        assert.equal(metadataFirst.summary.selectedCount, 2);
        assert.equal(metadataFirst.summary.metadataWinnerCount, 2);
        assert.equal(metadataFirst.summary.postRuntimeWinnerCount, 0);

        const preferRuntimeProved = resolveModelGatewaySelectionPolicy(comparison, {
            mode: MODEL_GATEWAY_SELECTION_POLICY_MODE.PREFER_RUNTIME_PROVED,
        });
        assert.equal(preferRuntimeProved.ok, true);
        assert.equal(preferRuntimeProved.summary.selectedCount, 2);
        assert.equal(preferRuntimeProved.summary.postRuntimeWinnerCount, 1);
        assert.equal(preferRuntimeProved.summary.changedFromPreRuntimeCount, 0);
        assert.equal(preferRuntimeProved.rows[0].source, 'post_runtime_proved');

        const requireRuntimeProof = resolveModelGatewaySelectionPolicy(comparison, {
            mode: MODEL_GATEWAY_SELECTION_POLICY_MODE.REQUIRE_RUNTIME_PROOF,
        });
        assert.equal(requireRuntimeProof.ok, false);
        assert.equal(requireRuntimeProof.summary.selectedCount, 1);
        assert.equal(requireRuntimeProof.summary.unselectedCount, 1);
        assert.equal(requireRuntimeProof.rows[1].source, 'blocked_runtime_proof_missing');

        const runtimeSelectorPlan = buildModelGatewayRuntimeSelectorPlan(preferRuntimeProved, {
            source: 'unit-test-runtime-selector',
            sessionId: 'unit-session',
        });
        assert.equal(runtimeSelectorPlan.schema, 'model-gateway-runtime-selector-plan');
        assert.equal(runtimeSelectorPlan.ok, true);
        assert.equal(runtimeSelectorPlan.ready, true);
        assert.equal(runtimeSelectorPlan.summary.selectedProfileCount, 2);
        assert.equal(runtimeSelectorPlan.summary.blockedProfileCount, 0);
        assert.equal(runtimeSelectorPlan.summary.accountAccessBlockedCount, 0);
        assert.equal(runtimeSelectorPlan.routes[0].decisionEvent.source, 'unit-test-runtime-selector');
        assert.equal(runtimeSelectorPlan.routes[0].decisionEvent.sessionId, 'unit-session');
        assert.equal(runtimeSelectorPlan.routes[0].selected?.['accountScope'], 'default');
        assert.equal(runtimeSelectorPlan.routes[0].selected?.['accountAccess']?.['canAttempt'], true);
        assert.equal(runtimeSelectorPlan.routes[0].selected?.['taskProfile'], 'repo_agent');
        assert.equal(runtimeSelectorPlan.routes[0].selected?.['selectorSyntax'], 'openai/gpt-oss-120b:groq');
        assert.equal(runtimeSelectorPlan.routes[0].selected?.['routeLayer'], 'openai_compatible_aggregator');
        assert.equal(runtimeSelectorPlan.routes[0].selected?.['wireApi'], 'openai_chat_completions');
        assert.equal(runtimeSelectorPlan.routes[0].selected?.['upstreamProvider'], 'groq');
        assert.equal(selectModelGatewayRuntimeRoute(runtimeSelectorPlan, 'repo_agent')?.selectedRouteKey, 'openrouter:openai/gpt-oss-120b');

        const strictRuntimeSelectorPlan = buildModelGatewayRuntimeSelectorPlan(requireRuntimeProof, {
            requireRuntimeProof: true,
        });
        assert.equal(strictRuntimeSelectorPlan.ok, false);
        assert.equal(strictRuntimeSelectorPlan.ready, true);
        assert.equal(strictRuntimeSelectorPlan.summary.selectedProfileCount, 1);
        assert.equal(strictRuntimeSelectorPlan.summary.blockedProfileCount, 1);

        const routeProbeEnv = buildModelGatewayRuntimeSelectorProbeEnv(runtimeSelectorPlan.routes[0].selected, {
            COPILOT_BYOK_PROFILE: 'current-default-profile',
            COPILOT_BYOK_PROVIDER_PRESET: 'groq',
            COPILOT_BYOK_BASE_URL: 'https://wrong.example.test/v1',
            COPILOT_BYOK_WIRE_API: 'responses',
            COPILOT_BYOK_API_KEY: 'wrong-generic-key',
            OPENROUTER_API_KEY: 'openrouter-key',
        });
        assert.equal(routeProbeEnv['COPILOT_BYOK_ENABLED'], 'true');
        assert.equal(routeProbeEnv['COPILOT_BYOK_PROVIDER_PRESET'], 'openrouter');
        assert.equal(routeProbeEnv['COPILOT_BYOK_MODEL'], 'openai/gpt-oss-120b');
        assert.equal(routeProbeEnv['COPILOT_BYOK_BASE_URL'], undefined);
        assert.equal(routeProbeEnv['COPILOT_BYOK_WIRE_API'], 'completions');
        assert.equal(routeProbeEnv['COPILOT_BYOK_API_KEY'], undefined);
        assert.equal(routeProbeEnv['OPENROUTER_API_KEY'], 'openrouter-key');
        const routeEnvStatus = evaluateModelGatewayRuntimeSelectorRouteEnv(runtimeSelectorPlan.routes[0].selected, {
            OPENROUTER_API_KEY: 'openrouter-key',
        });
        assert.equal(routeEnvStatus.status, 'ready');
        assert.deepEqual(routeEnvStatus.configuredKeys, ['OPENROUTER_API_KEY']);
        const routeEnvBlockedPlan = buildModelGatewayRuntimeSelectorPlan(preferRuntimeProved, {
            requireRuntimeEnvReady: true,
            env: {},
        });
        assert.equal(routeEnvBlockedPlan.summary.runtimeEnvBlockedCount, 2);
        assert.equal(routeEnvBlockedPlan.summary.blockedProfileCount, 2);
        assert.equal(routeEnvBlockedPlan.routes[0].reasons.includes('blocked:runtime_env_not_ready'), true);
        const provedButEnvBlockedPolicy = {
            ...preferRuntimeProved,
            rows: [preferRuntimeProved.rows[0]].map((row) => ({
                ...row,
                hasRuntimeProof: true,
                selected: {
                    ...row.selected,
                    hasRuntimeProof: true,
                },
            })),
        };
        const provedButEnvBlockedPlan = buildModelGatewayRuntimeSelectorPlan(provedButEnvBlockedPolicy, {
            requireRuntimeProof: true,
            requireRuntimeEnvReady: true,
            env: {},
        });
        assert.equal(provedButEnvBlockedPlan.summary.blockedProfileCount, 1);
        assert.equal(provedButEnvBlockedPlan.routes[0].reasons.includes('blocked:runtime_env_not_ready'), true);
        assert.equal(provedButEnvBlockedPlan.routes[0].reasons.includes('blocked:runtime_proof_required'), false);
        const routeEnvReadyPlan = buildModelGatewayRuntimeSelectorPlan(preferRuntimeProved, {
            requireRuntimeEnvReady: true,
            env: { OPENROUTER_API_KEY: 'openrouter-key' },
        });
        assert.equal(routeEnvReadyPlan.summary.runtimeEnvReadyCount, 2);
        assert.equal(routeEnvReadyPlan.summary.blockedProfileCount, 0);
        const liveProtocolBlockedPlan = buildModelGatewayRuntimeSelectorPlan(preferRuntimeProved, {
            runtimeHealthRecords: [
                {
                    routeProfile: null,
                    providerId: 'openrouter',
                    providerModel: 'openai/gpt-oss-120b',
                    lastStatus: 'ok',
                    lastSuccessAt: 120,
                    probes: {
                        live_ask_user: {
                            kind: 'live_ask_user',
                            status: 'failed',
                            ok: false,
                            providerAttempted: true,
                            lastAt: 125,
                        },
                    },
                },
            ],
            blockFailedProbeKinds: ['live_ask_user'],
        });
        assert.equal(liveProtocolBlockedPlan.ok, false);
        assert.equal(liveProtocolBlockedPlan.summary.runtimeProbeBlockedCount, 2);
        assert.equal(liveProtocolBlockedPlan.routes[0].selected, null);
        assert.ok(liveProtocolBlockedPlan.routes[0].reasons.includes('blocked:runtime_probe_failed:live_ask_user'));
        assert.ok(liveProtocolBlockedPlan.routes[0].nextActions.includes('choose_route_without_failed_runtime_health'));

        const providerCooldownNow = Date.now();
        const providerCooldownRecords = [
            {
                routeProfile: 'repo_agent',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                lastStatus: 'failed',
                lastFailureKind: 'timeout',
                lastFailureAt: providerCooldownNow - 3_000,
                lastSuccessAt: null,
            },
            {
                routeProfile: 'repo_agent',
                providerId: 'openrouter',
                providerModel: 'anthropic/claude-test',
                lastStatus: 'failed',
                lastFailureKind: 'timeout',
                lastFailureAt: providerCooldownNow - 2_000,
                lastSuccessAt: null,
            },
            {
                routeProfile: 'tool_agent',
                providerId: 'openrouter',
                providerModel: 'meta/llama-test',
                lastStatus: 'failed',
                lastFailureKind: 'upstream',
                lastFailureAt: providerCooldownNow - 1_000,
                lastSuccessAt: null,
            },
        ];
        const providerCooldown = evaluateGatewayProviderHealthCooldown(
            { providerId: 'openrouter', providerModel: 'openai/gpt-oss-120b' },
            providerCooldownRecords,
            { now: providerCooldownNow },
        );
        assert.equal(providerCooldown.include, false);
        assert.equal(providerCooldown.reason, 'provider_health_cooldown');
        assert.equal(providerCooldown.failedModelCount, 3);
        assert.deepEqual(providerCooldown.failureKinds, ['timeout', 'upstream']);
        const providerCooldownPlan = buildModelGatewayRuntimeSelectorPlan(preferRuntimeProved, {
            runtimeHealthRecords: providerCooldownRecords,
            providerCooldownWindowMs: 10_000,
            providerCooldownMinFailedModels: 3,
        });
        assert.equal(providerCooldownPlan.ok, false);
        assert.equal(providerCooldownPlan.summary.providerCooldownBlockedCount, 2);
        assert.equal(providerCooldownPlan.routes[0].selected, null);
        assert.ok(providerCooldownPlan.routes[0].reasons.includes('blocked:provider_health_cooldown:timeout+upstream'));
        assert.ok(providerCooldownPlan.routes[0].nextActions.includes('wait_for_provider_cooldown_or_probe_different_provider'));

        const accountBlockedPolicy = {
            ...preferRuntimeProved,
            rows: preferRuntimeProved.rows.map((row, index) =>
                index === 0
                    ? {
                          ...row,
                          selected: {
                              ...row.selected,
                              accountAccess: {
                                  ...row.selected.accountAccess,
                                  canAttempt: false,
                                  status: 'not_visible',
                                  hardReasons: ['account_model_not_visible'],
                              },
                          },
                      }
                    : row,
            ),
        };
        const accountBlockedPlan = buildModelGatewayRuntimeSelectorPlan(accountBlockedPolicy);
        assert.equal(accountBlockedPlan.ok, false);
        assert.equal(accountBlockedPlan.summary.accountAccessBlockedCount, 1);
        assert.equal(accountBlockedPlan.summary.blockedProfileCount, 1);
        assert.equal(accountBlockedPlan.routes[0].selected, null);
        assert.equal(accountBlockedPlan.routes[0].reasons.includes('blocked:account_access_denies_attempt'), true);
        assert.equal(accountBlockedPlan.routes[0].nextActions.includes('refresh_account_overlay_or_choose_accessible_model'), true);

        const runtimeRouteDecisionEvents = [];
        const runtimeExecution = await executeModelGatewayRuntimeSelectorPlan(runtimeSelectorPlan, {
            profileId: 'repo_agent',
            env: {
                COPILOT_BYOK_PROVIDER_PRESET: 'groq',
                COPILOT_BYOK_BASE_URL: 'https://wrong.example.test/v1',
                OPENROUTER_API_KEY: 'openrouter-key',
            },
            deps: {
                runChatProbe: async (options = {}) => {
                    assert.equal(options.model, 'openai/gpt-oss-120b');
                    assert.equal(options.env?.['COPILOT_BYOK_PROVIDER_PRESET'], 'openrouter');
                    assert.equal(options.env?.['COPILOT_BYOK_BASE_URL'], undefined);
                    assert.equal(options.env?.['COPILOT_BYOK_WIRE_API'], 'completions');
                    assert.equal(typeof options.deps?.classifyProviderFailure, 'function');
                    return {
                        ok: true,
                        status: 'ok',
                        elapsedMs: 12,
                        model: String(options.model ?? ''),
                        profile: 'repo_agent',
                        preset: 'openrouter',
                        providerType: 'openai-compatible',
                        deltaCount: 1,
                        deltaChars: 13,
                        finalChars: 13,
                        finalContent: 'BYOK_PROBE_OK',
                        observedFinalEvent: true,
                        sessionId: 'unit-runtime-session',
                        errors: [],
                        warnings: [],
                        providerFailure: null,
                    };
                },
                recordSuccess: (input) => {
                    assert.equal(input.routeProfile, 'repo_agent');
                    assert.equal(input.providerId, 'openrouter');
                    assert.equal(input.providerModel, 'openai/gpt-oss-120b');
                },
                recordFailure: () => {
                    throw new Error('recordFailure should not be called for ok runtime execution');
                },
                recordRouteDecision: (event) => {
                    runtimeRouteDecisionEvents.push(event);
                    assert.equal(event.source.startsWith('unit-test-runtime-selector'), true);
                    return event;
                },
                flushHealth: async () => {},
            },
        });
        assert.equal(runtimeExecution.schema, 'model-gateway-runtime-selector-execution-result');
        assert.equal(runtimeExecution.ok, true);
        assert.equal(runtimeExecution.status, 'ok');
        assert.equal(runtimeExecution.healthRecorded, true);
        assert.equal(runtimeExecution.providerFailure, null);
        assert.equal(runtimeExecution.routeDecisionRecordedCount, 2);
        assert.deepEqual(
            runtimeRouteDecisionEvents.map((event) => [event.source, event.failure]),
            [
                ['unit-test-runtime-selector', null],
                ['unit-test-runtime-selector:runtime-result', null],
            ],
        );

        const blockedRuntimeExecution = await executeModelGatewayRuntimeSelectorPlan(strictRuntimeSelectorPlan, {
            profileId: 'tool_agent',
            deps: {
                runChatProbe: async () => {
                    throw new Error('runChatProbe should not be called for blocked runtime execution');
                },
            },
        });
        assert.equal(blockedRuntimeExecution.ok, false);
        assert.equal(blockedRuntimeExecution.status, 'blocked');
        assert.equal(blockedRuntimeExecution.error, 'runtime_selector_route_unavailable');

        const duplicateFallbackExecution = await executeModelGatewayRuntimeSelectorPlanWithFallbacks(runtimeSelectorPlan, {
            profileId: 'repo_agent',
            fallbackProfileIds: ['tool_agent'],
            deps: {
                runChatProbe: async () => ({
                    ok: false,
                    status: 'failed',
                    elapsedMs: 10,
                    model: '',
                    profile: 'repo_agent',
                    preset: 'openrouter',
                    providerType: 'openai-compatible',
                    deltaCount: 0,
                    deltaChars: 0,
                    finalChars: 0,
                    finalContent: '',
                    observedFinalEvent: false,
                    sessionId: 'unit-runtime-duplicate',
                    errors: ['duplicate route failed'],
                    warnings: [],
                    providerFailure: null,
                }),
                recordSuccess: () => {},
                recordFailure: () => {},
                flushHealth: async () => {},
            },
        });
        assert.equal(duplicateFallbackExecution.ok, false);
        assert.equal(duplicateFallbackExecution.attemptedCount, 1);
        assert.equal(duplicateFallbackExecution.attempts[0].profileId, 'repo_agent');

        const distinctFallbackPlan = {
            ...runtimeSelectorPlan,
            routes: runtimeSelectorPlan.routes.map((route) =>
                route.profileId === 'tool_agent'
                    ? {
                          ...route,
                          selectedRouteKey: 'openrouter:openai/gpt-oss-20b-tool',
                          selected: {
                              ...route.selected,
                              id: 'openrouter:openai/gpt-oss-20b-tool',
                              providerModel: 'openai/gpt-oss-20b-tool',
                          },
                      }
                    : route,
            ),
        };
        const provedFallbackFirstPlan = {
            ...distinctFallbackPlan,
            mode: 'prefer_runtime_proved',
            routes: distinctFallbackPlan.routes.map((route) =>
                route.profileId === 'tool_agent'
                    ? {
                          ...route,
                          hasRuntimeProof: true,
                          selected: {
                              ...route.selected,
                              hasRuntimeProof: true,
                          },
                      }
                    : {
                          ...route,
                          hasRuntimeProof: false,
                          selected: route.selected
                              ? {
                                    ...route.selected,
                                    hasRuntimeProof: false,
                                }
                              : route.selected,
                      },
            ),
        };
        const provedFallbackFirstExecution = await executeModelGatewayRuntimeSelectorPlanWithFallbacks(provedFallbackFirstPlan, {
            profileId: 'repo_agent',
            fallbackProfileIds: ['tool_agent'],
            deps: {
                runChatProbe: async (options = {}) => {
                    assert.equal(options.model, 'openai/gpt-oss-20b-tool');
                    return {
                        ok: true,
                        status: 'ok',
                        elapsedMs: 10,
                        model: String(options.model ?? ''),
                        profile: 'tool_agent',
                        preset: 'openrouter',
                        providerType: 'openai-compatible',
                        deltaCount: 1,
                        deltaChars: 13,
                        finalChars: 13,
                        finalContent: 'BYOK_PROBE_OK',
                        observedFinalEvent: true,
                        sessionId: 'unit-runtime-proved-fallback',
                        errors: [],
                        warnings: [],
                        providerFailure: null,
                    };
                },
                recordSuccess: () => {},
                recordFailure: () => {},
                flushHealth: async () => {},
            },
        });
        assert.equal(provedFallbackFirstExecution.ok, true);
        assert.equal(provedFallbackFirstExecution.attemptedCount, 1);
        assert.equal(provedFallbackFirstExecution.selectedProfileId, 'tool_agent');

        let fallbackProbeCalls = 0;
        const fallbackRuntimeExecution = await executeModelGatewayRuntimeSelectorPlanWithFallbacks(distinctFallbackPlan, {
            profileId: 'repo_agent',
            fallbackProfileIds: ['tool_agent'],
            deps: {
                runChatProbe: async (options = {}) => {
                    fallbackProbeCalls += 1;
                    return {
                        ok: fallbackProbeCalls === 2,
                        status: fallbackProbeCalls === 2 ? 'ok' : 'failed',
                        elapsedMs: 10,
                        model: String(options.model ?? ''),
                        profile: fallbackProbeCalls === 2 ? 'tool_agent' : 'repo_agent',
                        preset: 'openrouter',
                        providerType: 'openai-compatible',
                        deltaCount: fallbackProbeCalls === 2 ? 1 : 0,
                        deltaChars: fallbackProbeCalls === 2 ? 13 : 0,
                        finalChars: fallbackProbeCalls === 2 ? 13 : 0,
                        finalContent: fallbackProbeCalls === 2 ? 'BYOK_PROBE_OK' : '',
                        observedFinalEvent: fallbackProbeCalls === 2,
                        sessionId: `unit-runtime-session-${fallbackProbeCalls}`,
                        errors: fallbackProbeCalls === 2 ? [] : ['first route failed'],
                        warnings: [],
                        providerFailure: null,
                    };
                },
                recordSuccess: () => {},
                recordFailure: () => {},
                flushHealth: async () => {},
            },
        });
        assert.equal(fallbackRuntimeExecution.schema, 'model-gateway-runtime-selector-fallback-execution-result');
        assert.equal(fallbackRuntimeExecution.ok, true);
        assert.equal(fallbackRuntimeExecution.attemptedCount, 2);
        assert.equal(fallbackRuntimeExecution.selectedProfileId, 'tool_agent');
        assert.equal(fallbackRuntimeExecution.attempts[0].ok, false);
        assert.equal(fallbackRuntimeExecution.attempts[1].ok, true);
        assert.equal(fallbackRuntimeExecution.routeDecisionRecordedCount, 4);

        let retryProbeCalls = 0;
        let retrySleepCalls = 0;
        const retryRuntimeExecution = await executeModelGatewayRuntimeSelectorPlanWithFallbacks(runtimeSelectorPlan, {
            profileId: 'repo_agent',
            attemptsPerRoute: 2,
            retryDelayMs: 5,
            deps: {
                runChatProbe: async (options = {}) => {
                    retryProbeCalls += 1;
                    return {
                        ok: retryProbeCalls === 2,
                        status: retryProbeCalls === 2 ? 'ok' : 'failed',
                        elapsedMs: 10,
                        model: String(options.model ?? ''),
                        profile: 'repo_agent',
                        preset: 'openrouter',
                        providerType: 'openai-compatible',
                        deltaCount: retryProbeCalls === 2 ? 1 : 0,
                        deltaChars: retryProbeCalls === 2 ? 13 : 0,
                        finalChars: retryProbeCalls === 2 ? 13 : 0,
                        finalContent: retryProbeCalls === 2 ? 'BYOK_PROBE_OK' : '',
                        observedFinalEvent: retryProbeCalls === 2,
                        sessionId: `unit-runtime-retry-${retryProbeCalls}`,
                        errors: retryProbeCalls === 2 ? [] : ['retryable route failed'],
                        warnings: [],
                        providerFailure: null,
                    };
                },
                recordSuccess: () => {},
                recordFailure: () => {},
                flushHealth: async () => {},
                sleep: async (delayMs) => {
                    retrySleepCalls += 1;
                    assert.equal(delayMs, 5);
                },
            },
        });
        assert.equal(retryRuntimeExecution.ok, true);
        assert.equal(retryRuntimeExecution.attemptedCount, 2);
        assert.equal(retryRuntimeExecution.selectedProfileId, 'repo_agent');
        assert.equal(retrySleepCalls, 1);
        assert.equal(retryRuntimeExecution.retryDecisions[0].retryRoute, true);
        assert.equal(retryRuntimeExecution.routeDecisionRecordedCount, 4);

        const rateLimitRouteDecisionEvents = [];
        const rateLimitRuntimeExecution = await executeModelGatewayRuntimeSelectorPlan(runtimeSelectorPlan, {
            profileId: 'repo_agent',
            deps: {
                runChatProbe: async () => {
                    throw Object.assign(new Error('HTTP 429 provider asked to slow down'), {
                        status: 429,
                        headers: { 'retry-after': '42' },
                    });
                },
                recordSuccess: () => {
                    throw new Error('recordSuccess should not be called for thrown runtime execution');
                },
                recordFailure: (input) => {
                    assert.equal(input.routeProfile, 'repo_agent');
                    assert.equal(input.failureKind, 'rate-limit');
                    assert.equal(input.retryAfterSeconds, 42);
                },
                recordRouteDecision: (event) => {
                    rateLimitRouteDecisionEvents.push(event);
                    return event;
                },
                flushHealth: async () => {},
            },
        });
        assert.equal(rateLimitRuntimeExecution.ok, false);
        assert.equal(rateLimitRuntimeExecution.providerFailure?.kind, 'rate-limit');
        assert.equal(rateLimitRuntimeExecution.providerFailure?.retryAfterSeconds, 42);
        assert.equal(rateLimitRuntimeExecution.healthRecorded, true);
        assert.equal(rateLimitRuntimeExecution.routeDecisionRecordedCount, 2);
        assert.deepEqual(rateLimitRouteDecisionEvents.map((event) => event.failure), [
            null,
            'runtime_provider_failure:rate-limit',
        ]);
        const rateLimitDecision = resolveModelGatewayRuntimeRetryDecision(rateLimitRuntimeExecution, {
            maxRetryDelayMs: 1_000,
            retryDelayMs: 5,
        });
        assert.equal(rateLimitDecision.retryRoute, false);
        assert.equal(rateLimitDecision.fallbackRoute, true);
        assert.equal(rateLimitDecision.waitMs, 42_000);
        assert.equal(rateLimitDecision.reason, 'rate_limit_window_exceeds_runtime_retry_budget');
        assert.equal(rateLimitDecision.resetWindow?.class, 'temporary');
        assert.equal(rateLimitDecision.resetWindow?.source, 'retry_after');
        assert.equal(rateLimitDecision.resetWindow?.retryAfterSeconds, 42);

        let permanentProbeCalls = 0;
        let permanentRetrySleeps = 0;
        const permanentRuntimeExecution = await executeModelGatewayRuntimeSelectorPlanWithFallbacks(distinctFallbackPlan, {
            profileId: 'repo_agent',
            fallbackProfileIds: ['tool_agent'],
            attemptsPerRoute: 3,
            retryDelayMs: 5,
            deps: {
                runChatProbe: async (options = {}) => {
                    permanentProbeCalls += 1;
                    return {
                        ok: permanentProbeCalls === 2,
                        status: permanentProbeCalls === 2 ? 'ok' : 'failed',
                        elapsedMs: 10,
                        model: String(options.model ?? ''),
                        profile: permanentProbeCalls === 2 ? 'tool_agent' : 'repo_agent',
                        preset: 'openrouter',
                        providerType: 'openai-compatible',
                        deltaCount: permanentProbeCalls === 2 ? 1 : 0,
                        deltaChars: permanentProbeCalls === 2 ? 13 : 0,
                        finalChars: permanentProbeCalls === 2 ? 13 : 0,
                        finalContent: permanentProbeCalls === 2 ? 'BYOK_PROBE_OK' : '',
                        observedFinalEvent: permanentProbeCalls === 2,
                        sessionId: `unit-runtime-permanent-${permanentProbeCalls}`,
                        errors: permanentProbeCalls === 2 ? [] : ['invalid api key'],
                        warnings: [],
                        providerFailure:
                            permanentProbeCalls === 2
                                ? null
                                : {
                                      kind: 'auth',
                                      statusCode: 401,
                                      message: 'invalid api key',
                                      errorContext: 'provider.auth',
                                      operatorLabel: 'auth',
                                      operatorAction: 'fix key',
                                      external: true,
                                      retryAfterSeconds: null,
                                      resetAt: null,
                                      limitHeaders: {},
                                  },
                    };
                },
                recordSuccess: () => {},
                recordFailure: () => {},
                flushHealth: async () => {},
                sleep: async () => {
                    permanentRetrySleeps += 1;
                },
            },
        });
        assert.equal(permanentRuntimeExecution.ok, true);
        assert.equal(permanentRuntimeExecution.attemptedCount, 2);
        assert.equal(permanentRuntimeExecution.selectedProfileId, 'tool_agent');
        assert.equal(permanentRuntimeExecution.retryDecisions[0].permanent, true);
        assert.equal(permanentRuntimeExecution.retryDecisions[0].retryRoute, false);
        assert.equal(permanentProbeCalls, 2);
        assert.equal(permanentRetrySleeps, 0);

        const trace = buildModelGatewaySelectionDecisionTrace({
            snapshot,
            integrity: { ok: true, redactedIdentityCount: 0 },
            selection: audit,
            postRuntimeSelection: postRuntimeAudit,
            selectionComparison: comparison,
            policyResolution: preferRuntimeProved,
            runtimeSource: 'unit',
            runtimeHealthRecordCount: 1,
            runtimeAccountOverlaySummary: { activeCount: 0, expiredCount: 0 },
            traceId: 'unit-selection-trace',
            generatedAt: '2026-05-27T12:00:00.000Z',
            source: 'unit-test',
        });
        assert.equal(trace['schema'], 'model-gateway-selection-decision-trace');
        assert.equal(trace['traceId'], 'unit-selection-trace');
        assert.equal(trace['source'], 'unit-test');
        assert.equal(trace['runtime']?.['source'], 'unit');
        assert.equal(trace['policy']?.['mode'], MODEL_GATEWAY_SELECTION_POLICY_MODE.PREFER_RUNTIME_PROVED);
        assert.equal(Array.isArray(trace['rows']), true);
        assert.equal(trace['rows']?.[0]?.['selected']?.['providerId'], 'openrouter');
        assert.equal(trace['rows']?.[0]?.['selected']?.['accountScope'], 'default');
        assert.equal(trace['rows']?.[0]?.['selected']?.['taskProfile'], 'repo_agent');
        assert.equal(trace['rows']?.[0]?.['selected']?.['selectorSyntax'], 'openai/gpt-oss-120b:groq');
        assert.equal(trace['rows']?.[0]?.['selected']?.['routeLayer'], 'openai_compatible_aggregator');
        assert.equal(trace['rows']?.[0]?.['selected']?.['wireApi'], 'openai_chat_completions');
        assert.equal(trace['rows']?.[0]?.['selected']?.['upstreamProvider'], 'groq');
        const traceRuntimePlan = buildModelGatewayRuntimeSelectorPlan(trace, {
            source: 'unit-trace-runtime-selector',
            env: { OPENROUTER_API_KEY: 'openrouter-key' },
        });
        assert.equal(traceRuntimePlan.sourceSchema, 'model-gateway-selection-decision-trace');
        assert.equal(traceRuntimePlan.traceId, 'unit-selection-trace');
        assert.equal(traceRuntimePlan.routes[0].selected?.['selectorSyntax'], 'openai/gpt-oss-120b:groq');
        assert.equal(traceRuntimePlan.routes[0].selected?.['routeLayer'], 'openai_compatible_aggregator');
        assert.equal(traceRuntimePlan.routes[0].selected?.['wireApi'], 'openai_chat_completions');
        const traceProbeEnv = buildModelGatewayRuntimeSelectorProbeEnv(traceRuntimePlan.routes[0].selected, {});
        assert.equal(traceProbeEnv['COPILOT_BYOK_MODEL'], 'openai/gpt-oss-120b');
        assert.equal(traceProbeEnv['COPILOT_BYOK_WIRE_API'], 'completions');

        const traceDir = await mkdtemp(join(tmpdir(), 'model-gateway-selection-trace-'));
        try {
            const persistedTrace = await persistModelGatewaySelectionDecisionTrace(trace, { directory: traceDir });
            assert.equal(DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR, 'data/copilot/model-gateway/selection-traces');
            assert.equal(persistedTrace.ok, true);
            assert.equal(persistedTrace.written, true);
            const persistedPayload = JSON.parse(await readFile(String(persistedTrace.filePath), 'utf8'));
            const latestPayload = JSON.parse(await readFile(String(persistedTrace.latestPath), 'utf8'));
            assert.equal(persistedPayload.schema, 'model-gateway-selection-decision-trace');
            assert.equal(latestPayload.traceId, 'unit-selection-trace');

            const secondTrace = {
                ...trace,
                traceId: 'unit-selection-trace-b',
                policy: { mode: MODEL_GATEWAY_SELECTION_POLICY_MODE.REQUIRE_RUNTIME_PROOF },
                rows: [
                    {
                        profileId: 'repo_agent',
                        source: 'post_runtime_proved',
                        hasRuntimeProof: true,
                        selected: { providerId: 'groq', providerModel: 'openai/gpt-oss-120b', selectorKind: 'exact_model' },
                    },
                ],
            };
            const secondPersistedTrace = await persistModelGatewaySelectionDecisionTrace(secondTrace, { directory: traceDir });
            await persistModelGatewaySelectionDecisionTrace({ ...trace, traceId: 'unit-selection-trace-c' }, { directory: traceDir });
            const readBackTrace = await readModelGatewaySelectionDecisionTrace(String(secondPersistedTrace.filePath));
            assert.equal(readBackTrace['traceId'], 'unit-selection-trace-b');
            const traceFiles = await listModelGatewaySelectionDecisionTraceFiles({ directory: traceDir, limit: 2 });
            assert.equal(traceFiles.length, 2);
            const traceDiff = compareModelGatewaySelectionDecisionTraces(trace, secondTrace);
            assert.equal(traceDiff.schema, 'model-gateway-selection-trace-diff');
            assert.equal(traceDiff.left.traceId, 'unit-selection-trace');
            assert.equal(traceDiff.right.traceId, 'unit-selection-trace-b');
            assert.equal(traceDiff.summary.profileCount, 2);
            assert.equal(traceDiff.summary.changedProfileCount, 1);
            assert.equal(traceDiff.summary.removedProfileCount, 1);
            assert.equal(traceDiff.summary.selectedRouteChangedCount, 2);
            const retentionPreview = await applyModelGatewaySelectionTraceRetention({
                directory: traceDir,
                maxFiles: 1,
            });
            assert.equal(retentionPreview.ok, true);
            assert.equal(retentionPreview.dryRun, true);
            assert.equal(retentionPreview.prunedCount, 2);
            assert.equal(retentionPreview.deletedCount, 0);
            const retentionApply = await applyModelGatewaySelectionTraceRetention({
                directory: traceDir,
                maxFiles: 1,
                dryRun: false,
            });
            assert.equal(retentionApply.ok, true);
            assert.equal(retentionApply.prunedCount, 2);
            assert.equal(retentionApply.deletedCount, 2);
            const retainedFiles = await readdir(traceDir);
            assert.equal(retainedFiles.filter((name) => name !== 'latest.json').length, 1);
        } finally {
            await rm(traceDir, { recursive: true, force: true });
        }

        const strictAudit = auditModelGatewayPreRuntimeSelection(
            {
                ...snapshot,
                modelEligibilityDecisions: [
                    createModelEligibilityDecision({
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        selectorKind: 'provider_explicit',
                        selectorSyntax: 'openai/gpt-oss-120b:groq',
                        include: true,
                        disposition: 'unknown_policy_allows_probe',
                        reasons: ['unknown_account_access'],
                    }),
                ],
            },
            {
                strict: true,
                profiles: ['repo_agent'],
                secretRegistry: { has: () => true },
            },
        );

        assert.equal(strictAudit.mode, 'strict_access_only');
        assert.equal(strictAudit.ok, false);
        assert.equal(strictAudit.summary.selectedProfileCount, 0);
        assert.equal(
            strictAudit.profiles[0].topRejectedReasons.includes(
                'eligibility:not_known_access:unknown_policy_allows_probe',
            ),
            true,
        );

        const localPrivateAudit = auditModelGatewayPreRuntimeSelection(snapshot, {
            profiles: ['local_private'],
            secretRegistry: { has: () => true },
        });
        assert.equal(localPrivateAudit.ok, false);
        assert.equal(localPrivateAudit.profiles[0].selected, null);
        assert.equal(localPrivateAudit.profiles[0].capabilitySupply.required.local, 0);
        assert.equal(localPrivateAudit.profiles[0].capabilitySupply.required.privacy, 0);
        assert.equal(localPrivateAudit.profiles[0].capabilitySupply.required.no_remote_secrets, 0);
        assert.ok(localPrivateAudit.profiles[0].supplyWarnings.includes('required_supply_zero:local'));
        assert.ok(localPrivateAudit.profiles[0].supplyWarnings.includes('required_supply_zero:privacy'));
        assert.ok(localPrivateAudit.profiles[0].supplyWarnings.includes('required_supply_zero:no_remote_secrets'));
        assert.ok(localPrivateAudit.profiles[0].topRejectedReasons.includes('missing_capability:local'));
        assert.ok(localPrivateAudit.profiles[0].nextActions.includes('start_or_configure_explicit_local_provider'));

        const defaultProfileAudit = auditModelGatewayPreRuntimeSelection(snapshot, {
            secretRegistry: { has: () => true },
        });
        assert.equal(defaultProfileAudit.summary.profileCount, 7);

        const defaultWithOllamaAudit = auditModelGatewayPreRuntimeSelection(
            {
                projections: [
                    createCanonicalModelProjection({
                        providerId: 'ollama-local',
                        providerModel: 'gemma3:4b',
                        capabilities: {
                            streaming: true,
                            tools: true,
                            local: true,
                            privacy: true,
                            no_remote_secrets: true,
                        },
                        limits: { contextWindowTokens: 131_072 },
                        pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
                    }),
                    createCanonicalModelProjection({
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        capabilities: { streaming: true, tools: true, reasoningEffort: true, forcedToolChoice: true },
                        limits: { contextWindowTokens: 131_072 },
                        pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
                    }),
                ],
                routeOptions: [
                    createModelRouteOption({
                        providerId: 'ollama-local',
                        providerModel: 'gemma3:4b',
                        selectorKind: 'exact_model',
                        selectorSyntax: 'gemma3:4b',
                        normalizedPolicy: { routeLayer: 'local_daemon', runtimeKind: 'local', localPrivate: true },
                    }),
                    createModelRouteOption({
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        selectorKind: 'exact_model',
                        selectorSyntax: 'openai/gpt-oss-120b',
                    }),
                ],
                accountOverlays: [
                    createProviderAccountOverlay({ providerId: 'ollama-local', enabledModels: ['gemma3:4b'] }),
                    createProviderAccountOverlay({ providerId: 'openrouter', enabledModels: ['openai/gpt-oss-120b'] }),
                ],
            },
            {
                secretRegistry: { has: () => true },
            },
        );
        assert.equal(defaultWithOllamaAudit.summary.profileCount, 7);
        assert.equal(defaultWithOllamaAudit.profiles.some((profile) => profile.selected?.['providerId'] === 'ollama-local'), false);
        assert.ok(defaultWithOllamaAudit.summary.rejectedReasonCounts['local_provider_requires_explicit_request'] > 0);

        const strictLocalPrivateAudit = auditModelGatewayPreRuntimeSelection(snapshot, {
            profiles: ['local_private_strict'],
            secretRegistry: { has: () => true },
        });
        assert.equal(strictLocalPrivateAudit.ok, false);
        assert.equal(strictLocalPrivateAudit.profiles[0].selected, null);
        assert.ok(strictLocalPrivateAudit.profiles[0].topRejectedReasons.includes('missing_capability:local'));

        const strictLocalPrivateReady = auditModelGatewayPreRuntimeSelection(
            {
                projections: [
                    createCanonicalModelProjection({
                        providerId: 'ollama-local',
                        providerModel: 'gemma3:4b',
                        capabilities: { streaming: true, local: true, privacy: true, no_remote_secrets: true },
                        limits: { contextWindowTokens: 8192 },
                        pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
                    }),
                ],
                routeOptions: [
                    createModelRouteOption({
                        providerId: 'ollama-local',
                        providerModel: 'gemma3:4b',
                        selectorKind: 'exact_model',
                        selectorSyntax: 'gemma3:4b',
                        normalizedPolicy: { routeLayer: 'local_daemon', localPrivate: true },
                    }),
                ],
                accountOverlays: [
                    createProviderAccountOverlay({
                        providerId: 'ollama-local',
                        enabledModels: ['gemma3:4b'],
                    }),
                ],
            },
            {
                profiles: ['local_private_strict'],
                secretRegistry: { has: () => true },
            },
        );
        assert.equal(strictLocalPrivateReady.ok, true);
        assert.equal(strictLocalPrivateReady.profiles[0].selected?.['providerId'], 'ollama-local');
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

    it('keeps Ollama local candidates out of default routing until the operator explicitly requests local', () => {
        const ollamaProjection = createCanonicalModelProjection({
            providerId: 'ollama-local',
            providerModel: 'gemma3:4b',
            capabilities: { streaming: true, local: true, privacy: true, no_remote_secrets: true },
            limits: { contextWindowTokens: 131_072 },
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const remoteProjection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-20b',
            capabilities: { streaming: true },
            limits: { contextWindowTokens: 131_072 },
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const candidates = buildModelGatewayRouteCandidates({
            projections: [ollamaProjection, remoteProjection],
            routeOptions: [
                createModelRouteOption({
                    providerId: 'ollama-local',
                    providerModel: 'gemma3:4b',
                    selectorKind: 'exact_model',
                    selectorSyntax: 'gemma3:4b',
                    normalizedPolicy: {
                        routeLayer: 'local_daemon',
                        runtimeKind: 'local',
                        localPrivate: true,
                    },
                }),
                createModelRouteOption({
                    providerId: 'openrouter',
                    providerModel: 'openai/gpt-oss-20b',
                    selectorKind: 'exact_model',
                    selectorSyntax: 'openai/gpt-oss-20b',
                    normalizedPolicy: { routeLayer: 'openai_compatible_aggregator' },
                }),
            ],
        });

        const defaultRoute = routeGatewayModels(candidates, 'cheap_chat', { requireAgentProbeOk: false });
        assert.equal(defaultRoute.selected?.model['providerId'], 'openrouter');
        assert.ok(
            defaultRoute.rejected.some(
                (candidate) =>
                    candidate.model['providerId'] === 'ollama-local' &&
                    candidate.rejectedReasons.includes('local_provider_requires_explicit_request'),
            ),
        );

        const explicitProvider = routeGatewayModels(candidates, 'cheap_chat', {
            allowProviders: ['ollama'],
            requireAgentProbeOk: false,
        });
        assert.equal(explicitProvider.selected?.model['providerId'], 'ollama-local');

        const explicitLocalProfile = routeGatewayModels(candidates, 'local_private', { requireAgentProbeOk: false });
        assert.equal(explicitLocalProfile.selected?.model['providerId'], 'ollama-local');

        const globalOptOut = routeGatewayModels(candidates, 'cheap_chat', {
            excludeLocalProvidersByDefault: false,
            requireAgentProbeOk: false,
        });
        assert.equal(globalOptOut.selected?.model['providerId'], 'ollama-local');
    });

    it('selects route candidates by upstream provider metadata before runtime', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'huggingface',
            providerModel: 'openai/gpt-oss-120b',
            capabilities: { tools: true, streaming: true },
            limits: { contextWindowTokens: 131_072 },
        });
        const candidates = buildModelGatewayRouteCandidates({
            projections: [projection],
            routeOptions: [
                createModelRouteOption({
                    providerId: 'huggingface',
                    providerModel: 'openai/gpt-oss-120b',
                    selectorKind: 'provider_explicit',
                    selectorSyntax: 'openai/gpt-oss-120b:groq',
                    providerSpecific: { huggingFaceProvider: 'groq' },
                }),
                createModelRouteOption({
                    providerId: 'huggingface',
                    providerModel: 'openai/gpt-oss-120b',
                    selectorKind: 'provider_explicit',
                    selectorSyntax: 'openai/gpt-oss-120b:cerebras',
                    providerSpecific: { huggingFaceProvider: 'cerebras' },
                }),
            ],
        });

        const decision = routeGatewayModels(candidates, 'tool_agent', {
            blockUpstreamProviders: ['groq'],
            preferredUpstreamProviders: ['cerebras'],
            requireAgentProbeOk: false,
        });

        assert.equal(decision.selected?.model['selectorSyntax'], 'openai/gpt-oss-120b:cerebras');
        assert.ok(decision.selected?.reasons.includes('preferred_upstream_provider:cerebras'));
        assert.ok(decision.rejected.some((candidate) => candidate.rejectedReasons.includes('upstream_provider_blocked:groq')));
    });

    it('selects candidates by normalized data policy before runtime', () => {
        const retained = {
            ...createModelRecord({
                providerId: 'openrouter',
                providerModel: 'retained-model',
                capabilities: { tools: true, streaming: true },
                limits: { contextWindowTokens: 64_000 },
            }),
            dataPolicy: { training: true, retainsPrompts: true },
        };
        const privateModel = {
            ...createModelRecord({
                providerId: 'openrouter',
                providerModel: 'private-model',
                capabilities: { tools: true, streaming: true },
                limits: { contextWindowTokens: 64_000 },
            }),
            dataPolicy: { training: false, retainsPrompts: false },
        };

        const decision = routeGatewayModels([retained, privateModel], 'tool_agent', {
            requiredDataPolicy: { training: false, retainsPrompts: false },
            requireAgentProbeOk: false,
        });

        assert.equal(decision.selected?.model['id'], 'openrouter:private-model');
        assert.ok(decision.selected?.reasons.includes('data_policy_match:training'));
        assert.ok(decision.selected?.reasons.includes('data_policy_match:retainsPrompts'));
        assert.ok(decision.rejected.some((candidate) => candidate.rejectedReasons.includes('data_policy_mismatch:training')));
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
        const explanation = explainGatewayRouteDecision(route);

        assert.deepEqual({
            selected: explanation.selected,
            selectedId: explanation.selectedId,
            candidateCount: explanation.candidateCount,
            rejectedCount: explanation.rejectedCount,
            fallbackChain: explanation.fallbackChain,
            rejectedReasonCounts: explanation.rejectedReasonCounts,
            topRejectedReasons: explanation.topRejectedReasons,
            nextActions: explanation.nextActions,
            summary: explanation.summary,
        }, {
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
        assert.equal(explanation.rejectedSummaries[0]?.['id'], 'openrouter:weak-chat');
        assert.deepEqual(explanation.rejectedSummaries[0]?.['probes'], {
            status: null,
            agentProbeStatus: null,
            chatOk: false,
            agentProbeVerified: false,
            verifiedProbes: [],
            failedProbes: [],
            liveToolProtocolStatus: null,
            liveAskUserStatus: null,
        });
        assert.deepEqual(explanation.decisionLayers, {
            catalogCandidateCount: 1,
            eligibilityEvaluatedCount: 0,
            healthRecordCount: 0,
            runtimeChatOkCount: 0,
            runtimeAgentProbeProofCount: 0,
            runtimeProbeProofCount: 0,
            runtimeLiveToolProtocolProofCount: 0,
            runtimeLiveAskUserProofCount: 0,
            runtimeLiveProtocolFailureCount: 0,
            runtimeHealthProofCount: 0,
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

    it('penalizes failed preferred probes without making vision a hard gate', () => {
        const failedVision = createModelRecord({
            providerId: 'kilo',
            providerModel: 'kilo-auto/free',
            capabilities: { streaming: true, vision: true },
            limits: { contextWindowTokens: 256_000 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });
        const unprovedVision = createModelRecord({
            providerId: 'kilo',
            providerModel: 'openrouter/free',
            capabilities: { streaming: true, vision: true },
            limits: { contextWindowTokens: 200_000 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });
        recordByokProviderModelProbeResult({
            routeProfile: 'vision',
            providerId: 'kilo',
            providerModel: 'kilo-auto/free',
            probeKind: 'vision',
            status: 'failed',
            ok: false,
            providerAttempted: true,
            timestamp: 90,
        });

        const decision = routeGatewayModels([failedVision, unprovedVision], 'vision', { routeProfile: 'vision' });

        assert.equal(decision.selected?.model['id'], 'kilo:openrouter/free');
        assert.equal(decision.rejected.length, 0);
        const failed = decision.candidates.find((candidate) => candidate.model['id'] === 'kilo:kilo-auto/free');
        assert.ok(failed?.reasons.includes('preferred_probe_failed:vision'));
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

    it('can block routes with failed terminal live protocol probes before another runtime handoff', () => {
        const textifiedTools = createModelRecord({
            providerId: 'nvidia-nim',
            providerModel: 'openai/gpt-oss-120b',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });
        const unprovenAlternative = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'qwen/qwen3-coder:free',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
            verification: { confidence: 'catalog', sources: ['provider_catalog'] },
        });

        recordByokProviderModelProbeResult({
            routeProfile: 'code',
            providerId: 'nvidia-nim',
            providerModel: 'openai/gpt-oss-120b',
            probeKind: 'live_ask_user',
            status: 'failed',
            ok: false,
            providerAttempted: true,
            message: 'terminal live turn textified ask_user',
            errorContext: 'terminal_live_ask_user',
            failureKind: 'tool_protocol',
            timestamp: 85,
        });

        const decision = routeGatewayModels([textifiedTools, unprovenAlternative], 'code', {
            routeProfile: 'code',
            blockFailedProbeKinds: ['live_ask_user'],
            preferredProbeKinds: ['live_tool_protocol', 'live_ask_user'],
        });

        assert.equal(decision.selected?.model['id'], 'openrouter:qwen/qwen3-coder:free');
        assert.ok(decision.rejected.some((candidate) => candidate.rejectedReasons.includes('runtime_probe_failed:live_ask_user')));
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
        assert.equal(blocked.scoreBreakdown.baseScore, 100);
        assert.equal(blocked.scoreBreakdown.finalScore, blocked.score);
        assert.equal(blocked.scoreBreakdown.hardGateCount, 1);
        assert.equal(blocked.scoreBreakdown.rejectedGroups.provider_blocked, 1);
        assert.equal(blocked.scoreBreakdown.groups.confidence, 1);
    });

    it('applies selector, auto route and gateway fallback policies before runtime', () => {
        const model = {
            id: 'kilo:anthropic/claude-sonnet-4.5',
            providerId: 'kilo',
            providerModel: 'anthropic/claude-sonnet-4.5',
            selectorKind: 'gateway_fallback',
            selectorSyntax: 'anthropic/claude-sonnet-4.5:fastest',
            normalizedPolicy: {
                routeLayer: 'gateway_fallback',
                selectorKind: 'gateway_fallback',
                selectorSyntax: 'anthropic/claude-sonnet-4.5:fastest',
                wireApi: 'openai_chat_completions',
            },
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
        };

        const blocked = scoreGatewayModelCandidate(model, MODEL_GATEWAY_TASK_PROFILES.tool_agent, {
            allowSelectorKinds: ['exact_model'],
            allowAutoSelectors: false,
            allowGatewayFallbacks: false,
            requireProviderDirect: true,
        });

        assert.equal(blocked.include, false);
        assert.ok(blocked.rejectedReasons.includes('selector_kind_not_allowed:gateway_fallback'));
        assert.ok(blocked.rejectedReasons.includes('auto_selector_blocked:gateway_fallback'));
        assert.ok(blocked.rejectedReasons.includes('gateway_fallback_blocked:gateway_fallback'));
        assert.ok(blocked.rejectedReasons.includes('provider_direct_required:gateway_fallback'));
    });

    it('selects gateway routes by explicit upstream provider policy before runtime', () => {
        const anthropicRoute = {
            id: 'kilo:anthropic/claude-sonnet-4.5',
            providerId: 'kilo',
            providerModel: 'anthropic/claude-sonnet-4.5',
            selectorKind: 'gateway_policy',
            selectorSyntax: 'anthropic/claude-sonnet-4.5:fastest',
            providerSpecific: { upstreamProvider: 'anthropic' },
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 200_000 },
        };
        const openaiRoute = {
            id: 'kilo:openai/gpt-oss-120b',
            providerId: 'kilo',
            providerModel: 'openai/gpt-oss-120b',
            selectorKind: 'gateway_policy',
            selectorSyntax: 'openai/gpt-oss-120b:fastest',
            providerSpecific: { upstreamProvider: 'openai' },
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
        };

        const preferred = routeGatewayModels([openaiRoute, anthropicRoute], 'tool_agent', {
            requireAgentProbeOk: false,
            allowUpstreamProviders: ['anthropic', 'openai'],
            preferredUpstreamProviders: ['anthropic'],
        });
        const blocked = routeGatewayModels([openaiRoute, anthropicRoute], 'tool_agent', {
            requireAgentProbeOk: false,
            blockUpstreamProviders: ['anthropic'],
        });

        assert.equal(preferred.selected?.model['providerModel'], 'anthropic/claude-sonnet-4.5');
        assert.ok(preferred.selected?.reasons.includes('preferred_upstream_provider:anthropic'));
        assert.equal(blocked.selected?.model['providerModel'], 'openai/gpt-oss-120b');
        assert.ok(blocked.rejected.some((candidate) => candidate.rejectedReasons.includes('upstream_provider_blocked:anthropic')));
    });

    it('applies privacy strict, no-paid and max estimated cost policies before runtime', () => {
        const paidTraining = {
            id: 'openrouter:paid-training',
            providerId: 'openrouter',
            providerModel: 'paid-training',
            capabilities: { streaming: true, tools: true },
            pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 3 },
            dataPolicy: { training: true, retainsPrompts: true },
        };
        const privateFree = {
            id: 'openrouter:private-free',
            providerId: 'openrouter',
            providerModel: 'private-free',
            capabilities: { streaming: true, tools: true, privacy: true },
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
            dataPolicy: { training: false, retainsPrompts: false },
        };

        const blocked = scoreGatewayModelCandidate(paidTraining, MODEL_GATEWAY_TASK_PROFILES.tool_agent, {
            privacyStrict: true,
            noPaidModels: true,
            maxEstimatedCostPerMillion: 1,
            requireAgentProbeOk: false,
        });
        const allowed = scoreGatewayModelCandidate(privateFree, MODEL_GATEWAY_TASK_PROFILES.tool_agent, {
            privacyStrict: true,
            noPaidModels: true,
            maxEstimatedCostPerMillion: 1,
            requireAgentProbeOk: false,
        });

        assert.equal(blocked.include, false);
        assert.ok(blocked.rejectedReasons.includes('privacy_strict_not_satisfied'));
        assert.ok(blocked.rejectedReasons.includes('paid_model_blocked:5'));
        assert.ok(blocked.rejectedReasons.includes('price_above_limit:5>1'));
        assert.equal(allowed.include, true);
        assert.ok(allowed.reasons.includes('privacy_strict_satisfied'));
        assert.ok(allowed.reasons.includes('price_within_preference:0<=1') === false);
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

    it('lets concrete runtime account blockers override older route eligibility decisions', () => {
        const model = {
            ...createModelRecord({
                providerId: 'chutes',
                providerModel: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
                capabilities: { streaming: true, tools: true },
                limits: { contextWindowTokens: 262_144 },
                pricing: { inputUsdPerMillion: 0.14, outputUsdPerMillion: 0.57 },
            }),
            routeProfile: 'repo_agent',
            selectorKind: 'exact_model',
            selectorSyntax: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
        };
        const staleEligible = createModelEligibilityDecision({
            providerId: 'chutes',
            providerModel: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
            routeProfile: 'repo_agent',
            selectorKind: 'exact_model',
            selectorSyntax: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
            include: true,
            policyProfile: 'build-default',
            taskProfile: 'repo_agent',
        });
        const runtimeBlocked = createModelEligibilityDecision({
            providerId: 'chutes',
            providerModel: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
            selectorKind: 'exact_model',
            selectorSyntax: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
            include: false,
            hardExclusions: ['account_spending_exhausted'],
            policyProfile: 'runtime-selector-strict',
            taskProfile: 'default',
        });

        const decision = routeGatewayModels([model], 'repo_agent', {
            eligibilityDecisions: [staleEligible, runtimeBlocked],
            requireKnownEligibility: true,
            requireAgentProbeOk: false,
        });

        assert.equal(decision.selected, null);
        assert.equal(decision.rejected.length, 1);
        assert.ok(decision.rejected[0].rejectedReasons.includes('eligibility:account_spending_exhausted'));
    });

    it('does not reuse precomputed eligibility decisions across account scopes', () => {
        const model = createModelRecord({
            providerId: 'openrouter',
            providerModel: 'scope-model',
            capabilities: { streaming: true, tools: true },
            limits: { contextWindowTokens: 128_000 },
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
        });
        const defaultExcluded = createModelEligibilityDecision({
            providerId: 'openrouter',
            providerModel: 'scope-model',
            accountScope: 'default',
            taskProfile: 'tool_agent',
            include: false,
            hardExclusions: ['account_model_not_visible'],
        });
        const orgEligible = createModelEligibilityDecision({
            providerId: 'openrouter',
            providerModel: 'scope-model',
            accountScope: 'org-alpha',
            taskProfile: 'tool_agent',
            include: true,
            reasons: ['account_model_visible'],
        });

        const decision = routeGatewayModels([model], 'tool_agent', {
            eligibilityDecisions: [defaultExcluded, orgEligible],
            eligibilityPolicy: { accountScope: 'org-alpha' },
            requireKnownEligibility: true,
            requireAgentProbeOk: false,
        });

        assert.equal(decision.selected?.model['providerModel'], 'scope-model');
        assert.equal(decision.selected?.eligibility?.['accountScope'], 'org-alpha');
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

    it('resolves account and workspace scoped env secrets before global refs', () => {
        const workspaceKey = buildScopedSecretEnvKey({ scope: 'workspace', scopeId: 'workspace-alpha', ref: 'OPENAI_API_KEY' });
        const accountKey = buildScopedSecretEnvKey({ scope: 'account', scopeId: 'acct-42', ref: 'OPENAI_API_KEY' });
        const registry = createEnvSecretRegistry({
            accountId: 'acct-42',
            workspaceId: 'workspace-alpha',
            env: {
                OPENAI_API_KEY: 'global-key',
                [workspaceKey]: 'workspace-key',
                [accountKey]: 'account-key',
            },
        });

        assert.equal(workspaceKey, 'COPILOT_BYOK_WORKSPACE_WORKSPACE_ALPHA__OPENAI_API_KEY');
        assert.equal(accountKey, 'COPILOT_BYOK_ACCOUNT_ACCT_42__OPENAI_API_KEY');
        assert.equal(registry.get('OPENAI_API_KEY'), 'account-key');
        assert.deepEqual(
            registry.candidateRefs('OPENAI_API_KEY').map((candidate) => candidate.scope),
            ['account', 'workspace', 'global'],
        );
        assert.deepEqual(registry.describe('OPENAI_API_KEY'), {
            ref: 'OPENAI_API_KEY',
            configured: true,
            source: 'env',
            scope: 'account',
            checkedEnvKeys: [accountKey, workspaceKey, 'OPENAI_API_KEY'],
            safeLabel: 'OPENAI_API_KEY=<configured:account>',
        });
        assert.equal(createEnvSecretRegistry({ env: { ANTHROPIC_KEY: 'anthropic-key' } }).has('ANTHROPIC_KEY'), true);
        assert.equal(createEnvSecretRegistry({ env: { HUGGINGFACE_API_TOKEN: 'hf-key' } }).has('HUGGINGFACE_API_TOKEN'), true);
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

    it('captures and deduplicates route decision streams before SQLite persistence', () => {
        const route = routeGatewayModels(
            [
                createModelRecord({
                    providerId: 'openrouter',
                    providerModel: 'openai/gpt-oss-120b',
                    capabilities: { tools: true, streaming: true },
                    limits: { contextWindowTokens: 131072 },
                }),
            ],
            'repo_agent',
            { requireAgentProbeOk: false },
        );
        const first = buildRouteDecisionEvent({
            taskProfile: 'repo_agent',
            routeProfile: 'default',
            mode: 'metadata_first',
            source: 'unit-test-runtime-selector',
            route,
        });
        const second = buildRouteDecisionEvent({
            taskProfile: 'repo_agent',
            routeProfile: 'default',
            mode: 'metadata_first:runtime_result',
            source: 'unit-test-runtime-selector:runtime-result',
            route,
            failure: 'runtime_probe_failed:empty',
        });
        const duplicateSecond = {
            ...second,
            selected: false,
            failure: 'runtime_probe_failed:updated-empty',
        };
        const capture = createModelGatewayRouteDecisionCapture();

        capture.record(first);
        capture.record(second);
        capture.record(duplicateSecond);
        const captured = capture.list();
        const unique = capture.listUnique();
        const deduped = dedupeModelGatewayRouteDecisionEvents([first, second, duplicateSecond, null, undefined]);

        assert.equal(capture.count(), 3);
        assert.equal(captured.length, 3);
        assert.equal(unique.length, 2);
        assert.deepEqual(
            unique.map((event) => event.decisionId),
            [first.decisionId, second.decisionId],
        );
        assert.equal(unique[1].failure, 'runtime_probe_failed:updated-empty');
        assert.equal(deduped[1].failure, 'runtime_probe_failed:updated-empty');
        captured[0].fallbackChain.push('mutated');
        assert.equal(capture.list()[0].fallbackChain.includes('mutated'), false);
    });

    it('keeps route decision ids unique for pre-decision and runtime outcome in the same millisecond', () => {
        const route = routeGatewayModels(
            [
                createModelRecord({
                    providerId: 'openrouter',
                    providerModel: 'openai/gpt-oss-120b',
                    capabilities: { tools: true, streaming: true },
                    limits: { contextWindowTokens: 131072 },
                }),
            ],
            'repo_agent',
            { requireAgentProbeOk: false },
        );
        const originalNow = Date.now;
        Date.now = () => 1_779_930_000_000;
        try {
            const preDecision = buildRouteDecisionEvent({
                taskProfile: 'repo_agent',
                routeProfile: 'default',
                mode: 'metadata_first',
                source: 'unit-test-runtime-selector',
                route,
            });
            const runtimeOutcome = buildRouteDecisionEvent({
                taskProfile: 'repo_agent',
                routeProfile: 'default',
                mode: 'metadata_first:runtime_result',
                source: 'unit-test-runtime-selector:runtime-result',
                route,
                failure: 'runtime_probe_failed:empty',
            });

            assert.notEqual(preDecision.decisionId, runtimeOutcome.decisionId);
            assert.equal(preDecision.timestamp, runtimeOutcome.timestamp);
            assert.equal(preDecision.decisionId.includes('unit-test-runtime-selector'), true);
            assert.equal(runtimeOutcome.decisionId.includes('runtime-result'), true);
            assert.equal(runtimeOutcome.decisionId.includes('runtime_probe_failed:empty'), true);
        } finally {
            Date.now = originalNow;
        }
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
            decisions: [
                createModelEligibilityDecision({
                    providerId: 'openrouter',
                    providerModel: 'visible-model',
                    include: true,
                    disposition: 'eligible',
                }),
                createModelEligibilityDecision({
                    providerId: 'openrouter',
                    providerModel: 'blocked-model',
                    include: false,
                    hardExclusions: ['account_model_not_visible', 'secret_missing:OPENROUTER_API_KEY'],
                    softPenalties: ['price_unknown'],
                }),
            ],
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
        assert.equal(metrics.gauges['model_gateway.eligibility.exclusion_reason.hard.account_model_not_visible'], 1);
        assert.equal(metrics.gauges['model_gateway.eligibility.exclusion_reason.hard.secret_missing:openrouter_api_key'], 1);
        assert.equal(metrics.gauges['model_gateway.eligibility.exclusion_reason.soft.price_unknown'], 1);
        assert.equal(metrics.gauges['model_gateway.eligibility.disposition.eligible'], 1);
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

    it('publishes a boolean pre-build readiness gate for K+ metadata layers', () => {
        const report = buildModelGatewayPreBuildReadinessReport();
        const ids = new Set(report.checks.map((check) => check.id));

        assert.equal(report.stage, 'prebuild');
        assert.equal(report.ready, true);
        assert.equal(report.failed, 0);
        assert.equal(report.passed, report.total);
        assert.ok(report.checks.length > buildModelGatewayPreKCompatibilityReport().checks.length);
        assert.ok(report.checks.every((check) => typeof check.passed === 'boolean'));
        assert.ok(ids.has('universal_catalog_contracts_are_exported'));
        assert.ok(ids.has('sqlite_catalog_store_is_available'));
        assert.ok(ids.has('eligibility_is_pre_runtime'));
        assert.ok(ids.has('provider_gateway_traits_are_metadata'));
        assert.ok(ids.has('canonical_commands_are_published'));
        assert.ok(ids.has('metadata_database_build_is_explicit'));
    });

    it('publishes a canonical model-gateway command inventory for operators and LLMs', () => {
        const commands = listModelGatewayCanonicalCommands();
        const packageCommands = listModelGatewayCanonicalCommands({ surface: 'package' });
        const terminalLines = renderModelGatewayCanonicalCommandLines({ surface: 'terminal' });

        assert.ok(commands.length >= 20);
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:prebuild'));
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:build'));
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:metadata:build:plan'));
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:metadata:build:preview'));
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:metadata:build'));
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:redaction:audit -- --fail'));
        assert.ok(
            packageCommands.some(
                (entry) => entry.command === 'npm run model-gateway:selection:audit -- --profile=local_private_strict --fail-on-unselected',
            ),
        );
        assert.ok(
            packageCommands.some(
                (entry) =>
                    entry.command === 'npm run model-gateway:selection:effective -- --profile local_private --fail --fail-on-supply-warning',
            ),
        );
        assert.ok(
            packageCommands.some(
                (entry) => entry.command === 'npm run model-gateway:selection:effective -- --require-runtime-proof',
            ),
        );
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:selection:effective:trace'));
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:selection:trace-diff'));
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:selection:trace-retention'));
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:live:plan'));
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run terminal:llm-b:live-test -- --no-pr --timeout-ms=180000'));
        assert.ok(
            packageCommands.some(
                (entry) =>
                    entry.command ===
                    'npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-timeout-ms=15000 --no-pr --timeout-ms=600000',
            ),
        );
        assert.ok(packageCommands.some((entry) => entry.command === 'npm run model-gateway:runtime-health:mirror'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-prebuild'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-build'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-effective-selection-trace'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-selection-trace-diff'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-selection-trace-retention'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-metadata-build-plan'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-metadata-build-preview'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-metadata-build'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-redaction-audit'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-live-plan'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-runtime-health-mirror'));
        assert.ok(commands.some((entry) => entry.command === 'npm run model-gateway:refresh:log:sqlite -- --json'));
        assert.ok(commands.some((entry) => entry.command === 'npm run model-gateway:sqlite:retention -- --json'));
        assert.ok(commands.some((entry) => entry.command === 'npm run model-gateway:sqlite:retention:apply -- --json'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-refresh-log-sqlite'));
        assert.ok(commands.some((entry) => entry.command === 'make model-gateway-sqlite-retention'));
        assert.ok(commands.some((entry) => entry.command === '/byok gateway commands'));
        assert.ok(commands.some((entry) => entry.command === '/byok gateway prebuild'));
        assert.ok(commands.some((entry) => entry.command === '/byok gateway selection audit runtime-proof'));
        assert.ok(commands.some((entry) => entry.command === '/byok gateway selection audit strict local_private_strict'));
        assert.ok(commands.some((entry) => entry.command === '/byok gateway health sqlite'));
        assert.ok(commands.every((entry) => MODEL_GATEWAY_CANONICAL_COMMAND_PHASES.includes(entry.phase)));
        assert.ok(terminalLines.some((line) => line.includes('/byok gateway catalog refresh')));
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
        const skyfallEvidence = createModelMetadataEvidence({
            evidenceId: 'ev-skyfall',
            providerId: 'openrouter',
            providerModel: 'thedrummer/skyfall-36b-v2',
            fieldPath: 'aliases.providerModel',
            value: 'thedrummer/skyfall-36b-v2',
            sourceId: source.id,
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
            accountOverlayId: 'kilo:org:sk-overlay-secret-that-must-not-leak',
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
        assert.equal(skyfallEvidence.providerModel, 'thedrummer/skyfall-36b-v2');
        assert.equal(skyfallEvidence.value, 'thedrummer/skyfall-36b-v2');
        assert.equal(providerEvidence.subjectProviderId, 'anthropic');
        assert.equal(providerEvidence.redactionStatus, 'sanitized');
        assert.equal(route.selectorKind, 'gateway_auto');
        assert.deepEqual(route.normalizedPolicy.routeTraits, {
            selectorKind: 'gateway-auto',
            selectionMode: 'gateway_auto',
            autoSelection: true,
        });
        assert.equal(overlay.redactionStatus, 'sanitized');
        assert.equal(overlay.accountOverlayId.includes('sk-overlay-secret-that-must-not-leak'), false);
        assert.equal(overlay.accountOverlayId.includes('[redacted]'), false);
        assert.equal(overlay.accountOverlayId, 'kilo:org:KILO_API_KEY:account-overlay');
        assert.deepEqual(projection.modalities, { input: ['text'], output: ['text'] });
        const serialized = JSON.stringify({ evidence, providerEvidence, route, overlay, projection, skyfallEvidence });
        assert.equal(serialized.includes('sk-secret-that-must-not-leak'), false);
        assert.equal(serialized.includes('secret-token-that-must-not-leak'), false);
    });

    it('audits persisted model-gateway values for redaction leaks without returning raw secrets', () => {
        const secret = 'sk-audit-secret-that-must-not-leak';
        const audit = auditModelGatewayValueRedaction(
            {
                ok: 'plain',
                nested: {
                    diagnostic: `provider returned ${secret}`,
                },
            },
            { additionalSecrets: [secret], surface: 'unit', rootPath: 'snapshot' },
        );
        const envSecrets = collectModelGatewaySecretAuditEnvValues({
            OPENROUTER_API_KEY: secret,
            UNRELATED: secret,
        });

        assert.equal(audit.ok, false);
        assert.equal(audit.leakCount, 1);
        assert.equal(audit.samples.length, 1);
        assert.equal(JSON.stringify(audit).includes(secret), false);
        assert.deepEqual(envSecrets, [secret]);
    });

    it('does not confuse public secret references with secret assignment leaks', () => {
        const publicRefsAudit = auditModelGatewayValueRedaction(
            {
                accountOverlayId: 'cerebras:default:CEREBRAS_API_KEY:account-overlay',
                sourceId: 'openai-compatible-account',
                secretRef: 'OPENAI_API_KEY',
            },
            { surface: 'unit', rootPath: 'snapshot' },
        );
        const assignedSecretAudit = auditModelGatewayValueRedaction(
            {
                diagnostics: 'api_key:sk-assignment-secret-that-must-not-leak',
            },
            { surface: 'unit', rootPath: 'snapshot' },
        );

        assert.equal(publicRefsAudit.ok, true);
        assert.equal(publicRefsAudit.leakCount, 0);
        assert.equal(assignedSecretAudit.ok, false);
        assert.equal(assignedSecretAudit.leakCount, 1);
        assert.equal(JSON.stringify(assignedSecretAudit).includes('sk-assignment-secret-that-must-not-leak'), false);
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

    it('applies raw payload storage policy before persistence', () => {
        const inline = createSanitizedRawPayloadRef({
            providerId: 'openrouter',
            sourceId: 'openrouter-models',
            payload: { data: [{ id: 'm' }] },
            storagePolicy: { maxInlineBytes: 1024 },
        });
        const hashOnly = createSanitizedRawPayloadRef({
            providerId: 'openrouter',
            sourceId: 'openrouter-models',
            payload: { data: [{ id: 'm', token: 'sk-secret-that-must-not-leak', text: 'x'.repeat(128) }] },
            storagePolicy: { maxInlineBytes: 8 },
        });
        const forcedHashOnly = createSanitizedRawPayloadRef({
            providerId: 'openrouter',
            sourceId: 'openrouter-models',
            payload: { data: [{ id: 'm' }] },
            storagePolicy: { mode: MODEL_GATEWAY_RAW_PAYLOAD_STORAGE_POLICY.HASH_ONLY },
        });

        assert.equal(inline.storagePolicy, MODEL_GATEWAY_RAW_PAYLOAD_STORAGE_POLICY.INLINE_SANITIZED);
        assert.notEqual(inline.sanitizedPayload, null);
        assert.equal(hashOnly.storagePolicy, MODEL_GATEWAY_RAW_PAYLOAD_STORAGE_POLICY.HASH_ONLY);
        assert.equal(hashOnly.sanitizedPayload, null);
        assert.match(hashOnly.payloadSha256, /^[a-f0-9]{64}$/u);
        assert.equal(forcedHashOnly.storagePolicy, MODEL_GATEWAY_RAW_PAYLOAD_STORAGE_POLICY.HASH_ONLY);
        assert.equal(forcedHashOnly.sanitizedPayload, null);
        assert.equal(JSON.stringify({ inline, hashOnly, forcedHashOnly }).includes('sk-secret-that-must-not-leak'), false);
    });

    it('creates catalog tombstones for removed projections', () => {
        const previous = [
            createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'meta/llama-3.1:free',
                displayName: 'Llama Free',
            }),
        ];
        const next = [];
        const diff = diffCanonicalModelProjections(previous, next);
        const tombstones = createCatalogModelTombstones({
            diff,
            previousProjections: previous,
            observedAt: '2026-05-26T12:00:00.000Z',
        });

        assert.deepEqual(diff.removed, ['openrouter:meta/llama-3.1:free:default']);
        assert.equal(tombstones.length, 1);
        assert.equal(tombstones[0].projectionKey, 'openrouter:meta/llama-3.1:free:default');
        assert.equal(tombstones[0].providerId, 'openrouter');
        assert.equal(tombstones[0].providerModel, 'meta/llama-3.1:free');
        assert.equal(tombstones[0].routeProfile, 'default');
        assert.equal(tombstones[0].reason, 'catalog_removed');
        assert.equal(tombstones[0].lastProjection?.displayName, 'Llama Free');
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

    it('plans recommended probes under cost and kind constraints before runtime', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'priced/model',
            capabilities: { tools: true, streaming: true, jsonMode: true },
            pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
        });
        const recommendation = {
            key: 'openrouter:priced/model:default',
            providerId: 'openrouter',
            providerModel: 'priced/model',
            routeProfile: 'default',
            priority: 'high',
            probeKinds: ['json', 'agent'],
            reasons: ['structured_output_capability', 'agentic_capability'],
            commands: ['/byok probe json model:priced/model', '/byok probe agent model:priced/model'],
        };

        assert.equal(estimateProbeCostUsd(projection, 'json'), 0.0028);
        const plan = planCostBoundedCatalogProbes({
            recommendations: [recommendation],
            projections: [projection],
            allowedProbeKinds: ['json', 'agent'],
            maxEstimatedCostUsd: 0.003,
        });

        assert.deepEqual(
            plan.selected.map((item) => [item.kind, item.command, item.estimatedCostUsd]),
            [['json', '/byok probe json model:priced/model', 0.0028]],
        );
        assert.deepEqual(
            plan.skipped.map((item) => [item.kind, item.reason]),
            [['agent', 'probe_cost_limit_reached']],
        );
        assert.equal(plan.totalProbeCount, 1);
        assert.equal(plan.totalEstimatedCostUsd, 0.0028);
    });

    it('defers recommended probes during active account, runtime rate-limit or recent probe-failure windows', () => {
        const recommendations = [
            {
                key: 'openrouter:priced/model:default',
                providerId: 'openrouter',
                providerModel: 'priced/model',
                routeProfile: 'default',
                probeKinds: ['chat'],
                reasons: ['catalog_changed'],
            },
            {
                key: 'groq:fast/model:default',
                providerId: 'groq',
                providerModel: 'fast/model',
                routeProfile: 'default',
                probeKinds: ['json'],
                reasons: ['capabilities_changed'],
            },
            {
                key: 'kilo-code:moonshotai/kimi-k2.6:free:kilo',
                providerId: 'kilo-code',
                providerModel: 'moonshotai/kimi-k2.6:free',
                routeProfile: 'kilo',
                probeKinds: ['agent'],
                reasons: ['agentic_capability'],
            },
        ];
        const plan = planModelGatewayProbeBackoff({
            recommendations,
            accountOverlays: [
                createProviderAccountOverlay({
                    providerId: 'openrouter',
                    rateLimits: { remainingRequests: 0, resetAt: '2026-05-25T00:05:00.000Z' },
                }),
            ],
            healthRecords: [
                {
                    providerId: 'groq',
                    providerModel: 'fast/model',
                    routeProfile: 'default',
                    lastFailureKind: 'rate-limit',
                    lastFailureAt: Date.parse('2026-05-25T00:00:30.000Z'),
                    lastResetAt: '2026-05-25T00:03:00.000Z',
                },
                {
                    providerId: 'kilo-code',
                    providerModel: 'moonshotai/kimi-k2.6:free',
                    routeProfile: 'kilo',
                    agentProbeStatus: 'failed',
                    lastAgentProbeFailureAt: Date.parse('2026-05-25T00:00:00.000Z'),
                    lastAgentProbeMessage: 'agent probe empty',
                    probes: {
                        agent: {
                            kind: 'agent',
                            status: 'empty',
                            ok: false,
                            providerAttempted: true,
                            lastAt: Date.parse('2026-05-25T00:00:00.000Z'),
                        },
                    },
                },
            ],
            now: '2026-05-25T00:01:00.000Z',
            probeFailureCooldownSeconds: 900,
        });

        assert.equal(plan.summary.ready, 0);
        assert.equal(plan.summary.deferred, 3);
        assert.deepEqual(plan.deferred.map((item) => item.reason).sort(), [
            'account_rate_limited',
            'runtime_probe_failed_recent',
            'runtime_rate_limited',
        ]);
        assert.equal(plan.deferred[0].resetAt, '2026-05-25T00:05:00.000Z');
        assert.deepEqual(
            plan.deferred
                .filter((item) => item.reason === 'runtime_probe_failed_recent')
                .map((item) => [item.probeKind, item.retryAfterSeconds, item.resetAt]),
            [['agent', 840, '2026-05-25T00:15:00.000Z']],
        );
    });

    it('summarizes metadata coverage by provider before runtime', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'policy-rich',
            capabilities: { tools: true, structuredOutputs: true },
            supportedParameters: ['tools', 'response_format'],
            limits: { contextWindowTokens: 128_000 },
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
            rateLimits: { requestsPerMinute: 60, tokensPerMinute: 120_000 },
            dataPolicy: { training: false, retainsPrompts: false },
        });
        const evidence = createModelMetadataEvidence({
            evidenceId: 'ev-policy-rich',
            providerId: 'openrouter',
            providerModel: 'policy-rich',
            fieldPath: 'pricing.inputUsdPerMillion',
            value: 1,
            sourceId: 'openrouter-models',
        });
        const route = createModelRouteOption({
            providerId: 'openrouter',
            providerModel: 'policy-rich',
            selectorKind: 'aggregator_auto',
            selectorSyntax: 'policy-rich',
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'openrouter',
            secretRef: 'OPEN_ROUTER_KEY',
            enabledModels: ['policy-rich'],
        });
        const decision = createModelEligibilityDecision({
            providerId: 'openrouter',
            providerModel: 'policy-rich',
            include: true,
        });

        const summary = summarizeModelGatewayMetadataCoverage({
            projections: [projection],
            evidences: [evidence],
            routeOptions: [route],
            accountOverlays: [overlay],
            modelEligibilityDecisions: [decision],
        });
        const metrics = projectModelGatewayMetadataCoverageMetrics(summary);

        assert.equal(summary.providerCount, 1);
        assert.equal(summary.providers[0]?.routeCoverageRatio, 1);
        assert.equal(summary.pricingKnownModelCount, 1);
        assert.equal(summary.dataPolicyKnownModelCount, 1);
        assert.equal(summary.runtimeAgenticTaxonomyModelCount, 1);
        assert.equal(summary.pricingTaxonomyModelCount, 1);
        assert.equal(summary.rateLimitTaxonomyModelCount, 1);
        assert.equal(summary.dataPolicyTaxonomyModelCount, 1);
        assert.equal(metrics.gauges['model_gateway.catalog.coverage.provider.openrouter.route_options'], 1);
        assert.equal(metrics.gauges['model_gateway.catalog.coverage.models.runtime_agentic_taxonomy'], 1);
        assert.equal(metrics.gauges['model_gateway.catalog.coverage.provider.openrouter.rate_limit_taxonomy'], 1);
        assert.equal(metrics.gauges['model_gateway.catalog.coverage.route_ratio'], 1);
    });

    it('projects provider freshness metrics from catalog sources before runtime', () => {
        const summary = summarizeModelGatewayProviderFreshness(
            {
                sources: [
                    {
                        id: 'openrouter-models',
                        providerId: 'openrouter',
                        kind: 'public_api',
                        ttlSeconds: 3600,
                        updatedAt: '2026-05-25T11:45:00.000Z',
                    },
                    {
                        id: 'openrouter-pricing',
                        providerId: 'openrouter',
                        kind: 'docs_seed',
                        ttlSeconds: 3600,
                        updatedAt: '2026-05-25T10:00:00.000Z',
                    },
                    {
                        id: 'kilo-models',
                        providerId: 'kilo',
                        kind: 'gateway',
                        updatedAt: '2026-05-25T11:00:00.000Z',
                    },
                ],
            },
            { now: new Date('2026-05-25T12:00:00.000Z') },
        );
        const metrics = projectModelGatewayProviderFreshnessMetrics(summary);

        assert.equal(summary.providerCount, 2);
        assert.equal(summary.sourceCount, 3);
        assert.equal(summary.expiredSourceCount, 1);
        assert.equal(summary.providers.find((provider) => provider.providerId === 'openrouter')?.oldestAgeSeconds, 7200);
        assert.equal(metrics.gauges['model_gateway.catalog.freshness.sources.expired'], 1);
        assert.equal(metrics.gauges['model_gateway.catalog.freshness.provider.openrouter.sources'], 2);
        assert.equal(metrics.gauges['model_gateway.catalog.freshness.provider.openrouter.age_seconds.newest'], 900);
        assert.equal(metrics.gauges['model_gateway.catalog.freshness.provider.kilo.sources.ttl_known'], 0);
    });

    it('creates stable catalog snapshot ids independent from array order and generated time', () => {
        const source = createProviderCatalogSource({
            id: 'openrouter-models',
            providerId: 'openrouter',
            kind: 'public_api',
            url: 'https://openrouter.ai/api/v1/models',
        });
        const first = {
            schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
            generatedAt: '2026-05-26T00:00:00.000Z',
            source: 'first',
            sources: [source],
            projections: [
                createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'b' }),
                createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'a' }),
            ],
        };
        const second = {
            schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
            generatedAt: '2026-05-26T01:00:00.000Z',
            source: 'second',
            sources: [source],
            projections: [
                createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'a' }),
                createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'b' }),
            ],
        };

        assert.equal(createModelGatewayCatalogSnapshotId(first), createModelGatewayCatalogSnapshotId(second));
        assert.equal(normalizeStoredCatalogSnapshot(first).snapshotId, createModelGatewayCatalogSnapshotId(first));
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
                    {
                        runId: 'run-raw',
                        providerId: 'openrouter',
                        sourceId: source.id,
                        status: 'failed',
                        errors: ['nested raw sk-raw-secret-that-must-not-leak'],
                    },
                ],
                conflicts: [
                    {
                        conflictKey: 'conflict-raw',
                        projectionKey: 'openrouter:m:default',
                        fieldPath: 'providerMetadata.diagnostic',
                        diagnostic: 'provider returned Bearer sk-conflict-secret-that-must-not-leak',
                    },
                ],
            });
            const raw = await readFile(filePath, 'utf8');
            const loaded = await store.readSnapshot();

            assert.equal(raw.includes('sk-secret-that-must-not-leak'), false);
            assert.equal(raw.includes('sk-raw-secret-that-must-not-leak'), false);
            assert.equal(raw.includes('sk-conflict-secret-that-must-not-leak'), false);
            assert.equal(loaded.source, 'unit-test');
            assert.equal(loaded.sources.length, 1);
            assert.equal(loaded.evidences.length, 1);
            assert.equal(loaded.projections.length, 1);
            assert.equal(loaded.projections[0].limits.contextWindowTokens, 131072);
            assert.equal(loaded.rawPayloadRefs.length, 1);
            assert.equal(loaded.importRuns.length, 2);
            assert.equal(loaded.modelEligibilityRuns.length, 1);
            assert.equal(loaded.modelEligibilityDecisions.length, 1);
            assert.equal(JSON.stringify(loaded.modelEligibilityRuns).includes('sk-secret-that-must-not-leak'), false);
            assert.equal(JSON.stringify(loaded).includes('sk-raw-secret-that-must-not-leak'), false);
            assert.equal(JSON.stringify(loaded).includes('sk-conflict-secret-that-must-not-leak'), false);
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
            db.prepare(
                `
                    INSERT INTO copilot_model_gateway_refresh_log_events
                        (event_key, run_id, phase, status, provider_id, importer_id, source_id,
                         progress_pct, observed_at_ms, elapsed_ms, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                'refresh-log-1',
                'refresh-run-1',
                'importer:importer_completed',
                'completed',
                'openrouter',
                'openrouter-models',
                'openrouter-models',
                100,
                10,
                500,
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
                selectorKind: 'gateway_policy',
                selectorSyntax: 'anthropic/claude-sonnet-4.5:fastest',
                normalizedPolicy: { routeLayer: 'gateway', wireApi: 'openai_chat_completions' },
            });
            const economyRoute = createModelRouteOption({
                providerId: 'kilo',
                providerModel: 'anthropic/claude-sonnet-4.5',
                routeProfile: 'kilo-free',
                selectorKind: 'gateway_policy',
                selectorSyntax: 'anthropic/claude-sonnet-4.5:economy',
                normalizedPolicy: { routeLayer: 'gateway', wireApi: 'openai_chat_completions' },
            });
            const overlay = createProviderAccountOverlay({
                providerId: 'kilo',
                secretRef: 'KILO_API_KEY',
                enabledModels: ['anthropic/claude-sonnet-4.5'],
                quota: { remainingCreditsUsd: 0 },
                rateLimits: { remainingRequests: 0, retryAfterSeconds: 60 },
                spendingLimits: { remainingUsd: 0 },
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
                selectorKind: 'gateway_policy',
                selectorSyntax: 'anthropic/claude-sonnet-4.5:fastest',
                include: true,
                reasons: ['account_model_visible'],
                policyInputs: { apiKey: 'sk-secret-that-must-not-leak' },
            });
            const economyEligibility = createModelEligibilityDecision({
                providerId: 'kilo',
                providerModel: 'anthropic/claude-sonnet-4.5',
                routeProfile: 'kilo-free',
                selectorKind: 'gateway_policy',
                selectorSyntax: 'anthropic/claude-sonnet-4.5:economy',
                include: true,
                reasons: ['account_model_visible'],
                policyInputs: { apiKey: 'sk-secret-that-must-not-leak' },
            });
            const store = new SqliteModelGatewayCatalogStore({ db });

            const snapshot = {
                source: 'sqlite-unit-test',
                sources: [source],
                evidences: [evidence],
                routeOptions: [route, economyRoute],
                accountOverlays: [overlay],
                projections: [projection],
                modelEligibilityRuns: [
                    createModelEligibilityRun({
                        runId: 'eligibility-run-sqlite',
                        modelCount: 2,
                        eligibleCount: 2,
                    }),
                ],
                modelEligibilityDecisions: [eligibility, economyEligibility],
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
            assert.equal(loaded.routeOptions.length, 2);
            assert.equal(loaded.accountOverlays.length, 1);
            assert.equal(loaded.projections.length, 1);
            assert.equal(loaded.modelEligibilityRuns.length, 1);
            assert.equal(loaded.modelEligibilityDecisions.length, 2);
            assert.deepEqual(
                loaded.modelEligibilityDecisions.map((decision) => decision.selectorSyntax).sort(),
                ['anthropic/claude-sonnet-4.5:economy', 'anthropic/claude-sonnet-4.5:fastest'],
            );
            assert.equal(
                db.prepare('SELECT COUNT(*) AS count FROM copilot_model_gateway_eligibility_decisions').get().count,
                2,
            );
            assert.equal(openai.object, 'list');
            assert.equal(openai.data.length, 1);
            assert.equal(openai.data[0].x_model_gateway.eligibility.status, 'eligible');
            const quotaStatus = /** @type {{ status: string }} */ (
                db.prepare('SELECT status FROM copilot_model_gateway_account_quota_snapshots').get()
            );
            const rateLimitStatus = /** @type {{ status: string }} */ (
                db.prepare('SELECT status FROM copilot_model_gateway_account_rate_limit_snapshots').get()
            );
            const spendingStatus = /** @type {{ status: string }} */ (
                db.prepare('SELECT status FROM copilot_model_gateway_account_spending_snapshots').get()
            );
            assert.equal(quotaStatus.status, 'exhausted');
            assert.equal(rateLimitStatus.status, 'limited');
            assert.equal(spendingStatus.status, 'exhausted');
            assert.equal(JSON.stringify(loaded).includes('sk-secret-that-must-not-leak'), false);
            assert.equal(JSON.stringify(serializedRows).includes('secret-token-that-must-not-leak'), false);
        } finally {
            db.close();
        }
    });

    it('keeps SQLite operational history across catalog rewrites and tolerates duplicate snapshot keys', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const duplicateEvidenceA = createModelMetadataEvidence({
                evidenceId: 'duplicate-evidence',
                providerId: 'openrouter',
                providerModel: 'model-a',
                fieldPath: 'displayName',
                value: 'Model A',
                sourceId: 'openrouter-models',
            });
            const duplicateEvidenceB = createModelMetadataEvidence({
                evidenceId: 'duplicate-evidence',
                providerId: 'openrouter',
                providerModel: 'model-a',
                fieldPath: 'displayName',
                value: 'Model A Updated',
                sourceId: 'openrouter-models',
            });
            const overlayOk = createProviderAccountOverlay({
                providerId: 'openrouter',
                secretRef: 'OPENROUTER_API_KEY',
                observedAt: '2026-05-26T10:00:00.000Z',
                quota: { remainingRequests: 10 },
                rateLimits: { remainingRequests: 10 },
                spendingLimits: { remainingUsd: 5 },
            });
            const overlayLimited = createProviderAccountOverlay({
                providerId: 'openrouter',
                secretRef: 'OPENROUTER_API_KEY',
                observedAt: '2026-05-26T11:00:00.000Z',
                quota: { remainingRequests: 0 },
                rateLimits: { remainingRequests: 0, resetAt: '2026-05-26T11:05:00.000Z' },
                spendingLimits: { remainingUsd: 0 },
            });

            await store.writeRouteDecisionEvents([{ decisionId: 'route-1', providerId: 'openrouter', modelId: 'model-a', selected: true }]);
            await store.writeRuntimeHealthRecords([
                {
                    key: 'default|openrouter|model-a',
                    providerId: 'openrouter',
                    providerModel: 'model-a',
                    lastStatus: 'ok',
                    lastSuccessAt: 1_000,
                    probes: { chat: { ok: true, status: 'ok', lastAt: 1_000 } },
                },
            ]);
            await store.writeSnapshot({
                source: 'first-catalog',
                generatedAt: null,
                evidences: [duplicateEvidenceA, duplicateEvidenceB],
                accountOverlays: [overlayOk],
                projections: [createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'model-a' })],
            });
            const firstLoaded = await store.readSnapshot();
            await store.writeSnapshot({
                source: 'second-catalog',
                accountOverlays: [overlayLimited],
                projections: [
                    createCanonicalModelProjection({
                        providerId: 'openrouter',
                        providerModel: 'model-a',
                        lifecycle: { status: 'active' },
                    }),
                ],
            });

            const loaded = await store.readSnapshot();
            const routeDecisions = await store.readRouteDecisionEvents({ limit: 5 });
            const runtime = await store.readRuntimeHealthForModel({ providerId: 'openrouter', providerModel: 'model-a' });
            const diagnostics = await store.readStorageDiagnostics();
            const quotaRows = /** @type {{ count: number } | undefined} */ (
                db.prepare('SELECT COUNT(*) AS count FROM copilot_model_gateway_account_quota_snapshots').get()
            );
            const rateRows = /** @type {{ count: number } | undefined} */ (
                db.prepare('SELECT COUNT(*) AS count FROM copilot_model_gateway_account_rate_limit_snapshots').get()
            );
            const latestRate = /** @type {{ status: string } | undefined} */ (
                db.prepare(
                    'SELECT status FROM copilot_model_gateway_account_rate_limit_snapshots ORDER BY observed_at_ms DESC LIMIT 1',
                ).get()
            );
            const lifecycleRow = /** @type {{ lifecycle_status: string } | undefined} */ (
                db.prepare('SELECT lifecycle_status FROM copilot_model_gateway_model_projections WHERE provider_model = ?').get('model-a')
            );

            assert.equal(firstLoaded.evidences.length, 1);
            assert.equal(firstLoaded.evidences[0].value, 'Model A Updated');
            assert.equal(loaded.source, 'second-catalog');
            assert.equal(typeof loaded.generatedAt, 'string');
            assert.equal(loaded.evidences.length, 0);
            assert.equal(routeDecisions.length, 1);
            assert.equal(routeDecisions[0].decisionId, 'route-1');
            assert.equal(runtime.health?.['lastStatus'], 'ok');
            assert.equal(runtime.probes.length, 1);
            assert.equal(quotaRows?.count, 2);
            assert.equal(rateRows?.count, 2);
            assert.equal(latestRate?.status, 'limited');
            assert.equal(lifecycleRow?.lifecycle_status, 'active');
            assert.equal(diagnostics.activeSnapshot.exists, true);
            assert.equal(diagnostics.activeSnapshot.source, 'second-catalog');
            assert.equal(diagnostics.accountHistoryRows, 6);
            assert.equal(diagnostics.runtimeRows, 3);
            assert.equal(diagnostics.routeDecisionRows, 1);
            assert.equal(diagnostics.refreshLogRows, 0);
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

            const secretEvent = {
                ...event,
                diagnostic: 'provider returned Bearer sk-route-secret-that-must-not-leak',
            };

            const summary = await store.writeRouteDecisionEvents([secretEvent]);
            await store.writeRouteDecisionEvents([secretEvent]);
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
            assert.equal(JSON.stringify(loaded).includes('sk-route-secret-that-must-not-leak'), false);
        } finally {
            db.close();
        }
    });

    it('persists sanitized refresh JSONL events in the SQLite operational log layer', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const text = [
                JSON.stringify({
                    ts: '2026-05-26T12:00:00.000Z',
                    phase: 'refresh_started',
                    token: 'sk-secret-that-must-not-leak',
                }),
                JSON.stringify({
                    ts: '2026-05-26T12:00:01.000Z',
                    phase: 'importer:importer_completed',
                    importer: { providerId: 'openrouter', importerId: 'openrouter-models', sourceId: 'openrouter-models' },
                    progress: { pct: 100 },
                    rowCount: 2,
                    evidenceCount: 7,
                }),
                JSON.stringify({
                    ts: '2026-05-26T12:00:02.000Z',
                    phase: 'refresh_completed',
                    elapsedMs: 2_000,
                    committed: true,
                    projectionCount: 42,
                }),
                'not-json',
            ].join('\n');

            const summary = await store.writeRefreshLogText(text, {
                logPath: 'logs/model-gateway-refresh/unit.jsonl',
                runId: 'refresh-unit',
            });
            const loaded = await store.readRefreshLogEvents({ runId: 'refresh-unit' });
            const diagnostics = await store.readStorageDiagnostics();
            const serializedRows = /** @type {{ payload: string | null } | undefined} */ (
                db.prepare('SELECT group_concat(payload_json, char(10)) AS payload FROM copilot_model_gateway_refresh_log_events').get()
            );
            const completedRow = /** @type {{ status: string; elapsed_ms: number } | undefined} */ (
                db.prepare(
                    'SELECT status, elapsed_ms FROM copilot_model_gateway_refresh_log_events WHERE phase = ?',
                ).get('refresh_completed')
            );

            assert.equal(summary.runId, 'refresh-unit');
            assert.equal(summary.refreshLogEvents, 3);
            assert.equal(summary.invalidLineCount, 1);
            assert.equal(summary.completed, true);
            assert.equal(summary.committed, true);
            assert.equal(loaded.length, 3);
            assert.equal(diagnostics.refreshLogRows, 3);
            assert.equal(completedRow?.status, 'completed');
            assert.equal(completedRow?.elapsed_ms, 2_000);
            assert.equal(JSON.stringify(serializedRows).includes('sk-secret-that-must-not-leak'), false);
        } finally {
            db.close();
        }
    });

    it('applies explicit SQLite operational retention without touching canonical catalog rows', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            await store.writeSnapshot({
                source: 'retention-catalog',
                projections: [createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'model-a' })],
            });
            for (const table of [
                'copilot_model_gateway_account_quota_snapshots',
                'copilot_model_gateway_account_rate_limit_snapshots',
                'copilot_model_gateway_account_spending_snapshots',
            ]) {
                const hasReset = table.includes('rate_limit');
                const statement = db.prepare(
                    hasReset
                        ? `
                            INSERT INTO ${table}
                                (snapshot_key, account_overlay_id, provider_id, account_scope, secret_ref, status,
                                 reset_at_ms, observed_at_ms, expires_at_ms, payload_json)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `
                        : `
                            INSERT INTO ${table}
                                (snapshot_key, account_overlay_id, provider_id, account_scope, secret_ref, status,
                                 observed_at_ms, expires_at_ms, payload_json)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `,
                );
                for (const observedAt of [1, 2, 3]) {
                    /** @type {unknown[]} */
                    const args = [
                        `${table}:${observedAt}`,
                        'overlay',
                        'openrouter',
                        'default',
                        'OPENROUTER_API_KEY',
                        'ok',
                    ];
                    if (hasReset) args.push(null);
                    args.push(observedAt, null, '{}');
                    statement.run(...args);
                }
            }
            await store.writeRouteDecisionEvents([
                { decisionId: 'route-1', timestamp: 1, providerId: 'openrouter', modelId: 'model-a', selected: true },
                { decisionId: 'route-2', timestamp: 2, providerId: 'openrouter', modelId: 'model-b', selected: false },
                { decisionId: 'route-3', timestamp: 3, providerId: 'openrouter', modelId: 'model-c', selected: false },
            ]);
            await store.writeRefreshLogEvents(
                [
                    { eventId: 'refresh-1', ts: 1, phase: 'refresh_started' },
                    { eventId: 'refresh-2', ts: 2, phase: 'importer:importer_completed' },
                    { eventId: 'refresh-3', ts: 3, phase: 'refresh_completed' },
                ],
                { runId: 'retention-run' },
            );
            for (const observedAt of [1, 2, 3]) {
                db.prepare(
                    `
                        INSERT INTO copilot_model_gateway_runtime_probe_runs
                            (run_id, probe_profile, account_scope, status, started_at_ms, completed_at_ms,
                             model_count, success_count, failure_count, skipped_count, payload_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(`probe-run-${observedAt}`, 'retention', 'default', 'completed', observedAt, observedAt, 1, 1, 0, 0, '{}');
                db.prepare(
                    `
                        INSERT INTO copilot_model_gateway_runtime_probe_results
                            (result_key, run_id, provider_id, provider_model, route_profile, probe_kind, ok,
                             status, observed_at_ms, expires_at_ms, payload_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    `probe-result-${observedAt}`,
                    `probe-run-${observedAt}`,
                    'openrouter',
                    `model-${observedAt}`,
                    'default',
                    'chat',
                    1,
                    'ok',
                    observedAt,
                    null,
                    '{}',
                );
                db.prepare(
                    `
                        INSERT INTO copilot_model_gateway_health_observations
                            (observation_key, provider_id, provider_model, route_profile, health_scope, status,
                             classified_failure, observed_at_ms, expires_at_ms, payload_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    `health-${observedAt}`,
                    'openrouter',
                    `model-${observedAt}`,
                    'default',
                    'runtime',
                    'ok',
                    null,
                    observedAt,
                    null,
                    '{}',
                );
            }

            const result = await store.applyOperationalRetention({
                accountHistoryMaxRowsPerTable: 1,
                routeDecisionMaxRows: 1,
                refreshLogMaxRows: 1,
                runtimeProbeRunMaxRows: 1,
                runtimeProbeResultMaxRows: 1,
                healthObservationMaxRows: 1,
            });
            const diagnostics = await store.readStorageDiagnostics();
            const loaded = await store.readSnapshot();

            assert.equal(DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.refreshLogMaxRows > 1, true);
            assert.equal(DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.healthObservationMaxRows > 1, true);
            assert.equal(result.deletedRows, 16);
            assert.equal(diagnostics.catalogRows > 0, true);
            assert.equal(diagnostics.accountHistoryRows, 3);
            assert.equal(diagnostics.routeDecisionRows, 1);
            assert.equal(diagnostics.refreshLogRows, 1);
            assert.equal(diagnostics.runtimeRows, 3);
            assert.equal(loaded.projections.length, 1);
        } finally {
            db.close();
        }
    });

    it('applies separate SQLite retention limits for quota, rate-limit and spending snapshots', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            await store.writeSnapshot({
                source: 'separate-account-retention',
                projections: [createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'model-a' })],
            });
            for (const [table, hasReset] of [
                ['copilot_model_gateway_account_quota_snapshots', false],
                ['copilot_model_gateway_account_rate_limit_snapshots', true],
                ['copilot_model_gateway_account_spending_snapshots', false],
            ]) {
                const statement = db.prepare(
                    hasReset
                        ? `
                            INSERT INTO ${table}
                                (snapshot_key, account_overlay_id, provider_id, account_scope, secret_ref, status,
                                 reset_at_ms, observed_at_ms, expires_at_ms, payload_json)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `
                        : `
                            INSERT INTO ${table}
                                (snapshot_key, account_overlay_id, provider_id, account_scope, secret_ref, status,
                                 observed_at_ms, expires_at_ms, payload_json)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `,
                );
                for (const observedAt of [1, 2, 3, 4]) {
                    const args = [`${table}:${observedAt}`, 'overlay', 'openrouter', 'default', 'OPENROUTER_API_KEY', 'ok'];
                    if (hasReset) args.push(null);
                    args.push(observedAt, null, '{}');
                    statement.run(...args);
                }
            }

            const result = await store.applyOperationalRetention({
                accountQuotaSnapshotMaxRows: 1,
                accountRateLimitSnapshotMaxRows: 2,
                accountSpendingSnapshotMaxRows: 3,
                routeDecisionMaxRows: 0,
                refreshLogMaxRows: 0,
                runtimeProbeRunMaxRows: 0,
                runtimeProbeResultMaxRows: 0,
                healthObservationMaxRows: 0,
            });
            const quotaCount = /** @type {{ count: number }} */ (
                db.prepare('SELECT COUNT(*) AS count FROM copilot_model_gateway_account_quota_snapshots').get()
            );
            const rateLimitCount = /** @type {{ count: number }} */ (
                db.prepare('SELECT COUNT(*) AS count FROM copilot_model_gateway_account_rate_limit_snapshots').get()
            );
            const spendingCount = /** @type {{ count: number }} */ (
                db.prepare('SELECT COUNT(*) AS count FROM copilot_model_gateway_account_spending_snapshots').get()
            );
            const counts = {
                quota: quotaCount.count,
                rateLimit: rateLimitCount.count,
                spending: spendingCount.count,
            };

            assert.equal(result.tables['copilot_model_gateway_account_quota_snapshots'].maxRows, 1);
            assert.equal(result.tables['copilot_model_gateway_account_rate_limit_snapshots'].maxRows, 2);
            assert.equal(result.tables['copilot_model_gateway_account_spending_snapshots'].maxRows, 3);
            assert.deepEqual(counts, { quota: 1, rateLimit: 2, spending: 3 });
            assert.equal(result.deletedRows, 6);
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
            assert.equal(mirrored.parity.ok, true);
            assert.equal(mirrored.parity.snapshotIdMatches, true);
            assert.deepEqual(mirrored.parity.countMismatches, []);
            assert.deepEqual(mirrored.parity.keyMismatches, []);
            assert.equal(sqliteSummary.projections, 1);
            assert.equal(sqliteSummary.routeOptions, 1);
            assert.equal(sqliteSummary.modelEligibilityDecisions, 1);
            assert.equal(jsonAfter.projections.length, 1);
            assert.equal(jsonAfter.routeOptions.length, 1);
            const mismatch = compareModelGatewayCatalogSnapshotParity(
                mirrored.sourceSnapshot,
                normalizeStoredCatalogSnapshot({
                    ...mirrored.sqliteSnapshot,
                    projections: [],
                }),
            );
            assert.equal(mismatch.ok, false);
            assert.deepEqual(mismatch.countMismatches, [{ field: 'projections', source: 1, sqlite: 0 }]);
            assert.equal(mismatch.keyMismatches.some((row) => row.field === 'projections'), true);

            const routeKeyMismatch = compareModelGatewayCatalogSnapshotParity(
                mirrored.sourceSnapshot,
                normalizeStoredCatalogSnapshot({
                    ...mirrored.sqliteSnapshot,
                    routeOptions: [
                        {
                            ...mirrored.sqliteSnapshot.routeOptions[0],
                            selectorSyntax: 'openai/gpt-oss-120b:changed',
                        },
                    ],
                }),
            );
            assert.equal(routeKeyMismatch.ok, false);
            assert.deepEqual(routeKeyMismatch.countMismatches, []);
            assert.deepEqual(routeKeyMismatch.keyMismatches, [
                {
                    field: 'routeOptions',
                    missingFromSqlite: ['openrouter:openai/gpt-oss-120b:default:provider_model:openai/gpt-oss-120b'],
                    missingFromSource: [
                        'openrouter:openai/gpt-oss-120b:default:provider_model:openai/gpt-oss-120b:changed',
                    ],
                },
            ]);
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
            const runtimeRecords = await store.listRuntimeHealthRecords();
            const explanation = explainModelGatewayCatalogEntry(snapshot, 'gpt-oss', {
                runtimeHealthRecords: runtime.health ? [runtime.health] : [],
                runtimeProbeResults: runtime.probes,
            });

            assert.equal(mirrored.records, 1);
            assert.equal(mirrored.healthObservations, 1);
            assert.equal(mirrored.probeResults, 2);
            assert.equal(runtimeRecords.length, 1);
            assert.equal(runtime.health?.['lastStatus'], 'ok');
            assert.equal(runtime.probes.length, 2);
            assert.equal(explanation.runtimeHealth?.status, 'ok');
            assert.equal(explanation.runtimeProbes.length, 2);
            assert.equal(explanation.nextActions.includes('run_runtime_probes_for_current_route'), false);
        } finally {
            db.close();
        }
    });

    it('flushes BYOK health before mirroring runtime facts into SQLite on demand', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            recordByokProviderModelCallFailure({
                routeProfile: 'repo_agent',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                message: 'HTTP 429 retry later',
                errorContext: 'unit-runtime',
                failureKind: 'rate-limit',
                failureStatusCode: 429,
                retryAfterSeconds: 30,
                timestamp: 7_000,
            });
            recordByokProviderModelProbeResult({
                routeProfile: 'repo_agent',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                probeKind: 'chat',
                status: 'failed',
                ok: false,
                providerAttempted: true,
                failureKind: 'rate-limit',
                failureStatusCode: 429,
                retryAfterSeconds: 30,
                timestamp: 7_000,
            });

            const mirrored = await flushAndMirrorByokProviderHealthToSqlite({
                sqliteStore: store,
                observedAt: 7_500,
            });
            const runtime = await store.readRuntimeHealthForModel({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
            });

            assert.equal(mirrored.flushed, true);
            assert.equal(mirrored.records, 1);
            assert.equal(mirrored.healthObservations, 1);
            assert.equal(mirrored.probeResults, 1);
            assert.equal(runtime.health?.['lastFailureKind'], 'rate-limit');
            assert.equal(runtime.probes[0]?.['lastFailureKind'], 'rate-limit');
        } finally {
            db.close();
        }
    });

    it('appends runtime health mirror runs and reads the latest health/probe facts per model', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const staleRecord = {
                key: 'default|openrouter|openai/gpt-oss-120b',
                routeProfile: 'default',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                lastStatus: 'failed',
                lastFailureAt: 1_000,
                failureCount: 1,
                successCount: 0,
                probes: {
                    chat: {
                        kind: 'chat',
                        status: 'failed',
                        ok: false,
                        providerAttempted: true,
                        count: 1,
                        successCount: 0,
                        failureCount: 1,
                        lastAt: 1_000,
                    },
                },
            };
            const freshRecord = {
                ...staleRecord,
                lastStatus: 'ok',
                lastSuccessAt: 2_000,
                successCount: 1,
                probes: {
                    chat: {
                        kind: 'chat',
                        status: 'ok',
                        ok: true,
                        providerAttempted: true,
                        count: 2,
                        successCount: 1,
                        failureCount: 1,
                        lastAt: 2_000,
                    },
                },
            };

            await store.writeRuntimeHealthRecords([staleRecord], { runId: 'runtime-run-1', observedAt: 1_000 });
            await store.writeRuntimeHealthRecords([freshRecord], { runId: 'runtime-run-2', observedAt: 2_000 });

            const diagnostics = await store.readStorageDiagnostics();
            const runtime = await store.readRuntimeHealthForModel({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
            });
            const runtimeRecords = await store.listRuntimeHealthRecords();
            const latestRuntimeRecords = await store.listLatestRuntimeHealthRecords();

            assert.equal(diagnostics.runtimeRows, 6);
            assert.equal(diagnostics.runtime.probeRuns, 2);
            assert.equal(diagnostics.runtime.probeResults, 2);
            assert.equal(diagnostics.runtime.healthObservations, 2);
            assert.equal(diagnostics.runtime.latestHealthObservedAtMs, 2_000);
            assert.equal(diagnostics.runtime.latestProbeResultObservedAtMs, 2_000);
            assert.equal(diagnostics.runtime.healthStatusCounts['ok'], 1);
            assert.equal(diagnostics.runtime.healthStatusCounts['failed'], 1);
            assert.equal(diagnostics.runtime.probeStatusCounts['ok'], 1);
            assert.equal(diagnostics.runtime.probeStatusCounts['failed'], 1);
            assert.equal(runtimeRecords.length, 2);
            assert.equal(latestRuntimeRecords.length, 1);
            assert.equal(latestRuntimeRecords[0]?.['runtimeHealthStatus'], 'ok');
            assert.equal(runtime.health?.['lastStatus'], 'ok');
            assert.equal(runtime.probes.length, 1);
            assert.equal(runtime.probes[0]?.['status'], 'ok');
        } finally {
            db.close();
        }
    });

    it('uses collision-resistant runtime observation keys instead of raw concatenation', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            await store.writeRuntimeHealthRecords(
                [
                    {
                        key: 'c',
                        routeProfile: 'default',
                        providerId: 'openrouter',
                        providerModel: 'model-c',
                        lastStatus: 'ok',
                        lastSuccessAt: 1_000,
                    },
                ],
                { runId: 'a:b', observedAt: 1_000 },
            );
            await store.writeRuntimeHealthRecords(
                [
                    {
                        key: 'b:c',
                        routeProfile: 'default',
                        providerId: 'openrouter',
                        providerModel: 'model-bc',
                        lastStatus: 'ok',
                        lastSuccessAt: 2_000,
                    },
                ],
                { runId: 'a', observedAt: 2_000 },
            );

            const diagnostics = await store.readStorageDiagnostics();
            const runtimeRecords = await store.listRuntimeHealthRecords();

            assert.equal(diagnostics.runtimeRows, 4);
            assert.equal(runtimeRecords.length, 2);
        } finally {
            db.close();
        }
    });

    it('generates unique default runtime health run ids for same-millisecond writes', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const first = await store.writeRuntimeHealthRecords(
                [
                    {
                        key: 'default|openrouter|model-a',
                        routeProfile: 'default',
                        providerId: 'openrouter',
                        providerModel: 'model-a',
                        lastStatus: 'ok',
                        lastSuccessAt: 1_000,
                    },
                ],
                { observedAt: 3_000 },
            );
            const second = await store.writeRuntimeHealthRecords(
                [
                    {
                        key: 'default|openrouter|model-b',
                        routeProfile: 'default',
                        providerId: 'openrouter',
                        providerModel: 'model-b',
                        lastStatus: 'ok',
                        lastSuccessAt: 1_000,
                    },
                ],
                { observedAt: 3_000 },
            );

            const diagnostics = await store.readStorageDiagnostics();

            assert.notEqual(first.runId, second.runId);
            assert.equal(diagnostics.runtimeRows, 4);
        } finally {
            db.close();
        }
    });

    it('skips malformed runtime health records instead of failing the SQLite mirror write', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const result = await store.writeRuntimeHealthRecords(
                [
                    {
                        key: 'default|openrouter|model-a',
                        routeProfile: 'default',
                        providerId: 'openrouter',
                        providerModel: 'model-a',
                        lastStatus: 'ok',
                        lastSuccessAt: 1_000,
                        lastMessage: 'provider returned Bearer sk-runtime-secret-that-must-not-leak',
                        probes: {
                            chat: {
                                status: 'failed',
                                ok: false,
                                lastAt: 1_000,
                                lastMessage: 'probe leaked token sk-probe-secret-that-must-not-leak',
                            },
                        },
                    },
                    {
                        key: 'default|missing-provider-model|-',
                        routeProfile: 'default',
                        lastStatus: 'failed',
                        lastFailureAt: 1_000,
                    },
                    /** @type {Record<string, unknown>} */ (null),
                ],
                { runId: 'runtime-malformed-records', observedAt: 1_000 },
            );
            const diagnostics = await store.readStorageDiagnostics();
            const runRow = /** @type {{ model_count: number; skipped_count: number; payload_json: string } | undefined} */ (
                db
                    .prepare(
                        'SELECT model_count, skipped_count, payload_json FROM copilot_model_gateway_runtime_probe_runs WHERE run_id = ?',
                    )
                    .get('runtime-malformed-records')
            );
            const storedPayloads = /** @type {Array<{ payload_json: string }>} */ (
                db
                    .prepare(
                        `
                            SELECT payload_json FROM copilot_model_gateway_health_observations
                            UNION ALL
                            SELECT payload_json FROM copilot_model_gateway_runtime_probe_results
                            UNION ALL
                            SELECT payload_json FROM copilot_model_gateway_runtime_probe_runs
                        `,
                    )
                    .all()
            );
            const serializedPayloads = JSON.stringify(storedPayloads);

            assert.equal(result.healthObservations, 1);
            assert.equal(result.probeResults, 1);
            assert.equal(result.skippedRecords, 2);
            assert.equal(diagnostics.runtime.healthObservations, 1);
            assert.equal(runRow?.model_count, 1);
            assert.equal(runRow?.skipped_count, 2);
            assert.equal(JSON.parse(runRow?.payload_json ?? '{}').skippedRecords, 2);
            assert.equal(serializedPayloads.includes('sk-runtime-secret-that-must-not-leak'), false);
            assert.equal(serializedPayloads.includes('sk-probe-secret-that-must-not-leak'), false);
        } finally {
            db.close();
        }
    });

    it('audits SQLite payload surfaces for unredacted secret leaks without printing secrets', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        const secret = 'sk-sqlite-audit-secret-that-must-not-leak';
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            await store.writeRouteDecisionEvents([
                {
                    decisionId: 'route-redacted',
                    providerId: 'openrouter',
                    modelId: 'model-a',
                    selected: true,
                    diagnostic: `provider returned ${secret}`,
                },
            ]);
            const clean = await store.auditStoredPayloadRedaction({ additionalSecrets: [secret] });

            db.prepare(
                `
                    UPDATE copilot_model_gateway_route_decisions
                    SET payload_json = ?
                    WHERE decision_id = ?
                `,
            ).run(JSON.stringify({ diagnostic: `manual leak ${secret}` }), 'route-redacted');
            const leaked = await store.auditStoredPayloadRedaction({ additionalSecrets: [secret] });
            const repair = await store.redactStoredPayloadLeaks({ additionalSecrets: [secret] });
            const repaired = await store.auditStoredPayloadRedaction({ additionalSecrets: [secret] });

            assert.equal(clean.ok, true);
            assert.equal(leaked.ok, false);
            assert.equal(leaked.leakCount, 1);
            assert.equal(JSON.stringify(leaked).includes(secret), false);
            assert.equal(leaked.tables.copilot_model_gateway_route_decisions.leakCount, 1);
            assert.equal(repair.updatedRows, 1);
            assert.equal(repaired.ok, true);
        } finally {
            db.close();
        }
    });

    it('derives runtime health status and failure context from generic probe-only records', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const projection = createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'model-streaming',
                capabilities: { streaming: true },
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
            await store.writeRuntimeHealthRecords(
                [
                    {
                        key: 'default|openrouter|model-streaming',
                        routeProfile: 'default',
                        providerId: 'openrouter',
                        providerModel: 'model-streaming',
                        probes: {
                            streaming: {
                                kind: 'streaming',
                                status: 'failed',
                                ok: false,
                                providerAttempted: true,
                                count: 1,
                                successCount: 0,
                                failureCount: 1,
                                lastAt: 5_000,
                                lastFailureKind: 'rate-limit',
                                lastErrorContext: 'streaming_probe',
                            },
                        },
                    },
                ],
                { runId: 'runtime-probe-only', observedAt: 1_000 },
            );

            const runtime = await store.readRuntimeHealthForModel({
                providerId: 'openrouter',
                providerModel: 'model-streaming',
            });
            const explanation = explainModelGatewayCatalogEntry(snapshot, 'model-streaming', {
                runtimeHealthRecords: runtime.health ? [runtime.health] : [],
                runtimeProbeResults: runtime.probes,
            });

            assert.equal(runtime.health?.['lastStatus'], undefined);
            assert.equal(runtime.health?.['runtimeHealthStatus'], 'failed');
            assert.equal(runtime.health?.['runtimeClassifiedFailure'], 'rate-limit');
            assert.equal(runtime.health?.['runtimeObservedAtMs'], 5_000);
            assert.equal(runtime.health?.['probes'] && typeof runtime.health['probes'] === 'object', true);
            assert.equal(runtime.probes.length, 1);
            assert.equal(runtime.probes[0]?.['status'], 'failed');
            assert.equal(runtime.probes[0]?.['runtimeObservedAtMs'], 5_000);
            assert.equal(explanation.runtimeHealth?.status, 'failed');
            assert.equal(explanation.nextActions.includes('inspect_or_clear_runtime_health_after_fix'), true);
            const healthRow = /** @type {{ status: string; classified_failure: string; observed_at_ms: number } | undefined} */ (
                db
                    .prepare(
                        'SELECT status, classified_failure, observed_at_ms FROM copilot_model_gateway_health_observations LIMIT 1',
                    )
                    .get()
            );
            assert.equal(healthRow?.status, 'failed');
            assert.equal(healthRow?.classified_failure, 'rate-limit');
            assert.equal(healthRow?.observed_at_ms, 5_000);
        } finally {
            db.close();
        }
    });

    it('installs a storage-neutral runtime health SQLite mirror for new BYOK health facts', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const controller = installByokProviderHealthSqliteMirror({
                sqliteStore: store,
                debounceMs: 0,
                enabled: true,
            });

            recordByokProviderModelCallSuccess({
                routeProfile: 'default',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                successContext: 'unit-test',
                timestamp: 10_000,
            });
            recordByokProviderModelProbeResult({
                routeProfile: 'default',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                probeKind: 'chat',
                status: 'ok',
                ok: true,
                providerAttempted: true,
                timestamp: 10_000,
            });

            const flushed = await controller.flush();
            const runtime = await store.readRuntimeHealthForModel({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
            });
            const runtimeRecords = await store.listRuntimeHealthRecords();
            controller.dispose();

            assert.equal(flushed.enabled, true);
            assert.equal(flushed.flushCount, 1);
            assert.equal(flushed.lastRecords, 1);
            assert.equal(flushed.lastHealthObservations, 1);
            assert.equal(flushed.lastProbeResults, 1);
            assert.equal(flushed.lastSkippedRecords, 0);
            assert.equal(runtimeRecords.length, 1);
            assert.equal(runtime.health?.['lastStatus'], 'ok');
            assert.equal(runtime.probes.length, 1);
        } finally {
            db.close();
        }
    });

    it('does not write runtime health mirror rows when no BYOK health change is pending', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const controller = installByokProviderHealthSqliteMirror({
                sqliteStore: store,
                debounceMs: 0,
                enabled: true,
            });

            const flushed = await controller.flush();
            const diagnostics = await store.readStorageDiagnostics();
            controller.dispose();

            assert.equal(flushed.flushCount, 0);
            assert.equal(flushed.lastRecords, 0);
            assert.equal(diagnostics.runtimeRows, 0);
        } finally {
            db.close();
        }
    });

    it('deduplicates BYOK health records by identity and keeps the freshest observed runtime fact', () => {
        const stale = {
            key: 'default|openrouter|openai/gpt-oss-120b',
            routeProfile: 'default',
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            lastStatus: 'failed',
            lastFailureAt: 1_000,
            failureCount: 1,
            successCount: 0,
        };
        const fresh = {
            key: 'default|openrouter|openai/gpt-oss-120b',
            routeProfile: 'default',
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            lastStatus: 'ok',
            lastSuccessAt: 2_000,
            failureCount: 1,
            successCount: 1,
            probes: {
                chat: {
                    kind: 'chat',
                    status: 'ok',
                    ok: true,
                    providerAttempted: true,
                    count: 1,
                    successCount: 1,
                    failureCount: 0,
                    lastAt: 2_500,
                },
            },
        };

        const records = mergeByokProviderHealthRecords([stale], [fresh]);

        assert.equal(byokProviderHealthRecordKey(fresh), 'default|openrouter|openai/gpt-oss-120b');
        assert.equal(byokProviderHealthRecordLastObservedAt(fresh), 2_500);
        assert.equal(records.length, 1);
        assert.equal(records[0]?.['lastStatus'], 'ok');
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
            { query: 'gpt oss', requireTools: true, requireReasoning: true, onlyEligible: true, limit: 5 },
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
            /** @type {Array<Record<string, any>>} */
            const progressEvents = [];
            const snapshot = await runCatalogImporters({
                store,
                now: () => dates.shift() ?? new Date('2026-05-25T12:00:04.000Z'),
                onProgress: (event) => progressEvents.push(event),
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
            assert.equal(snapshot.accountOverlays.length, 2);
            assert.equal(snapshot.rawPayloadRefs.length, 1);
            assert.deepEqual(
                snapshot.importRuns.map((run) => run.status),
                ['completed', 'failed'],
            );
            assert.equal(loaded.sources.length, 2);
            assert.equal(loaded.evidences[0].value, 131072);
            assert.deepEqual(
                loaded.accountOverlays.find((overlay) => overlay['providerId'] === 'openrouter')?.['enabledModels'],
                ['m'],
            );
            assert.equal(
                loaded.accountOverlays.some(
                    (overlay) =>
                        overlay['providerId'] === 'groq' &&
                        overlay['sourceId'] === 'broken-auth-catalog' &&
                        overlay['providerMetadata']?.['catalogImportStatus'] === 'failed' &&
                        overlay['providerMetadata']?.['failureMessage'] === 'token [redacted] rejected',
                ),
                true,
            );
            assert.equal(JSON.stringify(loaded.importRuns).includes('gsk-secret-that-must-not-leak'), false);
            assert.ok(progressEvents.some((event) => event['phase'] === 'importer_started' && event['importerId'] === 'openrouter-models'));
            assert.ok(progressEvents.some((event) => event['phase'] === 'facts_built' && event['evidenceCount'] === 1));
            assert.ok(progressEvents.some((event) => event['phase'] === 'importer_completed' && event['progressPct'] === 50));
            assert.ok(progressEvents.some((event) => event['phase'] === 'importer_failed' && event['progressPct'] === 100));
            assert.equal(JSON.stringify(progressEvents).includes('gsk-secret-that-must-not-leak'), false);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('preserves provider model identifiers that look like hosted model namespaces', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-model-catalog-identifiers-'));
        try {
            const filePath = join(dir, 'catalog.json');
            const store = new JsonModelGatewayCatalogStore({ filePath });
            await store.writeSnapshot({
                source: 'test',
                evidences: [
                    createModelMetadataEvidence({
                        evidenceId: 'cloudflare-workers-ai:@hf/thebloke/model-a:displayName',
                        providerId: 'cloudflare-workers-ai',
                        providerModel: '@hf/thebloke/model-a',
                        fieldPath: 'displayName',
                        value: '@hf/thebloke/model-a',
                        sourceId: 'cloudflare-workers-ai-catalog',
                    }),
                ],
                projections: [
                    createCanonicalModelProjection({
                        providerId: 'cloudflare-workers-ai',
                        providerModel: '@hf/thebloke/model-a',
                        displayName: '@hf/thebloke/model-a',
                    }),
                ],
            });
            const loaded = await store.readSnapshot();

            assert.equal(loaded.evidences[0].providerModel, '@hf/thebloke/model-a');
            assert.equal(loaded.evidences[0].evidenceId, 'cloudflare-workers-ai:@hf/thebloke/model-a:displayName');
            assert.equal(loaded.projections[0].providerModel, '@hf/thebloke/model-a');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('audits catalog snapshot integrity before SQLite materialization', () => {
        const healthy = auditModelGatewayCatalogSnapshotIntegrity({
            schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
            evidences: [
                createModelMetadataEvidence({
                    evidenceId: 'openrouter:model-a:displayName',
                    providerId: 'openrouter',
                    providerModel: 'model-a',
                    fieldPath: 'displayName',
                    value: 'Model A',
                    sourceId: 'openrouter-models',
                }),
            ],
            routeOptions: [
                createModelRouteOption({
                    providerId: 'openrouter',
                    providerModel: 'model-a',
                    selectorKind: 'exact_model',
                    selectorSyntax: 'model-a',
                }),
                createModelRouteOption({
                    providerId: 'huggingface',
                    providerModel: 'katanemo/Arch-Router-1.5B',
                    selectorKind: 'provider_explicit',
                    selectorSyntax: 'katanemo/Arch-Router-1.5B:hf-inference',
                    providerSpecific: { huggingFaceProvider: 'hf-inference' },
                }),
            ],
            projections: [
                createCanonicalModelProjection({
                    providerId: 'openrouter',
                    providerModel: 'model-a',
                    displayName: 'Model A',
                }),
            ],
        });
        const corrupted = auditModelGatewayCatalogSnapshotIntegrity({
            schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
            evidences: [
                { evidenceId: 'cloudflare:@[redacted]:displayName', providerId: 'cloudflare-workers-ai', providerModel: '@[redacted]', fieldPath: 'displayName' },
                { evidenceId: 'cloudflare:@[redacted]:displayName', providerId: 'cloudflare-workers-ai', providerModel: '@[redacted]', fieldPath: 'displayName' },
            ],
            projections: [
                { providerId: 'cloudflare-workers-ai', providerModel: '@[redacted]' },
                { providerId: 'cloudflare-workers-ai', providerModel: '@[redacted]' },
            ],
        });

        assert.equal(healthy.ok, true);
        assert.equal(corrupted.ok, false);
        assert.equal(corrupted.duplicateChecks.evidences.duplicateExtraRowCount, 1);
        assert.ok(corrupted.redactedIdentityCount > 0);
    });

    it('records account/local failure overlays without turning them into runtime proof', async () => {
        const snapshot = await runCatalogImporters({
            now: () => new Date('2026-05-26T19:00:00.000Z'),
            importers: [
                createGeminiModelsImporter({
                    apiKey: 'gemini-secret-that-must-not-leak',
                    secretRef: 'GEMINI_API_KEY',
                    fetchImpl: /** @type {typeof fetch} */ (async () =>
                        /** @type {Response} */ ({
                            ok: false,
                            status: 400,
                            text: async () =>
                                JSON.stringify({
                                    error: {
                                        code: 400,
                                        message: 'API key expired. Please renew the API key.',
                                        status: 'INVALID_ARGUMENT',
                                        details: [{ reason: 'API_KEY_INVALID' }],
                                    },
                                }),
                        })),
                }),
                createOllamaCatalogImporter({
                    baseUrl: 'http://127.0.0.1:11434',
                    fetchImpl: /** @type {typeof fetch} */ (async () => {
                        throw new Error('fetch failed ECONNREFUSED');
                    }),
                }),
            ],
        });
        const geminiOverlay = snapshot.accountOverlays.find((overlay) => overlay.providerId === 'gemini');
        const ollamaOverlay = snapshot.accountOverlays.find((overlay) => overlay.providerId === 'ollama-local');

        assert.deepEqual(
            snapshot.importRuns.map((run) => run.status),
            ['failed', 'failed'],
        );
        assert.equal(snapshot.projections.length, 0);
        assert.equal(geminiOverlay?.confidence, 'authenticated_catalog');
        assert.equal(geminiOverlay?.providerMetadata.catalogImportStatus, 'failed');
        assert.equal(geminiOverlay?.providerMetadata.apiKeyDisabled, true);
        assert.equal(JSON.stringify(geminiOverlay).includes('gemini-secret-that-must-not-leak'), false);
        assert.equal(ollamaOverlay?.confidence, 'catalog');
        assert.equal(ollamaOverlay?.providerMetadata.localDaemonReachable, false);
        assert.equal(ollamaOverlay?.providerMetadata.disabled, true);
    });

    it('creates generic failure overlays for authenticated importers without a custom failure hook', async () => {
        const snapshot = await runCatalogImporters({
            now: () => new Date('2026-05-26T19:20:00.000Z'),
            importers: [
                {
                    id: 'generic-auth-models',
                    providerId: 'generic-provider',
                    sourceKind: 'authenticated_api',
                    requiresAuth: true,
                    envRequirements: ['GENERIC_API_KEY'],
                    fetchRaw: () => {
                        const error = new Error('HTTP 429 rate limit exceeded');
                        Object.assign(error, { headers: { 'retry-after': '42', 'x-ratelimit-remaining-requests': '0' } });
                        throw error;
                    },
                    parseRows: () => [],
                    toEvidenceFacts: () => [],
                },
            ],
        });
        const overlay = snapshot.accountOverlays[0];

        assert.equal(snapshot.importRuns[0].status, 'failed');
        assert.equal(overlay.providerId, 'generic-provider');
        assert.equal(overlay.confidence, 'authenticated_catalog');
        assert.equal(overlay.secretRef, 'GENERIC_API_KEY');
        assert.equal(overlay.providerMetadata.catalogImportStatus, 'failed');
        assert.equal(overlay.providerMetadata.failureKind, 'rate-limit');
        assert.equal(overlay.rateLimits.limited, true);
        assert.equal(overlay.rateLimits.retryAfterSeconds, 42);
        assert.equal(overlay.rateLimits['x-ratelimit-remaining-requests'], 0);
    });

    it('classifies importer failures separately for metadata, account, and local build gates', () => {
        const publicFailure = classifyModelGatewayCatalogImporterFailure({
            importerId: 'openai-docs-models',
            providerId: 'openai',
            sourceId: 'openai-docs-models',
            sourceKind: 'official_docs',
            errors: ['OpenAI docs fetch failed with HTTP 403'],
        });
        const accountFailure = classifyModelGatewayCatalogImporterFailure({
            importerId: 'gemini-models',
            providerId: 'gemini',
            sourceId: 'gemini-models',
            sourceKind: 'authenticated_api',
            requiresAuth: true,
            errors: ['Gemini models.list failed with HTTP 400: API key expired. Please renew the API key.'],
        });
        const localFailure = classifyModelGatewayCatalogImporterFailure({
            importerId: 'ollama-catalog',
            providerId: 'ollama-local',
            sourceId: 'ollama-catalog',
            sourceKind: 'local_daemon',
            errors: ['fetch failed ECONNREFUSED'],
        });

        assert.equal(publicFailure.disposition, MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION.BLOCKING_METADATA_SOURCE);
        assert.equal(publicFailure.buildBlocking, true);
        assert.equal(accountFailure.disposition, MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION.ACCOUNT_STATE_UNAVAILABLE);
        assert.equal(accountFailure.failureKind, 'auth');
        assert.equal(accountFailure.buildBlocking, false);
        assert.equal(localFailure.disposition, MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION.OPTIONAL_LOCAL_SOURCE_UNAVAILABLE);
        assert.equal(localFailure.failureKind, 'network');
        assert.equal(localFailure.buildBlocking, false);
        assert.equal(
            classifyModelGatewayCatalogImporterFailure(accountFailure, { failOnAccountImporterFailures: true }).buildBlocking,
            true,
        );
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

    it('imports OpenRouter key account limits as account overlay without proving runtime access', async () => {
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                authorizationHeader = /** @type {{ headers?: { authorization?: string } }} */ (init)?.headers?.authorization ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: {
                            label: 'repo-agent-key',
                            usage: 12.5,
                            limit: 50,
                            is_free_tier: false,
                            disabled: false,
                            rate_limit: { requests: 1000, interval: '10s' },
                        },
                    }),
                });
            }
        );

        const parsed = parseOpenRouterKeyRows({
            data: { label: 'repo-agent-key', usage: 12.5, limit: 50, rate_limit: { requests: 1000 } },
        });
        const snapshot = await runCatalogImporters({
            importers: [
                createOpenRouterKeyAccountImporter({
                    fetchImpl: fakeFetch,
                    apiKey: 'sk-or-v1-secret-that-must-not-leak',
                    secretRef: 'OPENROUTER_API_KEY',
                }),
            ],
            now: () => new Date('2026-05-25T12:40:00.000Z'),
        });
        const providerEvidenceByPath = new Map(snapshot.providerEvidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(parsed[0]?.label, 'repo-agent-key');
        assert.equal(authorizationHeader, 'Bearer sk-or-v1-secret-that-must-not-leak');
        assert.equal(snapshot.sources[0].url, 'https://openrouter.ai/api/v1/key');
        assert.equal(snapshot.sources[0].authMode, 'api_key');
        assert.equal(snapshot.evidences.length, 0);
        assert.equal(snapshot.routeOptions.length, 0);
        assert.equal(snapshot.accountOverlays.length, 1);
        assert.equal(snapshot.accountOverlays[0].providerId, 'openrouter');
        assert.equal(snapshot.accountOverlays[0].secretRef, 'OPENROUTER_API_KEY');
        assert.equal(snapshot.accountOverlays[0].spendingLimits.remainingUsd, 37.5);
        assert.deepEqual(snapshot.accountOverlays[0].rateLimits, { requests: 1000, interval: '10s' });
        assert.equal(snapshot.accountOverlays[0].providerMetadata.semantics, 'account_key_credit_and_rate_limits');
        assert.equal(providerEvidenceByPath.get('providerMetadata.openrouter.keyUsage'), 12.5);
        assert.equal(JSON.stringify(snapshot).includes('sk-or-v1-secret-that-must-not-leak'), false);
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

    it('extracts conservative Kilo account overlay from authenticated models and JWT claims', async () => {
        const encode = (/** @type {Record<string, unknown>} */ value) =>
            Buffer.from(JSON.stringify(value)).toString('base64url');
        const secret = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
            env: 'production',
            kiloUserId: 'user-1',
            version: 3,
            iat: 1779359562,
            exp: 1937039562,
            apiTokenPepper: 'must-not-leak',
        })}.signature-that-must-not-leak`;
        /** @type {string | null} */
        let authorizationHeader = null;
        /** @type {string | null} */
        let organizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                const headers = /** @type {{ authorization?: string; 'X-KiloCode-OrganizationId'?: string }} */ (init)?.headers ?? {};
                authorizationHeader = headers.authorization ?? null;
                organizationHeader = headers['X-KiloCode-OrganizationId'] ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            { id: 'kilo-auto/free', isFree: true },
                            { id: 'anthropic/claude-sonnet-4.6', allowed: true },
                            { id: 'openai/gpt-5.4', blocked: true },
                            { id: 'google/gemini-3.1-pro-preview' },
                        ],
                        account: {
                            remainingCreditsUsd: 12.25,
                            byokProviderKeys: ['anthropic', 'zai'],
                        },
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [
                createKiloGatewayAccountImporter({
                    fetchImpl: fakeFetch,
                    apiKey: secret,
                    secretRef: 'KILO_CODE_API_KEY',
                    organizationId: 'org-1',
                    organizationIdRef: 'KILO_ORGANIZATION_ID',
                }),
            ],
            now: () => new Date('2026-05-26T13:30:00.000Z'),
        });
        const overlay = snapshot.accountOverlays[0];
        const providerEvidence = new Map(snapshot.providerEvidences.map((item) => [String(item.fieldPath), item.value]));

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(organizationHeader, 'org-1');
        assert.equal(JSON.stringify(snapshot).includes('must-not-leak'), false);
        assert.equal(JSON.stringify(snapshot).includes('signature-that-must-not-leak'), false);
        assert.equal(snapshot.sources[0].kind, 'authenticated_account_api');
        assert.equal(snapshot.sources[0].trustTier, 'account_scoped');
        assert.equal(overlay.accountScope, 'user-1');
        assert.equal(overlay.secretRef, 'KILO_CODE_API_KEY');
        assert.deepEqual(overlay.enabledModels, ['anthropic/claude-sonnet-4.6', 'kilo-auto/free']);
        assert.deepEqual(overlay.blockedModels, ['openai/gpt-5.4']);
        assert.deepEqual(overlay.byokProviderKeys, ['anthropic', 'zai']);
        assert.equal(overlay.quota.remainingCreditsUsd, 12.25);
        assert.equal(overlay.providerMetadata.accountEndpointDocumented, false);
        assert.equal(overlay.providerMetadata.explicitAccessFieldCount, 2);
        assert.equal(overlay.providerMetadata.organizationIdConfigured, true);
        assert.equal(providerEvidence.get('providerMetadata.kilo.accountApi.visibleModelCount'), 4);
        assert.equal(providerEvidence.get('providerMetadata.kilo.accountApi.remainingCreditsUsd'), 12.25);
        assert.equal(providerEvidence.get('providerMetadata.kilo.token.validJwtShape'), true);
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

    it('imports OpenAI official docs as public metadata seed without proving account access', async () => {
        const pages = {
            models: '<main>GPT-5.2 model id gpt-5.2. text-embedding-3-small embeddings. GPT-4.5 Preview gpt-4.5-preview Deprecated.</main>',
            pricing: '<section>gpt-5.2 $1.25 input $10 output text-embedding-3-small $0.02 input</section>',
            compare: '<table><tr><td>gpt-5.2</td><td>recommended coding and agentic tasks with reasoning</td></tr></table>',
        };
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url) =>
                /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    text: async () =>
                        String(url).includes('/pricing') ? pages.pricing : String(url).includes('/compare') ? pages.compare : pages.models,
                })
        );

        const parsed = parseOpenAiDocsRows(pages);
        const snapshot = await runCatalogImporters({
            importers: [createOpenAiDocsModelsImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T12:20:00.000Z'),
        });
        const byModelPath = new Map(snapshot.evidences.map((item) => [`${item.providerModel}:${item.fieldPath}`, item.value]));

        assert.deepEqual(parsed.map((row) => row.id), ['gpt-4.5', 'gpt-4.5-preview', 'gpt-5.2', 'text-embedding-3-small']);
        assert.equal(snapshot.sources[0].providerId, 'openai');
        assert.equal(snapshot.sources[0].authMode, 'none');
        assert.equal(snapshot.accountOverlays.length, 0);
        assert.equal(snapshot.routeOptions.length, 0);
        assert.equal(byModelPath.get('gpt-5.2:providerMetadata.openai.docsUrl'), 'https://developers.openai.com/docs/models');
        assert.equal(byModelPath.get('gpt-5.2:pricing.inputUsdPerMillion'), 1.25);
        assert.equal(byModelPath.get('gpt-5.2:pricing.outputUsdPerMillion'), 10);
        assert.equal(byModelPath.get('gpt-5.2:capabilities.tools'), true);
        assert.equal(byModelPath.get('text-embedding-3-small:modalities.output')?.[0], 'embedding');
        assert.equal(byModelPath.get('gpt-4.5-preview:lifecycle.providerStatus'), 'deprecated');
    });

    it('imports Anthropic official docs as public metadata seed without proving account access', async () => {
        const pages = {
            models: `
                <main>
                    <table>
                        <tr><th>Model</th><th>Anthropic API</th><th>AWS Bedrock</th><th>GCP Vertex AI</th></tr>
                        <tr><td>Claude Sonnet 4</td><td>claude-sonnet-4-20250514</td><td>anthropic.claude-sonnet-4-20250514-v1:0</td><td>claude-sonnet-4@20250514</td></tr>
                        <tr><td>Claude Haiku 3.5</td><td>claude-3-5-haiku-20241022 (claude-3-5-haiku-latest)</td><td>anthropic.claude-3-5-haiku-20241022-v1:0</td><td>claude-3-5-haiku@20241022</td></tr>
                    </table>
                    <section>Claude Sonnet 4 Text and image input Text output 200K context window 1M context beta Extended thinking Priority Tier Max output 64000 tokens</section>
                    <section>Claude Haiku 3.5 Text and image input Text output 200K context window Max output 8192 tokens</section>
                </main>
            `,
            pricing: `
                <table>
                    <tr><th>Model</th><th>Base Input Tokens</th><th>5m Cache Writes</th><th>1h Cache Writes</th><th>Cache Hits & Refreshes</th><th>Output Tokens</th></tr>
                    <tr><td>Claude Sonnet 4</td><td>$3 / MTok</td><td>$3.75 / MTok</td><td>$6 / MTok</td><td>$0.30 / MTok</td><td>$15 / MTok</td></tr>
                    <tr><td>Claude Haiku 3.5</td><td>$0.80 / MTok</td><td>$1 / MTok</td><td>$1.6 / MTok</td><td>$0.08 / MTok</td><td>$4 / MTok</td></tr>
                </table>
            `,
            api: '<code>GET /v1/models</code><code>claude-sonnet-4-20250514</code>',
        };
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url) =>
                /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    text: async () =>
                        String(url).includes('/pricing') ? pages.pricing : String(url).includes('/api/') ? pages.api : pages.models,
                })
        );

        const parsed = parseAnthropicDocsRows(pages);
        const snapshot = await runCatalogImporters({
            importers: [createAnthropicDocsModelsImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T12:25:00.000Z'),
        });
        const byModelPath = new Map(snapshot.evidences.map((item) => [`${item.providerModel}:${item.fieldPath}`, item.value]));

        assert.deepEqual(parsed.map((row) => row.id), [
            'claude-3-5-haiku-20241022',
            'claude-3-5-haiku-latest',
            'claude-sonnet-4-20250514',
        ]);
        assert.equal(snapshot.sources[0].providerId, 'anthropic');
        assert.equal(snapshot.sources[0].authMode, 'none');
        assert.equal(snapshot.accountOverlays.length, 0);
        assert.equal(snapshot.routeOptions.length, 0);
        assert.equal(byModelPath.get('claude-sonnet-4-20250514:providerMetadata.anthropic.docsUrl'), 'https://docs.anthropic.com/en/docs/about-claude/models/overview');
        assert.equal(byModelPath.get('claude-sonnet-4-20250514:capabilities.reasoning'), true);
        assert.equal(byModelPath.get('claude-sonnet-4-20250514:capabilities.vision'), true);
        assert.equal(byModelPath.get('claude-sonnet-4-20250514:limits.contextWindowTokens'), 1_000_000);
        assert.equal(byModelPath.get('claude-sonnet-4-20250514:limits.maxOutputTokens'), 64_000);
        assert.equal(byModelPath.get('claude-sonnet-4-20250514:pricing.inputUsdPerMillion'), 3);
        assert.equal(byModelPath.get('claude-sonnet-4-20250514:pricing.outputUsdPerMillion'), 15);
        assert.equal(byModelPath.get('claude-3-5-haiku-20241022:pricing.cacheReadUsdPerMillion'), 0.08);
        assert.equal(byModelPath.get('claude-3-5-haiku-20241022:providerMetadata.modelTraits.tier'), 'haiku');
    });

    it('imports Gemini official docs as public metadata seed across Developer API, Vertex and OpenAI surfaces', async () => {
        const pages = {
            models: `
                <main>
                    <h2>Gemini 2.5 Pro</h2>
                    <p>gemini-2.5-pro supports complex reasoning, coding, tools, multimodal input and a 1 million token context window.</p>
                    <h2>Gemini 2.5 Flash Image</h2>
                    <p>gemini-2.5-flash-image generates high-quality images and supports conversational editing.</p>
                </main>
            `,
            pricing: `
                <section>
                    <h2>Gemini 2.5 Pro</h2>
                    <p>Input price $1.25 Output price $10.00 Context caching price $0.31</p>
                    <h2>Gemini 2.5 Flash Image</h2>
                    <p>Input price $0.30 Output image $30.00 Context caching price $0.03</p>
                </section>
            `,
            openai: '<code>base_url="https://generativelanguage.googleapis.com/v1beta/openai/"</code><code>model="gemini-2.5-flash"</code>',
            vertex: '<main>Gemini 2.5 Pro on Vertex AI features agentic workflows, autonomous coding and multimodal tasks.</main>',
        };
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url) =>
                /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    text: async () =>
                        String(url).includes('/pricing')
                            ? pages.pricing
                            : String(url).includes('/openai')
                              ? pages.openai
                              : String(url).includes('cloud.google.com')
                                ? pages.vertex
                                : pages.models,
                })
        );

        const parsed = parseGeminiDocsRows(pages);
        const snapshot = await runCatalogImporters({
            importers: [createGeminiDocsModelsImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T12:30:00.000Z'),
        });
        const byModelPath = new Map(snapshot.evidences.map((item) => [`${item.providerModel}:${item.fieldPath}`, item.value]));

        assert.deepEqual(parsed.map((row) => row.id), ['gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-2.5-pro']);
        assert.equal(snapshot.sources[0].providerId, 'gemini');
        assert.equal(snapshot.sources[0].authMode, 'none');
        assert.equal(snapshot.accountOverlays.length, 0);
        assert.equal(snapshot.routeOptions.length, 0);
        assert.equal(byModelPath.get('gemini-2.5-pro:providerMetadata.gemini.docsUrl'), 'https://ai.google.dev/gemini-api/docs/models');
        assert.deepEqual(byModelPath.get('gemini-2.5-pro:providerMetadata.gemini.surfaces'), [
            'developer_api',
            'vertex_ai',
            'openai_compatible',
        ]);
        assert.equal(byModelPath.get('gemini-2.5-pro:capabilities.reasoning'), true);
        assert.equal(byModelPath.get('gemini-2.5-pro:limits.contextWindowTokens'), 1_000_000);
        assert.equal(byModelPath.get('gemini-2.5-pro:pricing.inputUsdPerMillion'), 1.25);
        assert.equal(byModelPath.get('gemini-2.5-pro:pricing.outputUsdPerMillion'), 10);
        assert.equal(byModelPath.get('gemini-2.5-flash-image:capabilities.imageGeneration'), true);
        assert.deepEqual(byModelPath.get('gemini-2.5-flash-image:modalities.output'), ['image', 'text']);
    });

    it('imports Mistral official docs as public pricing and limit metadata without proving access', async () => {
        const pages = {
            models: `
                <main>
                    <article>Mistral Large 3 Open mistral-large-2512 multimodal model Price $2 input $6 output Structured Outputs</article>
                    <article>Codestral codestral-2508 coding and FIM model Price $0.30 input $0.90 output</article>
                </main>
            `,
            limits: `
                <table>
                    <tr><td>Mistral Large</td><td>131,072 tokens</td></tr>
                    <tr><td>Codestral</td><td>32,768 tokens</td></tr>
                </table>
            `,
            api: '<code>GET /v1/models</code><code>POST /v1/chat/completions</code><code>POST /v1/fim/completions</code>',
        };
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url) =>
                /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    text: async () =>
                        String(url).includes('/known-limitations') ? pages.limits : String(url).includes('/api/') ? pages.api : pages.models,
                })
        );

        const parsed = parseMistralDocsRows(pages);
        const snapshot = await runCatalogImporters({
            importers: [createMistralDocsModelsImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-25T12:35:00.000Z'),
        });
        const byModelPath = new Map(snapshot.evidences.map((item) => [`${item.providerModel}:${item.fieldPath}`, item.value]));

        assert.deepEqual(parsed.map((row) => row.id), ['codestral-2508', 'mistral-large-2512']);
        assert.equal(snapshot.sources[0].providerId, 'mistral');
        assert.equal(snapshot.sources[0].authMode, 'none');
        assert.equal(snapshot.accountOverlays.length, 0);
        assert.equal(snapshot.routeOptions.length, 0);
        assert.equal(byModelPath.get('mistral-large-2512:providerMetadata.mistral.docsUrl'), 'https://docs.mistral.ai/models/overview');
        assert.equal(byModelPath.get('mistral-large-2512:capabilities.vision'), true);
        assert.equal(byModelPath.get('mistral-large-2512:capabilities.structuredOutputs'), true);
        assert.equal(byModelPath.get('mistral-large-2512:limits.contextWindowTokens'), 131_072);
        assert.equal(byModelPath.get('mistral-large-2512:pricing.inputUsdPerMillion'), 2);
        assert.equal(byModelPath.get('mistral-large-2512:pricing.outputUsdPerMillion'), 6);
        assert.equal(byModelPath.get('codestral-2508:capabilities.codeCompletion'), true);
        assert.deepEqual(byModelPath.get('codestral-2508:modalities.input'), ['text']);
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

    it('imports Z.AI OpenAPI as provider wire-contract metadata without model invention', async () => {
        /** @type {string | null} */
        let acceptHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (_url, init) => {
                acceptHeader = /** @type {{ headers?: { accept?: string } }} */ (init)?.headers?.accept ?? null;
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        openapi: '3.1.0',
                        info: { title: 'Z.AI API', version: '2026-05-01' },
                        paths: {
                            '/chat/completions': {
                                post: {
                                    operationId: 'createChatCompletion',
                                    tags: ['Chat'],
                                    requestBody: {
                                        content: {
                                            'application/json': {
                                                schema: {
                                                    type: 'object',
                                                    required: ['model', 'messages'],
                                                    properties: {
                                                        model: { type: 'string' },
                                                        messages: { type: 'array' },
                                                        stream: { type: 'boolean' },
                                                        tools: { type: 'array' },
                                                        tool_choice: {},
                                                        response_format: {},
                                                        web_search: {},
                                                        thinking: {},
                                                        input_image: {},
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createZaiOpenApiImporter({ fetchImpl: fakeFetch })],
            now: () => new Date('2026-05-26T14:00:00.000Z'),
        });
        const providerEvidence = new Map(snapshot.providerEvidences.map((item) => [String(item.fieldPath), item.value]));

        assert.equal(acceptHeader, 'application/json');
        assert.equal(snapshot.sources[0].kind, 'openapi');
        assert.equal(snapshot.evidences.length, 0);
        assert.equal(snapshot.routeOptions.length, 0);
        assert.equal(providerEvidence.get('providerMetadata.zai.openapi.openapiVersion'), '3.1.0');
        assert.equal(providerEvidence.get('providerMetadata.zai.openapi.chatCompletionsOperationId'), 'createChatCompletion');
        assert.deepEqual(providerEvidence.get('providerMetadata.zai.openapi.chatCompletionsParameters'), [
            'input_image',
            'messages',
            'model',
            'response_format',
            'stream',
            'thinking',
            'tool_choice',
            'tools',
            'web_search',
        ]);
        assert.equal(providerEvidence.get('providerMetadata.zai.openapi.capabilities.tools'), true);
        assert.equal(providerEvidence.get('providerMetadata.zai.openapi.capabilities.forcedToolChoice'), true);
        assert.equal(providerEvidence.get('providerMetadata.zai.openapi.capabilities.structuredOutputs'), true);
        assert.equal(providerEvidence.get('providerMetadata.zai.openapi.capabilities.reasoning'), true);
        assert.equal(providerEvidence.get('providerMetadata.zai.openapi.capabilities.webSearch'), true);
        assert.equal(providerEvidence.get('providerMetadata.zai.openapi.capabilities.multimodal'), true);
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
        assert.equal(byPath.get('capabilities.text'), true);
        assert.equal(byPath.get('capabilities.streaming'), true);
        assert.equal(byPath.get('capabilities.chat'), true);
        assert.equal(byPath.get('capabilities.vision'), true);
        assert.equal(byPath.get('capabilities.local'), true);
        assert.equal(byPath.get('capabilities.privacy'), true);
        assert.equal(byPath.get('capabilities.no_remote_secrets'), true);
        assert.deepEqual(byPath.get('modalities.input'), ['text', 'image']);
        assert.equal(byPath.get('providerMetadata.runtimeKind'), 'local');
        assert.equal(byPath.get('providerMetadata.localPrivate'), true);
        assert.equal(byPath.get('providerMetadata.ollama.digest'), 'sha256-local-digest');
        assert.equal(byPath.get('providerMetadata.ollama.family'), 'gemma3');
        assert.equal(byPath.get('providerMetadata.ollama.quantizationLevel'), 'Q4_K_M');
        assert.deepEqual(byPath.get('providerMetadata.ollama.parameters'), { temperature: 0.7, num_ctx: 8192 });
        assert.equal(snapshot.routeOptions[0].providerId, 'ollama-local');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.routeLayer, 'local_daemon');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.wireApi, 'openai_chat_completions');
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

    it('imports Cloudflare account-scoped model, gateway, provider-key and billing metadata before runtime', async () => {
        const secret = 'cloudflare-account-secret-that-must-not-leak';
        /** @type {string[]} */
        const requestedUrls = [];
        /** @type {string | null} */
        let authorizationHeader = null;
        const fakeFetch = /** @type {typeof fetch} */ (
            async (url, init) => {
                const urlText = String(url);
                requestedUrls.push(urlText);
                authorizationHeader = /** @type {{ authorization?: string }} */ (init)?.headers?.authorization ?? null;
                /** @type {unknown} */
                let payload = { success: true, result: {} };
                if (urlText.endsWith('/ai/models/search')) {
                    payload = {
                        success: true,
                        result: [
                            { id: '@cf/meta/llama-3.1-8b-instruct', task: 'Text Generation' },
                            { id: '@cf/baai/bge-large-en-v1.5', task: 'Text Embeddings' },
                        ],
                    };
                } else if (urlText.endsWith('/ai-gateway/gateways')) {
                    payload = {
                        success: true,
                        result: [
                            {
                                id: 'gateway-1',
                                name: 'production',
                                rate_limiting_limit: 120,
                                rate_limiting_interval: 60,
                            },
                        ],
                    };
                } else if (urlText.endsWith('/ai-gateway/gateways/gateway-1')) {
                    payload = {
                        success: true,
                        result: {
                            id: 'gateway-1',
                            cache: true,
                            rate_limiting_limit: 240,
                            rate_limiting_interval: 120,
                        },
                    };
                } else if (urlText.endsWith('/ai-gateway/gateways/gateway-1/provider_configs')) {
                    payload = {
                        success: true,
                        result: [
                            { provider: 'workers-ai', token_preview: 'should-redact' },
                            { provider_slug: 'openai', secret: 'should-redact' },
                        ],
                    };
                } else if (urlText.endsWith('/ai-gateway/billing/credit-balance')) {
                    payload = { success: true, result: { balance: 37.5, currency: 'USD' } };
                } else if (urlText.endsWith('/ai-gateway/billing/spending-limit')) {
                    payload = { success: true, result: { enabled: true, amount: 10000 } };
                }
                return /** @type {Response} */ ({
                    ok: true,
                    status: 200,
                    headers: { get: () => 'application/json' },
                    json: async () => payload,
                    text: async () => JSON.stringify(payload),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [
                createCloudflareWorkersAiAccountImporter({
                    fetchImpl: fakeFetch,
                    apiToken: secret,
                    secretRef: 'CLOUDFLARE_API_TOKEN',
                    accountId: 'account-1',
                    gatewayId: 'gateway-1',
                }),
            ],
            now: () => new Date('2026-05-26T12:00:00.000Z'),
        });

        const overlay = snapshot.accountOverlays[0];
        const providerEvidence = new Map(snapshot.providerEvidences.map((item) => [String(item.fieldPath), item.value]));

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(JSON.stringify(snapshot).includes('should-redact'), false);
        assert.equal(snapshot.sources[0].kind, 'authenticated_account_api');
        assert.equal(snapshot.importRuns[0].status, 'completed');
        assert.equal(requestedUrls.some((url) => url.endsWith('/accounts/account-1/ai/models/search')), true);
        assert.equal(
            requestedUrls.some((url) => url.endsWith('/accounts/account-1/ai-gateway/gateways/gateway-1/provider_configs')),
            true,
        );
        assert.deepEqual(overlay.enabledModels, ['@cf/meta/llama-3.1-8b-instruct', '@cf/baai/bge-large-en-v1.5']);
        assert.deepEqual(overlay.byokProviderKeys, ['workers-ai', 'openai']);
        assert.equal(overlay.quota.remainingCreditsUsd, 37.5);
        assert.equal(overlay.spendingLimits.hardLimitUsd, 100);
        assert.equal(overlay.rateLimits.requestsPerMinute, 120);
        assert.equal(overlay.providerMetadata.semantics, 'cloudflare_account_ai_gateway_access');
        assert.equal(overlay.providerMetadata.selectedGatewayFound, true);
        assert.equal(overlay.providerMetadata.providerConfigCount, 2);
        assert.equal(providerEvidence.get('providerMetadata.cloudflare.accountApi.visibleModelCount'), 2);
        assert.deepEqual(providerEvidence.get('providerMetadata.cloudflare.accountApi.providerConfigProviders'), [
            'workers-ai',
            'openai',
        ]);
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

    it('imports Cerebras authenticated visible models with provider-specific overlay metadata', async () => {
        const secret = 'cerebras-secret-that-must-not-leak';
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
                                id: 'gpt-oss-120b',
                                object: 'model',
                                created: 1754438400,
                                owned_by: 'OpenAI',
                            },
                        ],
                    }),
                });
            }
        );
        const snapshot = await runCatalogImporters({
            importers: [createCerebrasModelsImporter({ fetchImpl: fakeFetch, apiKey: secret, secretRef: 'CEREBRAS_KEY' })],
            now: () => new Date('2026-05-26T14:30:00.000Z'),
        });
        const byPath = new Map(snapshot.evidences.map((item) => [item.fieldPath, item.value]));

        assert.equal(authorizationHeader, `Bearer ${secret}`);
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(snapshot.sources[0].kind, 'authenticated_api');
        assert.equal(snapshot.sources[0].trustTier, 'account_scoped');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.openAICompatibleBaseUrl, 'https://api.cerebras.ai/v1');
        assert.equal(snapshot.routeOptions[0].normalizedPolicy.wireApi, 'openai_chat_completions');
        assert.deepEqual(snapshot.accountOverlays[0].enabledModels, ['gpt-oss-120b']);
        assert.equal(snapshot.accountOverlays[0].secretRef, 'CEREBRAS_KEY');
        assert.equal(snapshot.accountOverlays[0].providerMetadata.semantics, 'cerebras_account_visible_models');
        assert.equal(byPath.get('providerMetadata.cerebras.authenticatedVisibility'), true);
        assert.equal(byPath.get('providerMetadata.cerebras.openAICompatibleBaseUrl'), 'https://api.cerebras.ai/v1');
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
        const routeOption = createModelRouteOption({
            providerId: 'openrouter',
            providerModel: 'x-ai/grok-build-0.1',
            selectorKind: 'provider-explicit',
            selectorSyntax: 'x-ai/grok-build-0.1:groq',
            sourceId: 'openrouter-models',
            sourceKind: 'public_api',
            confidence: 'catalog',
            normalizedPolicy: {
                routeLayer: 'openai_compatible_aggregator',
                openAICompatibleBaseUrl: 'https://openrouter.ai/api/v1',
                wireApi: 'openai_chat_completions',
            },
            providerSpecific: { upstreamProvider: 'groq' },
        });
        const entry = toOpenAIModelCatalogEntry(projection);
        const list = toOpenAIModelCatalogList([projection], {
            providerProjections: [providerProjection],
            routeOptions: [routeOption],
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
        assert.equal(list.data[0].x_model_gateway.route_options?.[0]?.selector_kind, 'provider-explicit');
        assert.equal(list.data[0].x_model_gateway.route_options?.[0]?.route_traits.openAICompatible, true);
        assert.deepEqual(list.data[0].x_model_gateway.route_options?.[0]?.provider_specific, { upstreamProvider: 'groq' });
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

    it('normalizes runtime-agentic, pricing, rate, data-policy and alias taxonomies as metadata', () => {
        assert.deepEqual(
            normalizeRuntimeAgenticCapabilityTaxonomy({
                supportedParameters: ['tools', 'tool_choice', 'parallel_tool_calls', 'response_format'],
                capabilities: { structuredOutputs: true, reasoningEffort: true },
                modalities: { input: ['text', 'image'], output: ['text'] },
            }),
            {
                tools: true,
                forcedToolChoice: true,
                parallelToolCalls: true,
                jsonMode: true,
                structuredOutputs: true,
                reasoning: true,
                streaming: false,
                webSearch: false,
                codeExecution: false,
                vision: true,
                audio: false,
                agenticLevel: 'parallel_tools',
                capabilityFamilies: ['tools', 'reasoning', 'structured_outputs', 'vision'],
            },
        );
        assert.deepEqual(
            normalizeModelPricingTaxonomy({
                currency: 'EUR',
                inputPerToken: '0.000001',
                outputPerMillion: 2,
                request: 0.01,
                exchangeRateToUsd: 1.1,
            }),
            {
                currency: 'EUR',
                tokenUnit: 'per_million_tokens',
                requestUnit: 'per_request',
                inputPerMillion: 1,
                outputPerMillion: 2,
                request: 0.01,
                exchangeRateToUsd: 1.1,
                usd: {
                    inputPerMillionUsd: 1.1,
                    outputPerMillionUsd: 2.2,
                    requestUsd: 0.011,
                },
            },
        );
        assert.deepEqual(
            normalizeRateLimitTaxonomy({
                requestsPerMinute: 60,
                tokensPerDay: 1_000_000,
                maxConcurrentRequests: 8,
                retryAfterSeconds: 30,
            }),
            {
                requests: { perMinute: 60 },
                tokens: { perDay: 1_000_000 },
                concurrency: { maxConcurrentRequests: 8 },
                retry: { retryAfterSeconds: 30 },
            },
        );
        assert.deepEqual(
            normalizeDataPolicyTaxonomy({
                retainsPrompts: 'false',
                training: 'false',
                zeroDataRetention: true,
                confidentialCompute: true,
                dataResidency: 'EU',
                compliance: ['SOC2', 'SOC2', 'HIPAA'],
            }),
            {
                retainsPrompts: false,
                trainsOnPrompts: false,
                zeroDataRetention: true,
                confidentialCompute: true,
                dataResidency: 'EU',
                compliance: ['SOC2', 'HIPAA'],
            },
        );
        assert.deepEqual(
            resolveModelDeprecationAlias({
                providerModel: 'gpt-latest',
                aliases: { aliasTarget: 'gpt-5.1' },
                lifecycle: { status: 'deprecated', replacementModel: 'gpt-5.2', expiresAt: '2026-06-01T00:00:00.000Z' },
            }),
            {
                providerModel: 'gpt-latest',
                canonicalModel: 'gpt-5.1',
                isAlias: true,
                aliasTarget: 'gpt-5.1',
                replacementModel: 'gpt-5.2',
                deprecated: true,
                retired: false,
                expiresAt: '2026-06-01T00:00:00.000Z',
                providerStatus: 'deprecated',
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

    it('resolves formal eligibility policy presets while preserving caller overrides', () => {
        const presets = listModelGatewayEligibilityPolicyPresets();
        assert.equal(presets.some((preset) => preset.id === 'fresh_account'), true);

        const fresh = resolveModelGatewayEligibilityPolicy({
            policyPreset: 'fresh-account',
            unknownAccessPolicy: 'allow_probe',
        });
        assert.equal(fresh.policyPreset, 'fresh_account');
        assert.equal(fresh.requireAccountOverlay, true);
        assert.equal(fresh.requireFreshAccountOverlay, true);
        assert.equal(fresh.unknownAccessPolicy, 'allow_probe');

        const free = resolveModelGatewayEligibilityPolicy({ policyPreset: 'free_or_known_cost' });
        assert.equal(free.requireKnownPricing, true);
        assert.equal(free.maxInputUsdPerMillion, 0);
        assert.equal(free.maxOutputUsdPerMillion, 0);
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
        assert.equal(visible.accessConfidence, 'high');
        assert.equal(visible.failureClass, 'none');
        assert.deepEqual(visible.overlayRefs, [overlay.accountOverlayId]);

        const missingSecret = resolveModelGatewayAccountAccess({
            providerId: 'openai',
            providerModel: 'gpt-visible',
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: {} }),
        });
        assert.equal(missingSecret.status, 'missing_secret');
        assert.equal(missingSecret.canAttempt, false);
        assert.equal(missingSecret.accessConfidence, 'high');
        assert.equal(missingSecret.failureClass, 'secret_configuration');
        assert.ok(missingSecret.hardReasons.includes('secret_missing:OPENAI_API_KEY'));

        const blocked = resolveModelGatewayAccountAccess({
            providerId: 'openai',
            providerModel: 'gpt-blocked',
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
        });
        assert.equal(blocked.status, 'blocked');
        assert.equal(blocked.accessConfidence, 'high');
        assert.equal(blocked.failureClass, 'policy_block');
        assert.ok(blocked.hardReasons.includes('account_model_blocked'));

        const selectorVisible = resolveModelGatewayAccountAccess({
            providerId: 'openai',
            providerModel: 'gpt-base',
            providerModelAliases: ['gpt-base:fastest'],
            accountOverlays: [
                createProviderAccountOverlay({
                    providerId: 'openai',
                    secretRef: 'OPENAI_API_KEY',
                    enabledModels: ['gpt-base:fastest'],
                }),
            ],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
        });
        assert.equal(selectorVisible.status, 'visible');
        assert.deepEqual(selectorVisible.modelIdentifiers, ['gpt-base', 'gpt-base:fastest']);

        const selectorBlocked = resolveModelGatewayAccountAccess({
            providerId: 'openai',
            providerModel: 'gpt-base',
            providerModelAliases: ['gpt-base:blocked-policy'],
            accountOverlays: [
                createProviderAccountOverlay({
                    providerId: 'openai',
                    secretRef: 'OPENAI_API_KEY',
                    enabledModels: ['gpt-base'],
                    blockedModels: ['gpt-base:blocked-policy'],
                }),
            ],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
        });
        assert.equal(selectorBlocked.status, 'blocked');
        assert.ok(selectorBlocked.hardReasons.includes('account_model_blocked'));
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
            accessConfidence: 'high',
            failureClass: 'model_visibility',
            primaryReason: 'account_model_not_visible',
            hardReasons: ['account_model_not_visible'],
            softReasons: [],
            reasons: ['secret_configured:OPENAI_API_KEY', 'account_overlay_available'],
            overlayRefs: [overlay.accountOverlayId],
            actionable: {
                category: 'blocked',
                dataNeeded: ['model_visibility'],
                probeSafe: false,
                operatorHint: 'resolve_model_visibility',
            },
            nextActions: ['choose_visible_model_or_refresh_overlay'],
            summary: 'not_visible:account_model_not_visible',
        });
    });

    it('explains unknown account access as probe-safe only when no hard gate is present', () => {
        const access = resolveModelGatewayAccountAccess({
            providerId: 'openrouter',
            providerModel: 'new/model',
            accountOverlays: [],
            secretRegistry: createEnvSecretRegistry({ env: { OPENROUTER_API_KEY: 'sk-or-test' } }),
        });

        const explanation = explainModelGatewayAccountAccess(access);

        assert.equal(explanation.status, 'missing_overlay');
        assert.equal(explanation.actionable.category, 'unknown_probe_allowed');
        assert.deepEqual(explanation.actionable.dataNeeded.sort(), ['account_overlay', 'model_visibility'].sort());
        assert.equal(explanation.actionable.probeSafe, true);
        assert.equal(explanation.actionable.operatorHint, 'run_low_cost_access_probe_or_refresh_account_overlay');
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
        assert.equal(stale.accessConfidence, 'medium');
        assert.equal(stale.failureClass, 'account_overlay');
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

    it('normalizes dynamic account key limits separately from canonical metadata', () => {
        const activeLimitedOverlay = createProviderAccountOverlay({
            providerId: 'openrouter',
            secretRef: 'OPENROUTER_API_KEY',
            enabledModels: ['anthropic/claude'],
            rateLimits: {
                remainingRequests: 0,
                resetAt: '2026-05-25T00:05:00.000Z',
            },
        });
        const active = normalizeModelGatewayAccountLimitState(activeLimitedOverlay, {
            now: '2026-05-25T00:00:00.000Z',
        });
        assert.equal(active.status, 'rate_limited');
        assert.equal(active.rateLimited, true);
        assert.equal(active.resetAt, '2026-05-25T00:05:00.000Z');
        assert.equal(active.resetWindow.class, 'temporary');
        assert.equal(active.resetWindow.source, 'explicit_reset_at');
        assert.equal(active.resetWindow.autoUnblocksAt, '2026-05-25T00:05:00.000Z');
        assert.equal(active.resetWindow.blocksUntilRefresh, false);

        const expired = normalizeModelGatewayAccountLimitState(activeLimitedOverlay, {
            now: '2026-05-25T00:06:00.000Z',
        });
        assert.equal(expired.status, 'ok');
        assert.equal(expired.rateLimited, false);
        assert.equal(expired.resetWindow.class, 'not_blocking');

        const exhaustedDailyQuota = createProviderAccountOverlay({
            providerId: 'gemini',
            secretRef: 'GEMINI_API_KEY',
            enabledModels: ['gemini-pro'],
            quota: { dailyRequests: 0, resetAt: '2026-05-25T00:05:00.000Z' },
        });
        const activeQuota = normalizeModelGatewayAccountLimitState(exhaustedDailyQuota, {
            now: '2026-05-25T00:00:00.000Z',
        });
        assert.equal(activeQuota.status, 'quota_exhausted');
        assert.equal(activeQuota.quotaExhausted, true);
        assert.equal(activeQuota.quota.resetActive, true);
        assert.equal(activeQuota.resetWindow.class, 'temporary');
        assert.equal(activeQuota.resetWindow.autoUnblocksAt, '2026-05-25T00:05:00.000Z');

        const resetQuota = normalizeModelGatewayAccountLimitState(exhaustedDailyQuota, {
            now: '2026-05-25T00:06:00.000Z',
        });
        assert.equal(resetQuota.status, 'ok');
        assert.equal(resetQuota.quotaExhausted, false);
        assert.equal(resetQuota.quota.resetExpired, true);
    });

    it('separates reset-window strategy from canonical model metadata', () => {
        const rateLimitWindow = resolveModelGatewayAccountResetWindow({
            status: 'rate_limited',
            retryAfterSeconds: 120,
            observedAt: '2026-05-25T00:00:00.000Z',
        }, {
            now: '2026-05-25T00:00:00.000Z',
        });
        assert.equal(rateLimitWindow.class, 'temporary');
        assert.equal(rateLimitWindow.source, 'retry_after');
        assert.equal(rateLimitWindow.autoUnblocksAt, '2026-05-25T00:02:00.000Z');

        const unknownQuotaWindow = resolveModelGatewayAccountResetWindow({
            status: 'quota_exhausted',
            observedAt: '2026-05-25T00:00:00.000Z',
        }, {
            now: '2026-05-25T00:01:00.000Z',
        });
        assert.equal(unknownQuotaWindow.class, 'unknown');
        assert.equal(unknownQuotaWindow.blocksUntilRefresh, true);
        assert.equal(unknownQuotaWindow.nextRefreshAfter, '2026-05-25T00:15:00.000Z');
        assert.equal(unknownQuotaWindow.retentionExpiresAt, '2026-05-26T00:00:00.000Z');

        const summary = summarizeModelGatewayAccountResetWindows([
            {
                accountOverlayId: 'openrouter:default:key',
                providerId: 'openrouter',
                status: 'rate_limited',
                retryAfterSeconds: 120,
                observedAt: '2026-05-25T00:00:00.000Z',
            },
            {
                accountOverlayId: 'groq:default:key',
                providerId: 'groq',
                status: 'key_disabled',
                observedAt: '2026-05-25T00:00:00.000Z',
            },
        ], {
            now: '2026-05-25T00:00:00.000Z',
        });
        assert.equal(summary.summary.temporary, 1);
        assert.equal(summary.summary.durable, 1);
    });

    it('blocks disabled keys and active account rate-limit windows before runtime', () => {
        const keyDisabled = resolveModelGatewayAccountAccess({
            providerId: 'openrouter',
            providerModel: 'anthropic/claude',
            accountOverlays: [
                createProviderAccountOverlay({
                    providerId: 'openrouter',
                    secretRef: 'OPENROUTER_API_KEY',
                    enabledModels: ['anthropic/claude'],
                    providerMetadata: { disabled: true },
                }),
            ],
            secretRegistry: createEnvSecretRegistry({ env: { OPENROUTER_API_KEY: 'sk-or-test' } }),
        });
        assert.equal(keyDisabled.status, 'key_disabled');
        assert.equal(keyDisabled.canAttempt, false);
        assert.equal(keyDisabled.failureClass, 'account_key');
        assert.ok(keyDisabled.hardReasons.includes('account_key_disabled'));

        const rateLimitedDecision = evaluateModelGatewayEligibility({
            projection: createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'anthropic/claude',
                pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 3 },
            }),
            accountOverlays: [
                createProviderAccountOverlay({
                    providerId: 'openrouter',
                    secretRef: 'OPENROUTER_API_KEY',
                    enabledModels: ['anthropic/claude'],
                    rateLimits: { retryAfterSeconds: 60 },
                }),
            ],
            secretRegistry: createEnvSecretRegistry({ env: { OPENROUTER_API_KEY: 'sk-or-test' } }),
            now: '2026-05-25T00:00:00.000Z',
        });
        assert.equal(rateLimitedDecision.include, false);
        assert.ok(rateLimitedDecision.hardExclusions.includes('account_rate_limited'));
        assert.equal(rateLimitedDecision.policyInputs['accountAccess']['status'], 'rate_limited');
    });

    it('derives volatile account overlays from runtime health without mutating canonical metadata', () => {
        const overlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth([
            {
                key: 'groq|groq|llama',
                providerId: 'groq',
                providerModel: 'llama',
                routeProfile: 'groq',
                lastStatus: 'failed',
                lastFailureKind: 'rate-limit',
                lastFailureStatusCode: 429,
                lastFailureAt: Date.parse('2026-05-25T00:00:00.000Z'),
                lastRetryAfterSeconds: 60,
            },
            {
                key: 'openrouter|openrouter|paid',
                providerId: 'openrouter',
                providerModel: 'paid',
                lastStatus: 'failed',
                lastFailureKind: 'credits',
                lastFailureStatusCode: 402,
                lastFailureAt: Date.parse('2026-05-25T00:00:00.000Z'),
            },
            {
                key: 'chutes|chutes|legacy',
                providerId: 'chutes',
                providerModel: 'legacy',
                lastStatus: 'failed',
                lastFailureKind: null,
                lastErrorContext: 'provider.credits',
                lastMessage: '402 status code',
                lastFailureAt: Date.parse('2026-05-25T00:00:00.000Z'),
            },
        ]);

        assert.equal(overlays.length, 3);
        assert.equal(overlays[0].sourceKind, 'runtime_health');
        assert.equal(overlays[0].confidence, 'probe_failed');
        assert.deepEqual(overlays[0].enabledModels, ['llama']);
        assert.equal(overlays[0].rateLimits.limited, true);
        assert.equal(overlays[0].rateLimits.retryAfterSeconds, 60);
        assert.equal(overlays[0].rateLimits.resetAt, '2026-05-25T00:01:00.000Z');
        assert.equal(overlays[0].expiresAt, '2026-05-25T00:01:00.000Z');
        assert.equal(overlays[1].quota.remainingCreditsUsd, 0);
        assert.equal(overlays[1].spendingLimits.remainingUsd, 0);
        assert.equal(overlays[2].providerId, 'chutes');
        assert.equal(overlays[2].secretRef, 'CHUTES_API_KEY');
        assert.equal(overlays[2].providerMetadata.failureKind, 'credits');
        const summary = summarizeModelGatewayRuntimeAccountOverlays(overlays, {
            maxItems: 2,
            maxModelsPerOverlay: 1,
            now: '2026-05-25T00:00:30.000Z',
        });
        assert.equal(summary.total, 3);
        assert.equal(summary.activeCount, 3);
        assert.equal(summary.expiredCount, 0);
        assert.deepEqual(summary.byProvider, { chutes: 1, groq: 1, openrouter: 1 });
        assert.deepEqual(summary.byFailureKind, { credits: 2, 'rate-limit': 1 });
        assert.equal(summary.items.length, 2);
        assert.deepEqual(summary.items[0], {
            providerId: 'chutes',
            failureKind: 'credits',
            modelCount: 1,
            models: ['legacy'],
            sourceKind: 'runtime_health',
            expired: false,
            disabled: false,
            retryAfterSeconds: null,
            resetAt: null,
            expiresAt: '2026-05-25T01:00:00.000Z',
        });
        assert.equal(JSON.stringify(overlays).includes('sk-'), false);
        assert.equal(JSON.stringify(summary).includes('sk-'), false);
    });

    it('maps runtime-health overlays to canonical provider secret refs without provider-specific ad hoc callers', () => {
        const overlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth([
            {
                providerId: 'cerebras',
                providerModel: 'llama3.1-8b',
                lastStatus: 'failed',
                lastFailureKind: 'auth',
                lastFailureStatusCode: 401,
            },
            {
                providerId: 'kilo-code',
                providerModel: 'kilo-auto/free',
                lastStatus: 'failed',
                lastMessage: 'provider rate limit: 429',
                lastRetryAfterSeconds: 15,
            },
            {
                providerId: 'ollama-cloud',
                providerModel: 'gpt-oss:120b',
                lastStatus: 'failed',
                lastErrorContext: 'provider.credits',
            },
        ]);

        assert.equal(overlays.length, 3);
        assert.equal(overlays[0].secretRef, 'CEREBRAS_API_KEY');
        assert.equal(overlays[0].providerMetadata.disabled, true);
        assert.equal(overlays[1].secretRef, 'KILO_CODE_API_KEY');
        assert.equal(overlays[1].rateLimits.retryAfterSeconds, 15);
        assert.equal(overlays[2].secretRef, 'OLLAMA_CLOUD_API_KEY');
        assert.equal(overlays[2].quota.remainingCreditsUsd, 0);

        const accountWide = deriveModelGatewayRuntimeAccountOverlaysFromHealth(
            [
                {
                    providerId: 'chutes',
                    providerModel: 'model-that-spent-the-key',
                    lastStatus: 'failed',
                    lastFailureKind: 'credits',
                    lastFailureStatusCode: 402,
                },
            ],
            { accountWideFailureKinds: ['credits'] },
        );
        assert.equal(accountWide.length, 1);
        assert.deepEqual(accountWide[0].enabledModels, []);
        assert.equal(accountWide[0].providerMetadata.accountWide, true);
    });

    it('derives runtime account overlays from persisted SQLite runtime classification fields', () => {
        const overlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth([
            {
                key: 'default|openrouter|model-streaming',
                providerId: 'openrouter',
                providerModel: 'model-streaming',
                routeProfile: 'default',
                runtimeHealthStatus: 'failed',
                runtimeClassifiedFailure: 'rate-limit',
                runtimeObservedAtMs: Date.parse('2026-05-25T00:10:00.000Z'),
                probes: {
                    streaming: {
                        kind: 'streaming',
                        status: 'failed',
                        ok: false,
                        lastAt: Date.parse('2026-05-25T00:10:00.000Z'),
                        lastFailureKind: 'rate-limit',
                    },
                },
            },
        ]);

        assert.equal(overlays.length, 1);
        assert.equal(overlays[0].providerId, 'openrouter');
        assert.equal(overlays[0].providerMetadata.failureKind, 'rate-limit');
        assert.equal(overlays[0].providerMetadata.runtimeHealthStatus, 'failed');
        assert.equal(overlays[0].providerMetadata.runtimeObservedAtMs, Date.parse('2026-05-25T00:10:00.000Z'));
        assert.equal(overlays[0].observedAt, '2026-05-25T00:10:00.000Z');
        assert.equal(overlays[0].expiresAt, '2026-05-25T01:10:00.000Z');
    });

    it('summarizes account/key overlays for operator pre-runtime visibility', () => {
        const summary = summarizeModelGatewayAccountOverlays([
            createProviderAccountOverlay({
                providerId: 'openrouter',
                accountScope: 'default',
                secretRef: 'OPENROUTER_API_KEY',
                enabledModels: ['a', 'b'],
                rateLimits: { remainingRequests: 0, resetAt: '2026-05-25T00:05:00.000Z' },
            }),
            createProviderAccountOverlay({
                providerId: 'groq',
                accountScope: 'org',
                secretRef: 'GROQ_API_KEY',
                spendingLimits: { remainingUsd: 12 },
            }),
        ], {
            now: '2026-05-25T00:00:00.000Z',
        });

        assert.equal(summary.summary.total, 2);
        assert.equal(summary.summary.providers, 2);
        assert.equal(summary.summary.statusCounts['rate_limited'], 1);
        assert.equal(summary.summary.statusCounts['ok'], 1);
        assert.equal(summary.rows[0].enabledModelCount, 2);
        assert.equal(summary.rows[0].limitStatus, 'rate_limited');
        assert.equal(summary.rows[0].resetAt, '2026-05-25T00:05:00.000Z');
        assert.equal(summary.rows[0].quotaResetActive, false);
        assert.equal(summary.rows[0].quotaResetExpired, false);
        assert.equal(summary.rows[0].freshnessStatus, 'fresh');
        assert.equal(summary.rows[0].freshnessTtlSeconds, 900);
        assert.equal(summary.rows[0].resetWindowClass, 'temporary');
        assert.equal(summary.rows[0].resetWindowSource, 'explicit_reset_at');
        assert.equal(summary.rows[0].autoUnblocksAt, '2026-05-25T00:05:00.000Z');
    });

    it('applies account overlay freshness policy without mutating canonical metadata', () => {
        const overlay = createProviderAccountOverlay({
            providerId: 'openrouter',
            secretRef: 'OPENROUTER_API_KEY',
            enabledModels: ['fresh-model'],
            sourceKind: 'authenticated_account_api',
            observedAt: '2026-05-25T00:00:00.000Z',
        });
        const policy = resolveModelGatewayAccountOverlayFreshnessPolicy(overlay);
        assert.equal(policy.ttlSeconds, 900);
        assert.equal(policy.policySource, 'provider');

        const fresh = evaluateModelGatewayAccountOverlayFreshness(overlay, {
            now: '2026-05-25T00:05:00.000Z',
        });
        assert.equal(fresh.status, 'fresh');
        assert.equal(fresh.effectiveExpiresAt, '2026-05-25T00:15:00.000Z');

        const stale = evaluateModelGatewayAccountOverlayFreshness(overlay, {
            now: '2026-05-25T00:13:00.000Z',
        });
        assert.equal(stale.status, 'stale');

        const expired = evaluateModelGatewayAccountOverlayFreshness(overlay, {
            now: '2026-05-25T00:16:00.000Z',
        });
        assert.equal(expired.status, 'expired');

        const summary = summarizeModelGatewayAccountOverlayFreshness([overlay], {
            now: '2026-05-25T00:16:00.000Z',
        });
        assert.equal(summary.summary.expired, 1);
    });

    it('blocks expired account overlays by provider freshness TTL when strict freshness is required', () => {
        const overlay = createProviderAccountOverlay({
            providerId: 'openrouter',
            secretRef: 'OPENROUTER_API_KEY',
            enabledModels: ['old-model'],
            sourceKind: 'authenticated_account_api',
            observedAt: '2026-05-25T00:00:00.000Z',
        });
        const access = resolveModelGatewayAccountAccess({
            providerId: 'openrouter',
            providerModel: 'old-model',
            accountOverlays: [overlay],
            secretRegistry: { has: () => true },
            requireFreshAccountOverlay: true,
            now: '2026-05-25T00:16:00.000Z',
        });
        assert.equal(access.status, 'expired');
        assert.equal(access.canAttempt, false);
        assert.ok(access.hardReasons.includes('account_overlay_expired'));
    });

    it('explains active and expired account/key limit overlays before runtime', () => {
        const explanation = explainModelGatewayAccountLimitOverlays([
            createProviderAccountOverlay({
                providerId: 'openrouter',
                accountScope: 'default',
                secretRef: 'OPENROUTER_API_KEY',
                sourceKind: 'authenticated_account_api',
                rateLimits: { remainingRequests: 0, resetAt: '2026-05-25T00:05:00.000Z' },
            }),
            createProviderAccountOverlay({
                providerId: 'groq',
                accountScope: 'default',
                secretRef: 'GROQ_API_KEY',
                sourceKind: 'runtime_health',
                quota: { dailyRequests: 0, resetAt: '2026-05-25T00:01:00.000Z' },
                expiresAt: '2026-05-25T00:02:00.000Z',
                providerMetadata: { failureKind: 'credits' },
            }),
        ], {
            now: '2026-05-25T00:03:00.000Z',
        });

        assert.equal(explanation.summary.total, 2);
        assert.equal(explanation.summary.activeBlockers, 1);
        assert.equal(explanation.summary.expiredSignals, 1);
        assert.equal(explanation.summary.temporaryBlockers, 1);
        assert.equal(explanation.summary.bySourceLayer.account, 1);
        assert.equal(explanation.summary.bySourceLayer.runtime, 1);
        assert.equal(explanation.rows[0].providerId, 'openrouter');
        assert.equal(explanation.rows[0].limitStatus, 'rate_limited');
        assert.equal(explanation.rows[0].activeBlocker, true);
        assert.equal(explanation.rows[0].nextAction, 'wait_for_rate_limit_reset_or_choose_another_route');
        assert.equal(explanation.rows[0].resetWindowClass, 'temporary');
        assert.equal(explanation.rows[0].nextRefreshAfter, '2026-05-25T00:05:00.000Z');
        assert.equal(explanation.rows[1].providerId, 'groq');
        assert.equal(explanation.rows[1].expiredSignal, true);
        assert.equal(explanation.rows[1].nextAction, 'refresh_overlay_or_retry_pre_runtime_selection');
    });

    it('summarizes provider quota capability surfaces without treating SDK quota as BYOK truth', () => {
        const openRouterRows = listModelGatewayProviderQuotaCapabilities({ selector: 'openrouter' });
        assert.equal(openRouterRows.length, 1);
        assert.equal(openRouterRows[0].quotaSnapshot, 'key_credit_balance');
        assert.equal(openRouterRows[0].sdkQuotaAppliesToByok, false);

        const matrix = summarizeModelGatewayProviderQuotaCapabilities();
        assert.equal(matrix.summary.total >= 10, true);
        assert.equal(matrix.summary.sdkQuotaByokTruthCount, 0);
        assert.equal(matrix.summary.quotaSnapshotCount >= 2, true);
        assert.equal(matrix.summary.runtimeFailureOverlayCount > 0, true);
        assert.equal(matrix.summary.byQuotaSnapshot['sdk_entitlement_separate'], 1);
    });

    it('normalizes SDK AssistantUsage quota as host entitlement, not BYOK provider quota', () => {
        const summary = summarizeModelGatewaySdkQuotaSnapshots({
            quotaSnapshots: {
                premium_interactions: {
                    entitlementRequests: 1000,
                    usedRequests: 990,
                    overage: 0,
                    remainingPercentage: 1,
                    resetDate: '2026-06-01',
                    usageAllowedWithExhaustedQuota: false,
                    overageAllowedWithExhaustedQuota: false,
                },
                chat: {
                    remainingPercentage: 0,
                    usageAllowedWithExhaustedQuota: true,
                },
            },
        });

        assert.equal(summary.summary.total, 2);
        assert.equal(summary.rows[0].remainingFraction, 1);
        assert.equal(summary.rows[0].remainingPercentage, 100);
        assert.equal(summary.rows[0].scope, 'copilot_sdk_entitlement');
        assert.equal(summary.rows[0].appliesToByokProviderRuntime, false);
        assert.equal(summary.rows[0].canBlockSdkNativeRoute, false);
        assert.equal(summary.rows[1].status, 'exhausted');
        assert.equal(summary.rows[1].canBlockSdkNativeRoute, false);
        assert.equal(summary.summary.status, 'exhausted');
        assert.equal(summary.summary.appliesToByokProviderRuntime, false);
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
        assert.equal(decision.policyInputs['accountAccess']['accessConfidence'], 'high');
        assert.equal(decision.policyInputs['accountAccess']['failureClass'], 'secret_configuration');
        assert.equal(Array.isArray(decision.policyInputs['accountAccess']['resetWindows']), true);
        assert.equal(JSON.stringify(decision).includes('OPENAI_API_KEY'), true);
    });

    it('evaluates account-scoped selector syntax visibility before runtime', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const route = createModelRouteOption({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            selectorKind: 'gateway_policy',
            selectorSyntax: 'openai/gpt-oss-120b:fastest',
        });
        const visible = evaluateModelGatewayEligibility({
            projection,
            routeOption: route,
            accountOverlays: [
                createProviderAccountOverlay({
                    providerId: 'openrouter',
                    secretRef: 'OPENROUTER_API_KEY',
                    enabledModels: ['openai/gpt-oss-120b:fastest'],
                }),
            ],
            secretRegistry: createEnvSecretRegistry({ env: { OPENROUTER_API_KEY: 'sk-or-test' } }),
        });
        assert.equal(visible.include, true);
        assert.equal(visible.selectorSyntax, 'openai/gpt-oss-120b:fastest');
        assert.deepEqual(visible.policyInputs['accountAccess']['modelIdentifiers'], [
            'openai/gpt-oss-120b',
            'openai/gpt-oss-120b:fastest',
        ]);

        const blocked = evaluateModelGatewayEligibility({
            projection,
            routeOption: route,
            accountOverlays: [
                createProviderAccountOverlay({
                    providerId: 'openrouter',
                    secretRef: 'OPENROUTER_API_KEY',
                    enabledModels: ['openai/gpt-oss-120b'],
                    blockedModels: ['openai/gpt-oss-120b:fastest'],
                }),
            ],
            secretRegistry: createEnvSecretRegistry({ env: { OPENROUTER_API_KEY: 'sk-or-test' } }),
        });
        assert.equal(blocked.include, false);
        assert.ok(blocked.hardExclusions.includes('account_model_blocked'));
    });

    it('applies eligibility policy presets inside pre-runtime decisions', () => {
        const decision = evaluateModelGatewayEligibility({
            projection: createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
            }),
            policy: { policyPreset: 'fresh_account' },
            secretRegistry: createEnvSecretRegistry({ env: { OPENROUTER_API_KEY: 'sk-or-test' } }),
        });
        assert.equal(decision.include, false);
        assert.ok(decision.hardExclusions.includes('account_overlay_missing'));
        assert.equal(decision.policyInputs['policyPreset'], 'fresh_account');
        assert.equal(decision.policyInputs['unknownAccessPolicy'], 'block');
    });

    it('applies upstream, route layer and wire API gates before runtime ranking', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'kilo',
            providerModel: 'anthropic/claude-sonnet-4.5',
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const route = createModelRouteOption({
            providerId: 'kilo',
            providerModel: 'anthropic/claude-sonnet-4.5',
            selectorKind: 'gateway_policy',
            selectorSyntax: 'anthropic/claude-sonnet-4.5:fastest',
            providerSpecific: { upstreamProvider: 'anthropic' },
            normalizedPolicy: { routeLayer: 'gateway', wireApi: 'openai_chat_completions' },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'kilo',
            secretRef: 'KILO_API_KEY',
            enabledModels: ['anthropic/claude-sonnet-4.5'],
        });

        const allowed = evaluateModelGatewayEligibility({
            projection,
            routeOption: route,
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: { KILO_API_KEY: 'kilo-test' } }),
            policy: {
                allowUpstreamProviders: ['anthropic'],
                allowRouteLayers: ['gateway'],
                allowWireApis: ['openai_chat_completions'],
            },
        });
        assert.equal(allowed.include, true);
        assert.deepEqual(allowed.policyInputs['routeContext'], {
            routeLayer: 'gateway',
            wireApi: 'openai_chat_completions',
            upstreamProvider: 'anthropic',
        });

        const blocked = evaluateModelGatewayEligibility({
            projection,
            routeOption: route,
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: { KILO_API_KEY: 'kilo-test' } }),
            policy: {
                blockUpstreamProviders: ['anthropic'],
                blockRouteLayers: ['gateway'],
                blockWireApis: ['openai_chat_completions'],
            },
        });
        assert.equal(blocked.include, false);
        assert.ok(blocked.hardExclusions.includes('upstream_provider_blocked'));
        assert.ok(blocked.hardExclusions.includes('route_layer_blocked'));
        assert.ok(blocked.hardExclusions.includes('wire_api_blocked'));

        const explanation = explainModelGatewayEligibilityDecision(blocked);
        assert.equal(explanation.actionable.category, 'blocked');
        assert.deepEqual(
            explanation.actionable.dataNeeded.sort(),
            ['allowed_route_layer_policy', 'allowed_upstream_policy', 'allowed_wire_api_policy'].sort(),
        );
        assert.equal(explanation.actionable.operatorHint, 'resolve_allowed_upstream_policy');
        assert.equal(explanation.actionable.probeSafe, false);
        assert.ok(explanation.nextActions.includes('choose_allowed_upstream_provider_or_relax_policy'));
        assert.ok(explanation.nextActions.includes('choose_allowed_route_layer_or_relax_policy'));
        assert.ok(explanation.nextActions.includes('choose_allowed_wire_api_or_relax_policy'));
    });

    it('integrates fatal runtime health classification into pre-runtime eligibility', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'openai',
            providerModel: 'gpt-billing-blocked',
            pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'openai',
            secretRef: 'OPENAI_API_KEY',
            enabledModels: ['gpt-billing-blocked'],
        });
        const decision = evaluateModelGatewayEligibility({
            projection,
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: { OPENAI_API_KEY: 'sk-test' } }),
            health: {
                lastStatus: 'failed',
                lastErrorContext: { code: 'insufficient_quota', message: 'billing required' },
            },
        });

        assert.equal(decision.include, false);
        assert.equal(decision.disposition, 'excluded');
        assert.equal(decision.hardExclusions.includes('health_fatal'), true);
        assert.equal(explainModelGatewayEligibilityDecision(decision).nextActions.includes('wait_or_clear_fatal_provider_health_after_fix'), true);
    });

    it('does not keep rate-limit runtime health fatal after its reset window expires', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'groq',
            providerModel: 'openai/gpt-oss-120b',
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'groq',
            secretRef: 'GROQ_API_KEY',
            enabledModels: ['openai/gpt-oss-120b'],
        });
        const decision = evaluateModelGatewayEligibility({
            projection,
            accountOverlays: [overlay],
            secretRegistry: createEnvSecretRegistry({ env: { GROQ_API_KEY: 'gsk-test' } }),
            health: {
                lastStatus: 'failed',
                lastFailureAt: 1_700_000_000_000,
                lastErrorContext: 'provider.rate_limit',
                lastRetryAfterSeconds: 30,
            },
            now: 1_700_000_031_000,
        });
        assert.equal(decision.include, true);
        assert.equal(decision.hardExclusions.includes('health_fatal'), false);
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
            actionable: {
                category: 'blocked',
                dataNeeded: ['secret'],
                probeSafe: false,
                operatorHint: 'resolve_secret',
            },
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
        assert.deepEqual(explainModelGatewayEligibilityDecision(unknownAllowed).actionable, {
            category: 'unknown_probe_allowed',
            dataNeeded: ['account_visibility'],
            probeSafe: true,
            operatorHint: 'run_low_cost_access_probe_or_collect_overlay',
        });
    });

    it('diffs pre-runtime eligibility decisions by scoped route and classifies semantic changes', () => {
        const previous = [
            createModelEligibilityDecision({
                providerId: 'openrouter',
                providerModel: 'new/model',
                include: false,
                hardExclusions: ['account_model_not_visible'],
                policyProfile: 'strict-account',
                observedAt: '2026-05-26T20:00:00.000Z',
            }),
            createModelEligibilityDecision({
                providerId: 'openrouter',
                providerModel: 'removed/model',
                include: true,
                policyProfile: 'strict-account',
            }),
        ];
        const next = [
            createModelEligibilityDecision({
                providerId: 'openrouter',
                providerModel: 'new/model',
                include: true,
                reasons: ['account_model_visible'],
                policyProfile: 'strict-account',
                overlayRefs: ['overlay-visible'],
                observedAt: '2026-05-26T20:05:00.000Z',
            }),
            createModelEligibilityDecision({
                providerId: 'openrouter',
                providerModel: 'added/model',
                include: false,
                hardExclusions: ['secret_missing:OPENROUTER_API_KEY'],
                policyProfile: 'strict-account',
            }),
        ];

        const diff = diffModelGatewayEligibilityDecisions(previous, next);
        const summary = summarizeModelGatewayEligibilityDiff(diff);

        assert.deepEqual(diff.added, ['openrouter:added/model:default:exact_model:added/model:default:strict-account:default']);
        assert.deepEqual(diff.removed, ['openrouter:removed/model:default:exact_model:removed/model:default:strict-account:default']);
        assert.equal(diff.changed.length, 1);
        assert.equal(diff.changed[0]?.key, 'openrouter:new/model:default:exact_model:new/model:default:strict-account:default');
        assert.deepEqual(diff.changed[0]?.changedKinds.sort(), ['access_gate_changed', 'account_overlay_changed', 'disposition_changed']);
        assert.equal(summary.addedCount, 1);
        assert.equal(summary.removedCount, 1);
        assert.equal(summary.changedCount, 1);
        assert.equal(summary.becameEligibleCount, 1);
        assert.equal(summary.becameExcludedCount, 0);
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

    it('prunes stale eligibility decisions when provider models disappear from the catalog', () => {
        const current = createCanonicalModelProjection({
            providerId: 'openrouter',
            providerModel: 'current/model',
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const staleDecision = createModelEligibilityDecision({
            providerId: 'openrouter',
            providerModel: 'removed/model',
            include: true,
            policyProfile: 'strict-account',
        });
        const previousDecision = createModelEligibilityDecision({
            providerId: 'openrouter',
            providerModel: 'current/model',
            include: false,
            hardExclusions: ['account_model_not_visible'],
            policyProfile: 'strict-account',
        });
        const nextDecision = createModelEligibilityDecision({
            providerId: 'openrouter',
            providerModel: 'current/model',
            include: true,
            policyProfile: 'strict-account',
        });

        const nextSnapshot = applyModelGatewayEligibilityToSnapshot(
            {
                projections: [current],
                routeOptions: [],
                modelEligibilityDecisions: [staleDecision, previousDecision],
                modelEligibilityRuns: [],
            },
            [nextDecision],
            createModelEligibilityRun({ runId: 'eligibility-provider-removal' }),
        );

        assert.deepEqual(
            nextSnapshot.modelEligibilityDecisions.map((decision) => decision['providerModel']),
            ['current/model'],
        );
        assert.equal(nextSnapshot.modelEligibilityDecisions[0]?.['include'], true);
    });

    it('evaluates catalog eligibility per route option instead of reusing one model-level decision', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'cloudflare-workers-ai',
            providerModel: '@cf/openai/gpt-oss-120b',
            capabilities: { streaming: true, tools: true },
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const overlay = createProviderAccountOverlay({
            providerId: 'cloudflare-workers-ai',
            secretRef: 'CLOUDFLARE_API_TOKEN',
            enabledModels: ['@cf/openai/gpt-oss-120b'],
            providerMetadata: {
                accountIdConfigured: true,
                gatewayIdConfigured: false,
            },
        });
        const snapshot = {
            projections: [projection],
            routeOptions: [
                createModelRouteOption({
                    providerId: 'cloudflare-workers-ai',
                    providerModel: '@cf/openai/gpt-oss-120b',
                    selectorKind: 'exact_model',
                    selectorSyntax: '@cf/openai/gpt-oss-120b',
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
            accountOverlays: [overlay],
        };

        const evaluated = evaluateModelGatewayCatalogEligibility({
            snapshot,
            secretRegistry: { has: () => true },
            policy: { unknownAccessPolicy: 'block' },
            now: () => new Date('2026-05-26T20:00:00.000Z'),
        });
        const direct = evaluated.decisions.find((decision) => decision.selectorKind === 'exact_model');
        const gateway = evaluated.decisions.find((decision) => decision.selectorKind === 'gateway_fallback');

        assert.equal(evaluated.summary.modelCount, 2);
        assert.equal(direct?.include, true);
        assert.equal(gateway?.include, false);
        assert.deepEqual(gateway?.hardExclusions, ['cloudflare_gateway_id_missing']);

        const route = routeModelGatewayCatalogSnapshot(
            {
                ...snapshot,
                modelEligibilityDecisions: evaluated.decisions,
            },
            'tool_agent',
            { evaluateEligibility: true, requireAgentProbeOk: false },
        );

        assert.equal(route.selected?.model['selectorKind'], 'exact_model');
        assert.ok(route.rejected.some((candidate) => candidate.rejectedReasons.includes('eligibility:cloudflare_gateway_id_missing')));
    });

    it('feeds runtime health into catalog-wide eligibility without persisting provider metadata', () => {
        const projection = createCanonicalModelProjection({
            providerId: 'groq',
            providerModel: 'llama',
            pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        });
        const evaluated = evaluateModelGatewayCatalogEligibility({
            snapshot: { projections: [projection], routeOptions: [], accountOverlays: [] },
            secretRegistry: createEnvSecretRegistry({ env: { GROQ_API_KEY: 'gsk-test' } }),
            healthRecords: [
                {
                    key: 'default|groq|llama',
                    providerId: 'groq',
                    providerModel: 'llama',
                    lastStatus: 'failed',
                    lastFailureKind: 'rate-limit',
                    lastFailureAt: Date.parse('2026-05-25T22:30:00.000Z'),
                    lastRetryAfterSeconds: 60,
                },
            ],
            now: () => new Date('2026-05-25T22:30:00.000Z'),
        });

        assert.equal(evaluated.summary.excludedCount, 1);
        assert.equal(evaluated.run.policyInputs['runtimeAccountOverlayCount'], 1);
        assert.equal(evaluated.run.policyInputs['runtimeAccountOverlayActiveCount'], 1);
        assert.equal(evaluated.run.policyInputs['runtimeAccountOverlayExpiredCount'], 0);
        assert.equal(evaluated.run.policyInputs['healthRecordCount'], 1);
        assert.deepEqual(evaluated.decisions[0].hardExclusions, ['account_rate_limited']);
        assert.equal(evaluated.decisions[0].policyInputs['accountAccess']['status'], 'rate_limited');
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
            /** @type {Array<Record<string, any>>} */
            const progressEvents = [];
            const result = await refreshModelGatewayCatalog({
                store,
                writePolicy: 'commit',
                now: () => new Date('2026-05-25T12:30:00.000Z'),
                onProgress: (event) => progressEvents.push(event),
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
            assert.deepEqual(result.writePolicy, { mode: 'commit', storeAvailable: true, committed: true });
            const refreshRun = stored.importRuns.find((run) => run.providerId === 'model-gateway' && run.sourceId === 'catalog-refresh');
            assert.equal(refreshRun?.status, 'completed');
            assert.deepEqual(refreshRun?.diff?.added, ['openrouter:new-model:default']);
            assert.deepEqual(refreshRun?.diff?.removed, ['openrouter:old-model:default']);
            assert.ok(progressEvents.some((event) => event['phase'] === 'refresh_started' && event['writePolicy'] === 'commit'));
            assert.ok(progressEvents.some((event) => event['phase'] === 'refresh_plan_ready' && event['selectedCount'] === 1));
            assert.ok(progressEvents.some((event) => event['phase'] === 'importer:importer_completed'));
            assert.ok(progressEvents.some((event) => event['phase'] === 'projections_built' && event['addedCount'] === 1));
            assert.ok(progressEvents.some((event) => event['phase'] === 'snapshot_written' && event['committed'] === true));
            assert.ok(progressEvents.some((event) => event['phase'] === 'refresh_completed' && event['progressPct'] === 100));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('materializes route-level eligibility during catalog refresh when enabled', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-model-refresh-eligibility-'));
        try {
            const store = new JsonModelGatewayCatalogStore({ filePath: join(dir, 'catalog.json') });
            await store.writeSnapshot({ sources: [], projections: [] });
            /** @type {Array<Record<string, any>>} */
            const progressEvents = [];
            const result = await refreshModelGatewayCatalog({
                store,
                writePolicy: 'commit',
                now: () => new Date('2026-05-26T20:30:00.000Z'),
                onProgress: (event) => progressEvents.push(event),
                refreshAccountOverlays: true,
                eligibility: {
                    enabled: true,
                    secretRegistry: { has: () => true },
                    policy: { unknownAccessPolicy: 'block', policyProfile: 'refresh-strict' },
                },
                importers: [
                    {
                        id: 'cloudflare-workers-ai-test',
                        providerId: 'cloudflare-workers-ai',
                        sourceKind: 'authenticated_catalog',
                        requiresAuth: false,
                        fetchRaw: () => [{ id: '@cf/openai/gpt-oss-120b' }],
                        parseRows: (raw) => /** @type {unknown[]} */ (raw),
                        toEvidenceFacts: (rows, context) =>
                            rows.map((row) =>
                                createModelMetadataEvidence({
                                    evidenceId: 'cf-model',
                                    providerId: 'cloudflare-workers-ai',
                                    providerModel: /** @type {{ id: string }} */ (row).id,
                                    fieldPath: 'capabilities.tools',
                                    value: true,
                                    sourceId: /** @type {{ id: string }} */ (context.source).id,
                                    confidence: 'catalog',
                                }),
                            ),
                        toRouteOptions: () => [
                            createModelRouteOption({
                                providerId: 'cloudflare-workers-ai',
                                providerModel: '@cf/openai/gpt-oss-120b',
                                selectorKind: 'exact_model',
                                normalizedPolicy: { wireApi: 'workers_ai_run' },
                            }),
                            createModelRouteOption({
                                providerId: 'cloudflare-workers-ai',
                                providerModel: '@cf/openai/gpt-oss-120b',
                                selectorKind: 'gateway_fallback',
                                selectorSyntax: 'cloudflare-gateway:@cf/openai/gpt-oss-120b',
                                normalizedPolicy: { wireApi: 'cloudflare_ai_gateway_universal' },
                            }),
                        ],
                        toAccountOverlays: () => [
                            createProviderAccountOverlay({
                                providerId: 'cloudflare-workers-ai',
                                secretRef: 'CLOUDFLARE_API_TOKEN',
                                enabledModels: ['@cf/openai/gpt-oss-120b'],
                                providerMetadata: { accountIdConfigured: true, gatewayIdConfigured: false },
                            }),
                        ],
                    },
                ],
            });
            const stored = await store.readSnapshot();

            assert.equal(result.eligibilityRefresh.enabled, true);
            assert.equal(result.eligibilityRefresh.decisionCount, 2);
            assert.equal(result.eligibilityRefresh.diffSummary.addedCount, 2);
            assert.equal(result.eligibilityRefresh.diffSummary.changedCount, 0);
            assert.equal(result.eligibilityRefresh.run.diffSummary.addedCount, 2);
            assert.equal(stored.modelEligibilityDecisions.length, 2);
            assert.equal(stored.modelEligibilityRuns[0]?.['diffSummary']?.['addedCount'], 2);
            assert.equal(result.openai.data[0].x_model_gateway.eligibility.status, 'eligible');
            assert.ok(
                progressEvents.some(
                    (event) =>
                        event['phase'] === 'eligibility_evaluated' &&
                        event['eligibilityDecisionCount'] === 2 &&
                        event['eligibilityAddedCount'] === 2,
                ),
            );
            assert.ok(
                stored.modelEligibilityDecisions.some(
                    (decision) =>
                        decision['selectorKind'] === 'gateway_fallback' &&
                        Array.isArray(decision['hardExclusions']) &&
                        decision['hardExclusions'].includes('cloudflare_gateway_id_missing'),
                ),
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('summarizes refresh JSONL logs without mutating canonical metadata', () => {
        const text = [
            JSON.stringify({ ts: '2026-05-26T12:00:00.000Z', phase: 'refresh_started', elapsedMs: 0 }),
            JSON.stringify({
                ts: '2026-05-26T12:00:01.000Z',
                phase: 'importer:importer_completed',
                importer: { importerId: 'openrouter-models', rowCount: 2, evidenceCount: 7 },
                rowCount: 2,
                evidenceCount: 7,
            }),
            JSON.stringify({
                ts: '2026-05-26T12:00:02.000Z',
                phase: 'importer:importer_failed',
                importer: { importerId: 'broken-models' },
                errors: ['token [redacted] rejected'],
            }),
            JSON.stringify({
                ts: '2026-05-26T12:00:03.000Z',
                phase: 'refresh_completed',
                elapsedMs: 3000,
                committed: true,
                projectionCount: 42,
                openai: 42,
                overlays: 3,
                addedCount: 2,
                removedCount: 0,
                changedCount: 1,
            }),
            'not-json',
        ].join('\n');

        const parsed = parseModelGatewayRefreshLogText(text);
        const summary = summarizeModelGatewayRefreshLogText(text, { logPath: 'logs/model-gateway-refresh/run.jsonl' });

        assert.equal(parsed.events.length, 4);
        assert.equal(parsed.invalidLineCount, 1);
        assert.equal(summary.completed, true);
        assert.equal(summary.committed, true);
        assert.equal(summary.elapsedMs, 3000);
        assert.deepEqual(summary.totals, { projections: 42, openai: 42, overlays: 3, added: 2, removed: 0, changed: 1 });
        assert.equal(summary.importers['openrouter-models'].completed, 1);
        assert.equal(summary.importers['openrouter-models'].rowCount, 2);
        assert.equal(summary.failures[0].importerId, 'broken-models');
        assert.equal(JSON.stringify(summary).includes('secret'), false);
    });

    it('previews catalog refreshes by default and requires explicit commit policy to write the active store', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-model-refresh-preview-'));
        try {
            const filePath = join(dir, 'catalog.json');
            const store = new JsonModelGatewayCatalogStore({ filePath });
            await store.writeSnapshot({
                source: 'previous',
                evidences: [
                    createModelMetadataEvidence({
                        evidenceId: 'previous-model',
                        providerId: 'openrouter',
                        providerModel: 'previous-model',
                        fieldPath: 'displayName',
                        value: 'Previous Model',
                        sourceId: 'operator',
                        confidence: 'manual',
                    }),
                ],
                projections: [createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'previous-model' })],
            });

            const preview = await refreshModelGatewayCatalog({
                store,
                now: () => new Date('2026-05-25T12:30:00.000Z'),
                importers: [
                    {
                        id: 'openrouter-models',
                        providerId: 'openrouter',
                        sourceKind: 'public_api',
                        requiresAuth: false,
                        fetchRaw: () => ({ data: [{ id: 'preview-model', name: 'Preview Model' }] }),
                        parseRows: (raw) => /** @type {{ data: unknown[] }} */ (raw).data,
                        toEvidenceFacts: (rows, context) =>
                            rows.map((row) =>
                                createModelMetadataEvidence({
                                    evidenceId: 'preview-model-evidence',
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

            assert.deepEqual(preview.writePolicy, { mode: 'preview', storeAvailable: true, committed: false });
            assert.equal(preview.snapshot.projections.some((projection) => projection.providerModel === 'preview-model'), true);
            assert.equal(stored.projections.some((projection) => projection.providerModel === 'preview-model'), false);
            assert.equal(stored.projections.some((projection) => projection.providerModel === 'previous-model'), true);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('guards concurrent catalog refreshes with a process-local lock key', async () => {
        /** @type {(() => void) | null} */
        let releaseFetch = null;
        const blockedFetch = new Promise((resolve) => {
            releaseFetch = () => resolve({ data: [] });
        });
        const first = refreshModelGatewayCatalog({
            snapshot: { schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION },
            lockKey: 'unit-refresh-lock',
            importers: [
                {
                    id: 'slow-source',
                    providerId: 'openrouter',
                    sourceKind: 'public_api',
                    requiresAuth: false,
                    fetchRaw: () => blockedFetch,
                    parseRows: () => [],
                    toEvidenceFacts: () => [],
                },
            ],
        });

        assert.equal(isModelGatewayCatalogRefreshLocked('unit-refresh-lock'), true);
        const secondError = await refreshModelGatewayCatalog({
            snapshot: { schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION },
            lockKey: 'unit-refresh-lock',
            importers: [],
        }).catch((error) => error);

        assert.equal(secondError?.name, 'ModelGatewayCatalogRefreshLockError');
        assert.equal(secondError?.code, 'MODEL_GATEWAY_CATALOG_REFRESH_LOCKED');
        releaseFetch?.();
        const firstResult = await first;

        assert.deepEqual(firstResult.refreshLock, { enabled: true, key: 'unit-refresh-lock' });
        assert.equal(isModelGatewayCatalogRefreshLocked('unit-refresh-lock'), false);
    });

    it('plans incremental catalog refreshes from source TTL before any fetch is attempted', () => {
        const now = () => new Date('2026-05-25T12:00:00.000Z');
        const importers = [
            {
                id: 'fresh-source',
                providerId: 'openrouter',
                sourceKind: 'public_api',
                requiresAuth: false,
                ttlSeconds: 3600,
                fetchRaw: () => ({ data: [] }),
                parseRows: () => [],
                toEvidenceFacts: () => [],
            },
            {
                id: 'stale-source',
                providerId: 'kilo',
                sourceKind: 'public_api',
                requiresAuth: false,
                ttlSeconds: 3600,
                fetchRaw: () => ({ data: [] }),
                parseRows: () => [],
                toEvidenceFacts: () => [],
            },
        ];
        const plan = planModelGatewayCatalogRefresh({
            importers,
            now,
            sources: [
                {
                    ...createProviderCatalogSource({
                        id: 'fresh-source',
                        providerId: 'openrouter',
                        kind: 'public_api',
                        ttlSeconds: 3600,
                    }),
                    updatedAt: '2026-05-25T11:45:00.000Z',
                },
                {
                    ...createProviderCatalogSource({
                        id: 'stale-source',
                        providerId: 'kilo',
                        kind: 'public_api',
                        ttlSeconds: 3600,
                    }),
                    updatedAt: '2026-05-25T10:00:00.000Z',
                },
            ],
        });

        assert.deepEqual(
            plan.skipped.map((entry) => [entry.sourceId, entry.reason, entry.ageSeconds]),
            [['fresh-source', 'source_ttl_fresh', 900]],
        );
        assert.deepEqual(
            plan.selected.map((entry) => [entry.sourceId, entry.reason, entry.ageSeconds]),
            [['stale-source', 'source_ttl_expired', 7200]],
        );
        assert.deepEqual(
            plan.selectedImporters.map((importer) => importer.id),
            ['stale-source'],
        );
    });

    it('runs only expired sources during incremental catalog refresh while preserving fresh evidence', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-model-refresh-incremental-'));
        try {
            const calls = { fresh: 0, stale: 0 };
            const filePath = join(dir, 'catalog.json');
            const store = new JsonModelGatewayCatalogStore({ filePath });
            await store.writeSnapshot({
                source: 'previous',
                sources: [
                    {
                        ...createProviderCatalogSource({
                            id: 'fresh-source',
                            providerId: 'openrouter',
                            kind: 'public_api',
                            ttlSeconds: 3600,
                        }),
                        updatedAt: '2026-05-25T11:45:00.000Z',
                    },
                    {
                        ...createProviderCatalogSource({
                            id: 'stale-source',
                            providerId: 'kilo',
                            kind: 'public_api',
                            ttlSeconds: 3600,
                        }),
                        updatedAt: '2026-05-25T10:00:00.000Z',
                    },
                ],
                evidences: [
                    createModelMetadataEvidence({
                        evidenceId: 'fresh-old-evidence',
                        providerId: 'openrouter',
                        providerModel: 'fresh-model',
                        fieldPath: 'displayName',
                        value: 'Fresh Model',
                        sourceId: 'fresh-source',
                        confidence: 'catalog',
                    }),
                    createModelMetadataEvidence({
                        evidenceId: 'stale-old-evidence',
                        providerId: 'kilo',
                        providerModel: 'stale-old-model',
                        fieldPath: 'displayName',
                        value: 'Stale Old Model',
                        sourceId: 'stale-source',
                        confidence: 'catalog',
                    }),
                ],
            });

            const result = await refreshModelGatewayCatalog({
                store,
                incremental: true,
                now: () => new Date('2026-05-25T12:00:00.000Z'),
                importers: [
                    {
                        id: 'fresh-source',
                        providerId: 'openrouter',
                        sourceKind: 'public_api',
                        requiresAuth: false,
                        ttlSeconds: 3600,
                        fetchRaw: () => {
                            calls.fresh += 1;
                            return { data: [{ id: 'should-not-fetch' }] };
                        },
                        parseRows: (raw) => /** @type {{ data: unknown[] }} */ (raw).data,
                        toEvidenceFacts: () => [],
                    },
                    {
                        id: 'stale-source',
                        providerId: 'kilo',
                        sourceKind: 'public_api',
                        requiresAuth: false,
                        ttlSeconds: 3600,
                        fetchRaw: () => {
                            calls.stale += 1;
                            return { data: [{ id: 'stale-new-model', name: 'Stale New Model' }] };
                        },
                        parseRows: (raw) => /** @type {{ data: unknown[] }} */ (raw).data,
                        toEvidenceFacts: (rows, context) =>
                            rows.map((row) =>
                                createModelMetadataEvidence({
                                    evidenceId: 'stale-new-evidence',
                                    providerId: 'kilo',
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

            assert.deepEqual(calls, { fresh: 0, stale: 1 });
            assert.deepEqual(result.refreshPlan?.skipped.map((entry) => [entry.sourceId, entry.reason]), [
                ['fresh-source', 'source_ttl_fresh'],
            ]);
            assert.deepEqual(result.refreshPlan?.selected.map((entry) => [entry.sourceId, entry.reason]), [
                ['stale-source', 'source_ttl_expired'],
            ]);
            assert.equal(result.snapshot.projections.some((projection) => projection.providerModel === 'fresh-model'), true);
            assert.equal(result.snapshot.projections.some((projection) => projection.providerModel === 'stale-old-model'), false);
            assert.equal(result.snapshot.projections.some((projection) => projection.providerModel === 'stale-new-model'), true);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('separates public catalog refresh from account overlay refresh by default', async () => {
        const previousOverlay = createProviderAccountOverlay({
            providerId: 'openai',
            accountScope: 'default',
            secretRef: 'OPENAI_API_KEY',
            sourceId: 'openai-models',
            sourceKind: 'account_api',
            enabledModels: ['gpt-old-visible'],
        });
        const importer = {
            id: 'openai-models',
            providerId: 'openai',
            sourceKind: 'account_api',
            requiresAuth: true,
            fetchRaw: () => ({ data: [{ id: 'gpt-new-visible' }] }),
            parseRows: (raw) => /** @type {{ data: unknown[] }} */ (raw).data,
            toEvidenceFacts: (rows, context) =>
                rows.map((row) =>
                    createModelMetadataEvidence({
                        evidenceId: 'openai-new-visible-name',
                        providerId: 'openai',
                        providerModel: /** @type {{ id: string }} */ (row).id,
                        fieldPath: 'displayName',
                        value: 'GPT New Visible',
                        sourceId: /** @type {{ id: string }} */ (context.source).id,
                        confidence: 'account',
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                ),
            toAccountOverlays: (rows, context) => [
                createProviderAccountOverlay({
                    providerId: 'openai',
                    accountScope: 'default',
                    secretRef: 'OPENAI_API_KEY',
                    sourceId: /** @type {{ id: string }} */ (context.source).id,
                    sourceKind: 'account_api',
                    enabledModels: rows.map((row) => /** @type {{ id: string }} */ (row).id),
                }),
            ],
        };

        const publicRefresh = await refreshModelGatewayCatalog({
            snapshot: {
                schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
                accountOverlays: [previousOverlay],
            },
            now: () => new Date('2026-05-25T12:00:00.000Z'),
            importers: [importer],
        });

        assert.equal(publicRefresh.overlayRefresh.enabled, false);
        assert.equal(publicRefresh.overlayRefresh.imported, 1);
        assert.deepEqual(publicRefresh.snapshot.accountOverlays[0]?.enabledModels, ['gpt-old-visible']);

        const accountRefresh = await refreshModelGatewayCatalog({
            snapshot: {
                schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
                accountOverlays: [previousOverlay],
            },
            refreshAccountOverlays: true,
            now: () => new Date('2026-05-25T12:00:00.000Z'),
            importers: [importer],
        });

        assert.equal(accountRefresh.overlayRefresh.enabled, true);
        assert.equal(accountRefresh.overlayRefresh.imported, 1);
        assert.deepEqual(accountRefresh.snapshot.accountOverlays[0]?.enabledModels, ['gpt-new-visible']);
    });

    it('applies retention policy to refresh operational history without pruning canonical metadata', async () => {
        const retained = applyModelGatewayCatalogRetention(
            {
                importRuns: [
                    { runId: 'old', completedAt: '2026-05-25T10:00:00.000Z' },
                    { runId: 'new', completedAt: '2026-05-25T12:00:00.000Z' },
                ],
                rawPayloadRefs: [
                    { rawPayloadRef: 'raw-old', observedAt: '2026-05-25T10:00:00.000Z' },
                    { rawPayloadRef: 'raw-new', observedAt: '2026-05-25T12:00:00.000Z' },
                ],
                conflicts: [
                    { conflictId: 'conflict-old', observedAt: '2026-05-25T10:00:00.000Z' },
                    { conflictId: 'conflict-new', observedAt: '2026-05-25T12:00:00.000Z' },
                ],
                modelEligibilityRuns: [
                    { runId: 'eligibility-old', completedAt: '2026-05-25T10:00:00.000Z' },
                    { runId: 'eligibility-new', completedAt: '2026-05-25T12:00:00.000Z' },
                ],
                projections: [createCanonicalModelProjection({ providerId: 'openrouter', providerModel: 'kept-model' })],
                evidences: [
                    createModelMetadataEvidence({
                        evidenceId: 'kept-evidence',
                        providerId: 'openrouter',
                        providerModel: 'kept-model',
                        fieldPath: 'displayName',
                        value: 'Kept Model',
                        sourceId: 'source',
                        confidence: 'catalog',
                    }),
                ],
            },
            {
                maxImportRuns: 1,
                maxRawPayloadRefs: 1,
                maxConflicts: 1,
                maxModelEligibilityRuns: 1,
            },
        );

        assert.equal(retained.summary.enabled, true);
        assert.deepEqual(retained.snapshot.importRuns.map((run) => run['runId']), ['new']);
        assert.deepEqual(retained.snapshot.rawPayloadRefs.map((rawRef) => rawRef['rawPayloadRef']), ['raw-new']);
        assert.deepEqual(retained.snapshot.conflicts.map((conflict) => conflict['conflictId']), ['conflict-new']);
        assert.deepEqual(retained.snapshot.modelEligibilityRuns.map((run) => run['runId']), ['eligibility-new']);
        assert.equal(retained.snapshot.projections.length, 1);
        assert.equal(retained.snapshot.evidences.length, 1);

        const refresh = await refreshModelGatewayCatalog({
            snapshot: {
                schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
                importRuns: [
                    createCatalogImportRun({
                        runId: 'previous-run',
                        providerId: 'openrouter',
                        sourceId: 'openrouter-models',
                        status: 'completed',
                        startedAt: '2026-05-25T10:00:00.000Z',
                        completedAt: '2026-05-25T10:00:01.000Z',
                    }),
                ],
            },
            retentionPolicy: { maxImportRuns: 1 },
            now: () => new Date('2026-05-25T12:00:00.000Z'),
            importers: [],
        });

        assert.equal(refresh.retention.importRuns.pruned, 1);
        assert.deepEqual(refresh.snapshot.importRuns.map((run) => run['sourceId']), ['catalog-refresh']);
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
        const openRouterAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { OPEN_ROUTER_KEY: 'openrouter-secret-that-must-not-leak' },
            fetchImpl: /** @type {typeof fetch} */ (async () => /** @type {Response} */ ({ ok: true, status: 200, json: async () => ({ data: {} }) })),
        });
        const kiloAuthenticated = createDefaultModelGatewayCatalogImporters({
            env: { KILO_CODE_API_KEY: 'kilo-secret-that-must-not-leak', KILO_ORGANIZATION_ID: 'org-1' },
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
                'openai-docs-models',
                'anthropic-docs-models',
                'gemini-docs-models',
                'mistral-docs-models',
                'groq-docs-models',
                'opencode-zen-docs',
                'zai-openapi',
                'cloudflare-workers-ai-catalog',
                'huggingface-inference-providers',
                'opencode-zen-models',
                'chutes-models',
                'zai-models',
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
                'openai-docs-models',
                'anthropic-docs-models',
                'gemini-docs-models',
                'mistral-docs-models',
                'groq-docs-models',
                'opencode-zen-docs',
                'zai-openapi',
                'cloudflare-workers-ai-catalog',
                'huggingface-inference-providers',
                'opencode-zen-models',
                'chutes-models',
                'zai-models',
            ],
        );
        assert.equal(groqAuthenticated.some((importer) => importer.id === 'groq-models'), true);
        assert.equal(openRouterAuthenticated.some((importer) => importer.id === 'openrouter-key-account'), true);
        assert.equal(kiloAuthenticated.some((importer) => importer.id === 'kilo-gateway-account'), true);
        assert.equal(genericAuthenticated.some((importer) => importer.id === 'cerebras-models'), true);
        assert.equal(mistralAuthenticated.some((importer) => importer.id === 'mistral-models'), true);
        assert.equal(anthropicAuthenticated.some((importer) => importer.id === 'anthropic-models'), true);
        assert.equal(geminiAuthenticated.some((importer) => importer.id === 'gemini-models'), true);
        assert.equal(ollamaLocal.some((importer) => importer.id === 'ollama-catalog'), true);
        assert.equal(huggingFaceAuthenticated.some((importer) => importer.id === 'huggingface-inference-providers'), true);
        assert.equal(openCodeAuthenticated.some((importer) => importer.id === 'opencode-zen-models'), true);
        assert.equal(cloudflareAuthenticated.some((importer) => importer.id === 'cloudflare-workers-ai-catalog'), true);
        assert.equal(cloudflareAuthenticated.some((importer) => importer.id === 'cloudflare-workers-ai-account'), true);
        assert.equal(nvidiaAuthenticated.some((importer) => importer.id === 'nvidia-nim-models'), true);
        assert.equal(chutesAuthenticated.some((importer) => importer.id === 'chutes-models'), true);
        assert.equal(zaiAuthenticated.some((importer) => importer.id === 'zai-models'), true);
        assert.equal(JSON.stringify(importers).includes(secret), false);
        assert.equal(JSON.stringify(groqAuthenticated).includes('gsk-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(openRouterAuthenticated).includes('openrouter-secret-that-must-not-leak'), false);
        assert.equal(JSON.stringify(kiloAuthenticated).includes('kilo-secret-that-must-not-leak'), false);
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

    it('audits catalog importer hooks and endpoint coverage without fetching providers', () => {
        const importers = createDefaultModelGatewayCatalogImporters({
            env: {
                OPENAI_API_KEY: 'sk-test',
                OPENCODE_API_KEY: 'opencode-token',
                CHUTES_API_KEY: 'chutes-token',
                ZAI_API_KEY: 'zai-token',
            },
            fetchImpl: async () => ({}),
        });
        const openAiDescriptor = describeCatalogImporter(importers.find((importer) => importer.id === 'openai-models') ?? {});
        const audit = auditCatalogImporterSet(importers, { inventories: listProviderEndpointInventory() });

        assert.equal(openAiDescriptor.requiresAuth, true);
        assert.equal(openAiDescriptor.hooks.toRouteOptions, true);
        assert.equal(openAiDescriptor.hooks.toAccountOverlays, true);
        assert.equal(audit.missingRequiredHooks.length, 0);
        assert.ok(audit.publicImporterCount >= 8);
        assert.ok(audit.routeOptionImporterCount >= 10);
        assert.ok(audit.accountOverlayImporterCount >= 4);
        assert.equal(audit.providersWithoutImporters.includes('zai'), false);
        assert.equal(audit.uncoveredCatalogSourceIds.includes('zai:catalog:openapi:GET:https://docs.z.ai/openapi.json'), false);
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

    it('normalizes provider endpoint inventory into stable metadata source records', () => {
        const endpointInventory = listProviderEndpointInventory();
        const records = listProviderEndpointSourceRecords(endpointInventory);
        const byId = new Map(records.map((record) => [record['id'], record]));

        assert.equal(records.length > endpointInventory.length, true);
        assert.ok(byId.has('openai:catalog:authenticated_api:GET:https://api.openai.com/v1/models'));
        assert.deepEqual(byId.get('zai:catalog:openapi:GET:https://docs.z.ai/openapi.json')?.['richnessTags'], [
            'and',
            'multimodal',
            'parameters',
            'runtime',
            'schema',
            'streaming',
            'tool',
        ]);
        assert.deepEqual(byId.get('zai:catalog:openapi:GET:https://docs.z.ai/openapi.json')?.['richnessCategories'], [
            'capabilities',
            'limits',
            'runtime',
        ]);
        assert.equal(byId.get('zai:catalog:openapi:GET:https://docs.z.ai/openapi.json')?.['richnessCoverage']?.['hasRuntime'], true);
        assert.deepEqual(normalizeProviderEndpointRichness('pricing_context_features_rate_limits').categories, [
            'capabilities',
            'limits',
            'pricing',
        ]);
        const cloudflareRuntime = records.find(
            (record) => record['providerId'] === 'cloudflare-workers-ai' && record['target'] === 'runtime' && record['kind'] === 'workers_ai_run',
        );
        assert.deepEqual(cloudflareRuntime?.['placeholders'], ['account_id', 'model']);
        assert.equal(cloudflareRuntime?.['hasPlaceholders'], true);
        assert.equal(cloudflareRuntime?.['target'], 'runtime');
    });

    it('normalizes provider and gateway traits as pre-runtime metadata', () => {
        const traits = listProviderGatewayTraits();
        const byProvider = new Map(traits.map((item) => [item['providerId'], item]));
        const kilo = resolveProviderGatewayTraits('kilo');
        const openRouter = byProvider.get('openrouter');
        const ollama = byProvider.get('ollama');

        assert.equal(traits.length, listProviderEndpointInventory().length);
        assert.equal(kilo?.['topology'], 'gateway');
        assert.equal(kilo?.['gatewayManaged'], true);
        assert.equal(kilo?.['openAICompatible'], true);
        assert.equal(kilo?.['catalogSourceCount'], 3);
        assert.equal(kilo?.['runtimeEndpointCount'], 2);
        assert.equal(/** @type {Record<string, any>} */ (kilo?.['routing'] ?? {})['supportsGatewayByok'], true);
        assert.equal(/** @type {Record<string, any>} */ (kilo?.['capabilities'] ?? {})['fim'], true);
        assert.ok(/** @type {string[]} */ (kilo?.['richnessCategories'] ?? []).includes('pricing'));
        assert.equal(/** @type {Record<string, any>} */ (kilo?.['metadata'] ?? {})['hasPricingMetadata'], true);
        assert.equal(openRouter?.['topology'], 'aggregator');
        assert.equal(/** @type {Record<string, any>} */ (openRouter?.['routing'] ?? {})['supportsFallback'], true);
        assert.ok(/** @type {string[]} */ (openRouter?.['richnessCategories'] ?? []).includes('routing'));
        assert.equal(ollama?.['topology'], 'local_daemon');
        assert.equal(ollama?.['localPrivate'], true);
        assert.equal(resolveProviderGatewayTraits('missing-provider'), null);
    });

    it('builds a provider/wire-API probe matrix without executing runtime probes', () => {
        const matrix = listProviderWireProbeMatrix();
        const summary = summarizeProviderWireProbeMatrix(matrix);
        const byProviderWire = new Map(matrix.map((row) => [`${row.providerId}:${row.wireApi}`, row]));
        const kiloChat = byProviderWire.get('kilo:openai_chat_completions');
        const openAiResponses = byProviderWire.get('openai:openai_responses');
        const cloudflareGateway = byProviderWire.get('cloudflare-workers-ai:cloudflare_ai_gateway_universal');
        const openCodeAnthropic = byProviderWire.get('opencode:anthropic_messages');

        assert.ok(matrix.length >= listProviderGatewayTraits().length);
        assert.ok(summary.providerCount >= 10);
        assert.ok(kiloChat?.implementedProbeKinds.includes('agent'));
        assert.ok(kiloChat?.pendingProbeKinds.includes('forced_tool_choice'));
        assert.ok(kiloChat?.pendingProbeKinds.includes('parallel_tool_calls'));
        assert.ok(openAiResponses?.pendingProbeKinds.includes('reasoning'));
        assert.equal(cloudflareGateway?.gatewaySpecific, true);
        assert.ok(cloudflareGateway?.pendingProbeKinds.includes('gateway_fallback'));
        assert.equal(openCodeAnthropic?.providerNative, true);
        assert.ok(summary.pendingProbeKindCounts['provider_native'] > 0);
    });

    it('evaluates provider env requirements without exposing secret values', () => {
        const rows = evaluateModelGatewayProviderEnvRequirements({
            env: {
                KILO_API_KEY: 'kilo-secret',
                CLOUDFLARE_API_TOKEN: 'cf-secret',
                CLOUDFLARE_ACCOUNT_ID: 'account-1',
                OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
                OPENCODE_API_KEY: '',
            },
        });
        const ollamaAliasRows = evaluateModelGatewayProviderEnvRequirements({
            env: { OLLAMA_HOST: 'http://localhost:11434' },
            providerId: 'ollama',
        });
        const ollamaLocalRows = evaluateModelGatewayProviderEnvRequirements({
            env: { OLLAMA_HOST: 'http://localhost:11434' },
            providerId: 'ollama-local',
        });
        const ollamaCloudRows = evaluateModelGatewayProviderEnvRequirements({
            env: {},
            providerId: 'ollama-cloud',
        });
        const summary = summarizeModelGatewayProviderEnvRequirements(rows);
        const byProvider = new Map(rows.map((row) => [row.providerId, row]));

        assert.equal(byProvider.get('kilo')?.status, 'ready');
        assert.equal(byProvider.get('cloudflare-workers-ai')?.status, 'ready');
        assert.deepEqual(byProvider.get('cloudflare-workers-ai')?.missingRecommendedKeys, ['CLOUDFLARE_AI_GATEWAY_ID']);
        assert.equal(byProvider.get('ollama-local')?.status, 'ready');
        assert.deepEqual(byProvider.get('ollama-local')?.providerAliases, ['ollama']);
        assert.equal(byProvider.get('ollama-cloud')?.status, 'missing');
        assert.deepEqual(ollamaAliasRows.map((row) => row.providerId), ['ollama-local']);
        assert.deepEqual(ollamaLocalRows.map((row) => row.providerId), ['ollama-local']);
        assert.deepEqual(ollamaCloudRows.map((row) => row.providerId), ['ollama-cloud']);
        assert.deepEqual(ollamaCloudRows[0].missingRequiredKeys, ['OLLAMA_CLOUD_API_KEY']);
        assert.equal(byProvider.get('opencode')?.status, 'missing');
        assert.ok(byProvider.get('opencode')?.missingRequiredKeys.includes('OPENCODE_API_KEY'));
        assert.ok(summary.readyCount >= 3);
        assert.equal(JSON.stringify(rows).includes('kilo-secret'), false);
        assert.equal(JSON.stringify(rows).includes('cf-secret'), false);
    });

    it('audits endpoint inventory coverage against configured catalog importers', () => {
        const importers = createDefaultModelGatewayCatalogImporters({
            env: {
                OPENAI_API_KEY: 'sk-test',
                ANTHROPIC_API_KEY: 'sk-ant',
                GEMINI_API_KEY: 'sk-gemini',
                MISTRAL_API_KEY: 'sk-mistral',
                GROQ_API_KEY: 'sk-groq',
                HF_TOKEN: 'hf-token',
                OPENCODE_API_KEY: 'opencode-token',
                NVIDIA_API_KEY: 'nvapi-token',
                CHUTES_API_KEY: 'chutes-token',
                ZAI_API_KEY: 'zai-token',
                CEREBRAS_API_KEY: 'cerebras-token',
                CLOUDFLARE_API_TOKEN: 'cf-token',
                CLOUDFLARE_ACCOUNT_ID: 'account-1',
                CLOUDFLARE_AI_GATEWAY_ID: 'gateway-1',
                OLLAMA_BASE_URL: 'http://localhost:11434',
            },
            fetchImpl: async () => ({}),
        });
        const coverage = auditProviderEndpointImporterCoverage({
            inventories: listProviderEndpointInventory(),
            importers,
        });
        const byProvider = new Map(coverage.map((item) => [item.providerId, item]));

        assert.equal(byProvider.get('openai')?.coveredCatalogSourceCount, 1);
        assert.equal(byProvider.get('kilo')?.coveredCatalogSourceCount, 3);
        assert.equal(byProvider.get('openrouter')?.coveredCatalogSourceCount, 1);
        assert.equal(byProvider.get('zai')?.uncoveredCatalogSourceIds.includes('zai:catalog:openapi:GET:https://docs.z.ai/openapi.json'), false);
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
