// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass

import { afterEach, describe, expect, it, vi } from 'vitest';

const { activateModelGatewayByokProfileEnv, buildCatalogRefreshEventBatch, buildCatalogRefreshStartedEvent, buildEligibilityEvaluatedEvent, buildModelGatewayPreBuildReadinessReport, buildModelGatewayPreKCompatibilityReport, buildModelGatewayRouteCandidates, buildModelGatewayRuntimeProofCommands, buildModelGatewayRuntimeStandbyPlan, buildModelGatewayRuntimeStandbyRoutes, buildModelGatewayRuntimeSelectorPlan, buildModelGatewayRuntimeAutomationDecision, buildModelGatewayRuntimeAutomationControllerStep, DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH, explainModelGatewayRuntimeAutomationPolicySources, listModelGatewayRuntimeAutomationPolicyPresets, resolveModelGatewayRuntimeAutomationPolicyPreset, validateModelGatewayRuntimeAutomationPolicy, readModelGatewayRuntimeAutomationEffectivePolicy, readModelGatewayRuntimeAutomationPolicy, readModelGatewayRuntimeAutomationPolicyFile, writeModelGatewayRuntimeAutomationPolicyFile, buildModelGatewaySelectionDecisionTrace, buildProbeCompletedEvent, buildRouteDecisionEvent, auditCatalogImporterSet, auditModelGatewayCatalogSnapshotIntegrity, auditModelGatewayPostRuntimeSelection, auditModelGatewayPreRuntimeSelection, applyModelGatewayEligibilityToSnapshot, chmod, classifyByokProviderFailure, clearByokProviderModelHealth, compareModelGatewaySelectionAudits, createDefaultModelGatewayCatalogImporters, createEnvSecretRegistry, DEFAULT_MODEL_GATEWAY_CATALOG_PATH, DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR, deriveModelGatewayRuntimeAccountOverlaysFromHealth, discoverConfiguredByokModelsFromEnv, evaluateModelGatewayCatalogEligibility, evaluateModelGatewayProviderEnvRequirements, explainModelGatewayAccountLimitOverlays, explainModelGatewayCatalogEntry, explainModelGatewayProviderEntry, explainModelGatewayEligibilityDecision, explainModelGatewaySelectionComparison, flushAndMirrorByokProviderHealthToSqlite, flushByokProviderHealth, JsonModelGatewayCatalogStore, listByokProviderModelHealth, listModelGatewayCanonicalCommands, listProviderEndpointInventory, listProviderGatewayTraits, listProviderWireProbeMatrix, listTerminalSdkSessionInventory, loadDotenv, materializeModelGatewayActiveByokProfileEnv, mirrorByokProviderHealthToSqlite, mirrorModelGatewayCatalogSnapshotToSqlite, MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON, persistModelGatewaySelectionDecisionTrace, planModelGatewayProbeBackoff, planModelGatewayCatalogRefresh, readModelGatewayByokProfileCostHint, refreshModelGatewayCatalog, recommendCatalogDiffProbes, renderModelGatewayCanonicalCommandLines, renderModelGatewayLocalProviderOptInGuidance, resolveModelGatewaySelectionPolicy, resolveProviderEndpointInventory, resolveProviderGatewayTraits, routeGatewayModels, runConfiguredByokAgentProbe, runConfiguredByokChatProbe, runConfiguredByokJsonProbe, runConfiguredByokStreamingProbe, runConfiguredByokVisionProbe, searchModelGatewayCatalogEntries, readByokProviderHealthState, readByokProviderModelHealth, readConfiguredByokModelDiscoveryCacheFromEnv, readConfiguredByokProfilesFromEnv, readFile, readdir, mkdir, rm, readTerminalByokGatewayProjectionFromEnv, readTerminalByokProjection, readTerminalConfigProjection, readTerminalConfiguredSessionFsState, readTerminalRuntimeState, recordByokProviderModelAgentProbeFailure, recordByokProviderModelAgentProbeSuccess, recordByokProviderModelCallFailure, recordByokProviderModelCallSuccess, recordByokProviderModelProbeResult, recordModelGatewayRouteDecision, rename, scheduleTerminalSdkSessionBootSelection, setTerminalModelProjection, switchTerminalRouteProjection, SqliteModelGatewayCatalogStore, stat, summarizeCanonicalModelProjectionDiff, summarizeModelGatewayEligibilityDiff, summarizeModelGatewayAccountOverlays, summarizeModelGatewayLocalProviderOptInBlocks, summarizeModelGatewayProviderQuotaCapabilities, summarizeModelGatewayRuntimeAccountOverlays, summarizeModelGatewayProviderEnvRequirements, summarizeModelGatewayRefreshLogText, summarizeProviderWireProbeMatrix, toOpenAIModelCatalogList, writeFile } =
    vi.hoisted(() => ({
        buildCatalogRefreshEventBatch: vi.fn((input) => {
            const changedKinds = [
                ...new Set((input.diff?.changed ?? []).flatMap((item) => item.changedKinds ?? [])),
            ];
            return {
                completedEvent: { type: 'model_gateway:catalog:import_completed', changedKinds },
                events: [
                    { type: 'model_gateway:catalog:model_changed', key: 'openrouter:changed-model:default', changedKinds },
                    { type: 'model_gateway:catalog:import_completed', changedKinds },
                ],
            };
        }),
        buildCatalogRefreshStartedEvent: vi.fn((input) => ({
            type: 'model_gateway:catalog:import_started',
            importerIds: input.importerIds ?? [],
        })),
        buildEligibilityEvaluatedEvent: vi.fn((input) => ({
            type: 'model_gateway:eligibility_evaluated',
            modelCount: input?.summary?.modelCount ?? input?.run?.modelCount ?? 0,
            eligibleCount: input?.summary?.eligibleCount ?? input?.run?.eligibleCount ?? 0,
        })),
        recommendCatalogDiffProbes: vi.fn(() => [
            {
                key: 'openrouter:changed-model:default',
                priority: 'high',
                probeKinds: ['chat', 'agent'],
                reasons: ['capabilities_changed', 'agentic_capability'],
                commands: ['/byok probe agent model:changed-model'],
            },
        ]),
        summarizeCanonicalModelProjectionDiff: vi.fn((diff) => ({
            addedCount: diff.added?.length ?? 0,
            removedCount: diff.removed?.length ?? 0,
            changedCount: diff.changed?.length ?? 0,
            changedKinds: [...new Set((diff.changed ?? []).flatMap((item) => item.changedKinds ?? []))],
            changedKindCounts: {},
        })),
        summarizeModelGatewayEligibilityDiff: vi.fn((diff) => ({
            addedCount: diff.added?.length ?? 0,
            removedCount: diff.removed?.length ?? 0,
            changedCount: diff.changed?.length ?? 0,
            changedKinds: [...new Set((diff.changed ?? []).flatMap((item) => item.changedKinds ?? []))],
            changedKindCounts: {},
            becameEligibleCount: 0,
            becameExcludedCount: 0,
        })),
        summarizeProviderWireProbeMatrix: vi.fn(() => ({
            providerCount: 1,
            rowCount: 1,
            implementedProbeKindCounts: { chat: 1, streaming: 1, json: 1, agent: 1 },
            pendingProbeKindCounts: { reasoning: 1, forced_tool_choice: 1, parallel_tool_calls: 1 },
            providersWithPendingProbeKinds: ['kilo'],
        })),
        summarizeModelGatewayProviderEnvRequirements: vi.fn(() => ({
            providerCount: 1,
            readyCount: 0,
            partialCount: 0,
            missingCount: 1,
            missingRequiredKeyCounts: { KILO_API_KEY: 1, KILO_CODE_API_KEY: 1 },
            missingRecommendedKeyCounts: {},
        })),
        summarizeModelGatewayAccountOverlays: vi.fn(() => ({
            rows: [
                {
                    accountOverlayId: 'openrouter:default:OPENROUTER_API_KEY',
                    providerId: 'openrouter',
                    accountScope: 'default',
                    secretRef: 'OPENROUTER_API_KEY',
                    sourceId: 'openrouter-key-account',
                    sourceKind: 'authenticated_account_api',
                    confidence: 'authenticated_catalog',
                    enabledModelCount: 2,
                    blockedModelCount: 0,
                    observedAt: '2026-05-25T00:00:00.000Z',
                    expiresAt: null,
                    limitStatus: 'rate_limited',
                    retryAfterSeconds: 60,
                    resetAt: '2026-05-25T00:01:00.000Z',
                    freshnessStatus: 'fresh',
                    freshnessAgeSeconds: 60,
                    freshnessTtlSeconds: 900,
                    effectiveExpiresAt: '2026-05-25T00:15:00.000Z',
                    resetWindowClass: 'temporary',
                    resetWindowSource: 'explicit_reset_at',
                    nextRefreshAfter: '2026-05-25T00:01:00.000Z',
                    retentionExpiresAt: '2026-05-25T01:00:00.000Z',
                    autoUnblocksAt: '2026-05-25T00:01:00.000Z',
                    blocksUntilRefresh: false,
                    remainingUsd: 12,
                    remainingCreditsUsd: 12,
                },
            ],
            summary: {
                total: 1,
                visible: 1,
                matched: 1,
                providers: 1,
                statusCounts: { rate_limited: 1 },
            },
        })),
        explainModelGatewayAccountLimitOverlays: vi.fn(() => ({
            rows: [
                {
                    accountOverlayId: 'openrouter:default:OPENROUTER_API_KEY',
                    providerId: 'openrouter',
                    accountScope: 'default',
                    secretRef: 'OPENROUTER_API_KEY',
                    sourceId: 'openrouter-key-account',
                    sourceKind: 'authenticated_account_api',
                    sourceLayer: 'account',
                    confidence: 'authenticated_catalog',
                    limitStatus: 'rate_limited',
                    activeBlocker: true,
                    expiredSignal: false,
                    temporaryBlocker: true,
                    retryAfterSeconds: 60,
                    resetAt: '2026-05-25T00:01:00.000Z',
                    expiresAt: null,
                    freshnessStatus: 'fresh',
                    freshnessAgeSeconds: 60,
                    freshnessTtlSeconds: 900,
                    effectiveExpiresAt: '2026-05-25T00:15:00.000Z',
                    resetWindowClass: 'temporary',
                    resetWindowSource: 'explicit_reset_at',
                    nextRefreshAfter: '2026-05-25T00:01:00.000Z',
                    retentionExpiresAt: '2026-05-25T01:00:00.000Z',
                    autoUnblocksAt: '2026-05-25T00:01:00.000Z',
                    blocksUntilRefresh: false,
                    remainingUsd: 12,
                    remainingCreditsUsd: 12,
                    failureKind: null,
                    nextAction: 'wait_for_rate_limit_reset_or_choose_another_route',
                },
                {
                    accountOverlayId: 'runtime-health:groq:default:limited-model:rate-limit',
                    providerId: 'groq',
                    accountScope: 'default',
                    secretRef: 'GROQ_API_KEY',
                    sourceId: 'runtime-health-rate-limit',
                    sourceKind: 'runtime_health',
                    sourceLayer: 'runtime',
                    confidence: 'probe_failed',
                    limitStatus: 'ok',
                    activeBlocker: false,
                    expiredSignal: true,
                    temporaryBlocker: false,
                    retryAfterSeconds: null,
                    resetAt: '2026-05-25T00:01:00.000Z',
                    expiresAt: '2026-05-25T00:02:00.000Z',
                    freshnessStatus: 'expired',
                    freshnessAgeSeconds: 3600,
                    freshnessTtlSeconds: 3600,
                    effectiveExpiresAt: '2026-05-25T00:02:00.000Z',
                    resetWindowClass: 'not_blocking',
                    resetWindowSource: 'none',
                    nextRefreshAfter: '2026-05-25T00:02:00.000Z',
                    retentionExpiresAt: '2026-05-25T00:02:00.000Z',
                    autoUnblocksAt: null,
                    blocksUntilRefresh: false,
                    remainingUsd: null,
                    remainingCreditsUsd: null,
                    failureKind: 'rate-limit',
                    nextAction: 'refresh_overlay_or_retry_pre_runtime_selection',
                },
            ],
            summary: {
                total: 2,
                matched: 2,
                providers: 2,
                activeBlockers: 1,
                expiredSignals: 1,
                temporaryBlockers: 1,
                byStatus: { rate_limited: 1, ok: 1 },
                bySourceKind: { authenticated_account_api: 1, runtime_health: 1 },
                bySourceLayer: { account: 1, runtime: 1 },
            },
        })),
        summarizeModelGatewayRuntimeAccountOverlays: vi.fn(() => ({
            total: 1,
            activeCount: 1,
            expiredCount: 0,
            byProvider: { groq: 1 },
            byFailureKind: { 'rate-limit': 1 },
            items: [],
        })),
        summarizeModelGatewayProviderQuotaCapabilities: vi.fn(() => ({
            rows: [
                {
                    providerId: 'openrouter',
                    accountVisibility: 'key_account_and_public_models',
                    quotaSnapshot: 'key_credit_balance',
                    spendingLimit: 'key_credit_balance',
                    rateLimit: 'headers_or_runtime_failure',
                    runtimeFailureOverlay: true,
                    sdkQuotaAppliesToByok: false,
                    requiredEnv: ['OPENROUTER_API_KEY'],
                    endpoints: ['/api/v1/models', '/api/v1/key'],
                },
            ],
            summary: {
                total: 15,
                matched: 1,
                providerCount: 1,
                accountVisibilityCount: 1,
                quotaSnapshotCount: 1,
                runtimeFailureOverlayCount: 1,
                sdkQuotaByokTruthCount: 0,
                byQuotaSnapshot: { key_credit_balance: 1 },
            },
        })),
        MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON: 'local_provider_requires_explicit_request',
        summarizeModelGatewayLocalProviderOptInBlocks: vi.fn((selection) => {
            const blockedProfileIds = (selection.profiles ?? [])
                .filter((profile) => (profile.topRejectedReasons ?? []).includes('local_provider_requires_explicit_request'))
                .map((profile) => profile.profileId);
            const rejectedCount = selection.summary?.rejectedReasonCounts?.['local_provider_requires_explicit_request'] ?? 0;
            return {
                reason: 'local_provider_requires_explicit_request',
                blockedProfileIds,
                blockedProfileCount: blockedProfileIds.length,
                rejectedCount,
                hasBlocks: blockedProfileIds.length > 0 || rejectedCount > 0,
            };
        }),
        renderModelGatewayLocalProviderOptInGuidance: vi.fn((options = {}) => {
            const profileId = options.profileId ?? options.profileIds?.[0] ?? 'repo_agent';
            const profileSuffix = Array.isArray(options.profileIds) && options.profileIds.length > 0 ? ` nos perfis ${options.profileIds.join(',')}` : '';
            return `Ollama/local foi bloqueado por padrão${profileSuffix}. Para usar modelos locais, peça explicitamente: /byok models route ${profileId} provider:ollama, /byok models route local_private ou /byok models route local_private_strict.`;
        }),
        buildModelGatewayPreKCompatibilityReport: vi.fn(() => ({
            stage: 'pre-k',
            ready: true,
            total: 2,
            passed: 2,
            failed: 0,
            checks: [
                {
                    id: 'sdk_provider_config_boundary',
                    track: 'J',
                    passed: true,
                    summary: 'SDK ProviderConfig boundary ok',
                },
                {
                    id: 'route_trace_attributes_are_stable',
                    track: 'I',
                    passed: true,
                    summary: 'route trace attrs ok',
                },
            ],
        })),
        buildModelGatewayPreBuildReadinessReport: vi.fn(() => ({
            stage: 'prebuild',
            ready: true,
            total: 3,
            passed: 3,
            failed: 0,
            checks: [
                {
                    id: 'universal_catalog_contracts_are_exported',
                    track: 'K',
                    passed: true,
                    summary: 'catalog ok',
                },
                {
                    id: 'provider_gateway_traits_are_metadata',
                    track: 'M',
                    passed: true,
                    summary: 'traits ok',
                },
                {
                    id: 'canonical_commands_are_published',
                    track: 'Y',
                    passed: true,
                    summary: 'commands ok',
                },
            ],
        })),
        buildModelGatewayRouteCandidates: vi.fn(() => []),
        buildProbeCompletedEvent: vi.fn((input) => ({
            type: 'model_gateway:probe:completed',
            probeKind: input.probeKind,
            ok: input.result?.ok === true,
            status: input.result?.status ?? 'unknown',
            providerAttempted: input.providerAttempted !== false,
        })),
        buildRouteDecisionEvent: vi.fn((input) => ({
            type: 'model_gateway:route:decision',
            decisionId: 'route-test',
            taskProfile: input.taskProfile,
            routeProfile: input.routeProfile ?? null,
            mode: input.mode ?? 'unknown',
            source: input.source ?? 'test',
            selected: Boolean(input.route?.selected),
            candidateCount: input.route?.candidates?.length ?? 0,
            rejectedCount: input.route?.rejected?.length ?? 0,
            fallbackChain: input.route?.fallbackChain ?? [],
            providerId: input.route?.selected?.model?.providerId ?? null,
            modelId: input.route?.selected?.model?.providerModel ?? null,
            gatewayModelId: input.route?.selected?.model?.id ?? null,
            estimatedInputTokens: input.estimatedInputTokens ?? null,
            estimatedOutputTokens: input.estimatedOutputTokens ?? null,
            estimatedCostUsd: input.estimatedCostUsd ?? null,
            failure: input.failure ?? null,
        })),
        auditCatalogImporterSet: vi.fn((importers) => ({
            importerCount: importers.length,
            providerCount: 1,
            publicImporterCount: 1,
            authenticatedImporterCount: 1,
            routeOptionImporterCount: 1,
            accountOverlayImporterCount: 1,
            providerEvidenceImporterCount: 1,
            descriptors: [
                {
                    id: 'kilo-gateway-models',
                    providerId: 'kilo',
                    sourceKind: 'public_gateway_api',
                    requiresAuth: false,
                    url: 'https://api.kilo.ai/api/gateway/models',
                    command: null,
                    envRequirements: [],
                    refreshPolicy: 'ttl',
                    ttlSeconds: 21600,
                    hooks: {
                        fetchRaw: true,
                        parseRows: true,
                        toEvidenceFacts: true,
                        toProviderEvidenceFacts: false,
                        toRouteOptions: true,
                        toAccountOverlays: false,
                    },
                },
                {
                    id: 'kilo-gateway-providers',
                    providerId: 'kilo',
                    sourceKind: 'public_gateway_api',
                    requiresAuth: true,
                    url: 'https://api.kilo.ai/api/gateway/providers',
                    command: null,
                    envRequirements: ['KILO_API_KEY'],
                    refreshPolicy: 'ttl',
                    ttlSeconds: 21600,
                    hooks: {
                        fetchRaw: true,
                        parseRows: true,
                        toEvidenceFacts: true,
                        toProviderEvidenceFacts: true,
                        toRouteOptions: false,
                        toAccountOverlays: true,
                    },
                },
            ],
            endpointCoverage: [
                {
                    providerId: 'kilo',
                    catalogSourceCount: 2,
                    importerCount: 2,
                    coveredCatalogSourceCount: 1,
                    uncoveredCatalogSourceIds: ['kilo:catalog:public_docs:get:https-api-kilo-ai-docs'],
                },
            ],
            providersWithoutImporters: [],
            uncoveredCatalogSourceIds: ['kilo:catalog:public_docs:get:https-api-kilo-ai-docs'],
            missingRequiredHooks: [],
        })),
        auditModelGatewayCatalogSnapshotIntegrity: vi.fn(() => ({
            ok: true,
            redactedIdentityCount: 0,
            redactedIdentitySamples: [],
            duplicateChecks: {
                evidences: { rowCount: 0, uniqueKeyCount: 0, duplicateKeyCount: 0, duplicateExtraRowCount: 0, samples: [] },
                providerEvidences: { rowCount: 0, uniqueKeyCount: 0, duplicateKeyCount: 0, duplicateExtraRowCount: 0, samples: [] },
                routeOptions: { rowCount: 1, uniqueKeyCount: 1, duplicateKeyCount: 0, duplicateExtraRowCount: 0, samples: [] },
                projections: { rowCount: 1, uniqueKeyCount: 1, duplicateKeyCount: 0, duplicateExtraRowCount: 0, samples: [] },
                providerProjections: { rowCount: 0, uniqueKeyCount: 0, duplicateKeyCount: 0, duplicateExtraRowCount: 0, samples: [] },
                accountOverlays: { rowCount: 1, uniqueKeyCount: 1, duplicateKeyCount: 0, duplicateExtraRowCount: 0, samples: [] },
            },
        })),
        auditModelGatewayPreRuntimeSelection: vi.fn(() => ({
            schema: 'model-gateway-pre-runtime-selection-audit',
            ok: true,
            mode: 'allow_probe_unknown',
            snapshotContext: {
                projectionCount: 1,
                routeOptionCount: 1,
                accountOverlayCount: 1,
                eligibilityDecisionCount: 0,
                candidateCount: 1,
            },
            summary: {
                profileCount: 2,
                selectedProfileCount: 2,
                unselectedProfileCount: 0,
                candidateCount: 2,
                rejectedCount: 0,
                selectedProviders: { openrouter: 2 },
                selectedSelectorKinds: { provider_explicit: 2 },
                rejectedReasonCounts: {},
            },
            profiles: [
                {
                    profileId: 'repo_agent',
                    selected: {
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        selectorKind: 'provider_explicit',
                        selectorSyntax: 'openai/gpt-oss-120b:groq',
                        score: 250,
                    },
                    candidateCount: 1,
                    rejectedCount: 0,
                    fallbackChain: ['openrouter:openai/gpt-oss-120b'],
                    topRejectedReasons: [],
                    nextActions: ['route_decision_ready'],
                    decisionLayers: { runtimeProbeProofCount: 0 },
                    snapshotContext: {},
                },
                {
                    profileId: 'tool_agent',
                    selected: {
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        selectorKind: 'provider_explicit',
                        selectorSyntax: 'openai/gpt-oss-120b:groq',
                        score: 240,
                    },
                    candidateCount: 1,
                    rejectedCount: 0,
                    fallbackChain: ['openrouter:openai/gpt-oss-120b'],
                    topRejectedReasons: [],
                    nextActions: ['route_decision_ready'],
                    decisionLayers: { runtimeProbeProofCount: 0 },
                    snapshotContext: {},
                },
            ],
        })),
        auditModelGatewayPostRuntimeSelection: vi.fn(() => ({
            schema: 'model-gateway-post-runtime-selection-audit',
            ok: true,
            mode: 'strict_access_only',
            runtimeMode: 'observed_runtime_health',
            snapshotContext: {
                projectionCount: 1,
                routeOptionCount: 1,
                accountOverlayCount: 1,
                eligibilityDecisionCount: 1,
                candidateCount: 1,
            },
            summary: {
                profileCount: 1,
                selectedProfileCount: 1,
                unselectedProfileCount: 0,
                candidateCount: 1,
                rejectedCount: 0,
                healthRecordCount: 1,
                runtimeChatOkCount: 1,
                runtimeAgentProbeProofCount: 1,
                runtimeProbeProofCount: 1,
                runtimeHealthProofCount: 1,
                selectedProviders: { openrouter: 1 },
                selectedSelectorKinds: { provider_explicit: 1 },
                rejectedReasonCounts: {},
            },
            profiles: [],
        })),
        compareModelGatewaySelectionAudits: vi.fn(() => ({
            schema: 'model-gateway-selection-comparison',
            ok: true,
            summary: {
                profileCount: 1,
                changedCount: 1,
                unchangedCount: 0,
                preSelectedCount: 1,
                postSelectedCount: 1,
                postRuntimeProofSelectedCount: 1,
                postRuntimeHealthProofCount: 1,
                postRuntimeProbeProofCount: 1,
            },
            rows: [
                {
                    profileId: 'repo_agent',
                    changed: true,
                    preSelected: {
                        providerId: 'openrouter',
                        providerModel: 'openai/gpt-oss-120b',
                        selectorKind: 'provider_explicit',
                        score: 250,
                    },
                    postSelected: {
                        providerId: 'groq',
                        providerModel: 'openai/gpt-oss-120b',
                        selectorKind: 'exact_model',
                        score: 310,
                    },
                    postSelectedHasRuntimeProof: true,
                    postDecisionLayers: {},
                },
            ],
        })),
        explainModelGatewaySelectionComparison: vi.fn(() => ({
            schema: 'model-gateway-selection-comparison-explain',
            ok: true,
            summary: {
                profileCount: 1,
                changedCount: 1,
                unchangedCount: 0,
                runtimeProofCount: 1,
                reasonCounts: { post_runtime_proved_better_route: 1 },
                nextActions: ['consider_prefer_runtime_proved_policy'],
            },
            rows: [
                {
                    profileId: 'repo_agent',
                    changed: true,
                    reason: 'post_runtime_proved_better_route',
                    nextActions: ['consider_prefer_runtime_proved_policy'],
                    preRouteKey: 'openrouter:openai/gpt-oss-120b:provider_explicit',
                    postRouteKey: 'groq:openai/gpt-oss-120b:exact_model',
                    postSelectedHasRuntimeProof: true,
                },
            ],
        })),
        resolveModelGatewaySelectionPolicy: vi.fn((_comparison, options = {}) => ({
            schema: 'model-gateway-selection-policy-resolution',
            ok: true,
            mode: options.mode ?? 'metadata_first',
            summary: {
                profileCount: 1,
                selectedCount: 1,
                unselectedCount: 0,
                metadataWinnerCount: options.mode === 'metadata_first' ? 1 : 0,
                postRuntimeWinnerCount: options.mode === 'metadata_first' ? 0 : 1,
                runtimeProofSelectedCount: 1,
                changedFromPreRuntimeCount: options.mode === 'metadata_first' ? 0 : 1,
            },
            rows: [],
        })),
        buildModelGatewaySelectionDecisionTrace: vi.fn((input) => ({
            schema: 'model-gateway-selection-decision-trace',
            traceId: input.traceId ?? 'terminal-selection-trace',
            source: input.source ?? 'terminal-byok-selection-audit',
        })),
        DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH:
            'data/copilot/model-gateway/runtime-automation-policy.json',
        listModelGatewayRuntimeAutomationPolicyPresets: vi.fn(() => [
            {
                preset: 'operator_manual',
                policy: 'prefer_runtime_proved',
                allowLiveSetModel: false,
                allowNewSession: false,
                allowLocalPrivate: false,
            },
            {
                preset: 'auto_same_boundary',
                policy: 'prefer_runtime_proved',
                allowLiveSetModel: true,
                allowNewSession: false,
                allowLocalPrivate: false,
            },
            {
                preset: 'auto_prepare_new_session',
                policy: 'prefer_runtime_proved',
                allowLiveSetModel: true,
                allowNewSession: true,
                allowLocalPrivate: false,
            },
        ]),
        resolveModelGatewayRuntimeAutomationPolicyPreset: vi.fn((preset, overrides = {}) => {
            const presetId = String(preset ?? 'operator_manual').replace(/-/g, '_');
            return {
                enabled: true,
                policy: presetId === 'llm_operator_guarded' ? 'require_runtime_proof' : 'prefer_runtime_proved',
                profiles: [],
                allowLiveSetModel: presetId === 'auto_same_boundary' || presetId === 'auto_prepare_new_session',
                allowNewSession: presetId === 'auto_prepare_new_session',
                allowProviderProbes: false,
                allowLocalPrivate: false,
                accountWideFailureKinds: ['rate-limit', 'quota', 'credits'],
                ...overrides,
                preset: presetId,
            };
        }),
        readModelGatewayRuntimeAutomationPolicy: vi.fn(() => ({
            enabled: false,
            preset: 'operator_manual',
            policy: 'prefer_runtime_proved',
            profiles: [],
            allowLiveSetModel: false,
            allowNewSession: false,
            allowProviderProbes: false,
            allowLocalPrivate: false,
            accountWideFailureKinds: [],
        })),
        readModelGatewayRuntimeAutomationPolicyFile: vi.fn(() => Promise.resolve({})),
        explainModelGatewayRuntimeAutomationPolicySources: vi.fn(() => ({
            enabled: { source: 'default' },
            preset: { source: 'default' },
            policy: { source: 'default' },
            profiles: { source: 'default' },
            allowLiveSetModel: { source: 'default' },
            allowNewSession: { source: 'default' },
            allowProviderProbes: { source: 'default' },
            allowLocalPrivate: { source: 'default' },
            accountWideFailureKinds: { source: 'default' },
        })),
        validateModelGatewayRuntimeAutomationPolicy: vi.fn(() => ({
            ok: true,
            issues: [],
            allowedModes: ['prefer_runtime_proved'],
            allowedPresets: ['operator_manual', 'llm_operator_guarded', 'auto_same_boundary', 'auto_prepare_new_session'],
        })),
        readModelGatewayRuntimeAutomationEffectivePolicy: vi.fn(() =>
            Promise.resolve({
                enabled: false,
                preset: 'operator_manual',
                policy: 'prefer_runtime_proved',
                profiles: [],
                allowLiveSetModel: false,
                allowNewSession: false,
                allowProviderProbes: false,
                allowLocalPrivate: false,
                accountWideFailureKinds: [],
            }),
        ),
        writeModelGatewayRuntimeAutomationPolicyFile: vi.fn((policy) =>
            Promise.resolve({
                filePath: '/workspaces/chatgpt-docker-puppeteer/data/copilot/model-gateway/runtime-automation-policy.json',
                policy,
            }),
        ),
        buildModelGatewayRuntimeAutomationDecision: vi.fn((input) => ({
            schema: 'model-gateway-runtime-automation-decision',
            ok: true,
            status: 'ready',
            action: 'prepare_new_session',
            selectedRouteKey: 'openrouter:openai/gpt-oss-120b',
            routeProfile: input.profileId ?? 'repo_agent',
            canApplyLiveModel: false,
            requiresNewSession: true,
            blockers: [],
            currentBoundary: { enabled: false, profile: null, preset: null, providerType: null, baseUrl: null, model: null },
            targetBoundary: { profile: input.profileId ?? 'repo_agent', preset: 'openrouter', providerType: 'openai_compatible', baseUrl: null, model: 'openai/gpt-oss-120b' },
            cooldown: { active: false, reason: null, resetAt: null, retryAfterSeconds: null },
            blockerClass: 'none',
            nonActionReason: null,
            nextCommands: ['/session sdk next new', '/byok model openai/gpt-oss-120b'],
            operatorSummary: 'mock automation decision',
        })),
        buildModelGatewayRuntimeAutomationControllerStep: vi.fn((input) => ({
            schema: 'model-gateway-runtime-automation-controller-step',
            ok: input.decision?.ok === true,
            phase: input.phase ?? 'manual',
            action: input.decision?.action ?? 'manual_intervention',
            effectMode: input.policy?.allowEffects === true ? 'allowed' : 'dry_run',
            effects: [
                ...(input.phase === 'post_turn'
                    ? [
                          {
                              kind: 'replan_after_turn_failure',
                              failureKind: input.turnOutcome?.failureKind ?? 'unknown_failure',
                              execute: input.policy?.allowEffects === true,
                          },
                      ]
                    : []),
                {
                    kind: input.decision?.action === 'apply_live_model' ? 'set_live_model' : 'prepare_new_sdk_session',
                    model: input.decision?.targetBoundary?.model ?? null,
                    execute: input.policy?.allowEffects === true && input.policy?.allowLiveSetModel === true,
                },
            ],
            blockers: input.decision?.blockers ?? [],
            selectedRouteKey: input.decision?.selectedRouteKey ?? null,
            operatorSummary: 'mock controller step',
        })),
        buildModelGatewayRuntimeProofCommands: vi.fn((alternativeSummary, options = {}) => {
            const limit = typeof options.limit === 'number' ? options.limit : 3;
            const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 20_000;
            return (alternativeSummary?.topBlockedRoutes ?? [])
                .filter((route) => route.providerId && route.providerModel)
                .map((route) => ({
                    mode: String(route.reasons?.join(',') ?? '').includes('chat_health') ? 'chat' : 'agent',
                    providerId: route.providerId,
                    providerModel: route.providerModel,
                    command: `/byok probe ${String(route.reasons?.join(',') ?? '').includes('chat_health') ? 'chat' : 'agent'} provider:${route.providerId} model:${route.providerModel} timeout:${timeoutMs}`,
                    reasons: route.reasons ?? [],
                }))
                .slice(0, limit);
        }),
        buildModelGatewayRuntimeStandbyRoutes: vi.fn((_runtimeSelectorPlan, options = {}) => {
            const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 20_000;
            return [
                {
                    profileId: 'repo_agent',
                    rank: 1,
                    source: 'candidate_alternative',
                    selectedRouteKey: 'kilo-code:kilo-auto/free',
                    providerId: 'kilo-code',
                    providerModel: 'kilo-auto/free',
                    selectorSyntax: 'kilo-auto/free',
                    routeLayer: 'openai_compatible_direct',
                    wireApi: 'openai_chat_completions',
                    upstreamProvider: null,
                    score: 91,
                    hasRuntimeProof: true,
                    needsProbe: false,
                    standbyClass: 'new_provider',
                    runtimeEnvStatus: 'ready',
                    reasons: ['runtime_selector_alternativa:alternate1'],
                    commands: {
                        probeAgent: `/byok probe agent provider:kilo-code model:kilo-auto/free timeout:${timeoutMs}`,
                        probeChat: `/byok probe chat provider:kilo-code model:kilo-auto/free timeout:${timeoutMs}`,
                        liveModel: '/byok model kilo-auto/free',
                        provider: '/byok provider kilo-code kilo-auto/free',
                        persistProvider: '/byok persist provider kilo-code kilo-auto/free',
                        newSession: '/session sdk next new',
                    },
                },
            ];
        }),
        buildModelGatewayRuntimeStandbyPlan: vi.fn((_runtimeSelectorPlan, options = {}) => {
            const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 20_000;
            const routes = [
                {
                    profileId: 'repo_agent',
                    rank: 1,
                    source: 'candidate_alternative',
                    selectedRouteKey: 'kilo-code:kilo-auto/free',
                    providerId: 'kilo-code',
                    providerModel: 'kilo-auto/free',
                    selectorSyntax: 'kilo-auto/free',
                    routeLayer: 'openai_compatible_direct',
                    wireApi: 'openai_chat_completions',
                    upstreamProvider: null,
                    score: 91,
                    hasRuntimeProof: true,
                    needsProbe: false,
                    standbyClass: 'new_provider',
                    runtimeEnvStatus: 'ready',
                    reasons: ['runtime_selector_alternativa:alternate1'],
                    commands: {
                        probeAgent: `/byok probe agent provider:kilo-code model:kilo-auto/free timeout:${timeoutMs}`,
                        probeChat: `/byok probe chat provider:kilo-code model:kilo-auto/free timeout:${timeoutMs}`,
                        liveModel: '/byok model kilo-auto/free',
                        provider: '/byok provider kilo-code kilo-auto/free',
                        persistProvider: '/byok persist provider kilo-code kilo-auto/free',
                        newSession: '/session sdk next new',
                    },
                },
            ];
            return {
                schema: 'model-gateway-runtime-standby-plan',
                ok: true,
                generatedAt: '2026-06-02T00:00:00.000Z',
                profileId: options.profileId ?? 'repo_agent',
                selectorOk: true,
                runtimeSelectorReady: true,
                summary: {
                    routeCount: routes.length,
                    selectedCount: 0,
                    alternateCount: routes.length,
                    runtimeProofCount: 1,
                    providerCount: 1,
                    sameBoundaryCommandCount: 1,
                    newProviderCommandCount: 1,
                    probeCommandCount: 1,
                },
                routes,
                nextCommands: [
                    `/byok probe agent provider:kilo-code model:kilo-auto/free timeout:${timeoutMs}`,
                    '/byok model kilo-auto/free',
                    '/byok provider kilo-code kilo-auto/free',
                ],
            };
        }),
        buildModelGatewayRuntimeSelectorPlan: vi.fn((_policy, options = {}) => ({
            schema: 'model-gateway-runtime-selector-plan',
            ok: true,
            ready: true,
            mode: options.requireRuntimeProof ? 'require_runtime_proof' : 'metadata_first',
            summary: {
                profileCount: 1,
                selectedProfileCount: 1,
                blockedProfileCount: 0,
                runtimeProofSelectedCount: options.requireRuntimeProof ? 1 : 0,
                runtimeEnvReadyCount: 1,
                runtimeEnvBlockedCount: 0,
            },
            routes: [],
        })),
        persistModelGatewaySelectionDecisionTrace: vi.fn((trace) =>
            Promise.resolve({
                schema: 'model-gateway-selection-decision-trace-persistence',
                ok: true,
                written: true,
                traceId: trace.traceId ?? 'terminal-selection-trace',
                filePath: '/tmp/model-gateway-selection-trace.json',
                latestPath: '/tmp/latest-model-gateway-selection-trace.json',
                error: null,
            }),
        ),
        DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR: 'data/copilot/model-gateway/selection-traces',
        planModelGatewayProbeBackoff: vi.fn(() => ({
            ready: [
                {
                    key: 'openrouter:changed-model:default',
                    providerId: 'openrouter',
                    providerModel: 'changed-model',
                    routeProfile: 'default',
                    probeKinds: ['chat'],
                    reasons: ['capabilities_changed'],
                },
            ],
            deferred: [
                {
                    key: 'groq:limited-model:default',
                    providerId: 'groq',
                    providerModel: 'limited-model',
                    routeProfile: 'default',
                    reason: 'runtime_rate_limited',
                    retryAfterSeconds: 60,
                    resetAt: '2026-05-25T00:01:00.000Z',
                },
            ],
            summary: {
                total: 2,
                ready: 1,
                deferred: 1,
                reasonCounts: { runtime_rate_limited: 1 },
            },
        })),
        chmod: vi.fn(),
        classifyByokProviderFailure: vi.fn((error) => ({
            kind: 'unknown',
            message: error instanceof Error ? error.message : String(error),
            statusCode: null,
            errorContext: 'provider.unknown',
            operatorLabel: 'falha BYOK ainda sem classe operacional',
            operatorAction: 'inspecione /byok health',
            external: true,
        })),
        clearByokProviderModelHealth: vi.fn(),
        createDefaultModelGatewayCatalogImporters: vi.fn(() => [{ id: 'openrouter-models' }, { id: 'openai-models' }]),
        createEnvSecretRegistry: vi.fn(() => ({ has: () => false, get: () => null, list: () => [] })),
        DEFAULT_MODEL_GATEWAY_CATALOG_PATH: 'data/copilot/model-gateway/catalog.json',
        deriveModelGatewayRuntimeAccountOverlaysFromHealth: vi.fn(() => [
            {
                accountOverlayId: 'runtime-health:groq:default:limited-model:rate-limit',
                providerId: 'groq',
                sourceKind: 'runtime_health',
            },
        ]),
        discoverConfiguredByokModelsFromEnv: vi.fn(),
        applyModelGatewayEligibilityToSnapshot: vi.fn((snapshot, decisions, run) => ({
            ...snapshot,
            modelEligibilityDecisions: decisions,
            modelEligibilityRuns: [run],
        })),
        evaluateModelGatewayCatalogEligibility: vi.fn(() => ({
            run: { runId: 'eligibility-run', policyProfile: 'default' },
            decisions: [],
            summary: { modelCount: 0, eligibleCount: 0, unknownCount: 0, excludedCount: 0 },
        })),
        evaluateModelGatewayProviderEnvRequirements: vi.fn(() => [
            {
                providerId: 'kilo',
                status: 'missing',
                requiredGroupCount: 1,
                satisfiedRequiredGroupCount: 0,
                recommendedGroupCount: 0,
                satisfiedRecommendedGroupCount: 0,
                configuredKeys: [],
                missingRequiredKeys: ['KILO_API_KEY', 'KILO_CODE_API_KEY'],
                missingRecommendedKeys: [],
                groups: [],
            },
        ]),
        flushByokProviderHealth: vi.fn(() => Promise.resolve()),
        explainModelGatewayCatalogEntry: vi.fn(() => ({
            key: 'openrouter:new-model:default',
            sources: [],
            providerEvidences: [],
            projections: [],
            routeOptions: [],
            accountOverlays: [],
            conflicts: [],
            eligibility: null,
            openai: null,
            runtimeHealth: null,
            runtimeProbes: [],
        })),
        explainModelGatewayProviderEntry: vi.fn(() => ({
            providerId: 'openrouter',
            sources: [],
            providerEvidences: [],
            providerProjection: null,
            summary: 'openrouter',
        })),
        explainModelGatewayEligibilityDecision: vi.fn(() => ({
            status: 'eligible',
            key: 'openrouter:model:default:exact_model:model',
            summary: 'eligible:account_model_visible',
            disposition: 'eligible',
            hardExclusions: [],
            softPenalties: [],
            actionable: {
                category: 'rankable',
                dataNeeded: [],
                probeSafe: false,
                operatorHint: 'no_extra_action',
            },
            nextActions: ['candidate_can_be_ranked'],
        })),
        JsonModelGatewayCatalogStore: vi.fn(function JsonModelGatewayCatalogStore() {
            return {
                filePath: 'data/copilot/model-gateway/catalog.json',
                readSnapshot: vi.fn(() =>
                    Promise.resolve({
                        generatedAt: '2026-05-26T20:00:00.000Z',
                        sources: [
                            { id: 'openrouter-models', providerId: 'openrouter', refreshPolicy: 'ttl', ttlSeconds: 3600 },
                            { id: 'openai-models', providerId: 'openai', refreshPolicy: 'ttl', ttlSeconds: 3600 },
                        ],
                        projections: [{ providerId: 'openrouter', providerModel: 'new-model' }],
                        routeOptions: [
                            {
                                providerId: 'openrouter',
                                providerModel: 'openai/gpt-oss-120b',
                                selectorKind: 'provider_explicit',
                                selectorSyntax: 'openai/gpt-oss-120b:groq',
                            },
                        ],
                        accountOverlays: [
                            {
                                accountOverlayId: 'openrouter:default:OPENROUTER_API_KEY',
                                providerId: 'openrouter',
                                secretRef: 'OPENROUTER_API_KEY',
                            },
                        ],
                        modelEligibilityDecisions: [],
                        modelEligibilityRuns: [
                            {
                                runId: 'eligibility-run-1',
                                status: 'completed',
                                policyProfile: 'terminal-refresh',
                                taskProfile: 'default',
                                accountScope: 'default',
                                completedAt: '2026-05-25T18:00:00.000Z',
                                modelCount: 2,
                                eligibleCount: 1,
                                unknownCount: 0,
                                excludedCount: 1,
                                diff: {
                                    added: ['openrouter:new-model:default:exact_model:new-model:default:terminal-refresh:default'],
                                    removed: [],
                                    changed: [
                                        {
                                            key: 'openrouter:changed-model:default:exact_model:changed-model:default:terminal-refresh:default',
                                            changedFields: ['include', 'hardExclusions'],
                                            changedKinds: ['disposition_changed', 'access_gate_changed'],
                                            previousInclude: false,
                                            nextInclude: true,
                                        },
                                    ],
                                },
                                diffSummary: { addedCount: 1, removedCount: 0, changedCount: 1 },
                            },
                        ],
                        conflicts: [
                            {
                                projectionKey: 'openrouter:changed-model:default',
                                fieldPath: 'capabilities.tools',
                                selectedEvidenceId: 'catalog-tools',
                                conflictingEvidenceIds: ['heuristic-tools'],
                            },
                        ],
                        importRuns: [
                            {
                                runId: 'model-gateway:catalog-refresh:2026-05-25T17:00:00.000Z',
                                providerId: 'model-gateway',
                                sourceId: 'catalog-refresh',
                                diff: {
                                    added: ['openrouter:new-model:default'],
                                    removed: [],
                                    changed: [
                                        {
                                            key: 'openrouter:changed-model:default',
                                            changedFields: ['capabilities'],
                                            changedKinds: ['capabilities_changed'],
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                ),
            };
        }),
        listByokProviderModelHealth: vi.fn(() => []),
        listModelGatewayCanonicalCommands: vi.fn(() => [
            { id: 'prebuild.all', surface: 'package', phase: 'prebuild', command: 'npm run model-gateway:prebuild' },
            { id: 'prebuild.first-build', surface: 'make', phase: 'prebuild', command: 'make model-gateway-prebuild' },
            { id: 'commands.text', surface: 'terminal', phase: 'orientation', command: '/byok gateway commands' },
            { id: 'operator.ready', surface: 'terminal', phase: 'orientation', command: '/byok gateway operator-ready profile:repo_agent' },
        ]),
        listProviderEndpointInventory: vi.fn(() => [
            {
                providerId: 'kilo',
                adapterId: 'kilo',
                providerKind: 'gateway',
                baseUrls: ['https://api.kilo.ai/api/gateway'],
                modelCatalogSources: [
                    {
                        kind: 'public_gateway_api',
                        method: 'GET',
                        url: 'https://api.kilo.ai/api/gateway/models',
                        richness: 'pricing_context_features',
                    },
                ],
                runtimeEndpoints: [{ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }],
                routeSelectors: ['exact_model', 'gateway_auto', 'provider_model'],
            },
        ]),
        listProviderGatewayTraits: vi.fn(() => [
            {
                providerId: 'kilo',
                providerKind: 'gateway',
                topology: 'gateway',
                openAICompatible: true,
                catalogSourceCount: 1,
                runtimeEndpointCount: 1,
                publicCatalogSourceCount: 1,
                authenticatedCatalogSourceCount: 0,
                parameterizedCatalogSourceCount: 0,
                runtimeKinds: ['chat_completions'],
                routeSelectors: ['exact_model', 'gateway_auto', 'provider_model'],
                richnessTags: ['context', 'features', 'pricing'],
                capabilities: { chatCompletions: true, responses: false, fim: false, embeddings: false },
                routing: { supportsAutoSelection: true, supportsFallback: false, supportsProviderOrder: false, supportsGatewayByok: false },
                metadata: { hasPricingMetadata: true, hasContextMetadata: true, hasProviderMetadata: false },
            },
        ]),
        listProviderWireProbeMatrix: vi.fn(() => [
            {
                providerId: 'kilo',
                topology: 'gateway',
                runtimeKind: 'chat_completions',
                wireApi: 'openai_chat_completions',
                implementedProbeKinds: ['chat', 'streaming', 'json', 'agent'],
                pendingProbeKinds: ['reasoning', 'forced_tool_choice', 'parallel_tool_calls'],
                notes: ['runtime_probe_gap'],
            },
        ]),
        listTerminalSdkSessionInventory: vi.fn(() =>
            Promise.resolve({
                currentSessionId: null,
                lastSessionId: null,
                foregroundSessionId: null,
                persistedByokBinding: null,
                lastBootDecision: null,
                sessions: [],
            }),
        ),
        scheduleTerminalSdkSessionBootSelection: vi.fn(() => Promise.resolve({ ok: true })),
        loadDotenv: vi.fn(),
        flushAndMirrorByokProviderHealthToSqlite: vi.fn(() =>
            Promise.resolve({ flushed: true, records: 0, healthObservations: 0, probeResults: 0, runId: 'health-run' }),
        ),
        mirrorByokProviderHealthToSqlite: vi.fn(() =>
            Promise.resolve({ records: 0, healthObservations: 0, probeResults: 0, runId: 'health-run' }),
        ),
        mirrorModelGatewayCatalogSnapshotToSqlite: vi.fn(() =>
            Promise.resolve({
                sqliteSnapshot: { source: 'test' },
                sqliteCounts: {
                    projections: 1,
                    evidences: 0,
                    routeOptions: 1,
                    accountOverlays: 1,
                    modelEligibilityDecisions: 0,
                    providerProjections: 0,
                    providerEvidences: 0,
                    rawPayloadRefs: 0,
                    conflicts: 0,
                    importRuns: 0,
                },
            }),
        ),
        planModelGatewayCatalogRefresh: vi.fn(() => ({
            selectedImporters: [],
            selected: [
                {
                    importerId: 'openrouter-models',
                    providerId: 'openrouter',
                    sourceId: 'openrouter-models',
                    sourceKind: 'public_api',
                    refreshPolicy: 'ttl',
                    ttlSeconds: 3600,
                    ageSeconds: 7200,
                    reason: 'source_ttl_expired',
                },
            ],
            skipped: [
                {
                    importerId: 'openai-models',
                    providerId: 'openai',
                    sourceId: 'openai-models',
                    sourceKind: 'authenticated_api',
                    refreshPolicy: 'ttl',
                    ttlSeconds: 3600,
                    ageSeconds: 60,
                    reason: 'source_ttl_fresh',
                },
            ],
            importerCount: 2,
            sourceCount: 2,
        })),
        refreshModelGatewayCatalog: vi.fn(() =>
            Promise.resolve({
                snapshot: { projections: [{ providerModel: 'new-model' }], importRuns: [{ status: 'completed' }] },
                diff: {
                    added: ['openrouter:new-model:default'],
                    removed: [],
                    changed: [
                        {
                            key: 'openrouter:changed-model:default',
                            changedFields: ['pricing'],
                            changedKinds: ['pricing_changed'],
                        },
                    ],
                },
                openai: { object: 'list', data: [{ id: 'new-model', object: 'model' }] },
                overlayRefresh: { enabled: true, imported: 0, retained: 0, total: 0 },
                eligibilityRefresh: {
                    enabled: true,
                    run: { runId: 'eligibility-run' },
                    decisionCount: 2,
                    diff: { added: ['openrouter:new-model:default:exact_model:new-model:default:terminal-refresh:default'], removed: [], changed: [] },
                    diffSummary: { addedCount: 1, removedCount: 0, changedCount: 0, changedKinds: [], becameEligibleCount: 0, becameExcludedCount: 0 },
                },
                retention: {
                    importRuns: { before: 1, after: 1, pruned: 0 },
                    rawPayloadRefs: { before: 0, after: 0, pruned: 0 },
                    conflicts: { before: 0, after: 0, pruned: 0 },
                    modelEligibilityRuns: { before: 0, after: 0, pruned: 0 },
                },
                writePolicy: { mode: 'commit', storeAvailable: true, committed: true },
            }),
        ),
        renderModelGatewayCanonicalCommandLines: vi.fn(() => [
            'package  prebuild    npm run model-gateway:prebuild :: Run pre-build validators.',
            'make     prebuild    make model-gateway-prebuild :: Run pre-build validators.',
            'terminal orientation /byok gateway commands :: Show commands.',
            'terminal orientation /byok gateway operator-ready profile:repo_agent :: Show operator readiness.',
        ]),
        routeGatewayModels: vi.fn(),
        searchModelGatewayCatalogEntries: vi.fn(() => []),
        SqliteModelGatewayCatalogStore: vi.fn(function SqliteModelGatewayCatalogStore() {
            return {
                readStorageDiagnostics: vi.fn(() =>
                    Promise.resolve({
                        schemaVersion: 3,
                        userVersion: 3,
                        catalogRows: 1,
                        accountHistoryRows: 0,
                        runtimeRows: 0,
                        routeDecisionRows: 0,
                        recoveryAttemptRows: 0,
                        liveScenarioRunRows: 1,
                        latestLiveScenarioRun: {
                            runId: 'live-scenario-1',
                            scenarioKind: 'byok_real_no_pr',
                            status: 'passed',
                            ok: true,
                            summaryPath: 'artifacts/terminal-live/unit/summary.md',
                        },
                        activeSnapshot: { exists: true, source: 'test' },
                        tableCounts: {},
                    }),
                ),
                writeRouteDecisionEvents: vi.fn(() => Promise.resolve()),
                writeAutomationDecisionRecords: vi.fn(() => Promise.resolve({ automationDecisions: 1 })),
                writeAutomationPolicySnapshotRecords: vi.fn(() =>
                    Promise.resolve({ automationPolicySnapshots: 1 }),
                ),
                writeAutomationEffectApplicationRecords: vi.fn(() =>
                    Promise.resolve({ automationEffectApplications: 1 }),
                ),
                writeRecoveryAttemptRecords: vi.fn(() => Promise.resolve({ recoveryAttempts: 1 })),
                writeSdkSessionHandoffRecords: vi.fn(() => Promise.resolve({ sdkSessionHandoffs: 1 })),
                readAutomationDecisionRecords: vi.fn(() =>
                    Promise.resolve([
                        {
                            timestamp: '2026-06-01T00:00:00.000Z',
                            action: 'prepare_new_session',
                            selectedRouteKey: 'zai:glm-4.5-flash',
                            routeProfile: 'repo_agent',
                            ok: true,
                        },
                    ]),
                ),
                readSdkSessionHandoffRecords: vi.fn(() =>
                    Promise.resolve([
                        {
                            requestedAt: '2026-06-01T00:00:01.000Z',
                            status: 'deferred_until_turn_boundary',
                            sessionId: 'sdk-session-1',
                            targetModel: 'glm-4.5-flash',
                            selectedRouteKey: 'zai:glm-4.5-flash',
                            operation: {
                                targetRoute: {
                                    providerId: 'zai',
                                    providerModel: 'glm-4.5-flash',
                                },
                                promotionAuthorization: {
                                    authorized: true,
                                    expiresAt: '2026-06-01T00:05:01.000Z',
                                },
                            },
                        },
                    ]),
                ),
                readSdkSessionConfirmationRecords: vi.fn(() =>
                    Promise.resolve([
                        {
                            observedAt: '2026-06-01T00:00:02.000Z',
                            status: 'matched_handoff',
                            previousModel: 'auto',
                            confirmedModel: 'glm-4.5-flash',
                        },
                    ]),
                ),
                readRecoveryAttemptRecords: vi.fn(() =>
                    Promise.resolve([
                        {
                            observedAt: '2026-06-01T00:00:03.000Z',
                            status: 'effect_not_authorized',
                            recoveryScope: 'account',
                            failureKind: 'rate-limit',
                            selectedRouteKey: 'zai:glm-4.5-flash',
                        },
                    ]),
                ),
                readStandbyPlanRecords: vi.fn(() =>
                    Promise.resolve([
                        {
                            standbyPlanId: 'standby-1',
                            status: 'ready',
                            generatedAt: '2026-06-01T00:00:04.000Z',
                            summary: { routeCount: 2, providerCount: 2, runtimeProofCount: 1 },
                            routes: [
                                { providerId: 'groq', providerModel: 'llama', routeKey: 'groq:llama' },
                                { providerId: 'zai', providerModel: 'glm', routeKey: 'zai:glm' },
                            ],
                        },
                    ]),
                ),
                readLiveScenarioRunRecords: vi.fn(() =>
                    Promise.resolve([
                        {
                            runId: 'live-scenario-1',
                            scenarioKind: 'byok_real_no_pr',
                            status: 'passed',
                            ok: true,
                            summaryPath: 'artifacts/terminal-live/unit/summary.md',
                        },
                    ]),
                ),
                readOpenAIModelCatalogList: vi.fn(() => Promise.resolve({ object: 'list', data: [] })),
                readRuntimeHealthForModel: vi.fn(() => Promise.resolve({ health: null, probes: [] })),
            };
        }),
        runConfiguredByokAgentProbe: vi.fn(),
        runConfiguredByokChatProbe: vi.fn(),
        runConfiguredByokJsonProbe: vi.fn(),
        runConfiguredByokStreamingProbe: vi.fn(),
        runConfiguredByokVisionProbe: vi.fn(),
        readByokProviderHealthState: vi.fn(() => ({
            enabled: false,
            path: null,
            loaded: true,
            records: 0,
            persistedRecords: 0,
            flushScheduled: false,
            flushInFlight: false,
            dirty: false,
            error: null,
        })),
        readByokProviderModelHealth: vi.fn(() => null),
        readConfiguredByokModelDiscoveryCacheFromEnv: vi.fn(() => null),
        readConfiguredByokProfilesFromEnv: vi.fn(() => ({})),
        readFile: vi.fn(),
        readdir: vi.fn(),
        readTerminalByokGatewayProjectionFromEnv: vi.fn(() => ({
            gatewayModels: [],
            modelGateway: { providers: [], models: [] },
            modelGatewayProjection: { providers: [], models: [] },
        })),
        readTerminalByokProjection: vi.fn(),
        readTerminalConfigProjection: vi.fn(() => ({ currentModel: 'kilo-auto/free' })),
        readTerminalConfiguredSessionFsState: vi.fn(() => Promise.resolve({ configured: false, mode: 'default' })),
        readTerminalRuntimeState: vi.fn(() => ({ contextWindow: null })),
        recordByokProviderModelCallFailure: vi.fn(),
        recordByokProviderModelCallSuccess: vi.fn(),
        recordByokProviderModelProbeResult: vi.fn(),
        recordByokProviderModelAgentProbeFailure: vi.fn(),
        recordByokProviderModelAgentProbeSuccess: vi.fn(),
        recordModelGatewayRouteDecision: vi.fn((event) => event),
        resolveProviderEndpointInventory: vi.fn((providerId) =>
            providerId === 'kilo'
                ? {
                      providerId: 'kilo',
                      adapterId: 'kilo',
                      providerKind: 'gateway',
                      baseUrls: ['https://api.kilo.ai/api/gateway'],
                      modelCatalogSources: [
                          {
                              kind: 'public_gateway_api',
                              method: 'GET',
                              url: 'https://api.kilo.ai/api/gateway/models',
                              richness: 'pricing_context_features',
                          },
                      ],
                      runtimeEndpoints: [{ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }],
                      routeSelectors: ['exact_model', 'gateway_auto', 'provider_model'],
                  }
                : null,
        ),
        resolveProviderGatewayTraits: vi.fn((providerId) =>
            providerId === 'kilo'
                ? {
                      providerId: 'kilo',
                      providerKind: 'gateway',
                      topology: 'gateway',
                      openAICompatible: true,
                      catalogSourceCount: 1,
                      runtimeEndpointCount: 1,
                      publicCatalogSourceCount: 1,
                      authenticatedCatalogSourceCount: 0,
                      parameterizedCatalogSourceCount: 0,
                      runtimeKinds: ['chat_completions'],
                      routeSelectors: ['exact_model', 'gateway_auto', 'provider_model'],
                      richnessTags: ['context', 'features', 'pricing'],
                      capabilities: { chatCompletions: true, responses: false, fim: false, embeddings: false },
                      routing: {
                          supportsAutoSelection: true,
                          supportsFallback: false,
                          supportsProviderOrder: false,
                          supportsGatewayByok: false,
                      },
                      metadata: { hasPricingMetadata: true, hasContextMetadata: true, hasProviderMetadata: false },
                  }
                : null,
        ),
        mkdir: vi.fn(() => Promise.resolve()),
        rename: vi.fn(),
        rm: vi.fn(() => Promise.resolve()),
        setTerminalModelProjection: vi.fn(),
        switchTerminalRouteProjection: vi.fn(() => ({
            ok: true,
            previousRoute: null,
            nextRoute: { providerId: 'kilo-code', providerModel: 'kilo-auto/free' },
        })),
        stat: vi.fn(),
        summarizeModelGatewayRefreshLogText: vi.fn(() => ({
            eventCount: 6,
            invalidLineCount: 0,
            completed: true,
            committed: true,
            elapsedMs: 1200,
            totals: { projections: 42, openai: 42, overlays: 3, added: 2, removed: 0, changed: 1 },
            importers: {
                'openrouter-models': { started: 1, completed: 1, failed: 0, rowCount: 2, evidenceCount: 8 },
            },
            failures: [],
        })),
        toOpenAIModelCatalogList: vi.fn(() => ({ object: 'list', data: [] })),
        activateModelGatewayByokProfileEnv: vi.fn((name, env = process.env) => {
            env.COPILOT_BYOK_ENABLED = 'true';
            env.COPILOT_BYOK_PROFILE = String(name);
            return { ok: true, profileName: String(name) };
        }),
        materializeModelGatewayActiveByokProfileEnv: vi.fn((env = process.env) => {
            const profile = String(env.COPILOT_BYOK_PROFILE ?? '');
            const preset = profile.startsWith('groq') ? 'groq' : profile.startsWith('openrouter') ? 'openrouter' : 'kilo-code';
            return {
                env: {
                    ...env,
                    COPILOT_BYOK_ENABLED: 'true',
                    COPILOT_BYOK_PROVIDER_PRESET: preset,
                },
                profile,
            };
        }),
        readModelGatewayByokProfileCostHint: vi.fn((profileName) => {
            const profile = String(profileName ?? '');
            return profile.includes('free')
                ? {
                      profileFreeTier: true,
                      profileCostSource: 'profile',
                      profileCostDetail: '6k TPM observed on current plan',
                  }
                : {
                      profileFreeTier: null,
                      profileCostSource: null,
                      profileCostDetail: null,
                  };
        }),
        writeFile: vi.fn(),
    }));

vi.mock('node:fs/promises', () => ({
    default: { readFile, mkdir, rm, writeFile, rename, chmod, readdir, stat },
    readFile,
    mkdir,
    rm,
    writeFile,
    rename,
    chmod,
    readdir,
    stat,
}));

vi.mock('#copilot/infra/public/trusted-io', () => ({
    writeFileAtomicTrusted: vi.fn((path, content, options) => writeFile(path, content, options)),
}));

vi.mock('dotenv', () => ({
    config: loadDotenv,
}));

vi.mock('#copilot/config', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        discoverConfiguredByokModelsFromEnv,
        readConfiguredByokModelDiscoveryCacheFromEnv,
        readConfiguredByokProfilesFromEnv,
    };
});

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    listTerminalSdkSessionInventory,
    readTerminalByokGatewayProjectionFromEnv,
    readTerminalByokProjection,
    readTerminalConfigProjection,
    readTerminalConfiguredSessionFsState,
    readTerminalRuntimeState,
    scheduleTerminalSdkSessionBootSelection,
    setTerminalModelProjection,
}));

vi.mock('../../../../src/copilot/terminal/frontend/projections/config.js', () => ({
    readTerminalByokGatewayProjectionFromEnv,
    readTerminalByokProjection,
    readTerminalConfigProjection,
    setTerminalModelProjection,
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/session/index.js', () => ({
    listTerminalSdkSessionInventory,
    readTerminalConfiguredSessionFsState,
    scheduleTerminalSdkSessionBootSelection,
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalRuntimeState,
}));

vi.mock('../../../../src/copilot/terminal/frontend/projections/model-selection/index.js', () => ({
    setTerminalModelProjection,
    switchTerminalRouteProjection,
}));

vi.mock('#copilot/model-gateway', () => ({
    auditCatalogImporterSet,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    activateModelGatewayByokProfileEnv,
    compareModelGatewaySelectionAudits,
    resolveModelGatewaySelectionPolicy,
    applyModelGatewayEligibilityToSnapshot,
    buildCatalogRefreshEventBatch,
    buildCatalogRefreshStartedEvent,
    buildEligibilityEvaluatedEvent,
    buildModelGatewayPreBuildReadinessReport,
    buildModelGatewayPreKCompatibilityReport,
    buildModelGatewayRouteCandidates,
    buildModelGatewayRuntimeProofCommands,
    buildModelGatewayRuntimeStandbyPlan,
    buildModelGatewayRuntimeStandbyRoutes,
    buildModelGatewayRuntimeSelectorPlan,
    buildModelGatewayRuntimeAutomationDecision,
    buildModelGatewayRuntimeAutomationControllerStep,
    DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH,
    explainModelGatewayRuntimeAutomationPolicySources,
    listModelGatewayRuntimeAutomationPolicyPresets,
    resolveModelGatewayRuntimeAutomationPolicyPreset,
    validateModelGatewayRuntimeAutomationPolicy,
    readModelGatewayRuntimeAutomationEffectivePolicy,
    readModelGatewayRuntimeAutomationPolicy,
    readModelGatewayRuntimeAutomationPolicyFile,
    writeModelGatewayRuntimeAutomationPolicyFile,
    buildModelGatewaySelectionDecisionTrace,
    buildProbeCompletedEvent: buildProbeCompletedEvent,
    buildRouteDecisionEvent,
    materializeModelGatewayActiveByokProfileEnv,
    classifyByokProviderFailure,
    clearByokProviderModelHealth,
    createDefaultModelGatewayCatalogImporters,
    createEnvSecretRegistry,
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    evaluateModelGatewayCatalogEligibility,
    evaluateModelGatewayProviderEnvRequirements,
    explainModelGatewayAccountLimitOverlays,
    explainModelGatewayCatalogEntry,
    explainModelGatewayProviderEntry,
    explainModelGatewayEligibilityDecision,
    explainModelGatewaySelectionComparison,
    flushAndMirrorByokProviderHealthToSqlite,
    flushByokProviderHealth,
    JsonModelGatewayCatalogStore,
    listByokProviderModelHealth,
    listModelGatewayCanonicalCommands,
    listProviderEndpointInventory,
    listProviderGatewayTraits,
    listProviderWireProbeMatrix,
    mirrorByokProviderHealthToSqlite,
    mirrorModelGatewayCatalogSnapshotToSqlite,
    MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON,
    persistModelGatewaySelectionDecisionTrace,
    planModelGatewayCatalogRefresh,
    planModelGatewayProbeBackoff,
    readModelGatewayByokProfileCostHint,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    recordModelGatewayRouteDecision,
    refreshModelGatewayCatalog,
    recommendCatalogDiffProbes,
    renderModelGatewayCanonicalCommandLines,
    renderModelGatewayLocalProviderOptInGuidance,
    resolveProviderEndpointInventory,
    resolveProviderGatewayTraits,
    routeGatewayModels,
    searchModelGatewayCatalogEntries,
    SqliteModelGatewayCatalogStore,
    runConfiguredByokChatProbe: runConfiguredByokChatProbe,
    runConfiguredByokAgentProbe: runConfiguredByokAgentProbe,
    runConfiguredByokJsonProbe: runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe: runConfiguredByokStreamingProbe,
    runConfiguredByokVisionProbe: runConfiguredByokVisionProbe,
    planModelGatewayProbeBackoff,
    summarizeModelGatewayAccountOverlays,
    summarizeModelGatewayLocalProviderOptInBlocks,
    summarizeModelGatewayProviderQuotaCapabilities,
    summarizeModelGatewayRuntimeAccountOverlays,
    summarizeModelGatewayProviderEnvRequirements,
    summarizeModelGatewayRefreshLogText,
    summarizeCanonicalModelProjectionDiff,
    summarizeModelGatewayEligibilityDiff,
    summarizeProviderWireProbeMatrix,
    toOpenAIModelCatalogList,
}));

const { cmdByok } = await import('../../../../src/copilot/terminal/commands/byok.js');
const {
    applyTerminalByokGatewayAutoEffects,
    createTerminalByokGatewayAutoEffectApplicationRecords,
    createTerminalByokGatewaySdkSessionHandoffRecords,
    describeTerminalByokGatewayAutoEffect,
    runTerminalByokGatewayPostTurnAutomation,
    runTerminalByokGatewayPreTurnAutomation,
} = await import('../../../../src/copilot/terminal/byok/gateway-auto.js');
const { clearTerminalActivityHistory, readTerminalActivityHistory } = await import(
    '../../../../src/copilot/terminal/state/activity-state.js'
);

const BASE_PROJECTION = Object.freeze({
    envKeys: Object.freeze(['COPILOT_BYOK_ENABLED', 'COPILOT_BYOK_PROFILE', 'KILO_API_KEY']),
    gatewayModels: Object.freeze([]),
    models: Object.freeze([]),
    profiles: Object.freeze([]),
    modelGateway: Object.freeze({
        source: 'test',
        active: Object.freeze({ modelId: null }),
        providers: Object.freeze([]),
        models: Object.freeze([]),
        diagnostics: Object.freeze({ providerCount: 0, modelCount: 0, enabledModelCount: 0 }),
    }),
    modelGatewayProjection: Object.freeze({
        providerCount: 0,
        modelCount: 0,
        enabledModelCount: 0,
        providers: Object.freeze([]),
        models: Object.freeze([]),
    }),
    summary: Object.freeze({
        enabled: false,
        ready: false,
        profile: null,
        preset: null,
        providerType: null,
        baseUrl: null,
        model: null,
        wireApi: null,
        azureApiVersion: null,
        auth: { apiKeyConfigured: false, bearerTokenConfigured: false, headersConfigured: false },
        modelList: { configured: false, count: 0 },
        capabilities: { reasoningEffort: false, vision: false, contextWindowTokens: 128000 },
        warnings: [],
        errors: [],
    }),
});

/**
 * @param {Partial<typeof BASE_PROJECTION>} [overrides]
 */
function mockProjection(overrides = {}) {
    readTerminalByokProjection.mockReturnValue({
        ...BASE_PROJECTION,
        ...overrides,
        summary: { ...BASE_PROJECTION.summary, ...(overrides.summary ?? {}) },
    });
}

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    return {
        println: vi.fn((/** @type {string} */ text) => lines.push(text)),
        output: () => lines.join('\n'),
    };
}

describe('terminal /byok command', () => {
    afterEach(() => {
        discoverConfiguredByokModelsFromEnv.mockReset();
        readConfiguredByokModelDiscoveryCacheFromEnv.mockReset();
        readConfiguredByokModelDiscoveryCacheFromEnv.mockReturnValue(null);
        auditCatalogImporterSet.mockClear();
        auditModelGatewayCatalogSnapshotIntegrity.mockClear();
        auditModelGatewayPostRuntimeSelection.mockClear();
        auditModelGatewayPreRuntimeSelection.mockClear();
        buildModelGatewayRuntimeStandbyPlan.mockClear();
        buildModelGatewayRuntimeSelectorPlan.mockClear();
        buildModelGatewaySelectionDecisionTrace.mockClear();
        compareModelGatewaySelectionAudits.mockClear();
        explainModelGatewaySelectionComparison.mockClear();
        persistModelGatewaySelectionDecisionTrace.mockClear();
        resolveModelGatewaySelectionPolicy.mockClear();
        applyModelGatewayEligibilityToSnapshot.mockClear();
        chmod.mockReset();
        chmod.mockResolvedValue(undefined);
        clearByokProviderModelHealth.mockReset();
        createDefaultModelGatewayCatalogImporters.mockReset();
        createDefaultModelGatewayCatalogImporters.mockReturnValue([{ id: 'openrouter-models' }, { id: 'openai-models' }]);
        createEnvSecretRegistry.mockReset();
        createEnvSecretRegistry.mockReturnValue({ has: () => false, get: () => null, list: () => [] });
        evaluateModelGatewayCatalogEligibility.mockClear();
        evaluateModelGatewayProviderEnvRequirements.mockReset();
        evaluateModelGatewayProviderEnvRequirements.mockReturnValue([
            {
                providerId: 'kilo',
                status: 'missing',
                requiredGroupCount: 1,
                satisfiedRequiredGroupCount: 0,
                recommendedGroupCount: 0,
                satisfiedRecommendedGroupCount: 0,
                configuredKeys: [],
                missingRequiredKeys: ['KILO_API_KEY', 'KILO_CODE_API_KEY'],
                missingRecommendedKeys: [],
                groups: [],
            },
        ]);
        flushByokProviderHealth.mockReset();
        flushByokProviderHealth.mockResolvedValue(undefined);
        explainModelGatewayCatalogEntry.mockClear();
        explainModelGatewayProviderEntry.mockClear();
        explainModelGatewayEligibilityDecision.mockClear();
        JsonModelGatewayCatalogStore.mockClear();
        listByokProviderModelHealth.mockReset();
        listByokProviderModelHealth.mockReturnValue([]);
        listModelGatewayCanonicalCommands.mockReset();
        listModelGatewayCanonicalCommands.mockReturnValue([
            { id: 'prebuild.all', surface: 'package', phase: 'prebuild', command: 'npm run model-gateway:prebuild' },
            { id: 'prebuild.first-build', surface: 'make', phase: 'prebuild', command: 'make model-gateway-prebuild' },
            { id: 'commands.text', surface: 'terminal', phase: 'orientation', command: '/byok gateway commands' },
            { id: 'operator.ready', surface: 'terminal', phase: 'orientation', command: '/byok gateway operator-ready profile:repo_agent' },
        ]);
        listProviderEndpointInventory.mockReset();
        listProviderEndpointInventory.mockReturnValue([
            {
                providerId: 'kilo',
                adapterId: 'kilo',
                providerKind: 'gateway',
                baseUrls: ['https://api.kilo.ai/api/gateway'],
                modelCatalogSources: [
                    {
                        kind: 'public_gateway_api',
                        method: 'GET',
                        url: 'https://api.kilo.ai/api/gateway/models',
                        richness: 'pricing_context_features',
                    },
                ],
                runtimeEndpoints: [{ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }],
                routeSelectors: ['exact_model', 'gateway_auto', 'provider_model'],
            },
        ]);
        listProviderGatewayTraits.mockReset();
        listProviderGatewayTraits.mockReturnValue([
            {
                providerId: 'kilo',
                providerKind: 'gateway',
                topology: 'gateway',
                openAICompatible: true,
                catalogSourceCount: 1,
                runtimeEndpointCount: 1,
                publicCatalogSourceCount: 1,
                authenticatedCatalogSourceCount: 0,
                parameterizedCatalogSourceCount: 0,
                runtimeKinds: ['chat_completions'],
                routeSelectors: ['exact_model', 'gateway_auto', 'provider_model'],
                richnessTags: ['context', 'features', 'pricing'],
                capabilities: { chatCompletions: true, responses: false, fim: false, embeddings: false },
                routing: { supportsAutoSelection: true, supportsFallback: false, supportsProviderOrder: false, supportsGatewayByok: false },
                metadata: { hasPricingMetadata: true, hasContextMetadata: true, hasProviderMetadata: false },
            },
        ]);
        listProviderWireProbeMatrix.mockReset();
        listProviderWireProbeMatrix.mockReturnValue([
            {
                providerId: 'kilo',
                topology: 'gateway',
                runtimeKind: 'chat_completions',
                wireApi: 'openai_chat_completions',
                implementedProbeKinds: ['chat', 'streaming', 'json', 'agent'],
                pendingProbeKinds: ['reasoning', 'forced_tool_choice', 'parallel_tool_calls'],
                notes: ['runtime_probe_gap'],
            },
        ]);
        summarizeProviderWireProbeMatrix.mockReset();
        summarizeProviderWireProbeMatrix.mockReturnValue({
            providerCount: 1,
            rowCount: 1,
            implementedProbeKindCounts: { chat: 1, streaming: 1, json: 1, agent: 1 },
            pendingProbeKindCounts: { reasoning: 1, forced_tool_choice: 1, parallel_tool_calls: 1 },
            providersWithPendingProbeKinds: ['kilo'],
        });
        summarizeModelGatewayProviderEnvRequirements.mockReset();
        summarizeModelGatewayProviderEnvRequirements.mockReturnValue({
            providerCount: 1,
            readyCount: 0,
            partialCount: 0,
            missingCount: 1,
            missingRequiredKeyCounts: { KILO_API_KEY: 1, KILO_CODE_API_KEY: 1 },
            missingRecommendedKeyCounts: {},
        });
        listTerminalSdkSessionInventory.mockReset();
        listTerminalSdkSessionInventory.mockResolvedValue({
            currentSessionId: null,
            lastSessionId: null,
            foregroundSessionId: null,
            persistedByokBinding: null,
            lastBootDecision: null,
            sessions: [],
        });
        loadDotenv.mockReset();
        flushAndMirrorByokProviderHealthToSqlite.mockClear();
        mirrorByokProviderHealthToSqlite.mockClear();
        mirrorModelGatewayCatalogSnapshotToSqlite.mockClear();
        planModelGatewayCatalogRefresh.mockReset();
        planModelGatewayCatalogRefresh.mockReturnValue({
            selectedImporters: [],
            selected: [
                {
                    importerId: 'openrouter-models',
                    providerId: 'openrouter',
                    sourceId: 'openrouter-models',
                    sourceKind: 'public_api',
                    refreshPolicy: 'ttl',
                    ttlSeconds: 3600,
                    ageSeconds: 7200,
                    reason: 'source_ttl_expired',
                },
            ],
            skipped: [
                {
                    importerId: 'openai-models',
                    providerId: 'openai',
                    sourceId: 'openai-models',
                    sourceKind: 'authenticated_api',
                    refreshPolicy: 'ttl',
                    ttlSeconds: 3600,
                    ageSeconds: 60,
                    reason: 'source_ttl_fresh',
                },
            ],
            importerCount: 2,
            sourceCount: 2,
        });
        refreshModelGatewayCatalog.mockReset();
        refreshModelGatewayCatalog.mockResolvedValue({
            snapshot: { projections: [{ providerModel: 'new-model' }], importRuns: [{ status: 'completed' }] },
            diff: {
                added: ['openrouter:new-model:default'],
                removed: [],
                changed: [
                    {
                        key: 'openrouter:changed-model:default',
                        changedFields: ['pricing'],
                        changedKinds: ['pricing_changed'],
                    },
                ],
            },
            openai: { object: 'list', data: [{ id: 'new-model', object: 'model' }] },
            overlayRefresh: { enabled: true, imported: 0, retained: 0, total: 0 },
            eligibilityRefresh: {
                enabled: true,
                run: { runId: 'eligibility-run' },
                decisionCount: 2,
                diff: { added: ['openrouter:new-model:default:exact_model:new-model:default:terminal-refresh:default'], removed: [], changed: [] },
                diffSummary: { addedCount: 1, removedCount: 0, changedCount: 0, changedKinds: [], becameEligibleCount: 0, becameExcludedCount: 0 },
            },
            retention: {
                importRuns: { before: 1, after: 1, pruned: 0 },
                rawPayloadRefs: { before: 0, after: 0, pruned: 0 },
                conflicts: { before: 0, after: 0, pruned: 0 },
                modelEligibilityRuns: { before: 0, after: 0, pruned: 0 },
            },
            writePolicy: { mode: 'commit', storeAvailable: true, committed: true },
        });
        routeGatewayModels.mockReset();
        searchModelGatewayCatalogEntries.mockClear();
        SqliteModelGatewayCatalogStore.mockClear();
        buildCatalogRefreshEventBatch.mockClear();
        buildCatalogRefreshStartedEvent.mockClear();
        buildModelGatewayRouteCandidates.mockReset();
        buildModelGatewayRouteCandidates.mockReturnValue([]);
        recommendCatalogDiffProbes.mockClear();
        summarizeCanonicalModelProjectionDiff.mockClear();
        summarizeModelGatewayEligibilityDiff.mockClear();
        buildRouteDecisionEvent.mockClear();
        recordModelGatewayRouteDecision.mockClear();
        buildProbeCompletedEvent.mockClear();
        renderModelGatewayCanonicalCommandLines.mockReset();
        renderModelGatewayCanonicalCommandLines.mockReturnValue([
            'package  prebuild    npm run model-gateway:prebuild :: Run pre-build validators.',
            'make     prebuild    make model-gateway-prebuild :: Run pre-build validators.',
            'terminal orientation /byok gateway commands :: Show commands.',
            'terminal orientation /byok gateway operator-ready profile:repo_agent :: Show operator readiness.',
        ]);
        runConfiguredByokChatProbe.mockReset();
        runConfiguredByokAgentProbe.mockReset();
        runConfiguredByokJsonProbe.mockReset();
        runConfiguredByokStreamingProbe.mockReset();
        runConfiguredByokVisionProbe.mockReset();
        readByokProviderHealthState.mockReset();
        readByokProviderHealthState.mockReturnValue({
            enabled: false,
            path: null,
            loaded: true,
            records: 0,
            persistedRecords: 0,
            flushScheduled: false,
            flushInFlight: false,
            dirty: false,
            error: null,
        });
        readByokProviderModelHealth.mockReset();
        readByokProviderModelHealth.mockReturnValue(null);
        readModelGatewayRuntimeAutomationPolicy.mockReset();
        readModelGatewayRuntimeAutomationPolicy.mockReturnValue({
            enabled: false,
            policy: 'prefer_runtime_proved',
            profiles: [],
            allowLiveSetModel: false,
            allowNewSession: false,
            allowProviderProbes: false,
            allowLocalPrivate: false,
            accountWideFailureKinds: [],
        });
        readModelGatewayRuntimeAutomationPolicyFile.mockReset();
        readModelGatewayRuntimeAutomationPolicyFile.mockResolvedValue({});
        readModelGatewayRuntimeAutomationEffectivePolicy.mockReset();
        readModelGatewayRuntimeAutomationEffectivePolicy.mockResolvedValue({
            enabled: false,
            policy: 'prefer_runtime_proved',
            profiles: [],
            allowLiveSetModel: false,
            allowNewSession: false,
            allowProviderProbes: false,
            allowLocalPrivate: false,
            accountWideFailureKinds: [],
        });
        writeModelGatewayRuntimeAutomationPolicyFile.mockClear();
        readConfiguredByokProfilesFromEnv.mockReset();
        readConfiguredByokProfilesFromEnv.mockReturnValue({});
        readFile.mockReset();
        readdir.mockReset();
        stat.mockReset();
        summarizeModelGatewayRefreshLogText.mockReset();
        summarizeModelGatewayRefreshLogText.mockReturnValue({
            eventCount: 6,
            invalidLineCount: 0,
            completed: true,
            committed: true,
            elapsedMs: 1200,
            totals: { projections: 42, openai: 42, overlays: 3, added: 2, removed: 0, changed: 1 },
            importers: {
                'openrouter-models': { started: 1, completed: 1, failed: 0, rowCount: 2, evidenceCount: 8 },
            },
            failures: [],
        });
        readTerminalByokGatewayProjectionFromEnv.mockReset();
        readTerminalByokGatewayProjectionFromEnv.mockReturnValue({
            gatewayModels: [],
            modelGateway: { providers: [], models: [] },
            modelGatewayProjection: { providers: [], models: [] },
        });
        readTerminalByokProjection.mockReset();
        readTerminalConfigProjection.mockReset();
        readTerminalConfigProjection.mockReturnValue({ currentModel: 'kilo-auto/free' });
        readTerminalRuntimeState.mockReset();
        readTerminalRuntimeState.mockReturnValue({ contextWindow: null });
        recordByokProviderModelCallFailure.mockReset();
        recordByokProviderModelCallSuccess.mockReset();
        recordByokProviderModelProbeResult.mockReset();
        recordByokProviderModelAgentProbeFailure.mockReset();
        recordByokProviderModelAgentProbeSuccess.mockReset();
        buildModelGatewayPreBuildReadinessReport.mockClear();
        buildModelGatewayPreKCompatibilityReport.mockClear();
        resolveProviderEndpointInventory.mockReset();
        resolveProviderEndpointInventory.mockImplementation((providerId) =>
            providerId === 'kilo'
                ? {
                      providerId: 'kilo',
                      adapterId: 'kilo',
                      providerKind: 'gateway',
                      baseUrls: ['https://api.kilo.ai/api/gateway'],
                      modelCatalogSources: [
                          {
                              kind: 'public_gateway_api',
                              method: 'GET',
                              url: 'https://api.kilo.ai/api/gateway/models',
                              richness: 'pricing_context_features',
                          },
                      ],
                      runtimeEndpoints: [{ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }],
                      routeSelectors: ['exact_model', 'gateway_auto', 'provider_model'],
                  }
                : null,
        );
        resolveProviderGatewayTraits.mockReset();
        resolveProviderGatewayTraits.mockImplementation((providerId) =>
            providerId === 'kilo'
                ? {
                      providerId: 'kilo',
                      providerKind: 'gateway',
                      topology: 'gateway',
                      openAICompatible: true,
                      catalogSourceCount: 1,
                      runtimeEndpointCount: 1,
                      publicCatalogSourceCount: 1,
                      authenticatedCatalogSourceCount: 0,
                      parameterizedCatalogSourceCount: 0,
                      runtimeKinds: ['chat_completions'],
                      routeSelectors: ['exact_model', 'gateway_auto', 'provider_model'],
                      richnessTags: ['context', 'features', 'pricing'],
                      capabilities: { chatCompletions: true, responses: false, fim: false, embeddings: false },
                      routing: {
                          supportsAutoSelection: true,
                          supportsFallback: false,
                          supportsProviderOrder: false,
                          supportsGatewayByok: false,
                      },
                      metadata: { hasPricingMetadata: true, hasContextMetadata: true, hasProviderMetadata: false },
                  }
                : null,
        );
        rename.mockReset();
        scheduleTerminalSdkSessionBootSelection.mockReset();
        scheduleTerminalSdkSessionBootSelection.mockResolvedValue({ ok: true });
        setTerminalModelProjection.mockReset();
        clearTerminalActivityHistory();
        writeFile.mockReset();
        delete process.env['COPILOT_BYOK_ENABLED'];
        delete process.env['COPILOT_BYOK_PROFILE'];
        delete process.env['COPILOT_BYOK_PROVIDER_PRESET'];
        delete process.env['COPILOT_BYOK_PROVIDER_TYPE'];
        delete process.env['COPILOT_BYOK_MODEL'];
        delete process.env['COPILOT_BYOK_BASE_URL'];
        delete process.env['COPILOT_BYOK_WIRE_API'];
        delete process.env['COPILOT_BYOK_HEADERS_JSON'];
    });

    it('mostra .env.local como arquivo canônico sem expor segredos', async () => {
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'anthropic/claude-sonnet-4.5',
                auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                modelList: { configured: true, count: 1 },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).toContain('BYOK status');
        expect(ctx.output()).toContain('ativo e pronto');
        expect(ctx.output()).toContain('.env.local');
        expect(ctx.output()).toContain('Autenticação');
        expect(ctx.output()).toContain('token bearer configurado');
        expect(ctx.output()).toContain('Quota');
        expect(ctx.output()).toContain('BYOK usa quota/cobrança do provider externo');
        expect(ctx.output()).toContain('GitHub Copilot/Premium Requests só valem para rotas');
        expect(ctx.output()).toContain('não-BYOK');
        expect(ctx.output()).not.toContain('ativo sim');
        expect(ctx.output()).not.toContain('pronto sim');
        expect(ctx.output()).not.toContain('protocolo -');
        expect(ctx.output()).not.toContain('Azure -');
        expect(ctx.output()).toContain('Rotina');
        expect(ctx.output()).toContain('/byok providers · /byok profiles · /byok models · /byok recommend');
        expect(ctx.output()).toContain('Trocar');
        expect(ctx.output()).toContain('/byok use <perfil|sdk> · /byok model <id> · /byok provider <preset>');
        expect(ctx.output()).toContain('Provar');
        expect(ctx.output()).toContain('/byok probe chat · /byok probe agent · /byok probe shortlist');
        expect(ctx.output()).toContain('Avançado');
        expect(ctx.output()).toContain('/byok gateway commands · /byok auto policy · /byok env');
        expect(ctx.output()).not.toContain('/byok gateway catalog refresh|diff|integrity|sqlite|search <query>');
        expect(ctx.output()).not.toContain('/byok auto [on|policy|doctor|standby|proof-plan|switch|history|off]');
        expect(ctx.output()).not.toContain('apiKey');
        expect(ctx.output()).not.toContain('bearer=');
        expect(ctx.output()).not.toContain('\x1b[36mBYOK status');
        expect(ctx.output()).not.toContain('Uso: /byok | /byok reload | /byok auto');
        expect(ctx.output()).toContain('Preparada');
        expect(ctx.output()).toContain('Sessão viva');
        expect(ctx.output()).toContain('/restart reinicia a sessão SDK');
        expect(ctx.output()).toContain('/conversation-restart reinicia só a conversa');
        expect(ctx.output()).not.toContain('dialog loop');
        expect(ctx.output()).not.toContain('secret');
    });

    it('usa effectiveRoute compartilhado no gateway do status BYOK', async () => {
        mockProjection({
            summary: {
                ...BASE_PROJECTION.summary,
                enabled: true,
                ready: true,
                profile: 'repo_agent',
                preset: 'ollama-cloud',
                providerType: 'openai',
                model: 'qwen3-coder-next',
                auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                modelList: { configured: true, count: 1 },
            },
            modelGateway: {
                source: 'env_compat',
                active: { modelId: 'legacy-provider:legacy-model' },
                providers: [],
                models: [],
                diagnostics: { providerCount: 1, modelCount: 1, enabledModelCount: 1 },
            },
            modelGatewayProjection: {
                providerCount: 2,
                modelCount: 3,
                enabledModelCount: 2,
                providers: [],
                models: [],
                effectiveRoute: {
                    providerId: 'ollama-cloud',
                    providerModel: 'qwen3-coder-next',
                    modelId: 'ollama-cloud:qwen3-coder-next',
                    label: 'ollama-cloud · qwen3-coder-next',
                },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).toContain('2 provedores · 3 modelos · 2 habilitados');
        expect(ctx.output()).toContain('Gateway ativo');
        expect(ctx.output()).toContain('ollama-cloud · qwen3-coder-next');
        expect(ctx.output()).not.toContain('legacy-provider:legacy-model');
    });

    it('usa metadados remotos cacheados do modelo ativo no status sem herdar vision do provider', async () => {
        readConfiguredByokModelDiscoveryCacheFromEnv.mockReturnValue({
            models: [
                {
                    id: 'kilo-auto/free',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 256000 } },
                    byok: { source: 'remote', supportsReasoning: true, inputModalities: ['text'], outputModalities: ['text'] },
                },
            ],
            source: 'remote-cache',
            endpoint: 'https://api.kilo.ai/api/gateway/models',
            fromCache: true,
            error: null,
            configuredModel: { id: 'kilo-auto/free', inCatalog: true, authoritative: true },
            expiresAt: Date.now() + 60_000,
            ttlMs: 60_000,
        });
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
                auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                modelList: { configured: true, count: 3 },
                capabilities: { reasoningEffort: true, sdkReasoningEffort: true, vision: true, contextWindowTokens: 200000 },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).toMatch(/visão.*não.*contexto 256000/su);
        expect(ctx.output()).toContain('origem cache do provedor · sobrescreve defaults do provedor');
        expect(ctx.output()).not.toContain('source=provider-cache:model');
    });

    it('distingue seleção BYOK preparada do provider vivo que ainda precisa de novo boot', async () => {
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'ollama-cloud',
                preset: 'ollama-cloud',
                providerType: 'openai',
                baseUrl: 'https://ollama.com/v1',
                model: 'qwen3-coder-next',
            },
        });
        listTerminalSdkSessionInventory.mockResolvedValueOnce({
            currentSessionId: 'sdk-kilo-live',
            lastSessionId: 'sdk-kilo-live',
            foregroundSessionId: 'sdk-kilo-live',
            persistedByokBinding: {
                enabled: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
            },
            lastBootDecision: null,
            sessions: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).toContain('BYOK · perfil ollama-cloud');
        expect(ctx.output()).toContain('BYOK · perfil kilo');
        expect(ctx.output()).toContain('cruza provedor ou perfil e requer reattach');
        expect(ctx.output()).toContain('/restart reinicia a sessão SDK');
    });

    it('torna acionável o health falho da seleção BYOK ativa sem trocar modelo silenciosamente', async () => {
        const now = Date.now();
        readByokProviderModelHealth.mockImplementation((input) => {
            const model = input.providerModel ?? input.model;
            return model === 'deepseek/deepseek-v4-flash:free'
                ? {
                      key: 'openrouter-free|openrouter|deepseek/deepseek-v4-flash:free',
                      routeProfile: 'openrouter-free',
                      providerId: 'openrouter',
                      providerModel: model,
                      profile: 'openrouter-free',
                      provider: 'openrouter',
                      model,
                      lastStatus: 'failed',
                      failureCount: 2,
                      successCount: 0,
                      lastFailureAt: now,
                      lastSuccessAt: null,
                      lastMessage: 'timeout',
                      lastErrorContext: 'byok_probe',
                      agentProbeStatus: 'failed',
                      agentProbeFailureCount: 1,
                      agentProbeSuccessCount: 0,
                      lastAgentProbeFailureAt: now,
                      lastAgentProbeSuccessAt: null,
                      lastAgentProbeMessage: 'timeout',
                      lastAgentProbeErrorContext: 'byok_agent_probe',
                  }
                : null;
        });
        mockProjection({
            models: [
                {
                    id: 'deepseek/deepseek-v4-flash:free',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                },
                {
                    id: 'openrouter/free',
                    capabilities: { supports: { reasoningEffort: true, vision: true }, limits: { max_context_window_tokens: 128000 } },
                },
            ],
            summary: {
                enabled: true,
                ready: true,
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'deepseek/deepseek-v4-flash:free',
                auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                modelList: { configured: true, count: 2 },
                capabilities: { reasoningEffort: true, vision: true, contextWindowTokens: 128000 },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).toContain('Bloqueio de saúde');
        expect(ctx.output()).toContain('seleção ativa com falha recente');
        expect(ctx.output()).toMatch(/catálogo disponível não equivale a\s+execução saudável/u);
        expect(ctx.output()).toContain('/byok probe agent profile:openrouter-free model:openrouter/free');
        expect(ctx.output()).toContain('/byok use openrouter-free -> /byok model openrouter/free');
        expect(ctx.output()).not.toContain('\x1b[31m');
    });

    it('não herda health de outro modelo do profile quando há override BYOK ativo', async () => {
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'openrouter-free|openrouter|openrouter/free',
                routeProfile: 'openrouter-free',
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                profile: 'openrouter-free',
                provider: 'openrouter',
                model: 'openrouter/free',
                lastStatus: 'ok',
                failureCount: 0,
                successCount: 4,
                lastFailureAt: null,
                lastSuccessAt: Date.now(),
                lastMessage: null,
                lastErrorContext: null,
                agentProbeStatus: 'ok',
                agentProbeFailureCount: 0,
                agentProbeSuccessCount: 2,
                lastAgentProbeFailureAt: null,
                lastAgentProbeSuccessAt: Date.now(),
                lastAgentProbeMessage: null,
                lastAgentProbeErrorContext: null,
            },
        ]);
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'kilo-auto/free',
                auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                modelList: { configured: true, count: 2 },
                capabilities: { reasoningEffort: true, vision: true, contextWindowTokens: 128000 },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).not.toContain('chatHealth:');
        expect(ctx.output()).not.toContain('agentHealth:');
    });

    it('lista perfis redigidos', async () => {
        mockProjection({
            profiles: [
                {
                    name: 'kilo',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'anthropic/claude-sonnet-4.5',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: ['owner'],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'profiles');

        expect(ctx.output()).toContain('kilo');
        expect(ctx.output()).toContain('metadados owner');
        expect(ctx.output()).toContain('/byok use <perfil> prepara o seletor no processo atual');
        expect(ctx.output()).not.toContain('\x1b[36mBYOK profiles');
        expect(ctx.output()).not.toContain('← ativo');
        expect(ctx.output()).not.toContain('secret');
    });

    it('mostra perfil custom sem modelo como bloqueado para SDK 1.0', async () => {
        mockProjection({
            profiles: [
                {
                    name: 'local',
                    preset: 'openai-compatible',
                    providerType: 'openai',
                    baseUrl: 'http://127.0.0.1:11434/v1',
                    model: null,
                    ready: false,
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                    warnings: [],
                    errors: ['COPILOT_BYOK_MODEL must be an explicit provider model id; BYOK cannot use model=auto.'],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'profiles');

        expect(ctx.output()).toContain('local');
        expect(ctx.output()).toContain('bloqueado');
        expect(ctx.output()).toContain('defina modelo explícito para o SDK 1.0');
        expect(ctx.output()).not.toContain('disponível\n');
        expect(ctx.output()).not.toContain('secret');
    });

    it('resume provedores com contagem real de prontos e bloqueio por modelo ausente', async () => {
        mockProjection({
            profiles: [
                {
                    name: 'kilo',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'kilo-auto/free',
                    ready: true,
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                    warnings: [],
                    errors: [],
                },
                {
                    name: 'local',
                    preset: 'openai-compatible',
                    providerType: 'openai',
                    baseUrl: 'http://127.0.0.1:11434/v1',
                    model: null,
                    ready: false,
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                    warnings: [],
                    errors: ['COPILOT_BYOK_MODEL must be an explicit provider model id; BYOK cannot use model=auto.'],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'providers');

        expect(ctx.output()).toContain('prontos 1/2');
        expect(ctx.output()).toContain('local');
        expect(ctx.output()).toContain('bloqueado');
        expect(ctx.output()).toContain('defina modelo explícito para o SDK 1.0');
    });

    it('roda probe descartável e registra chat health sem expor segredo', async () => {
        mockProjection();
        runConfiguredByokChatProbe.mockResolvedValue({
            ok: true,
            status: 'ok',
            elapsedMs: 123,
            model: 'probe-model',
            profile: 'groq-free',
            preset: 'groq',
            providerType: 'openai',
            deltaCount: 2,
            deltaChars: 13,
            finalChars: 13,
            observedFinalEvent: true,
            sessionId: 'tmp-probe',
            errors: [],
            warnings: ['catalogo remoto'],
        });
        const ctx = mockCtx();
        const eventBus = { emit: vi.fn() };

        await cmdByok({ println: ctx.println, eventBus }, 'probe profile:groq-free model:probe-model timeout:9000');

        expect(runConfiguredByokChatProbe).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'groq-free' }),
                model: 'probe-model',
                timeoutMs: 9000,
            }),
        );
        expect(recordByokProviderModelCallSuccess).toHaveBeenCalledWith({
            routeProfile: 'groq-free',
            providerId: 'groq',
            providerModel: 'probe-model',
            successContext: 'byok_probe',
        });
        expect(recordByokProviderModelProbeResult).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'groq-free',
                providerId: 'groq',
                providerModel: 'probe-model',
                probeKind: 'chat',
                status: 'ok',
                ok: true,
                providerAttempted: true,
            }),
        );
        expect(buildProbeCompletedEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                probeKind: 'chat',
                providerAttempted: true,
                result: expect.objectContaining({ status: 'ok', model: 'probe-model' }),
            }),
        );
        expect(eventBus.emit).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'model_gateway:probe:completed', probeKind: 'chat' }),
        );
        expect(flushByokProviderHealth).toHaveBeenCalled();
        expect(ctx.output()).toContain('sessão SDK descartável');
        expect(ctx.output()).toContain('2 fragmentos');
        expect(ctx.output()).toContain('13 caracteres parciais');
        expect(ctx.output()).not.toContain('deltas 2/13 chars');
        expect(ctx.output()).not.toContain('token');
    });

    it('roda probe contra provider/model explícitos para promover rota do runtime selector', async () => {
        mockProjection();
        runConfiguredByokAgentProbe.mockResolvedValue({
            ok: true,
            status: 'ok',
            elapsedMs: 321,
            model: 'glm-4.5-flash',
            profile: null,
            preset: 'zai',
            providerType: 'openai',
            deltaCount: 4,
            deltaChars: 32,
            finalChars: 32,
            observedFinalEvent: true,
            toolCallCount: 2,
            markerToolCallCount: 1,
            readToolCallCount: 1,
            userInputRequestCount: 1,
            userInputAnswerCount: 1,
            sessionId: 'tmp-zai-agent',
            errors: [],
            warnings: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe agent provider:zai model:glm-4.5-flash timeout:20000');

        expect(runConfiguredByokAgentProbe).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({
                    COPILOT_BYOK_ENABLED: 'true',
                    COPILOT_BYOK_PROVIDER_PRESET: 'zai',
                    COPILOT_BYOK_MODEL: 'glm-4.5-flash',
                }),
                model: 'glm-4.5-flash',
                timeoutMs: 20000,
            }),
        );
        expect(recordByokProviderModelAgentProbeSuccess).toHaveBeenCalledWith({
            routeProfile: null,
            providerId: 'zai',
            providerModel: 'glm-4.5-flash',
        });
        expect(ctx.output()).toContain('provedor zai');
        expect(ctx.output()).toContain('modelo glm-4.5-flash');
    });

    it('roda agent probe descartável e separa compatibilidade agente do chat canário', async () => {
        mockProjection();
        runConfiguredByokAgentProbe.mockResolvedValue({
            ok: false,
            status: 'tool-missing',
            elapsedMs: 456,
            model: 'chat-only-model',
            profile: 'kilo',
            preset: 'kilo-code',
            providerType: 'openai',
            deltaCount: 3,
            deltaChars: 21,
            finalChars: 80,
            observedFinalEvent: true,
            toolCallCount: 0,
            userInputRequestCount: 0,
            userInputAnswerCount: 0,
            sessionId: 'tmp-agent-probe',
            errors: [],
            warnings: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe agent profile:kilo model:chat-only-model timeout:12000');

        expect(runConfiguredByokAgentProbe).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'kilo' }),
                model: 'chat-only-model',
                timeoutMs: 12000,
            }),
        );
        expect(recordByokProviderModelAgentProbeFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'chat-only-model',
                message: 'agent probe tool-missing',
            }),
        );
        expect(ctx.output()).toContain('BYOK sonda agente');
        expect(ctx.output()).toContain('chamadas de ferramenta 0');
        expect(ctx.output()).toContain('marcador 0');
        expect(ctx.output()).toContain('leituras 0');
        expect(ctx.output()).toContain('ferramentas representativas + ask_user');
        expect(ctx.output()).not.toContain('token');
    });

    it('explica bloqueio externo de credito/cota em probe BYOK sem degradar o diagnostico em erro cru', async () => {
        mockProjection();
        runConfiguredByokAgentProbe.mockResolvedValue({
            ok: false,
            status: 'failed',
            elapsedMs: 456,
            model: 'metered-model',
            profile: 'chutes-ai',
            preset: 'chutes',
            providerType: 'openai',
            deltaCount: 0,
            deltaChars: 0,
            finalChars: 0,
            observedFinalEvent: false,
            toolCallCount: 0,
            markerToolCallCount: 0,
            readToolCallCount: 0,
            userInputRequestCount: 0,
            userInputAnswerCount: 0,
            sessionId: 'tmp-agent-probe',
            errors: ['402 402 status code (no body)'],
            warnings: [],
            providerFailure: {
                kind: 'credits',
                message: '402 402 status code (no body)',
                statusCode: 402,
                errorContext: 'provider.credits',
                operatorLabel: 'provider BYOK recusou a chamada por credito, saldo ou cota (HTTP 402)',
                operatorAction: 'troque para modelo free e valide com /byok probe agent',
                external: true,
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe agent profile:chutes-ai model:metered-model');

        expect(recordByokProviderModelAgentProbeFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'chutes-ai',
                providerId: 'chutes',
                providerModel: 'metered-model',
                errorContext: 'provider.credits',
            }),
        );
        expect(ctx.output()).toContain('Diagnóstico');
        expect(ctx.output()).toContain('provider BYOK recusou a chamada por credito');
        expect(ctx.output()).toContain('Ação');
        expect(ctx.output()).toContain('troque para modelo free');
        expect(ctx.output()).toContain('Erro');
        expect(ctx.output()).toContain('402 402 status code (no body)');
    });

    it('sonda shortlist recomendada sem trocar a sessão viva e preserva profile/modelo de cada candidato', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'kilo/model-a',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        profile: 'kilo',
                        provider: 'kilo-code',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'openrouter/model-b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 180000 } },
                    byok: {
                        freeTier: true,
                        profile: 'openrouter-free',
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        runConfiguredByokAgentProbe
            .mockResolvedValueOnce({
                ok: true,
                status: 'ok',
                elapsedMs: 111,
                model: 'kilo/model-a',
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                deltaCount: 2,
                deltaChars: 16,
                finalChars: 24,
                observedFinalEvent: true,
                toolCallCount: 2,
                markerToolCallCount: 1,
                readToolCallCount: 1,
                userInputRequestCount: 1,
                userInputAnswerCount: 1,
                sessionId: 'tmp-kilo-shortlist',
                errors: [],
                warnings: [],
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 'ok',
                elapsedMs: 222,
                model: 'openrouter/model-b',
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                deltaCount: 3,
                deltaChars: 20,
                finalChars: 30,
                observedFinalEvent: true,
                toolCallCount: 2,
                markerToolCallCount: 1,
                readToolCallCount: 1,
                userInputRequestCount: 1,
                userInputAnswerCount: 1,
                sessionId: 'tmp-openrouter-shortlist',
                errors: [],
                warnings: [],
            });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe shortlist free reasoning safe 2 timeout:15000');

        expect(runConfiguredByokAgentProbe).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'kilo' }),
                model: 'kilo/model-a',
                timeoutMs: 15000,
            }),
        );
        expect(runConfiguredByokAgentProbe).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'openrouter-free' }),
                model: 'openrouter/model-b',
                timeoutMs: 15000,
            }),
        );
        expect(recordByokProviderModelAgentProbeSuccess).toHaveBeenCalledTimes(2);
        expect(ctx.output()).toContain('BYOK shortlist com sonda agente');
        expect(ctx.output()).toContain('kilo/model-a');
        expect(ctx.output()).toContain('openrouter/model-b');
        expect(ctx.output()).toContain('Shortlist');
        expect(ctx.output()).toContain('encerrada · aprovados 2/2');
        expect(ctx.output()).toContain('Shortlist encerrada: ok=2/2 attempted=2/2');
        expect(ctx.output()).not.toContain('providerTentado=');
        expect(ctx.output()).toContain('/byok recommend ... safe');
        expect(ctx.output()).not.toContain('tmp-kilo-shortlist');
    });

    it('sonda shortlist filtrada por provider sem transformar provider em profile inexistente', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'kilo-auto/free',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 256000 } },
                    byok: {
                        freeTier: true,
                        provider: 'kilo-code',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.kilo.ai/api/gateway/models',
            fromCache: false,
            error: null,
        });
        runConfiguredByokAgentProbe.mockResolvedValue({
            ok: true,
            status: 'ok',
            elapsedMs: 123,
            model: 'kilo-auto/free',
            profile: null,
            preset: 'kilo-code',
            providerType: 'openai',
            deltaCount: 2,
            deltaChars: 20,
            finalChars: 30,
            observedFinalEvent: true,
            toolCallCount: 2,
            markerToolCallCount: 1,
            readToolCallCount: 1,
            userInputRequestCount: 1,
            userInputAnswerCount: 1,
            sessionId: 'tmp-provider-shortlist',
            errors: [],
            warnings: [],
        });
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: null,
                preset: 'kilo-code',
                providerType: 'openai',
                model: 'kilo-auto/free',
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe shortlist free reasoning safe 1 timeout:15000 provider:kilo-code');

        const env = runConfiguredByokAgentProbe.mock.calls[0]?.[0]?.env;
        expect(env).toEqual(expect.objectContaining({ COPILOT_BYOK_PROVIDER_PRESET: 'kilo-code' }));
        expect(env?.COPILOT_BYOK_PROFILE).toBeUndefined();
        expect(recordByokProviderModelAgentProbeSuccess).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: null,
                providerId: 'kilo-code',
                providerModel: 'kilo-auto/free',
            }),
        );
        expect(ctx.output()).toContain('Shortlist');
        expect(ctx.output()).toContain('encerrada · aprovados 1/1');
        expect(ctx.output()).toContain('Shortlist encerrada: ok=1/1 attempted=1/1');
        expect(ctx.output()).not.toContain('providerTentado=');
        expect(ctx.output()).not.toContain("COPILOT_BYOK_PROFILE 'kilo-code'");
    });

    it('explica cobertura por perfil na shortlist agregada antes de sondar o top-N', async () => {
        discoverConfiguredByokModelsFromEnv
            .mockResolvedValueOnce({
                models: [
                    {
                        id: 'kilo/ranked',
                        capabilities: {
                            supports: { reasoningEffort: true, vision: false },
                            limits: { max_context_window_tokens: 200000 },
                        },
                        byok: { freeTier: true, rateLimits: { maxRequestTokens: 128000 } },
                    },
                ],
                source: 'remote',
                endpoint: 'https://kilo.example/v1/models',
                fromCache: false,
                error: null,
            })
            .mockResolvedValueOnce({
                models: [
                    {
                        id: 'groq/compact',
                        capabilities: {
                            supports: { reasoningEffort: true, vision: false },
                            limits: { max_context_window_tokens: 128000 },
                        },
                        byok: { freeTier: true, rateLimits: { maxRequestTokens: 6000 } },
                    },
                ],
                source: 'remote',
                endpoint: 'https://groq.example/v1/models',
                fromCache: false,
                error: null,
            });
        runConfiguredByokAgentProbe.mockResolvedValue({
            ok: true,
            status: 'ok',
            elapsedMs: 111,
            model: 'kilo/ranked',
            profile: 'kilo',
            preset: 'kilo-code',
            providerType: 'openai',
            deltaCount: 2,
            deltaChars: 16,
            finalChars: 16,
            observedFinalEvent: true,
            toolCallCount: 2,
            markerToolCallCount: 1,
            readToolCallCount: 1,
            userInputRequestCount: 1,
            userInputAnswerCount: 1,
            sessionId: 'tmp-kilo-ranked',
            errors: [],
            warnings: [],
        });
        mockProjection({
            profiles: [
                {
                    name: 'kilo',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'kilo/ranked',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'groq/compact',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe shortlist all-providers free reasoning safe 1');

        expect(runConfiguredByokAgentProbe).toHaveBeenCalledTimes(1);
        expect(ctx.output()).toContain('Cobertura por perfil  ·  antes das probes');
        expect(ctx.output()).toContain('kilo');
        expect(ctx.output()).toContain('catalogo=1 · elegiveis=1 · shortlist=1');
        expect(ctx.output()).toContain('groq-free');
        expect(ctx.output()).toContain('catalogo=1 · safe removeu=1');
        expect(ctx.output()).toContain('/byok models all-providers provider:groq-free 5');
    });

    it('não degrada health real quando admission bloqueia a probe antes do provider', async () => {
        mockProjection();
        runConfiguredByokChatProbe.mockResolvedValue({
            ok: false,
            status: 'admission-blocked',
            elapsedMs: 1,
            model: 'tiny-limit-model',
            profile: 'groq-free',
            preset: 'groq',
            providerType: 'openai',
            deltaCount: 0,
            deltaChars: 0,
            finalChars: 0,
            observedFinalEvent: false,
            sessionId: null,
            errors: ['probe chat estimada 16384 tokens > limite BYOK 6000'],
            warnings: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe chat profile:groq-free model:tiny-limit-model');

        expect(recordByokProviderModelCallFailure).not.toHaveBeenCalled();
        expect(recordByokProviderModelProbeResult).toHaveBeenCalledWith(
            expect.objectContaining({
                probeKind: 'chat',
                status: 'admission-blocked',
                ok: false,
                providerAttempted: false,
            }),
        );
        expect(ctx.output()).toContain('bloqueado na admissão');
        expect(ctx.output()).toContain('health real do modelo não foi degradado');
    });

    it('roda probe streaming sem passar pelo wrapper terminal legado nem degradar chat health', async () => {
        mockProjection();
        runConfiguredByokStreamingProbe.mockResolvedValue({
            ok: false,
            status: 'no-delta',
            elapsedMs: 42,
            model: 'stream-model',
            profile: 'openrouter-free',
            preset: 'openrouter',
            providerType: 'openai',
            deltaCount: 0,
            deltaChars: 0,
            finalChars: 24,
            observedFinalEvent: true,
            sessionId: 'tmp-stream',
            errors: ['Probe respondeu, mas não emitiu assistant.message_delta.'],
            warnings: [],
            streamingProved: false,
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe streaming profile:openrouter-free model:stream-model');

        expect(runConfiguredByokStreamingProbe).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'openrouter-free' }),
                model: 'stream-model',
                deps: expect.objectContaining({
                    evaluateAdmission: expect.any(Function),
                    classifyProviderFailure: expect.any(Function),
                }),
            }),
        );
        expect(recordByokProviderModelCallFailure).not.toHaveBeenCalled();
        expect(recordByokProviderModelAgentProbeFailure).not.toHaveBeenCalled();
        expect(recordByokProviderModelProbeResult).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'openrouter-free',
                providerId: 'openrouter',
                providerModel: 'stream-model',
                probeKind: 'streaming',
                status: 'no-delta',
            }),
        );
        expect(ctx.output()).toContain('BYOK sonda streaming');
        expect(ctx.output()).toContain('UX live cega');
    });

    it('roda probe JSON como capacidade estruturada sem degradar chat health', async () => {
        mockProjection();
        runConfiguredByokJsonProbe.mockResolvedValue({
            ok: true,
            status: 'ok',
            elapsedMs: 55,
            model: 'json-model',
            profile: 'mistral-free',
            preset: 'mistral',
            providerType: 'openai',
            deltaCount: 1,
            deltaChars: 12,
            finalChars: 33,
            finalContent: '{"byok_probe":"ok","mode":"json"}',
            observedFinalEvent: true,
            sessionId: 'tmp-json',
            errors: [],
            warnings: [],
            jsonProved: true,
            parsedJson: { byok_probe: 'ok', mode: 'json' },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe json profile:mistral-free model:json-model timeout:7000');

        expect(runConfiguredByokJsonProbe).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'mistral-free' }),
                model: 'json-model',
                timeoutMs: 7000,
                deps: expect.objectContaining({
                    evaluateAdmission: expect.any(Function),
                    classifyProviderFailure: expect.any(Function),
                }),
            }),
        );
        expect(recordByokProviderModelCallSuccess).not.toHaveBeenCalled();
        expect(recordByokProviderModelAgentProbeSuccess).not.toHaveBeenCalled();
        expect(recordByokProviderModelProbeResult).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'mistral-free',
                providerId: 'mistral',
                providerModel: 'json-model',
                probeKind: 'json',
                status: 'ok',
                ok: true,
            }),
        );
        expect(ctx.output()).toContain('BYOK sonda JSON');
        expect(ctx.output()).toContain('sonda JSON confirma saída estruturada');
    });

    it('roda probe vision com fixture de imagem sem degradar chat health', async () => {
        mockProjection();
        runConfiguredByokVisionProbe.mockResolvedValue({
            ok: true,
            status: 'ok',
            elapsedMs: 66,
            model: 'vision-model',
            profile: 'kilo',
            preset: 'kilo-code',
            providerType: 'openai',
            deltaCount: 1,
            deltaChars: 18,
            finalChars: 19,
            finalContent: 'VISION_PROBE_OK:red',
            observedFinalEvent: true,
            sessionId: 'tmp-vision',
            errors: [],
            warnings: [],
            visionProved: true,
            dominantColor: 'red',
            attachmentMimeType: 'image/png',
            attachmentBytes: 68,
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe vision profile:kilo model:vision-model timeout:8000');

        expect(runConfiguredByokVisionProbe).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'kilo' }),
                model: 'vision-model',
                timeoutMs: 8000,
                deps: expect.objectContaining({
                    evaluateAdmission: expect.any(Function),
                    classifyProviderFailure: expect.any(Function),
                }),
            }),
        );
        expect(recordByokProviderModelCallSuccess).not.toHaveBeenCalled();
        expect(recordByokProviderModelAgentProbeSuccess).not.toHaveBeenCalled();
        expect(recordByokProviderModelProbeResult).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'vision-model',
                probeKind: 'vision',
                status: 'ok',
                ok: true,
            }),
        );
        expect(ctx.output()).toContain('BYOK sonda visão');
        expect(ctx.output()).toContain('fixture image/png/68 bytes');
        expect(ctx.output()).toContain('sonda de visão confirmou');
    });

    it('explica probe vision sem prova como resultado multimodal não conclusivo', async () => {
        mockProjection();
        runConfiguredByokVisionProbe.mockResolvedValue({
            ok: false,
            status: 'empty',
            elapsedMs: 77,
            model: 'vision-model',
            profile: 'kilo',
            preset: 'kilo-code',
            providerType: 'openai',
            deltaCount: 0,
            deltaChars: 0,
            finalChars: 0,
            finalContent: '',
            observedFinalEvent: false,
            sessionId: 'tmp-vision-empty',
            errors: ['Probe concluiu sem delta nem mensagem final.'],
            warnings: [],
            visionProved: false,
            dominantColor: null,
            attachmentMimeType: 'image/png',
            attachmentBytes: 69,
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe vision profile:kilo model:vision-model timeout:8000');

        expect(recordByokProviderModelProbeResult).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'vision-model',
                probeKind: 'vision',
                status: 'empty',
                ok: false,
            }),
        );
        expect(ctx.output()).toContain('Resultado');
        expect(ctx.output()).toContain('empty');
        expect(ctx.output()).toContain('resultado sem prova visual positiva');
        expect(ctx.output()).not.toContain('Sonda de visão confirma que o provider aceitou');
    });

    it('lista providers disponíveis com comandos operacionais redigidos', async () => {
        const now = Date.now();
        readConfiguredByokProfilesFromEnv.mockReturnValue({
            'openrouter-free': { metadata: { freeFirst: true } },
            'groq-free': { metadata: { freeLimit: '6k TPM observed on current plan' } },
        });
        readByokProviderModelHealth.mockReturnValue(null);
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'groq-free|groq|openai/gpt-oss-120b',
                routeProfile: 'groq-free',
                providerId: 'groq',
                providerModel: 'openai/gpt-oss-120b',
                profile: 'groq-free',
                provider: 'groq',
                model: 'openai/gpt-oss-120b',
                lastStatus: 'ok',
                failureCount: 0,
                successCount: 2,
                lastFailureAt: null,
                lastSuccessAt: now,
                lastMessage: null,
                lastErrorContext: null,
            },
        ]);
        mockProjection({
            profiles: [
                {
                    name: 'openrouter-free',
                    preset: 'openrouter',
                    providerType: 'openai',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'z-ai/glm-4.5-air:free',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: ['tier', 'owner'],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'openai/gpt-oss-120b',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: ['limits'],
                },
            ],
            summary: {
                enabled: true,
                ready: true,
                profile: 'groq-free',
                preset: 'groq',
                providerType: 'openai',
                model: 'openai/gpt-oss-120b',
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'providers');

        expect(ctx.output()).toContain('BYOK provedores');
        expect(ctx.output()).toContain('openrouter-free');
        expect(ctx.output()).toContain('groq-free');
        expect(ctx.output()).toContain('ativo');
        expect(ctx.output()).toContain('/byok use groq-free');
        expect(ctx.output()).toContain('/byok models refresh provider:groq');
        expect(ctx.output()).toContain('metadados tier,owner');
        expect(ctx.output()).toContain('custo perfil gratuito');
        expect(ctx.output()).toContain('chat ok');
        expect(ctx.output()).not.toContain('\x1b[36mBYOK provedores');
        expect(ctx.output()).not.toContain('comandos: /byok use');
        expect(ctx.output()).not.toContain('ativo=');
        expect(ctx.output()).not.toContain('prontos=');
        expect(ctx.output()).not.toContain('presets=');
        expect(ctx.output()).not.toContain('secret');
    });

    it('mostra inventário de endpoints por provider sem chamar rede', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'providers endpoints kilo');

        expect(resolveProviderEndpointInventory).toHaveBeenCalledWith('kilo');
        expect(listProviderEndpointInventory).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK endpoints de provedores');
        expect(ctx.output()).toContain('tipo gateway');
        expect(ctx.output()).toContain('https://api.kilo.ai/api/gateway/models');
        expect(ctx.output()).toContain('POST /chat/completions');
        expect(ctx.output()).toContain('Seletores');
        expect(ctx.output()).toContain('modelo exato, gateway auto, modelo do provedor');
        expect(ctx.output()).not.toContain('kind=gateway');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra traits provider/gateway normalizados sem chamar runtime', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway provider traits kilo');

        expect(resolveProviderGatewayTraits).toHaveBeenCalledWith('kilo');
        expect(listProviderGatewayTraits).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK características de provedores');
        expect(ctx.output()).toContain('topologia gateway');
        expect(ctx.output()).toContain('compatível com OpenAI sim');
        expect(ctx.output()).toContain('tipos chat completions');
        expect(ctx.output()).toContain('preço sim');
        expect(ctx.output()).not.toContain('topology=gateway');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra matriz provider/wire API de probes sem chamar runtime', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway probes matrix kilo');

        expect(listProviderWireProbeMatrix).toHaveBeenCalledWith({ providerId: 'kilo' });
        expect(summarizeProviderWireProbeMatrix).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK matriz de sondas por protocolo');
        expect(ctx.output()).toContain('protocolo chat completions');
        expect(ctx.output()).toContain('implementados chat, streaming, JSON, agente');
        expect(ctx.output()).toContain('pendentes reasoning, forced tool choice, parallel');
        expect(ctx.output()).toContain('tool calls');
        expect(ctx.output()).toContain('Sondas pendentes');
        expect(ctx.output()).toContain('forced tool choice:1, parallel tool calls:1, reasoning:1');
        expect(ctx.output()).not.toContain('wire=openai_chat_completions');
        expect(ctx.output()).not.toContain('pendingKinds=');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra orientação explícita para habilitar Ollama/local sem iniciar daemon', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway local');

        expect(ctx.output()).toContain('BYOK local/Ollama');
        expect(ctx.output()).toContain('Política');
        expect(ctx.output()).toContain('excluir providers locais por padrão');
        expect(ctx.output()).toContain('provedor local exige pedido explícito');
        expect(ctx.output()).toContain('não inicia Ollama');
        expect(ctx.output()).not.toContain('default=excluido');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra planejamento de backoff de probes sem chamar runtime', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway probes backoff');

        expect(recommendCatalogDiffProbes).toHaveBeenCalled();
        expect(planModelGatewayProbeBackoff).toHaveBeenCalledWith(
            expect.objectContaining({
                recommendations: expect.any(Array),
                accountOverlays: expect.any(Array),
                healthRecords: expect.any(Array),
            }),
        );
        expect(ctx.output()).toContain('BYOK planejador de pausa para sondas');
        expect(ctx.output()).toContain('prontas 1');
        expect(ctx.output()).toContain('adiadas 1');
        expect(ctx.output()).toContain('runtime limitado por taxa');
        expect(ctx.output()).toContain('Pronto');
        expect(ctx.output()).toContain('Adiar');
        expect(ctx.output()).not.toContain('ready=1');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra requisitos de env por provider sem expor valores de segredo', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway secrets kilo');

        expect(evaluateModelGatewayProviderEnvRequirements).toHaveBeenCalledWith({ env: process.env, providerId: 'kilo' });
        expect(summarizeModelGatewayProviderEnvRequirements).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK requisitos de ambiente');
        expect(ctx.output()).toContain('estado ausente');
        expect(ctx.output()).toContain('obrigatórias ausentes KILO_API_KEY,KILO_CODE_API_KEY');
        expect(ctx.output()).not.toContain('kilo-secret');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('audita importers configurados e cobertura de endpoints sem chamar rede', async () => {
        mockProjection();
        createDefaultModelGatewayCatalogImporters.mockReturnValue([
            { id: 'kilo-gateway-models', providerId: 'kilo', sourceKind: 'public_gateway_api' },
            { id: 'kilo-gateway-providers', providerId: 'kilo', sourceKind: 'public_gateway_api' },
            { id: 'openai-models', providerId: 'openai', sourceKind: 'authenticated_api' },
        ]);
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway importers kilo');

        expect(createDefaultModelGatewayCatalogImporters).toHaveBeenCalledWith({ env: process.env });
        expect(resolveProviderEndpointInventory).toHaveBeenCalledWith('kilo');
        expect(auditCatalogImporterSet).toHaveBeenCalledWith(
            [
                { id: 'kilo-gateway-models', providerId: 'kilo', sourceKind: 'public_gateway_api' },
                { id: 'kilo-gateway-providers', providerId: 'kilo', sourceKind: 'public_gateway_api' },
            ],
            { inventories: [expect.objectContaining({ providerId: 'kilo' })] },
        );
        expect(ctx.output()).toContain('BYOK auditoria de importadores');
        expect(ctx.output()).toContain('filtro kilo');
        expect(ctx.output()).toContain('importadores 2/3');
        expect(ctx.output()).toContain('evidências de provedor 1');
        expect(ctx.output()).toContain('overlays de conta 1');
        expect(ctx.output()).toContain('kilo-gateway-models');
        expect(ctx.output()).toContain('Etapas');
        expect(ctx.output()).toContain('fetchRaw,parseRows,toEvidenceFacts,toRouteOptions');
        expect(ctx.output()).toContain('Sem cobertura');
        expect(ctx.output()).toContain('kilo:catalog:public_docs:get:https-api-kilo-ai-docs');
        expect(ctx.output()).not.toContain('secret');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra gate pré-K do model-gateway com checks booleanos', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway');

        expect(buildModelGatewayPreKCompatibilityReport).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK gate pré-K');
        expect(ctx.output()).toContain('checks 2/2');
        expect(ctx.output()).toContain('sdk provider config boundary');
        expect(ctx.output()).toContain('route trace attributes are stable');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra readiness pré-build K+ do model-gateway com checks booleanos', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway prebuild');

        expect(buildModelGatewayPreBuildReadinessReport).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK prontidão pré-build');
        expect(ctx.output()).toContain('checks 3/3');
        expect(ctx.output()).toContain('universal catalog contracts are exported');
        expect(ctx.output()).toContain('provider gateway traits are metadata');
        expect(ctx.output()).toContain('canonical commands are published');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('lista overlays de conta do model-gateway com superfície humana e segredos redigidos', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway overlays openrouter');

        expect(ctx.output()).toContain('BYOK overlays de conta');
        expect(ctx.output()).toContain('data/copilot/model-gateway/catalog.json');
        expect(ctx.output()).toContain('segredos protegidos sim');
        expect(ctx.output()).toContain('Provedor');
        expect(ctx.output()).toContain('openrouter');
        expect(ctx.output()).toContain('escopo padrão');
        expect(ctx.output()).toContain('segredo OPENROUTER_API_KEY');
        expect(ctx.output()).toContain('redigido -');
        expect(ctx.output()).toContain('não executa modelo nem revela valores de segredo');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).not.toContain('BYOK model-gateway account overlays');
        expect(ctx.output()).not.toContain('/workspaces/chatgpt-docker-puppeteer/data/copilot/model-gateway/catalog.json');
    });

    it('lista rotas do model-gateway com rótulos humanos e sem ANSI', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway routes openrouter');

        expect(ctx.output()).toContain('BYOK rotas do gateway');
        expect(ctx.output()).toContain('data/copilot/model-gateway/catalog.json');
        expect(ctx.output()).toContain('Rota');
        expect(ctx.output()).toContain('openrouter:openai/gpt-oss-120b');
        expect(ctx.output()).toContain('perfil padrão');
        expect(ctx.output()).toContain('seletor provedor explícito');
        expect(ctx.output()).toContain('protocolo padrão');
        expect(ctx.output()).toContain('rotas são metadados de seleção');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).not.toContain('BYOK model-gateway routes');
        expect(ctx.output()).not.toContain('selectorKind');
        expect(ctx.output()).not.toContain('wire -');
        expect(ctx.output()).not.toContain('limite numerico');
    });

    it('mostra contas e limites account/key do model-gateway sem executar runtime', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway accounts openrouter');

        expect(deriveModelGatewayRuntimeAccountOverlaysFromHealth).toHaveBeenCalledWith(expect.any(Array));
        expect(summarizeModelGatewayAccountOverlays).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ sourceKind: 'runtime_health' })]),
            expect.objectContaining({ selector: 'openrouter' }),
        );
        expect(ctx.output()).toContain('BYOK contas e chaves');
        expect(ctx.output()).toContain('estado limitado por taxa');
        expect(ctx.output()).toContain('segredo OPENROUTER_API_KEY');
        expect(ctx.output()).toContain('reset 2026-05-25T00:01:00.000Z');
        expect(ctx.output()).toContain('conta OpenRouter');
        expect(ctx.output()).toContain('saúde runtime continua em /byok health');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).not.toContain('estado rate_limited');
        expect(ctx.output()).not.toContain('openrouter-key-account');
    });

    it('explica limites account/key ativos e expirados antes do runtime', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway limits openrouter');

        expect(deriveModelGatewayRuntimeAccountOverlaysFromHealth).toHaveBeenCalledWith(expect.any(Array));
        expect(summarizeModelGatewayRuntimeAccountOverlays).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ sourceKind: 'runtime_health' })]),
        );
        expect(explainModelGatewayAccountLimitOverlays).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ sourceKind: 'runtime_health' })]),
            expect.objectContaining({ selector: 'openrouter' }),
        );
        expect(ctx.output()).toContain('BYOK limites de conta');
        expect(ctx.output()).toContain('bloqueios ativos 1');
        expect(ctx.output()).toContain('sinais expirados 1');
        expect(ctx.output()).toContain('sinal ativo');
        expect(ctx.output()).toContain('janela temporário');
        expect(ctx.output()).toContain('próxima atualização 2026-05-25T00:01:00.000Z');
        expect(ctx.output()).toContain('Ação');
        expect(ctx.output()).toContain('aguardar reset do limite ou escolher outra rota');
        expect(ctx.output()).toContain('conta OpenRouter');
        expect(ctx.output()).toContain('AssistantUsageQuotaSnapshot é quota SDK/Copilot');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).not.toContain('wait_for_rate_limit_reset_or_choose_another_route');
        expect(ctx.output()).not.toContain('refresh_overlay_or_retry_pre_runtime_selection');
        expect(ctx.output()).not.toContain('not_blocking');
        expect(ctx.output()).not.toContain('openrouter-key-account');
    });

    it('mostra matriz de capacidades de quota por provider sem executar runtime', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway quota-matrix openrouter');

        expect(summarizeModelGatewayProviderQuotaCapabilities).toHaveBeenCalledWith(
            expect.objectContaining({ selector: 'openrouter' }),
        );
        expect(ctx.output()).toContain('BYOK matriz de quotas dos provedores');
        expect(ctx.output()).toContain('Tipos de quota');
        expect(ctx.output()).toContain('saldo de crédito da key:1');
        expect(ctx.output()).toContain('cobertura SDK/BYOK 0');
        expect(ctx.output()).toContain('OPENROUTER_API_KEY');
        expect(ctx.output()).toContain('/api/v1/key');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).not.toContain('key_credit_balance');
        expect(ctx.output()).not.toContain('headers_or_runtime_failure');
        expect(ctx.output()).not.toContain('nao');
    });

    it('mostra comandos canônicos do model-gateway para package, make e terminal', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway commands');

        expect(listModelGatewayCanonicalCommands).toHaveBeenCalledWith({ surface: undefined, phase: undefined });
        expect(renderModelGatewayCanonicalCommandLines).toHaveBeenCalledWith({ surface: undefined, phase: undefined });
        expect(ctx.output()).toContain('Comandos canônicos BYOK');
        expect(ctx.output()).toContain('Faixa Y');
        expect(ctx.output()).toContain('npm run model-gateway:prebuild');
        expect(ctx.output()).toContain('make model-gateway-prebuild');
        expect(ctx.output()).toContain('/byok gateway commands');
        expect(ctx.output()).toContain('/byok gateway operator-ready profile:repo_agent');
        expect(ctx.output()).toContain('pré-build');
        expect(ctx.output()).toContain('orientação');
        expect(ctx.output()).toContain('Lista os comandos canônicos');
        expect(ctx.output()).toContain('Mostra readiness');
        expect(ctx.output()).not.toContain('Show commands');
        expect(ctx.output()).not.toContain('Run pre-build validators');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('filtra comandos canônicos do model-gateway pela fase live-readiness', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway commands live-readiness');

        expect(listModelGatewayCanonicalCommands).toHaveBeenCalledWith({ surface: undefined, phase: 'live-readiness' });
        expect(renderModelGatewayCanonicalCommandLines).toHaveBeenCalledWith({ surface: undefined, phase: 'live-readiness' });
    });

    it('renderiza cockpit operator-ready no terminal sem chamar provider', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway operator-ready profile:repo_agent 5');

        expect(ctx.output()).toContain('BYOK operador pronto');
        expect(ctx.output()).toMatch(/sem\s+chamada\s+a\s+provedor/u);
        expect(ctx.output()).toContain('preset manual do operador');
        expect(ctx.output()).toContain('seletor de execução');
        expect(ctx.output()).toContain('decisão automática');
        expect(ctx.output()).toContain('rotas standby');
        expect(ctx.output()).toContain('fronteira do terminal');
        expect(ctx.output()).toContain('Standby 1');
        expect(ctx.output()).toContain('Banco standby');
        expect(ctx.output()).toContain('Banco live');
        expect(ctx.output()).toContain('Provar');
        expect(ctx.output()).toContain('Novo boot');
        expect(ctx.output()).toContain('alternativa candidata');
        expect(ctx.output()).toContain('novo provedor');
        expect(ctx.output()).toContain('/byok health clear provider:');
        expect(ctx.output()).toContain('artifacts/terminal-live/unit/summary.md');
        expect(ctx.output()).toContain('kilo-code:kilo-auto/free');
        expect(ctx.output()).toContain('--write-sqlite');
        expect(ctx.output()).toMatch(/\/byok auto standby\s+profile:repo_agent 5/u);
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).not.toContain('candidate alternative');
        expect(ctx.output()).not.toContain('new provider');
        expect(ctx.output()).not.toMatch(/Check\s+.*automation decision/iu);
        expect(ctx.output()).not.toMatch(/Check\s+.*standby routes/iu);
        expect(ctx.output()).not.toMatch(/Check\s+.*terminal boundary/iu);
        expect(ctx.output()).not.toMatch(/Política\s+.*preset operator_manual/iu);
    });

    it('renderiza standby persistido sem recalcular selector no terminal', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto standby persisted profile:repo_agent 5');

        expect(ctx.output()).toContain('BYOK prontidão automática persistida');
        expect(ctx.output()).toContain('standby-1');
        expect(ctx.output()).toContain('rotas 2');
        expect(ctx.output()).toContain('sem chamada a provedor');
        expect(buildModelGatewayRuntimeStandbyPlan).not.toHaveBeenCalled();
    });

    it('mostra auditoria de seleção pré-runtime do model-gateway sem executar probes', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway selection audit repo_agent tool_agent');

        expect(auditModelGatewayCatalogSnapshotIntegrity).toHaveBeenCalled();
        expect(auditModelGatewayPreRuntimeSelection).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                strict: false,
                profiles: ['repo_agent', 'tool_agent'],
                secretRegistry: expect.any(Object),
            }),
        );
        expect(ctx.output()).toContain('BYOK auditoria de seleção');
        expect(ctx.output()).toContain('catálogo ');
        expect(ctx.output()).not.toContain('store ');
        expect(ctx.output()).toContain('sem execução');
        expect(ctx.output()).toContain('repo_agent');
        expect(ctx.output()).toContain('provedor explícito');
    });

    it('mostra plano auto do model-gateway sem mutar sessão ou executar provider', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto status profile:repo_agent');

        expect(buildModelGatewayRuntimeAutomationDecision).toHaveBeenCalledWith(
            expect.objectContaining({
                profileId: 'repo_agent',
                policy: expect.objectContaining({
                    allowLiveSetModel: false,
                    allowNewSession: false,
                    allowLocalPrivate: false,
                }),
            }),
        );
        expect(ctx.output()).toContain('BYOK automação do gateway');
        expect(ctx.output()).toMatch(/troca viva n(?:ão|ao)/u);
        expect(ctx.output()).not.toContain('live setModel');
        expect(ctx.output()).toContain('preparar novo boot SDK');
        expect(ctx.output()).not.toContain('prepare_new_sdk_session:dry');
        expect(ctx.output()).not.toContain('prepare_new_sdk_session');
        expect(ctx.output()).toContain('ação preparar nova sessão');
        expect(ctx.output()).not.toContain('new session policy');
        expect(ctx.output()).toContain('/session sdk next new');
    });

    it('mostra origem e motivo de fallback no auto status quando a decisão promove standby', async () => {
        mockProjection();
        buildModelGatewayRuntimeAutomationDecision.mockReturnValueOnce({
            schema: 'model-gateway-runtime-automation-decision',
            ok: true,
            status: 'ready',
            action: 'prepare_new_session',
            selectedRouteKey: 'groq:fallback-model',
            routeProfile: 'repo_agent',
            fallbackFromSelectedRouteKey: 'openrouter:primary-model',
            fallbackReason: 'rate-limit',
            canApplyLiveModel: false,
            requiresNewSession: true,
            blockers: [],
            currentBoundary: { enabled: true, profile: 'repo_agent', preset: 'openrouter', providerType: 'openai_compatible', baseUrl: null, model: 'primary-model' },
            targetBoundary: { profile: 'repo_agent', preset: 'groq', providerType: 'openai_compatible', baseUrl: null, model: 'fallback-model' },
            cooldown: { active: false, reason: null, resetAt: null, retryAfterSeconds: null },
            blockerClass: 'none',
            nonActionReason: null,
            nextCommands: ['/session sdk next new', '/byok provider groq fallback-model'],
            operatorSummary: 'fallback standby promoted',
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto status profile:repo_agent');

        expect(ctx.output()).toContain('Alternativa');
        expect(ctx.output()).toContain('origem openrouter:primary-model');
        expect(ctx.output()).toContain('motivo limite de taxa');
        expect(ctx.output()).not.toContain('from=');
        expect(ctx.output()).not.toContain('reason=');
    });

    it('mostra comandos de prova por provider/model quando alternativas auto carecem de agent probe', async () => {
        mockProjection();
        buildModelGatewayRuntimeSelectorPlan.mockReturnValueOnce({
            schema: 'model-gateway-runtime-selector-plan',
            ok: false,
            ready: false,
            mode: 'prefer_runtime_proved',
            summary: {
                profileCount: 1,
                selectedProfileCount: 0,
                blockedProfileCount: 1,
                runtimeProofSelectedCount: 0,
                runtimeEnvReadyCount: 1,
                runtimeEnvBlockedCount: 0,
            },
            routes: [
                {
                    profileId: 'repo_agent',
                    status: 'blocked',
                    source: 'test',
                    selected: null,
                    selectedRouteKey: null,
                    hasRuntimeProof: false,
                    runtimeEnv: null,
                    runtimeHealth: null,
                    providerCooldown: null,
                    alternativeSummary: {
                        evaluatedCount: 1,
                        usableCount: 0,
                        blockedCount: 1,
                        providerCount: 1,
                        rejectionReasonCounts: { 'runtime_health:agent_probe_missing': 1 },
                        topBlockedRoutes: [
                            {
                                label: 'alternate1',
                                providerId: 'zai',
                                providerModel: 'glm-4.5-flash',
                                reasons: ['runtime_health:agent_probe_missing'],
                            },
                        ],
                    },
                    candidateAlternatives: [],
                    reasons: ['blocked:no_selected_route'],
                    nextActions: ['run_runtime_probe_for_profile'],
                    decisionEvent: { type: 'model_gateway:route_decision' },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto status profile:repo_agent');

        expect(ctx.output()).toContain('Alternativas');
        expect(ctx.output()).toContain('/byok probe agent provider:zai model:glm-4.5-flash timeout:20000');
    });

    it('renderiza plano auto sem executar provider nem aplicar efeito', async () => {
        mockProjection();
        buildModelGatewayRuntimeSelectorPlan.mockReturnValueOnce({
            schema: 'model-gateway-runtime-selector-plan',
            ok: false,
            ready: false,
            mode: 'prefer_runtime_proved',
            summary: {
                profileCount: 1,
                selectedProfileCount: 0,
                blockedProfileCount: 1,
                runtimeProofSelectedCount: 0,
                runtimeEnvReadyCount: 1,
                runtimeEnvBlockedCount: 0,
            },
            routes: [
                {
                    profileId: 'repo_agent',
                    status: 'blocked',
                    source: 'test',
                    selected: null,
                    selectedRouteKey: null,
                    hasRuntimeProof: false,
                    runtimeEnv: null,
                    runtimeHealth: null,
                    providerCooldown: null,
                    alternativeSummary: {
                        evaluatedCount: 1,
                        usableCount: 0,
                        blockedCount: 1,
                        providerCount: 1,
                        rejectionReasonCounts: { 'runtime_health:agent_probe_not_verified': 1 },
                        topBlockedRoutes: [
                            {
                                label: 'alternate1',
                                providerId: 'kilo-code',
                                providerModel: 'kilo-auto/free',
                                reasons: ['runtime_health:agent_probe_not_verified'],
                            },
                        ],
                    },
                    candidateAlternatives: [],
                    reasons: ['blocked:no_selected_route'],
                    nextActions: ['run_runtime_probe_for_profile'],
                    decisionEvent: { type: 'model_gateway:route_decision' },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto plan profile:repo_agent 5');

        expect(ctx.output()).toContain('Plano de provas BYOK');
        expect(ctx.output()).toMatch(/sem chamada\s+a\s+provedor/u);
        expect(ctx.output()).toContain('Contexto');
        expect(ctx.output()).toContain('/byok probe agent provider:kilo-code model:kilo-auto/free timeout:20000');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mantém proof-plan como alias compatível para automação existente', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway auto proof-plan profile:repo_agent 5');

        expect(ctx.output()).toContain('Plano de provas BYOK');
        expect(ctx.output()).toMatch(/sem chamada\s+a\s+provedor/u);
    });

    it('renderiza plano auto mesmo quando o SDK ainda não expõe inventário vivo', async () => {
        mockProjection();
        listTerminalSdkSessionInventory.mockRejectedValueOnce(new Error('[AlwaysAlive] client SDK indisponível'));
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto plan profile:repo_agent 5');

        expect(ctx.output()).toContain('Plano de provas BYOK');
        expect(ctx.output()).toContain('sem chamada');
        expect(ctx.output()).not.toContain('SessionError');
        expect(ctx.output()).not.toContain('client SDK indisponível');
    });

    it('renderiza rotas standby auto sem chamar provider', async () => {
        mockProjection();
        buildModelGatewayRuntimeSelectorPlan.mockReturnValueOnce({
            schema: 'model-gateway-runtime-selector-plan',
            ok: true,
            ready: true,
            summary: { selectedProfileCount: 1, profileCount: 1, blockedProfileCount: 0 },
            routes: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto standby profile:repo_agent 5');

        expect(ctx.output()).toContain('BYOK prontidão automática');
        expect(ctx.output()).toMatch(/sem chamada\s+a\s+provedor/u);
        expect(ctx.output()).toContain('alternativa candidata');
        expect(ctx.output()).toContain('novo provedor');
        expect(ctx.output()).toContain('/byok probe agent provider:kilo-code model:kilo-auto/free timeout:20000');
        expect(ctx.output()).toContain('/byok model kilo-auto/free');
        expect(ctx.output()).toContain('/byok provider kilo-code kilo-auto/free');
        expect(ctx.output()).toContain('/byok persist provider kilo-code kilo-auto/free');
        expect(ctx.output()).not.toContain('candidate alternative');
        expect(ctx.output()).not.toContain('new provider');
    });

    it('aplica efeito auto live apenas quando a policy autoriza', async () => {
        mockProjection();
        buildModelGatewayRuntimeAutomationDecision.mockReturnValueOnce({
            schema: 'model-gateway-runtime-automation-decision',
            ok: true,
            status: 'ready',
            action: 'apply_live_model',
            selectedRouteKey: 'openrouter:openai/gpt-oss-120b',
            routeProfile: 'repo_agent',
            canApplyLiveModel: true,
            requiresNewSession: false,
            blockers: [],
            currentBoundary: {
                enabled: true,
                profile: 'repo_agent',
                preset: 'openrouter',
                providerType: 'openai_compatible',
                baseUrl: null,
                model: 'old-model',
            },
            targetBoundary: {
                profile: 'repo_agent',
                preset: 'openrouter',
                providerType: 'openai_compatible',
                baseUrl: null,
                model: 'openai/gpt-oss-120b',
            },
            cooldown: { active: false, reason: null, resetAt: null, retryAfterSeconds: null },
            blockerClass: 'none',
            nonActionReason: null,
            nextCommands: ['/byok model openai/gpt-oss-120b'],
            operatorSummary: 'Mesmo provider BYOK; o modelo pode ser aplicado na sessao viva.',
        });
        setTerminalModelProjection.mockReturnValueOnce({
            previousModel: 'old-model',
            currentModel: 'openai/gpt-oss-120b',
            currentReasoningEffort: 'high',
            reasoningAdjusted: false,
            runtimeId: 'runtime-auto-apply',
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto apply profile:repo_agent allow-live-set-model');

        expect(setTerminalModelProjection).toHaveBeenCalledWith('openai/gpt-oss-120b');
        expect(ctx.output()).toContain('Aplicação');
        expect(ctx.output()).toContain('modelo vivo solicitado old-model → openai/gpt-oss-120b');
        expect(ctx.output()).toContain('Confirmação');
        expect(ctx.output()).toContain('confirmação do SDK');
        expect(readTerminalActivityHistory()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    label: 'Troca de modelo solicitada',
                    source: 'terminal.byok_auto',
                    detail: expect.stringContaining('automação model-gateway'),
                }),
            ]),
        );
    });

    it('persiste auto on sem aplicar efeitos na sessao viva', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto on profile:repo_agent allow-live-set-model');

        expect(ctx.output()).toContain('BYOK automação ativada');
        expect(ctx.output()).toContain('COPILOT_BYOK_GATEWAY_AUTO=true');
        expect(ctx.output()).toContain('COPILOT_BYOK_GATEWAY_AUTO_PRESET=auto_same_boundary');
        expect(ctx.output()).toContain('COPILOT_BYOK_GATEWAY_AUTO_PROFILES=repo_agent');
        expect(ctx.output()).toContain('COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL=true');
        expect(writeModelGatewayRuntimeAutomationPolicyFile).toHaveBeenCalledWith(
            expect.objectContaining({
                enabled: true,
                preset: 'auto_same_boundary',
                profiles: ['repo_agent'],
                allowLiveSetModel: true,
            }),
        );
        expect(setTerminalModelProjection).not.toHaveBeenCalled();
    });

    it('mostra policy efetiva e desliga auto de modo persistente', async () => {
        mockProjection();
        readModelGatewayRuntimeAutomationPolicyFile.mockResolvedValueOnce({
            enabled: true,
            preset: 'auto_same_boundary',
            profiles: ['repo_agent'],
            allowLiveSetModel: true,
        });
        readModelGatewayRuntimeAutomationEffectivePolicy.mockResolvedValueOnce({
            enabled: true,
            preset: 'auto_same_boundary',
            policy: 'prefer_runtime_proved',
            profiles: ['repo_agent'],
            allowLiveSetModel: true,
            allowNewSession: false,
            allowProviderProbes: false,
            allowLocalPrivate: false,
            accountWideFailureKinds: ['rate-limit'],
        });
        const policyCtx = mockCtx();

        await cmdByok({ println: policyCtx.println }, 'auto policy');

        expect(policyCtx.output()).toContain('BYOK política da automação');
        expect(policyCtx.output()).toContain(DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH);
        expect(policyCtx.output()).toContain('ativo');
        expect(policyCtx.output()).toContain('auto_same_boundary');
        expect(policyCtx.output()).toContain('auto_prepare_new_session');
        expect(policyCtx.output()).toContain('repo_agent');
        expect(policyCtx.output()).toContain('troca viva sim');
        expect(policyCtx.output()).not.toContain('live setModel');

        readModelGatewayRuntimeAutomationEffectivePolicy.mockResolvedValueOnce({
            enabled: true,
            preset: 'auto_prepare_new_session',
            policy: 'prefer_runtime_proved',
            profiles: ['repo_agent'],
            allowLiveSetModel: true,
            allowNewSession: true,
            allowProviderProbes: false,
            allowLocalPrivate: false,
            accountWideFailureKinds: [],
        });
        const offCtx = mockCtx();
        await cmdByok({ println: offCtx.println }, 'auto off');

        expect(offCtx.output()).toContain('BYOK automação desativada');
        expect(writeModelGatewayRuntimeAutomationPolicyFile).toHaveBeenCalledWith(
            expect.objectContaining({ enabled: false, profiles: ['repo_agent'] }),
        );
    });

    it('registra decisão auto sem aplicar efeitos e explica auto off', async () => {
        mockProjection();
        const recordCtx = mockCtx();
        await cmdByok({ println: recordCtx.println }, 'auto record profile:repo_agent');
        expect(recordCtx.output()).toContain('1 decisão gravada');

        const offCtx = mockCtx();
        await cmdByok({ println: offCtx.println }, 'auto off');
        expect(offCtx.output()).toContain('BYOK automação desativada');
        expect(offCtx.output()).toContain('COPILOT_BYOK_GATEWAY_AUTO');
    });

    it('mostra historico auto persistido sem executar efeitos', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto history 5');

        expect(ctx.output()).toContain('BYOK histórico da automação');
        expect(ctx.output()).toContain('preparar nova sessão');
        expect(ctx.output()).toContain('zai:glm-4.5-flash');
        expect(setTerminalModelProjection).not.toHaveBeenCalled();
    });

    it('mostra handoffs, confirmations e recoveries auto persistidos sem executar efeitos', async () => {
        mockProjection();
        const handoffsCtx = mockCtx();
        const confirmationsCtx = mockCtx();
        const recoveriesCtx = mockCtx();
        const fixtureCtx = mockCtx();

        await cmdByok({ println: handoffsCtx.println }, 'auto handoffs 5');
        await cmdByok({ println: confirmationsCtx.println }, 'auto confirmations 5');
        await cmdByok({ println: fixtureCtx.println }, 'auto recovery-fixture profile:repo_agent failure:rate-limit');
        await cmdByok({ println: recoveriesCtx.println }, 'auto recoveries 5');

        expect(handoffsCtx.output()).toContain('Handoffs BYOK');
        expect(handoffsCtx.output()).toContain('diferido até limite do turno');
        expect(handoffsCtx.output()).toContain('sessão');
        expect(handoffsCtx.output()).toContain('sdk-session-1');
        expect(handoffsCtx.output()).toContain('provider zai:glm-4.5-flash');
        expect(handoffsCtx.output()).toContain('promoção autorizada');
        expect(handoffsCtx.output()).not.toContain('effect_not_authorized');
        expect(confirmationsCtx.output()).toContain('Confirmações BYOK');
        expect(confirmationsCtx.output()).toContain('matched handoff');
        expect(fixtureCtx.output()).toContain('Fixture de recuperação BYOK');
        expect(fixtureCtx.output()).toContain('sem chamada a provedor');
        expect(fixtureCtx.output()).toContain('saúde sintética sim');
        expect(fixtureCtx.output()).not.toContain('action=');
        expect(fixtureCtx.output()).not.toContain('applied=');
        expect(fixtureCtx.output()).not.toContain('recorded=');
        expect(fixtureCtx.output()).not.toContain('prepare_new_sdk_session');
        expect(fixtureCtx.output()).not.toContain('new_session_not_allowed');
        expect(recoveriesCtx.output()).toContain('Recuperações BYOK');
        expect(recoveriesCtx.output()).toContain('limite de taxa');
        expect(recoveriesCtx.output()).toContain('escopo');
        expect(recoveriesCtx.output()).not.toContain('scope=');
        expect(recoveriesCtx.output()).not.toContain('failure=');
        expect(setTerminalModelProjection).not.toHaveBeenCalled();
    });

    it('mostra doctor auto no terminal sem aplicar efeitos', async () => {
        mockProjection();
        buildModelGatewayRuntimeAutomationDecision.mockReturnValueOnce({
            schema: 'model-gateway-runtime-automation-decision',
            ok: false,
            status: 'blocked',
            action: 'wait_for_reset',
            selectedRouteKey: 'groq:reset-model',
            routeProfile: 'repo_agent',
            canApplyLiveModel: false,
            requiresNewSession: false,
            blockers: ['blocked:provider_health_cooldown:rate-limit'],
            currentBoundary: { enabled: false, profile: null, preset: null, providerType: null, baseUrl: null, model: null },
            targetBoundary: { profile: 'repo_agent', preset: 'groq', providerType: 'openai_compatible', baseUrl: null, model: 'reset-model' },
            cooldown: { active: true, reason: 'provider_health_cooldown', resetAt: '2026-06-01T10:00:00.000Z', retryAfterSeconds: 120 },
            blockerClass: 'rate_limit_resettable',
            nonActionReason: 'route_wait_for_reset',
            nextCommands: ['npm run model-gateway:runtime-health:diff'],
            operatorSummary: 'Rota bloqueada por health/cooldown; aguarde reset ou escolha outra rota.',
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto doctor profile:repo_agent');

        expect(ctx.output()).toContain('BYOK diagnóstico da automação');
        expect(ctx.output()).toContain('perfil repo_agent');
        expect(ctx.output()).toContain('snapshot ativo sim');
        expect(ctx.output()).toContain('Decisão');
        expect(ctx.output()).toContain('Origem');
        expect(ctx.output()).toContain('Cooldown');
        expect(ctx.output()).toContain('reset 2026-06-01T10:00:00.000Z');
        expect(ctx.output()).toContain('Registros');
        expect(ctx.output()).toContain('Bloqueios');
        expect(ctx.output()).toContain('Próximo');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).not.toContain('blockers:');
        expect(ctx.output()).not.toContain('proximo:');
        expect(setTerminalModelProjection).not.toHaveBeenCalled();
    });

    it('explica e aciona switch auto usando apenas efeitos autorizados', async () => {
        mockProjection();
        const explainCtx = mockCtx();
        const switchCtx = mockCtx();

        await cmdByok({ println: explainCtx.println }, 'auto explain profile:repo_agent');
        await cmdByok({ println: switchCtx.println }, 'auto switch profile:repo_agent');

        expect(explainCtx.output()).toContain('Explicação BYOK auto');
        expect(explainCtx.output()).toContain('decisão atual + diagnóstico operacional');
        expect(explainCtx.output()).toContain('BYOK automação do gateway');
        expect(explainCtx.output()).toContain('BYOK diagnóstico da automação');
        expect(switchCtx.output()).toContain('BYOK automação do gateway');
        expect(switchCtx.output()).toContain('Trilha auto');
    });

    it('centraliza executor terminal dos efeitos auto', async () => {
        const result = await applyTerminalByokGatewayAutoEffects({
            effects: [
                {
                    kind: 'set_live_model',
                    model: 'anthropic/claude-sonnet-4.5',
                    execute: true,
                    reason: 'Mesmo provider BYOK; o modelo pode ser aplicado na sessao viva.',
                    confidence: 'catalog',
                },
                { kind: 'prepare_new_sdk_session', model: 'anthropic/claude-sonnet-4.5', execute: true },
                { kind: 'set_live_model', model: 'dry-model', execute: false },
                { kind: 'set_live_model', model: 'blocked-model', execute: false, blockedReason: 'live_set_model_not_allowed' },
            ],
        });

        expect(setTerminalModelProjection).toHaveBeenCalledWith('anthropic/claude-sonnet-4.5');
        expect(scheduleTerminalSdkSessionBootSelection).not.toHaveBeenCalled();
        expect(result.applied).toHaveLength(1);
        expect(result.applied.map(describeTerminalByokGatewayAutoEffect)).toEqual(
            expect.arrayContaining([
                'modelo vivo solicitado anthropic/claude-sonnet-4.5 · confiança catálogo',
            ]),
        );
        expect(result.skipped).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'set_live_model', skippedReason: 'effect_not_authorized' }),
                expect.objectContaining({ kind: 'set_live_model', skippedReason: 'live_set_model_not_allowed' }),
            ]),
        );
        expect(result.skipped.map(describeTerminalByokGatewayAutoEffect)).toEqual(
            expect.arrayContaining([
                'trocar modelo vivo aguardando autorização da policy',
                'trocar modelo vivo não aplicado (troca viva não autorizada)',
            ]),
        );
        expect(
            describeTerminalByokGatewayAutoEffect({
                kind: 'prepare_new_sdk_session',
                skippedReason: 'new_session_not_allowed',
            }),
        ).toBe('preparar novo boot SDK não aplicado (nova sessão não autorizada)');
        const records = createTerminalByokGatewayAutoEffectApplicationRecords(
            {
                args: { profileId: 'repo_agent' },
                decision: { routeProfile: 'repo_agent', selectedRouteKey: 'openrouter:model-a' },
                automationDecisionRecord: { decisionId: 'automation-1' },
            },
            result,
            { timestamp: '2026-06-01T00:00:00.000Z' },
        );
        expect(records).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    decisionId: 'automation-1',
                    routeProfile: 'repo_agent',
                    selectedRouteKey: 'openrouter:model-a',
                    effectKind: 'set_live_model',
                    status: 'applied',
                    applied: true,
                }),
                expect.objectContaining({
                    decisionId: 'automation-1',
                    effectKind: 'prepare_new_sdk_session',
                    status: 'implicit_new_session_forbidden',
                    applied: false,
                }),
            ]),
        );
        const handoffs = createTerminalByokGatewaySdkSessionHandoffRecords(
            {
                args: { profileId: 'repo_agent' },
                decision: { routeProfile: 'repo_agent', selectedRouteKey: 'openrouter:model-a' },
                automationDecisionRecord: { decisionId: 'automation-1' },
            },
            result,
            { timestamp: '2026-06-01T00:00:00.000Z' },
        );
        expect(handoffs).toEqual([
            expect.objectContaining({
                decisionId: 'automation-1',
                routeProfile: 'repo_agent',
                selectedRouteKey: 'openrouter:model-a',
                status: 'implicit_new_session_forbidden',
                targetModel: 'anthropic/claude-sonnet-4.5',
            }),
        ]);
    });

    it('não dispara seleção pre-turn quando policy auto efetiva está desligada', async () => {
        const result = await runTerminalByokGatewayPreTurnAutomation();

        expect(result.ran).toBe(false);
        expect(result.status).toBeNull();
        expect(listTerminalSdkSessionInventory).not.toHaveBeenCalled();
        expect(auditModelGatewayPreRuntimeSelection).not.toHaveBeenCalled();
    });

    it('replaneja pós-falha BYOK quando policy auto efetiva está ligada', async () => {
        readModelGatewayRuntimeAutomationEffectivePolicy.mockResolvedValueOnce({
            enabled: true,
            policy: 'prefer_runtime_proved',
            profiles: ['repo_agent'],
            allowLiveSetModel: false,
            allowNewSession: true,
            allowProviderProbes: false,
            allowLocalPrivate: false,
            accountWideFailureKinds: ['rate-limit'],
        });

        const result = await runTerminalByokGatewayPostTurnAutomation({
            profile: 'repo_agent',
            provider: 'openrouter',
            model: 'openai/gpt-oss-120b',
            failureKind: 'rate-limit',
            message: 'quota exhausted',
        });

        expect(result.ran).toBe(true);
        expect(buildModelGatewayRuntimeAutomationDecision).toHaveBeenCalledWith(
            expect.objectContaining({
                turnFailure: expect.objectContaining({
                    profile: 'repo_agent',
                    provider: 'openrouter',
                    model: 'openai/gpt-oss-120b',
                    failureKind: 'rate-limit',
                }),
            }),
        );
        expect(result.controllerStep?.phase).toBe('post_turn');
        expect(result.application?.applied).toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'replan_after_turn_failure' })]),
        );
        expect(result.effectPersistence).toEqual(
            expect.objectContaining({
                automationEffectApplications: expect.any(Number),
                recoveryAttempts: expect.any(Number),
                sdkSessionHandoffs: expect.any(Number),
            }),
        );
        expect(recordByokProviderModelCallFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'repo_agent',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                failureKind: 'rate-limit',
                failureStatusCode: 429,
                retryAfterSeconds: 900,
            }),
        );
        expect(flushAndMirrorByokProviderHealthToSqlite).toHaveBeenCalledWith({
            sqliteStore: expect.anything(),
        });
        expect(result.healthPersistence).toEqual(
            expect.objectContaining({
                recorded: true,
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                failureKind: 'rate-limit',
            }),
        );
    });

    it('explica bloqueio local padrão na auditoria de seleção pré-runtime', async () => {
        auditModelGatewayPreRuntimeSelection.mockReturnValueOnce({
            schema: 'model-gateway-pre-runtime-selection-audit',
            ok: true,
            mode: 'allow_probe_unknown',
            snapshotContext: {
                projectionCount: 1,
                routeOptionCount: 1,
                accountOverlayCount: 0,
                eligibilityDecisionCount: 0,
                candidateCount: 1,
            },
            summary: {
                profileCount: 1,
                selectedProfileCount: 0,
                unselectedProfileCount: 1,
                candidateCount: 1,
                rejectedCount: 1,
                selectedProviders: {},
                selectedSelectorKinds: {},
                rejectedReasonCounts: { local_provider_requires_explicit_request: 1 },
            },
            profiles: [
                {
                    profileId: 'cheap_chat',
                    selected: null,
                    candidateCount: 1,
                    rejectedCount: 1,
                    fallbackChain: [],
                    topRejectedReasons: ['local_provider_requires_explicit_request'],
                    nextActions: ['request_local_provider_explicitly'],
                    decisionLayers: { runtimeProbeProofCount: 0 },
                    snapshotContext: {},
                },
            ],
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway selection audit cheap_chat');

        expect(ctx.output()).toContain('provedor local exige pedido explícito');
        expect(ctx.output()).not.toContain('local_provider_requires_explicit_request');
        expect(ctx.output()).toContain('Ollama/local foi bloqueado por padrão nos perfis cheap_chat');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra seleção efetiva com saúde observada sem persistir nem executar probes', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway selection audit effective repo_agent');

        expect(evaluateModelGatewayCatalogEligibility).toHaveBeenCalledWith(
            expect.objectContaining({
                snapshot: expect.any(Object),
                secretRegistry: expect.any(Object),
                healthRecords: expect.any(Array),
                now: expect.any(Function),
                policy: expect.objectContaining({
                    unknownAccessPolicy: 'block',
                    policyProfile: 'terminal-effective-strict-no-runtime',
                }),
            }),
        );
        expect(applyModelGatewayEligibilityToSnapshot).not.toHaveBeenCalled();
        expect(summarizeModelGatewayRuntimeAccountOverlays).toHaveBeenCalledWith(expect.any(Array), {
            now: expect.any(Date),
        });
        expect(auditModelGatewayPreRuntimeSelection).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'terminal-effective-selection-preview',
                modelEligibilityDecisions: expect.any(Array),
            }),
            expect.objectContaining({
                strict: true,
                profiles: ['repo_agent'],
                secretRegistry: expect.any(Object),
            }),
        );
        expect(auditModelGatewayPostRuntimeSelection).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'terminal-effective-selection-preview',
                modelEligibilityDecisions: expect.any(Array),
            }),
            expect.objectContaining({
                strict: true,
                profiles: ['repo_agent'],
                secretRegistry: expect.any(Object),
                runtimeHealthRecords: expect.any(Array),
                requireRuntimeProof: false,
            }),
        );
        expect(compareModelGatewaySelectionAudits).toHaveBeenCalled();
        expect(explainModelGatewaySelectionComparison).toHaveBeenCalledWith(expect.any(Object));
        expect(resolveModelGatewaySelectionPolicy).toHaveBeenCalledWith(expect.any(Object), { mode: 'metadata_first' });
        expect(buildModelGatewayRuntimeSelectorPlan).toHaveBeenCalledWith(expect.any(Object), {
            source: 'terminal-byok-selection-audit',
            requireRuntimeProof: false,
        });
        expect(ctx.output()).toContain('modo permitir sonda quando');
        expect(ctx.output()).toContain('acesso é desconhecido + efetivo');
        expect(ctx.output()).toContain('persistido não');
        expect(ctx.output()).toContain('Saúde observada');
        expect(ctx.output()).toContain('Pós-execução');
        expect(ctx.output()).toContain('perfis 1/1');
        expect(ctx.output()).toContain('Comparação');
        expect(ctx.output()).toContain('mudou 1/1');
        expect(ctx.output()).toContain('rota provada em runtime venceu:1');
        expect(ctx.output()).toContain('Comparação');
        expect(ctx.output()).toContain('rota provada em runtime venceu');
        expect(ctx.output()).not.toContain('compare=post_runtime_proved_better_route');
        expect(ctx.output()).not.toContain('post_runtime_proved_better_route');
        expect(ctx.output()).toContain('Política');
        expect(ctx.output()).toContain('metadados primeiro');
        expect(ctx.output()).toContain('selecionados finais 1/1');
        expect(ctx.output()).toContain('Seletor de execução');
        expect(ctx.output()).toContain('pronto · selecionados 1/1');
        expect(ctx.output()).toContain('bloqueados 0');
        expect(ctx.output()).toContain('env pronto 1');
        expect(ctx.output()).toContain('env bloqueado 0');
        expect(ctx.output()).toContain('mudou -> groq:openai/gpt-oss-120b');
        expect(ctx.output()).toContain('provas de saúde 1');
        expect(ctx.output()).toContain('provas de sonda 1');
        expect(ctx.output()).toContain('overlays de execução 1');
        expect(ctx.output()).toContain('ativos 1');
        expect(ctx.output()).toContain('expirados 0');
        expect(ctx.output()).toContain('falhas limite de taxa:1');
        expect(ctx.output()).toContain('provedores groq:1');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('permite exigir prova runtime na auditoria efetiva do terminal', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway selection audit runtime-proof repo_agent');

        expect(auditModelGatewayPostRuntimeSelection).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                strict: true,
                profiles: ['repo_agent'],
                requireRuntimeProof: true,
                runtimeHealthRecords: expect.any(Array),
            }),
        );
        expect(resolveModelGatewaySelectionPolicy).toHaveBeenCalledWith(expect.any(Object), {
            mode: 'require_runtime_proof',
        });
        expect(buildModelGatewayRuntimeSelectorPlan).toHaveBeenCalledWith(expect.any(Object), {
            source: 'terminal-byok-selection-audit',
            requireRuntimeProof: true,
        });
        expect(ctx.output()).toContain('modo permitir sonda quando');
        expect(ctx.output()).toContain('acesso é desconhecido + efetivo + prova obrigatória');
        expect(ctx.output()).toContain('Política');
        expect(ctx.output()).toContain('exigir prova runtime');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('grava trace de decisão da auditoria efetiva do terminal sem mutar catálogo', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok(
            { println: ctx.println },
            'gateway selection audit effective write-trace trace-id:terminal-trace repo_agent',
        );

        expect(buildModelGatewaySelectionDecisionTrace).toHaveBeenCalledWith(
            expect.objectContaining({
                snapshot: expect.any(Object),
                integrity: expect.any(Object),
                selection: expect.any(Object),
                postRuntimeSelection: expect.any(Object),
                selectionComparison: expect.any(Object),
                policyResolution: expect.any(Object),
                runtimeSource: 'terminal-file',
                runtimeHealthRecordCount: expect.any(Number),
                traceId: 'terminal-trace',
                source: 'terminal-byok-selection-audit',
            }),
        );
        expect(persistModelGatewaySelectionDecisionTrace).toHaveBeenCalledWith(
            expect.objectContaining({
                schema: 'model-gateway-selection-decision-trace',
                traceId: 'terminal-trace',
            }),
            { directory: DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR },
        );
        expect(ctx.output()).toContain('Trace');
        expect(ctx.output()).toContain('persistido sim');
        expect(ctx.output()).toContain('/tmp/latest-model-gateway-selection-trace.json');
        expect(ctx.output()).not.toContain('latest /tmp/latest-model-gateway-selection-trace.json');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).toContain('persistido sim');
        expect(ctx.output()).toContain('/tmp/model-gateway-selection-trace.json');
    });

    it('executa refresh do catálogo model-gateway com saída OpenAI-compatible resumida', async () => {
        mockProjection();
        const ctx = mockCtx();
        const eventBus = { emit: vi.fn() };

        await cmdByok({ println: ctx.println, eventBus }, 'gateway catalog refresh');

        expect(JsonModelGatewayCatalogStore).toHaveBeenCalledWith({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
        expect(createDefaultModelGatewayCatalogImporters).toHaveBeenCalledWith({ env: process.env });
        expect(refreshModelGatewayCatalog).toHaveBeenCalledWith(
            expect.objectContaining({
                incremental: true,
                refreshAccountOverlays: true,
                writePolicy: 'commit',
                lockKey: DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
                retentionPolicy: expect.objectContaining({ maxImportRuns: 200 }),
            }),
        );
        expect(buildCatalogRefreshStartedEvent).toHaveBeenCalledWith(
            expect.objectContaining({ source: 'terminal-byok', importerIds: ['openrouter-models', 'openai-models'] }),
        );
        expect(buildCatalogRefreshEventBatch).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'terminal-byok',
                importerIds: ['openrouter-models', 'openai-models'],
                diff: expect.objectContaining({ added: ['openrouter:new-model:default'] }),
            }),
        );
        expect(recommendCatalogDiffProbes).toHaveBeenCalledWith(
            expect.objectContaining({
                diff: expect.objectContaining({ added: ['openrouter:new-model:default'] }),
                projections: [{ providerModel: 'new-model' }],
                limit: 5,
            }),
        );
        expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'model_gateway:catalog:import_started' }));
        expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'model_gateway:catalog:model_changed' }));
        expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'model_gateway:catalog:import_completed' }));
        expect(ctx.output()).toContain('BYOK refresh do catálogo');
        expect(ctx.output()).toContain('schema OpenAI + x_model_gateway');
        expect(ctx.output()).toContain('projeções 1');
        expect(ctx.output()).toContain('modelos OpenAI 1');
        expect(ctx.output()).toContain('novos 1');
        expect(ctx.output()).toContain('alterados 1');
        expect(ctx.output()).toContain('Persistência');
        expect(ctx.output()).toContain('commit · commit sim');
        expect(ctx.output()).toContain('Diferença de elegibilidade');
        expect(ctx.output()).toContain('novas 1');
        expect(ctx.output()).toContain('preço alterado');
        expect(ctx.output()).not.toContain('pricing_changed');
        expect(ctx.output()).toContain('Sugestões de prova runtime');
        expect(ctx.output()).toContain('/byok probe agent model:changed-model');
        expect(ctx.output()).toContain('openrouter:new-model:default');
        expect(ctx.output()).not.toContain('schema=OpenAI+x_model_gateway');
        expect(ctx.output()).not.toContain('write=commit');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('resume o último log JSONL de refresh do catálogo model-gateway', async () => {
        mockProjection();
        const ctx = mockCtx();
        readdir.mockResolvedValue(['old.jsonl', 'latest.jsonl']);
        stat.mockImplementation((path) =>
            Promise.resolve({
                isFile: () => true,
                mtimeMs: String(path).includes('latest') ? 2 : 1,
            }),
        );
        readFile.mockResolvedValue('{"phase":"refresh_completed"}\n');

        await cmdByok({ println: ctx.println }, 'gateway catalog refresh-log');

        expect(readFile).toHaveBeenCalledWith(expect.stringContaining('latest.jsonl'), 'utf8');
        expect(summarizeModelGatewayRefreshLogText).toHaveBeenCalledWith('{"phase":"refresh_completed"}\n', {
            logPath: expect.stringContaining('latest.jsonl'),
        });
        expect(ctx.output()).toContain('BYOK log de refresh');
        expect(ctx.output()).toContain('eventos 6');
        expect(ctx.output()).toMatch(/Refresh completo\s+sim/u);
        expect(ctx.output()).toContain('projeções 42');
        expect(ctx.output()).toContain('openrouter-models');
        expect(ctx.output()).toContain('falhas 0');
        expect(ctx.output()).not.toContain('events=6');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('planeja refresh do catálogo model-gateway sem rede e sem escrita', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway catalog refresh-plan openrouter');

        expect(createDefaultModelGatewayCatalogImporters).toHaveBeenCalledWith({ env: process.env });
        expect(planModelGatewayCatalogRefresh).toHaveBeenCalledWith(
            expect.objectContaining({
                importers: expect.arrayContaining([expect.objectContaining({ id: 'openrouter-models' })]),
                sources: expect.any(Array),
            }),
        );
        expect(refreshModelGatewayCatalog).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK plano de refresh');
        expect(ctx.output()).toContain('sem rede');
        expect(ctx.output()).toContain('executar agora 1');
        expect(ctx.output()).toContain('executar');
        expect(ctx.output()).toContain('openrouter-models');
        expect(ctx.output()).toContain('source_ttl_expired');
        expect(ctx.output()).toContain('Adiar');
        expect(ctx.output()).toContain('openai-models');
        expect(ctx.output()).not.toContain('selected=1');
    });

    it('exibe o último diff persistido do catálogo sem refazer rede', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway catalog diff');

        expect(refreshModelGatewayCatalog).not.toHaveBeenCalled();
        expect(summarizeCanonicalModelProjectionDiff).toHaveBeenCalled();
        expect(recommendCatalogDiffProbes).toHaveBeenCalledWith(
            expect.objectContaining({
                diff: expect.objectContaining({ added: ['openrouter:new-model:default'] }),
                projections: [expect.objectContaining({ providerModel: 'new-model' })],
                limit: 8,
            }),
        );
        expect(ctx.output()).toContain('BYOK diff do catálogo');
        expect(ctx.output()).toContain('sem rede');
        expect(ctx.output()).toContain('novos 1');
        expect(ctx.output()).toContain('capabilities_changed');
        expect(ctx.output()).toMatch(/Sugestões de prova runtime\s+1/u);
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('exibe runs e diff persistidos de eligibility sem executar runtime', async () => {
        mockProjection();
        const runsCtx = mockCtx();
        const diffCtx = mockCtx();

        await cmdByok({ println: runsCtx.println }, 'gateway eligibility runs');
        await cmdByok({ println: diffCtx.println }, 'gateway eligibility diff');

        expect(refreshModelGatewayCatalog).not.toHaveBeenCalled();
        expect(summarizeModelGatewayEligibilityDiff).toHaveBeenCalled();
        expect(runsCtx.output()).toContain('BYOK runs de elegibilidade');
        expect(runsCtx.output()).toContain('eligibility-run-1');
        expect(runsCtx.output()).toMatch(/Diferença\s+novas 1/u);
        expect(runsCtx.output()).toContain('disposição alterada');
        expect(runsCtx.output()).not.toContain('disposition_changed');
        expect(runsCtx.output()).not.toContain('\x1b[');
        expect(diffCtx.output()).toContain('BYOK diff de elegibilidade');
        expect(diffCtx.output()).toContain('ficaram elegíveis 0');
        expect(diffCtx.output()).toContain('disposição alterada');
        expect(diffCtx.output()).not.toContain('disposition_changed');
        expect(diffCtx.output()).not.toContain('\x1b[');
    });

    it('explica elegibilidade pré-runtime com estados humanos sem executar modelo', async () => {
        mockProjection();
        evaluateModelGatewayCatalogEligibility.mockReturnValue({
            run: { runId: 'eligibility-run', policyProfile: 'default' },
            decisions: [
                {
                    providerId: 'openrouter',
                    providerModel: 'new-model',
                    routeProfile: 'default',
                },
            ],
            summary: { modelCount: 1, eligibleCount: 1, unknownCount: 0, excludedCount: 0 },
        });
        explainModelGatewayEligibilityDecision.mockReturnValue({
            status: 'eligible',
            key: 'openrouter:new-model:default:exact_model:new-model',
            summary: 'eligible:account_model_visible',
            disposition: 'eligible',
            hardExclusions: [],
            softPenalties: [],
            actionable: {
                category: 'rankable',
                dataNeeded: [],
                probeSafe: false,
                operatorHint: 'no_extra_action',
            },
            nextActions: ['candidate_can_be_ranked'],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway eligibility new-model');

        expect(evaluateModelGatewayCatalogEligibility).toHaveBeenCalled();
        expect(explainModelGatewayEligibilityDecision).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK elegibilidade');
        expect(ctx.output()).toContain('política permitir sonda');
        expect(ctx.output()).toContain('acesso é desconhecido');
        expect(ctx.output()).toContain('elegível');
        expect(ctx.output()).toContain('modelo visível na conta');
        expect(ctx.output()).toContain('sem ação extra');
        expect(ctx.output()).toContain('candidato pode ser ranqueado');
        expect(ctx.output()).not.toContain('account_model_visible');
        expect(ctx.output()).not.toContain('candidate_can_be_ranked');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('espelha catálogo model-gateway no SQLite com superfície temática', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway catalog sqlite');

        expect(mirrorModelGatewayCatalogSnapshotToSqlite).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceStore: expect.any(Object),
                sqliteStore: expect.any(Object),
            }),
        );
        expect(ctx.output()).toContain('BYOK espelho SQLite do catálogo');
        expect(ctx.output()).toContain('JSON data/copilot/model-gateway/catalog.json');
        expect(ctx.output()).toContain('projeções 1');
        expect(ctx.output()).toContain('rotas 1');
        expect(ctx.output()).toContain('Paridade');
        expect(ctx.output()).not.toContain('JSON:');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('espelha saúde runtime no SQLite sem misturar com catálogo', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway health sqlite');

        expect(flushAndMirrorByokProviderHealthToSqlite).toHaveBeenCalledWith({
            sqliteStore: expect.any(Object),
        });
        expect(ctx.output()).toContain('BYOK espelho SQLite da saúde runtime');
        expect(ctx.output()).toContain('fatos de execução separados do catálogo');
        expect(ctx.output()).toContain('Saúde runtime');
        expect(ctx.output()).toContain('run health-run');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('renderiza schema OpenAI normalizado com extensão x_model_gateway sem ANSI manual', async () => {
        mockProjection();
        toOpenAIModelCatalogList.mockReturnValue({
            object: 'list',
            data: [
                {
                    id: 'openrouter:new-model',
                    object: 'model',
                    x_model_gateway: {
                        provider_id: 'openrouter',
                        provider_model: 'new-model',
                        eligibility: { status: 'eligible' },
                        route_options: [{ selectorKind: 'exact_model' }],
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway catalog openai');

        expect(toOpenAIModelCatalogList).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK schema OpenAI normalizado');
        expect(ctx.output()).toContain('fonte json');
        expect(ctx.output()).toContain('extensão x_model_gateway');
        expect(ctx.output()).toContain('openrouter:new-model');
        expect(ctx.output()).toContain('provedor openrouter');
        expect(ctx.output()).not.toContain('schema=OpenAI+x_model_gateway');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('explica entrada do catálogo com camadas e fronteira sem runtime novo', async () => {
        mockProjection();
        explainModelGatewayCatalogEntry.mockReturnValue({
            found: true,
            key: 'openrouter:new-model:default',
            projection: {
                providerId: 'openrouter',
                providerModel: 'new-model',
                routeProfile: 'default',
                displayName: 'New Model',
                lifecycle: 'active',
                family: 'gpt',
            },
            routeOptions: [
                {
                    selectorKind: 'exact_model',
                    selectorSyntax: 'new-model',
                    normalizedPolicy: { routeLayer: 'catalog', wireApi: 'openai_chat_completions' },
                },
            ],
            accountOverlays: [
                {
                    accountScope: 'default',
                    secretRef: 'OPENROUTER_API_KEY',
                    enabledModels: ['new-model'],
                    blockedModels: [],
                },
            ],
            eligibility: {
                status: 'eligible',
                summary: 'eligible:account_model_visible',
                nextActions: ['candidate_can_be_ranked'],
            },
            openai: { id: 'openrouter:new-model' },
            runtimeHealth: { status: 'ok' },
            runtimeProbes: [{ kind: 'agent' }],
            metadataCoverage: {
                confidenceFields: 2,
                provenanceFields: 3,
                supportedParameters: 4,
                unsupportedParameters: 1,
            },
            nextActions: ['route_decision_ready'],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway catalog explain new-model');

        expect(explainModelGatewayCatalogEntry).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK explicação do catálogo');
        expect(ctx.output()).toContain('sem runtime novo');
        expect(ctx.output()).toContain('openrouter:new-model:default');
        expect(ctx.output()).toContain('Saúde runtime');
        expect(ctx.output()).toContain('Rota');
        expect(ctx.output()).toContain('Elegibilidade');
        expect(ctx.output()).not.toContain('route_decision_ready');
        expect(ctx.output()).toContain('decisão de rota pronta');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('explica provider do catálogo com fontes, frescor e conflitos sem ANSI manual', async () => {
        mockProjection();
        explainModelGatewayProviderEntry.mockReturnValue({
            found: true,
            providerId: 'openrouter',
            sources: [
                {
                    id: 'openrouter-models',
                    kind: 'public_api',
                    authMode: 'none',
                    refreshPolicy: 'ttl',
                },
            ],
            providerEvidences: [{}],
            projections: [{ providerId: 'openrouter' }],
            routeOptions: [{}],
            accountOverlays: [{}],
            conflicts: [{ projectionKey: 'openrouter:model:default', fieldPath: 'pricing.input' }],
            freshness: {
                newestSourceAt: '2026-05-25T00:00:00.000Z',
                oldestSourceAt: '2026-05-24T00:00:00.000Z',
            },
            providerProjection: {
                displayName: 'OpenRouter',
                subjectProviderId: 'openrouter',
            },
            nextActions: ['refresh_overlay_or_retry_pre_runtime_selection'],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway provider explain openrouter');

        expect(explainModelGatewayProviderEntry).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK explicação do provedor');
        expect(ctx.output()).toContain('Provedor');
        expect(ctx.output()).toContain('openrouter');
        expect(ctx.output()).toContain('Frescor');
        expect(ctx.output()).toContain('Fonte');
        expect(ctx.output()).toContain('Conflito');
        expect(ctx.output()).toContain('atualizar overlay ou tentar seleção pré-runtime novamente');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('encaminha /models catalog refresh com filtro de provider/importer', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models catalog refresh openrouter');

        expect(refreshModelGatewayCatalog).toHaveBeenCalledWith(
            expect.objectContaining({
                importers: [expect.objectContaining({ id: 'openrouter-models' })],
            }),
        );
        expect(ctx.output()).toContain('BYOK refresh do catálogo');
        expect(ctx.output()).toContain('filtro openrouter');
        expect(ctx.output()).toContain('openrouter-models');
        expect(ctx.output()).not.toContain('openai-models · Schema');
        expect(ctx.output()).toContain('Refresh concluído');
        expect(ctx.output()).toContain('Diferença do catálogo');
        expect(ctx.output()).toContain('Persistência');
        expect(ctx.output()).toContain('Sugestões de prova runtime');
        expect(ctx.output()).toContain('preço alterado');
        expect(ctx.output()).not.toContain('pricing_changed');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('encaminha /models catalog diff para a mesma UX persistida', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models catalog diff');

        expect(refreshModelGatewayCatalog).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK diff do catálogo');
    });

    it('busca catálogo model-gateway com filtros sem runtime e sem ANSI manual', async () => {
        mockProjection();
        searchModelGatewayCatalogEntries.mockReturnValue([
            {
                key: 'openrouter:new-model:default',
                score: 87,
                eligibilityStatus: 'eligible',
                displayName: 'New Model',
                routeOptionCount: 2,
                accountOverlayCount: 1,
                matchedFields: ['displayName', 'providerModel'],
            },
        ]);
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway catalog search new-model provider:openrouter eligible tools 5');

        expect(searchModelGatewayCatalogEntries).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                query: 'new-model',
                providerId: 'openrouter',
                onlyEligible: true,
                requireTools: true,
            }),
        );
        expect(ctx.output()).toContain('BYOK busca no catálogo');
        expect(ctx.output()).toContain('busca new-model');
        expect(ctx.output()).toContain('só');
        expect(ctx.output()).toContain('elegíveis sim');
        expect(ctx.output()).toContain('openrouter:new-model:default');
        expect(ctx.output()).toContain('elegibilidade elegível');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('exibe conflitos persistidos do catálogo via /models conflicts', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models conflicts');

        expect(refreshModelGatewayCatalog).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK conflitos do catálogo');
        expect(ctx.output()).toContain('capabilities.tools');
        expect(ctx.output()).toContain('catalog-tools');
        expect(ctx.output()).toContain('heuristic-tools');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('lista frescor das fontes do catálogo sem rede e sem ANSI manual', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway catalog freshness openrouter');

        expect(ctx.output()).toContain('BYOK frescor do catálogo');
        expect(ctx.output()).toContain('fontes 1/2');
        expect(ctx.output()).toContain('openrouter-models');
        expect(ctx.output()).toContain('atualização ttl');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra health operacional persistido de BYOK', async () => {
        readByokProviderHealthState.mockReturnValue({
            enabled: true,
            path: 'data/copilot-terminal/byok-provider-health.json',
            loaded: true,
            records: 1,
            persistedRecords: 1,
            flushScheduled: false,
            flushInFlight: false,
            dirty: false,
            error: null,
        });
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'kilo|kilo-code|kilo-auto/free',
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'kilo-auto/free',
                profile: 'kilo',
                provider: 'kilo-code',
                model: 'kilo-auto/free',
                lastStatus: 'ok',
                failureCount: 0,
                successCount: 2,
                lastFailureAt: null,
                lastSuccessAt: Date.now(),
                lastMessage: null,
                lastErrorContext: null,
                probes: {
                    streaming: { kind: 'streaming', status: 'ok', ok: true, providerAttempted: true, count: 2 },
                    vision: { kind: 'vision', status: 'failed', ok: false, providerAttempted: true, count: 1 },
                    live_ask_user: { kind: 'live_ask_user', status: 'ok', ok: true, providerAttempted: true, count: 1 },
                    live_tool_protocol: { kind: 'live_tool_protocol', status: 'ok', ok: true, providerAttempted: true, count: 1 },
                },
            },
        ]);
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'health');

        expect(ctx.output()).toContain('Saúde operacional BYOK');
        expect(ctx.output()).toContain('byok-provider-health.json');
        expect(ctx.output()).toContain('provedor kilo-code');
        expect(ctx.output()).toContain('chat ok');
        expect(ctx.output()).toContain('capacidades streaming ok');
        expect(ctx.output()).toContain('visão falhou');
        expect(ctx.output()).toContain('protocolo live ask user ok');
        expect(ctx.output()).toContain('live tool protocol ok');
        expect(ctx.output()).not.toContain('providerId=');
        expect(ctx.output()).not.toContain('chat=');
        expect(ctx.output()).not.toContain('capabilities=');
        expect(ctx.output()).not.toContain('BYOK operational health');
    });

    it('filtra health operacional BYOK por provider/model/profile', async () => {
        readByokProviderHealthState.mockReturnValue({
            enabled: true,
            path: 'data/copilot-terminal/byok-provider-health.json',
            loaded: true,
            records: 2,
            persistedRecords: 2,
            flushScheduled: false,
            flushInFlight: false,
            dirty: false,
            error: null,
        });
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'repo|openrouter|openai/gpt-oss-120b',
                routeProfile: 'repo_agent',
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                lastStatus: 'failed',
                failureCount: 1,
                successCount: 0,
                lastFailureAt: Date.now(),
                lastSuccessAt: null,
                lastMessage: 'rate limit',
                lastErrorContext: 'provider.rate_limit',
            },
            {
                key: 'tool|groq|openai/gpt-oss-120b',
                routeProfile: 'tool_agent',
                providerId: 'groq',
                providerModel: 'openai/gpt-oss-120b',
                lastStatus: 'ok',
                failureCount: 0,
                successCount: 1,
                lastFailureAt: null,
                lastSuccessAt: Date.now(),
                lastMessage: null,
                lastErrorContext: null,
            },
        ]);
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'health provider:openrouter model:openai/gpt-oss-120b profile:repo_agent');

        expect(ctx.output()).toContain('Filtro');
        expect(ctx.output()).toContain('provedor openrouter');
        expect(ctx.output()).toContain('Saúde operacional BYOK');
        expect(ctx.output()).toContain('1 registro');
        expect(ctx.output()).toContain('provedor openrouter');
        expect(ctx.output()).not.toContain('provider groq');
        expect(ctx.output()).not.toContain('providerId=');
    });

    it('limpa health operacional BYOK quando solicitado', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'health clear');

        expect(clearByokProviderModelHealth).toHaveBeenCalledWith({});
        expect(flushByokProviderHealth).toHaveBeenCalledOnce();
        expect(ctx.output()).toContain('Saúde BYOK');
        expect(ctx.output()).toContain('limpa no processo atual e no arquivo persistente');
        expect(ctx.output()).not.toContain('operational health');
    });

    it('limpa health operacional BYOK por escopo quando solicitado', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'health clear provider:openrouter model:openai/gpt-oss-120b profile:repo_agent');

        expect(clearByokProviderModelHealth).toHaveBeenCalledWith({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            routeProfile: 'repo_agent',
        });
        expect(flushByokProviderHealth).toHaveBeenCalledOnce();
        expect(ctx.output()).toContain('provedor openrouter');
        expect(ctx.output()).toContain('modelo openai/gpt-oss-120b');
        expect(ctx.output()).toContain('perfil repo_agent');
        expect(ctx.output()).toContain('Saúde BYOK');
        expect(ctx.output()).toContain('limpa para provedor openrouter');
        expect(ctx.output()).not.toContain('operational health');
    });

    it('ativa perfil no processo atual', async () => {
        process.env['COPILOT_BYOK_MODEL'] = 'stale-model';
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = 'stale-provider';
        process.env['COPILOT_BYOK_BASE_URL'] = 'https://stale.example/v1';
        mockProjection({
            profiles: [
                {
                    name: 'kilo',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'anthropic/claude-sonnet-4.5',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'use kilo');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBe('kilo');
        expect(process.env['COPILOT_BYOK_MODEL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBeUndefined();
        expect(ctx.output()).toContain('BYOK status');
    });

    it('desativa BYOK e volta para SDK', async () => {
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        process.env['COPILOT_BYOK_PROFILE'] = 'kilo';
        process.env['COPILOT_BYOK_MODEL'] = 'stale-model';
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = 'stale-provider';
        process.env['COPILOT_BYOK_BASE_URL'] = 'https://stale.example/v1';
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'use sdk');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('false');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_MODEL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBeUndefined();
        expect(ctx.output()).toContain('SDK Copilot');
    });

    it('muda modelo BYOK no processo atual', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'model anthropic/claude-sonnet-4.5');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_MODEL']).toBe('anthropic/claude-sonnet-4.5');
        expect(setTerminalModelProjection).not.toHaveBeenCalled();
    });

    it('troca modelo na sessão viva quando o provider BYOK bound é o mesmo', async () => {
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
            },
        });
        listTerminalSdkSessionInventory.mockResolvedValue({
            currentSessionId: 'sdk-kilo',
            lastSessionId: 'sdk-kilo',
            foregroundSessionId: 'sdk-kilo',
            persistedByokBinding: {
                enabled: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
            },
            lastBootDecision: null,
            sessions: [],
        });
        setTerminalModelProjection.mockReturnValueOnce({
            previousModel: 'kilo-auto/free',
            previousReasoningEffort: 'high',
            currentModel: 'anthropic/claude-sonnet-4.5',
            currentReasoningEffort: 'high',
            reasoningAdjusted: false,
            modelMeta: null,
            binding: { hubSessionId: null, sdkSessionId: 'sdk-kilo' },
            runtimeId: 'default',
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'model anthropic/claude-sonnet-4.5');

        expect(setTerminalModelProjection).toHaveBeenCalledWith('anthropic/claude-sonnet-4.5');
        expect(ctx.output()).toContain('Modelo vivo');
        expect(ctx.output()).toContain('solicitado kilo-auto/free → anthropic/claude-sonnet-4.5');
        expect(ctx.output()).toContain('Confirmação');
        expect(ctx.output()).toContain('confirmação do SDK');
        expect(ctx.output()).toContain('BYOK modelo');
        expect(ctx.output()).not.toContain('BYOK status');
        expect(ctx.output()).not.toContain('Rotina');
        expect(ctx.output()).not.toContain('Avançado');
        expect(ctx.output()).not.toContain('/byok model <id> pede a troca');
        expect(readTerminalActivityHistory(5)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    label: 'Troca de modelo solicitada',
                    detail: expect.stringContaining('kilo-auto/free → anthropic/claude-sonnet-4.5'),
                    source: 'terminal.byok_model',
                }),
            ]),
        );
    });

    it('não atravessa provider com setModel quando o binding BYOK vivo diverge', async () => {
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
            },
        });
        listTerminalSdkSessionInventory.mockResolvedValue({
            currentSessionId: 'sdk-openrouter',
            lastSessionId: 'sdk-openrouter',
            foregroundSessionId: 'sdk-openrouter',
            persistedByokBinding: {
                enabled: true,
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'openrouter/free',
            },
            lastBootDecision: null,
            sessions: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'model anthropic/claude-sonnet-4.5');

        expect(setTerminalModelProjection).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Troca modelo');
        expect(ctx.output()).toContain('seleção preparada cruza provedor ou perfil');
        expect(ctx.output()).toContain('sem criar nova sessão');
        expect(ctx.output()).not.toContain('bound ao mesmo provider');
        expect(ctx.output()).toContain('BYOK modelo');
        expect(ctx.output()).not.toContain('BYOK status');
        expect(ctx.output()).not.toContain('Rotina');
        expect(readTerminalActivityHistory(5)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    label: 'Troca de modelo adiada',
                    detail: expect.stringContaining('anthropic/claude-sonnet-4.5'),
                    source: 'terminal.byok_model',
                    severity: 'warn',
                }),
            ]),
        );
    });

    it('lista modelos descobertos automaticamente pelo provider', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'remote-a',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 200000 },
                    },
                    byok: {
                        freeTier: true,
                        pricing: { prompt: 0, completion: 0, request: null },
                        provider: 'fixture',
                        inputModalities: ['text', 'image'],
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000, requestsPerMinute: 30 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.kilo.ai/api/gateway/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models');

        expect(ctx.output()).toContain('Fonte');
        expect(ctx.output()).toContain('provider');
        expect(ctx.output()).toContain('remote-a');
        expect(ctx.output()).toContain('free');
        expect(ctx.output()).toContain('provedor fixture');
        expect(ctx.output()).toContain('contexto 200000');
        expect(ctx.output()).toContain('max req 6000');
        expect(ctx.output()).toContain('TPM 6000');
        expect(ctx.output()).toContain('entrada text+image');
        expect(ctx.output()).not.toContain('in=text+image');
    });

    it('roteia modelos por perfil usando catálogo normalizado antes das probes runtime', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'kilo-auto/free',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: true },
                        limits: { max_context_window_tokens: 200000 },
                    },
                    byok: {
                        freeTier: true,
                        pricing: { prompt: 0, completion: 0, request: null },
                        provider: 'kilo',
                        profile: 'kilo-free',
                        source: 'remote',
                        inputModalities: ['text', 'image'],
                        rateLimits: { maxRequestTokens: 64000, tokensPerMinute: 120000 },
                    },
                },
                {
                    id: 'tiny-chat-only',
                    capabilities: {
                        supports: { reasoningEffort: false, vision: false },
                        limits: { max_context_window_tokens: 4000 },
                    },
                    byok: {
                        freeTier: true,
                        provider: 'small',
                        profile: 'small-free',
                        capabilities: { tools: false },
                        source: 'remote',
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        routeGatewayModels.mockImplementation((candidates) => ({
            profile: { id: 'repo_agent' },
            selected: {
                model: candidates[0],
                include: true,
                score: 275,
                reasons: ['preferred:large_context', 'confidence:catalog'],
                rejectedReasons: [],
                health: null,
            },
            candidates: [
                {
                    model: candidates[0],
                    include: true,
                    score: 275,
                    reasons: ['preferred:large_context', 'confidence:catalog'],
                    rejectedReasons: [],
                    health: null,
                },
            ],
            rejected: [
                {
                    model: candidates[1],
                    include: false,
                    score: 0,
                    reasons: [],
                    rejectedReasons: ['missing_capability:tools', 'context_too_small:4000<64000'],
                    health: null,
                },
            ],
            fallbackChain: ['kilo:kilo-auto/free'],
        }));
        mockProjection({
            profiles: [
                {
                    name: 'kilo-free',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'kilo-auto/free',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
            summary: { enabled: true, ready: true, profile: 'kilo-free' },
        });
        readTerminalByokGatewayProjectionFromEnv.mockReturnValue({
            gatewayModels: [
                {
                    id: 'kilo-auto/free',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: true },
                        limits: { max_context_window_tokens: 200000 },
                    },
                    byok: {
                        freeTier: true,
                        pricing: { prompt: 0, completion: 0, request: null },
                        provider: 'kilo',
                        profile: 'kilo-free',
                        source: 'model-gateway',
                        inputModalities: ['text', 'image'],
                        rateLimits: { maxRequestTokens: 64000, tokensPerMinute: 120000 },
                    },
                },
                {
                    id: 'tiny-chat-only',
                    capabilities: { supports: { reasoningEffort: false, vision: false }, limits: { max_context_window_tokens: 4000 } },
                    byok: {
                        freeTier: true,
                        provider: 'small',
                        profile: 'small-free',
                        capabilities: { tools: false },
                        source: 'model-gateway',
                    },
                },
            ],
            modelGateway: { providers: [], models: [] },
            modelGatewayProjection: { providers: [], models: [] },
        });
        const ctx = mockCtx();
        const eventBus = { emit: vi.fn() };

        await cmdByok({ println: ctx.println, eventBus }, 'models route repo_agent --show-rejected');

        expect(routeGatewayModels).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    providerId: 'kilo',
                    providerModel: 'kilo-auto/free',
                    capabilities: expect.objectContaining({ tools: true, vision: true, reasoningEffort: true }),
                    limits: expect.objectContaining({ contextWindowTokens: 200000, maxRequestTokens: 64000 }),
                    verification: expect.objectContaining({ confidence: 'catalog' }),
                }),
                expect.objectContaining({
                    providerId: 'small',
                    capabilities: expect.objectContaining({ tools: false }),
                }),
            ],
            'repo_agent',
            expect.objectContaining({ routeProfile: 'kilo-free', excludeFailed: true, requireAgentProbeOk: false }),
        );
        expect(ctx.output()).toContain('BYOK rota de modelo');
        expect(ctx.output()).toContain('Decisão');
        expect(ctx.output()).toContain('route-test');
        expect(ctx.output()).toContain('modo pré-sonda');
        expect(ctx.output()).toContain('Selecionado');
        expect(ctx.output()).toContain('kilo-auto/free');
        expect(ctx.output()).toContain('Cadeia de alternativas');
        expect(ctx.output()).toContain('capacidade ausente: tools');
        expect(ctx.output()).not.toContain('missing_capability:tools');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(buildRouteDecisionEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                taskProfile: 'repo_agent',
                routeProfile: 'kilo-free',
                mode: 'pre-probe',
                source: 'terminal.models.route',
                failure: null,
            }),
        );
        expect(recordModelGatewayRouteDecision).toHaveBeenCalledWith(expect.objectContaining({ type: 'model_gateway:route:decision' }));
        expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'model_gateway:route:decision', decisionId: 'route-test' }));
    });

    it('trata provider:ollama como opt-in explícito e explica bloqueio local padrão', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'gemma3:4b',
                    capabilities: {
                        supports: { reasoningEffort: false, vision: false },
                        limits: { max_context_window_tokens: 8192 },
                    },
                    byok: {
                        provider: 'ollama-local',
                        providerModel: 'gemma3:4b',
                        profile: 'ollama',
                        capabilities: { tools: true, streaming: true },
                        source: 'model-gateway',
                    },
                },
            ],
            source: 'remote',
            endpoint: 'http://localhost:11434/api/tags',
            fromCache: false,
            error: null,
        });
        routeGatewayModels.mockImplementation((candidates) => ({
            profile: { id: 'repo_agent' },
            selected: null,
            candidates: [],
            rejected: [
                {
                    model: candidates[0],
                    include: false,
                    score: 0,
                    reasons: [],
                    rejectedReasons: ['local_provider_requires_explicit_request'],
                    health: null,
                },
            ],
            fallbackChain: [],
        }));
        mockProjection({
            profiles: [
                {
                    name: 'ollama',
                    preset: 'ollama-local',
                    providerType: 'openai',
                    baseUrl: 'http://localhost:11434/v1',
                    model: 'gemma3:4b',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
            summary: { enabled: true, ready: true, profile: 'remote-default' },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models route repo_agent provider:ollama --show-rejected');

        expect(routeGatewayModels).toHaveBeenCalledWith(
            expect.any(Array),
            'repo_agent',
            expect.objectContaining({ allowProviders: ['ollama'] }),
        );
        expect(ctx.output()).toContain('Ollama/local foi bloqueado por padrão');
        expect(ctx.output()).toMatch(/\/byok\s+models\s+route\s+repo_agent\s+provider:ollama/u);
        expect(ctx.output()).toContain('provedor local exige pedido explícito');
        expect(ctx.output()).not.toContain('local_provider_requires_explicit_request');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('roteia modelos descobertos pelo provider ativo usando o preset operacional em vez de owned_by', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'openai/gpt-oss-120b',
                    name: 'GPT OSS 120B',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 128000 },
                    },
                    byok: {
                        provider: 'openai',
                        providerModel: 'openai/gpt-oss-120b',
                        source: 'remote',
                        capabilities: { tools: true, streaming: true },
                    },
                },
            ],
            source: 'remote-cache',
            endpoint: 'https://integrate.api.nvidia.com/v1/models',
            fromCache: true,
            error: null,
        });
        routeGatewayModels.mockImplementation((candidates) => ({
            profile: { id: 'code' },
            selected: {
                model: candidates[0],
                include: true,
                score: 240,
                reasons: ['active_provider_preset'],
                rejectedReasons: [],
                health: null,
            },
            candidates: [
                {
                    model: candidates[0],
                    include: true,
                    score: 240,
                    reasons: ['active_provider_preset'],
                    rejectedReasons: [],
                    health: null,
                },
            ],
            rejected: [],
            fallbackChain: ['nvidia-nim:openai/gpt-oss-120b'],
        }));
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: null,
                preset: 'nvidia-nim',
                providerType: 'openai',
                baseUrl: 'https://integrate.api.nvidia.com/v1',
                model: 'openai/gpt-oss-120b',
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models route code active --show-rejected provider:nvidia-nim');

        expect(routeGatewayModels).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    providerId: 'nvidia-nim',
                    providerModel: 'openai/gpt-oss-120b',
                }),
            ],
            'code',
            expect.objectContaining({ allowProviders: ['nvidia-nim'] }),
        );
        expect(ctx.output()).toContain('Selecionado');
        expect(ctx.output()).toContain('provedor nvidia-nim');
        expect(ctx.output()).not.toContain('Nenhum candidato encontrado para roteamento');
    });

    it('mantem o modelo ativo como candidato quando active/current e o endpoint remoto o omite', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'glm-4.5',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 128000 },
                    },
                    byok: {
                        provider: 'zai',
                        providerModel: 'glm-4.5',
                        source: 'remote',
                        capabilities: { tools: true, streaming: true },
                    },
                },
            ],
            source: 'remote-cache',
            endpoint: 'https://api.z.ai/api/paas/v4/models',
            fromCache: true,
            error: null,
        });
        routeGatewayModels.mockImplementation((candidates) => {
            const selectedModel = candidates.find((candidate) => candidate.providerModel === 'glm-4.5-flash') ?? candidates[0];
            return {
                profile: { id: 'code' },
                selected: {
                    model: selectedModel,
                    include: true,
                    score: 260,
                    reasons: ['active_runtime_model'],
                    rejectedReasons: [],
                    health: null,
                },
                candidates: [
                    {
                        model: selectedModel,
                        include: true,
                        score: 260,
                        reasons: ['active_runtime_model'],
                        rejectedReasons: [],
                        health: null,
                    },
                ],
                rejected: [],
                fallbackChain: ['zai:glm-4.5-flash', 'zai:glm-4.5'],
            };
        });
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: null,
                preset: 'zai',
                providerType: 'openai',
                baseUrl: 'https://api.z.ai/api/paas/v4',
                model: 'glm-4.5-flash',
                capabilities: { reasoningEffort: true, vision: true, contextWindowTokens: 128000 },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models route code active --show-rejected provider:zai');

        expect(routeGatewayModels).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    providerId: 'zai',
                    providerModel: 'glm-4.5-flash',
                    verification: expect.objectContaining({ confidence: 'runtime' }),
                }),
            ]),
            'code',
            expect.objectContaining({ allowProviders: ['zai'] }),
        );
        expect(ctx.output()).toContain('Selecionado');
        expect(ctx.output()).toContain('glm-4.5-flash');
    });

    it('usa catálogo gateway como fallback para provider explícito sem perfil correspondente', async () => {
        routeGatewayModels.mockImplementation((candidates) => ({
            profile: { id: 'repo_agent' },
            selected: {
                model: candidates[0],
                include: true,
                score: 120,
                reasons: ['provider_allowed'],
                rejectedReasons: [],
                health: null,
            },
            candidates: [
                {
                    model: candidates[0],
                    include: true,
                    score: 120,
                    reasons: ['provider_allowed'],
                    rejectedReasons: [],
                    health: null,
                },
            ],
            rejected: [],
            fallbackChain: ['ollama-local:gemma3:4b'],
        }));
        mockProjection({
            profiles: [
                {
                    name: 'remote-default',
                    preset: 'openrouter',
                    providerType: 'openai',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'openai/gpt-4.1-mini',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
            gatewayModels: [
                {
                    id: 'gemma3:4b',
                    capabilities: {
                        supports: { reasoningEffort: false, vision: false },
                        limits: { max_context_window_tokens: 8192 },
                    },
                    byok: {
                        provider: 'ollama-local',
                        providerModel: 'gemma3:4b',
                        profile: 'ollama',
                        capabilities: { local: true, privacy: true, no_remote_secrets: true, tools: true, streaming: true },
                        source: 'model-gateway',
                    },
                },
            ],
            summary: { enabled: true, ready: true, profile: 'remote-default' },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models route repo_agent provider:ollama');

        expect(routeGatewayModels).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    providerId: 'ollama-local',
                    providerModel: 'gemma3:4b',
                    capabilities: expect.objectContaining({ local: true, privacy: true, no_remote_secrets: true }),
                }),
            ],
            'repo_agent',
            expect.objectContaining({ allowProviders: ['ollama'] }),
        );
        expect(ctx.output()).toContain('fonte model gateway static=1');
        expect(ctx.output()).toContain('Selecionado');
        expect(ctx.output()).toContain('ollama-local');
    });

    it('trata active/current como opt-in local quando a projeção ativa é Ollama', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'gemma3:4b',
                    capabilities: {
                        supports: { reasoningEffort: false, vision: false },
                        limits: { max_context_window_tokens: 8192 },
                    },
                    byok: {
                        provider: 'ollama-local',
                        providerModel: 'gemma3:4b',
                        capabilities: { local: true, privacy: true, no_remote_secrets: true, tools: true, streaming: true },
                        source: 'remote',
                    },
                },
            ],
            source: 'remote',
            endpoint: 'http://localhost:11434/api/tags',
            fromCache: false,
            error: null,
        });
        routeGatewayModels.mockImplementation((candidates) => ({
            profile: { id: 'repo_agent' },
            selected: {
                model: candidates[0],
                include: true,
                score: 120,
                reasons: ['active_local_profile'],
                rejectedReasons: [],
                health: null,
            },
            candidates: [
                {
                    model: candidates[0],
                    include: true,
                    score: 120,
                    reasons: ['active_local_profile'],
                    rejectedReasons: [],
                    health: null,
                },
            ],
            rejected: [],
            fallbackChain: ['ollama-local:gemma3:4b'],
        }));
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'ollama',
                preset: 'ollama-local',
                providerType: 'openai',
                baseUrl: 'http://localhost:11434/v1',
                model: 'gemma3:4b',
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models route repo_agent active');

        expect(routeGatewayModels).toHaveBeenCalledWith(
            expect.any(Array),
            'repo_agent',
            expect.objectContaining({ allowLocalProviders: true }),
        );
        expect(ctx.output()).toContain('Selecionado');
        expect(ctx.output()).toContain('ollama-local');
    });

    it('usa a projection do model gateway quando a descoberta remota cai para catálogo estático', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'legacy-static',
                    capabilities: { supports: { reasoningEffort: false, vision: false }, limits: { max_context_window_tokens: 8000 } },
                    byok: { provider: 'legacy' },
                },
            ],
            source: 'static-fallback',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: 'HTTP 401',
        });
        mockProjection({
            gatewayModels: [
                {
                    id: 'gateway-model',
                    capabilities: { supports: { reasoningEffort: true, vision: true }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        gatewayId: 'openrouter:gateway-model',
                        provider: 'openrouter',
                        providerModel: 'gateway-model',
                        source: 'env_compat',
                        supportsReasoning: true,
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models reasoning vision 5');

        expect(ctx.output()).toContain('Fonte');
        expect(ctx.output()).toContain('model-gateway/static-fallback');
        expect(ctx.output()).toContain('gateway-model');
        expect(ctx.output()).toContain('provedor openrouter');
        expect(ctx.output()).toContain('max req 64000');
        expect(ctx.output()).not.toContain('legacy-static');
    });

    it('ranqueia modelos BYOK free e capazes antes de modelos pagos ou desconhecidos', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'paid-small',
                    capabilities: { supports: { reasoningEffort: false, vision: false }, limits: { max_context_window_tokens: 8000 } },
                    byok: { freeTier: false, pricing: { prompt: 0.1, completion: 0.2, request: null } },
                },
                {
                    id: 'free-reasoning',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: true, pricing: { prompt: 0, completion: 0, request: null } },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models');

        expect(ctx.output().indexOf('free-reasoning')).toBeLessThan(ctx.output().indexOf('paid-small'));
        expect(ctx.output()).toContain('Ordenação');
        expect(ctx.output()).toContain('free/capability/context');
    });

    it('limita a página padrão de modelos BYOK e permite ampliar por número', async () => {
        const discoverModels = discoverConfiguredByokModelsFromEnv;
        const models = Array.from({ length: 30 }, (_, index) => ({
            id: `remote-${index + 1}`,
            capabilities: {
                supports: { reasoningEffort: true, vision: false },
                limits: { max_context_window_tokens: 200000 },
            },
        }));
        discoverModels.mockResolvedValue({
            models,
            source: 'remote',
            endpoint: 'https://api.kilo.ai/api/gateway/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const defaultCtx = mockCtx();

        await cmdByok({ println: defaultCtx.println }, 'models refresh');

        expect(defaultCtx.output()).toContain('remote-24');
        expect(defaultCtx.output()).not.toContain('remote-25');
        expect(defaultCtx.output()).toContain('Exibindo');
        expect(defaultCtx.output()).toContain('24/30');

        const expandedCtx = mockCtx();
        await cmdByok({ println: expandedCtx.println }, 'models refresh 26');

        expect(expandedCtx.output()).toContain('remote-26');
        expect(expandedCtx.output()).not.toContain('remote-27');
        expect(expandedCtx.output()).toContain('Exibindo');
        expect(expandedCtx.output()).toContain('26/30');
    });

    it('filtra catálogo BYOK por provider, gratuidade, capacidade e limite', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'openrouter/free-reasoning',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'openrouter/free-low',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 4000 },
                    },
                },
                {
                    id: 'groq/free-reasoning',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        provider: 'groq',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'openrouter/paid-vision',
                    capabilities: { supports: { reasoningEffort: true, vision: true }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: false, provider: 'openrouter' },
                },
            ],
            source: 'remote',
            endpoint: 'https://openrouter.ai/api/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models provider:openrouter free reasoning safe 10');

        expect(ctx.output()).toContain('filtros provedor:openrouter,gratuito,raciocínio,modo seguro');
        expect(ctx.output()).toContain('openrouter/free-reasoning');
        expect(ctx.output()).not.toContain('openrouter/free-low');
        expect(ctx.output()).not.toContain('groq/free-reasoning');
        expect(ctx.output()).not.toContain('openrouter/paid-vision');
    });

    it('consulta modelos em todos os perfis BYOK sem trocar o provider ativo', async () => {
        discoverConfiguredByokModelsFromEnv.mockImplementation(async (env) => {
            const profile = env?.COPILOT_BYOK_PROFILE;
            return {
                models: [
                    {
                        id: profile === 'groq-free' ? 'groq/free-reasoning' : 'openrouter/free-reasoning',
                        capabilities: {
                            supports: { reasoningEffort: true, vision: profile !== 'groq-free' },
                            limits: { max_context_window_tokens: profile === 'groq-free' ? 131072 : 200000 },
                        },
                        byok: {
                            freeTier: true,
                            provider: profile === 'groq-free' ? 'groq' : 'openrouter',
                            rateLimits: { maxRequestTokens: profile === 'groq-free' ? 32000 : 64000 },
                        },
                    },
                ],
                source: 'remote',
                endpoint: `https://${profile}.example/v1/models`,
                fromCache: false,
                error: null,
            };
        });
        mockProjection({
            profiles: [
                {
                    name: 'openrouter-free',
                    preset: 'openrouter',
                    providerType: 'openai',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'openrouter/default',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'groq/default',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
            summary: { enabled: true, ready: true, profile: 'openrouter-free' },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models all-providers free reasoning safe 10');

        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledTimes(2);
        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledWith(
            expect.objectContaining({ COPILOT_BYOK_PROFILE: 'openrouter-free', COPILOT_BYOK_ENABLED: 'true' }),
            expect.objectContaining({ forceRefresh: false }),
        );
        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledWith(
            expect.objectContaining({ COPILOT_BYOK_PROFILE: 'groq-free', COPILOT_BYOK_ENABLED: 'true' }),
            expect.objectContaining({ forceRefresh: false }),
        );
        expect(ctx.output()).toContain('filtros todos os perfis,gratuito,raciocínio,modo seguro');
        expect(ctx.output()).toContain('perfis 2');
        expect(ctx.output()).toContain('openrouter/free-reasoning');
        expect(ctx.output()).toContain('groq/free-reasoning');
        expect(ctx.output()).toContain('perfil openrouter-free');
        expect(ctx.output()).toContain('perfil groq-free');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
    });

    it('agrupa modelos repetidos entre providers preservando variantes operacionais', async () => {
        discoverConfiguredByokModelsFromEnv.mockImplementation(async (env) => {
            const profile = env?.COPILOT_BYOK_PROFILE;
            return {
                models: [
                    {
                        id: 'shared/free-model',
                        capabilities: {
                            supports: { reasoningEffort: true, vision: false },
                            limits: { max_context_window_tokens: 128000 },
                        },
                        byok: {
                            freeTier: true,
                            provider: profile === 'groq-free' ? 'groq' : 'openrouter',
                            rateLimits: { maxRequestTokens: 64000 },
                        },
                    },
                ],
                source: 'remote',
                endpoint: `https://${profile}.example/v1/models`,
                fromCache: false,
                error: null,
            };
        });
        mockProjection({
            profiles: [
                {
                    name: 'openrouter-free',
                    preset: 'openrouter',
                    providerType: 'openai',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'shared/free-model',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'shared/free-model',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models all-providers grouped free reasoning safe 10');

        expect(ctx.output()).toContain('1 grupos/2');
        expect(ctx.output()).toContain('shared/free-model');
        expect(ctx.output()).toContain('variantes openrouter-free/openrouter | groq-free/groq');
        expect(ctx.output()).not.toContain('variants=');
    });

    it('recomenda em todos os perfis filtrando o provider antes da descoberta', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'groq/free-reasoning',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: { freeTier: true, provider: 'groq', rateLimits: { maxRequestTokens: 64000 } },
                },
            ],
            source: 'remote-cache',
            endpoint: 'https://api.groq.com/openai/v1/models',
            fromCache: true,
            error: null,
        });
        mockProjection({
            profiles: [
                {
                    name: 'openrouter-free',
                    preset: 'openrouter',
                    providerType: 'openai',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'openrouter/default',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'groq/default',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend all-providers provider:groq free reasoning safe 5');

        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledTimes(1);
        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledWith(
            expect.objectContaining({ COPILOT_BYOK_PROFILE: 'groq-free' }),
            expect.any(Object),
        );
        expect(ctx.output()).toContain('Filtros');
        expect(ctx.output()).toContain('todos os perfis,provedor:groq,gratuito,raciocínio,modo seguro');
        expect(ctx.output()).toContain('groq/free-reasoning');
        expect(ctx.output()).not.toContain('openrouter');
        expect(ctx.output()).toContain('/byok probe agent profile:groq-free model:groq/free-reasoning');
        expect(ctx.output()).toContain('/byok use groq-free -> /byok model groq/free-reasoning');
    });

    it('trata plano gratuito declarado no perfil como gratuito pelo perfil sem mascarar custo por modelo desconhecido', async () => {
        readConfiguredByokProfilesFromEnv.mockReturnValue({
            'groq-free': {
                preset: 'groq',
                metadata: {
                    freeLimit: '6k TPM observed on current plan',
                },
            },
        });
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'qwen/qwen3-32b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: null,
                        provider: 'groq',
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.groq.com/openai/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection({
            profiles: [
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'qwen/qwen3-32b',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: ['freeLimit'],
                },
            ],
            summary: { enabled: true, ready: true, profile: 'groq-free', preset: 'groq', providerType: 'openai' },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models all-providers provider:groq free reasoning 5');

        expect(ctx.output()).toContain('qwen/qwen3-32b');
        expect(ctx.output()).toContain('gratuito pelo perfil');
        expect(ctx.output()).toContain('hint gratuito 6k TPM observed on current plan');
        expect(ctx.output()).not.toContain('Nenhum modelo BYOK encontrado');
    });

    it('avisa quando o modelo configurado sumiu do catálogo remoto autoritativo', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'provider/current-model',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 128000 },
                    },
                    byok: { freeTier: true, provider: 'chutes', rateLimits: { maxRequestTokens: 64000 } },
                },
            ],
            source: 'remote',
            endpoint: 'https://llm.chutes.ai/v1/models',
            fromCache: false,
            error: null,
            configuredModel: {
                id: 'provider/stale-model',
                inCatalog: false,
                authoritative: true,
            },
        });
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'chutes-ai',
                preset: 'chutes',
                providerType: 'openai',
                model: 'provider/stale-model',
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models refresh');

        expect(ctx.output()).toMatch(/modelo configurado 'provider\/stale-model' não apareceu no catálogo remoto\s+atual/u);
        expect(ctx.output()).toContain('/byok probe agent profile:chutes-ai model:<id>');
        expect(ctx.output()).toContain('provider/current-model');
    });

    it('explica quando o filtro safe remove modelos BYOK existentes por limites baixos', async () => {
        readConfiguredByokProfilesFromEnv.mockReturnValue({
            'groq-free': {
                metadata: { freeLimit: '6k TPM observed on current plan' },
            },
        });
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'qwen/qwen3-32b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: null,
                        provider: 'groq',
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.groq.com/openai/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection({
            profiles: [
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'qwen/qwen3-32b',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: ['freeLimit'],
                },
            ],
            summary: { enabled: true, ready: true, profile: 'groq-free', preset: 'groq', providerType: 'openai' },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models all-providers provider:groq free reasoning safe 5');

        expect(ctx.output()).toContain('Modelos');
        expect(ctx.output()).toContain('nenhum encontrado para os filtros atuais');
        expect(ctx.output()).toContain('O filtro safe removeu 1 candidato');
        expect(ctx.output()).toContain('qwen/qwen3-32b');
        expect(ctx.output()).toContain('baixo para turno real');
    });

    it('recomenda modelos BYOK com filtros e alerta limites baixos', async () => {
        const now = Date.now();
        readByokProviderModelHealth.mockImplementation((input) => {
            const model = input.providerModel ?? input.model;
            return model === 'free-comfortable'
                ? {
                      key: 'openrouter|openrouter|free-comfortable',
                      routeProfile: null,
                      providerId: 'openrouter',
                      providerModel: model,
                      profile: null,
                      provider: 'openrouter',
                      model,
                      lastStatus: 'ok',
                      failureCount: 0,
                      successCount: 1,
                      lastFailureAt: null,
                      lastSuccessAt: now,
                      lastMessage: null,
                      lastErrorContext: null,
                      agentProbeStatus: 'ok',
                      agentProbeFailureCount: 0,
                      agentProbeSuccessCount: 1,
                      lastAgentProbeFailureAt: null,
                      lastAgentProbeSuccessAt: now,
                  }
                : null;
        });
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'free-low-limit',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000 },
                        provider: 'groq',
                    },
                },
                {
                    id: 'free-comfortable',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        rateLimits: { maxRequestTokens: 64000, tokensPerMinute: 64000 },
                        provider: 'openrouter',
                    },
                },
                {
                    id: 'paid-vision',
                    capabilities: { supports: { reasoningEffort: true, vision: true }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: false, provider: 'paid' },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning safe 2');

        expect(ctx.output()).toContain('BYOK recomendação');
        expect(ctx.output()).toContain('free-comfortable');
        expect(ctx.output()).not.toContain('free-low-limit');
        expect(ctx.output()).not.toContain('paid-vision');
        expect(ctx.output()).toContain('ok para uso geral');
        expect(ctx.output()).toContain('/byok probe agent model:free-comfortable');
        expect(ctx.output()).toContain('Probe agent');
        expect(ctx.output()).toContain('live descartável do terminal');
    });

    it('na recomendacao safe exige probe agente positivo antes de promover modelo ao operador', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'openrouter/unverified',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        rateLimits: { maxRequestTokens: 128000 },
                        provider: 'openrouter',
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning safe 2');

        expect(ctx.output()).toContain('sem probe agente positivo');
        expect(ctx.output()).toContain('/byok probe agent model:openrouter/unverified');
        expect(ctx.output()).toContain('use /byok models para explorar catálogo bruto');
    });

    it('distingue health de chat vindo de probe e de turno vivo no ranking BYOK', async () => {
        readByokProviderModelHealth.mockImplementation((input) => {
            const model = input.providerModel ?? input.model;
            return model === 'probe-ok'
                ? {
                      key: 'kilo|kilo-code|probe-ok',
                      routeProfile: 'kilo',
                      providerId: 'kilo-code',
                      providerModel: model,
                      profile: 'kilo',
                      provider: 'kilo-code',
                      model,
                      lastStatus: 'ok',
                      failureCount: 0,
                      successCount: 1,
                      lastFailureAt: null,
                      lastSuccessAt: Date.now(),
                      lastMessage: null,
                      lastErrorContext: null,
                      lastSuccessContext: 'byok_probe',
                      agentProbeStatus: null,
                      agentProbeFailureCount: 0,
                      agentProbeSuccessCount: 0,
                      lastAgentProbeFailureAt: null,
                      lastAgentProbeSuccessAt: null,
                      lastAgentProbeMessage: null,
                      lastAgentProbeErrorContext: null,
                  }
                : model === 'turn-ok'
	                  ? {
	                        key: 'kilo|kilo-code|turn-ok',
                            routeProfile: 'kilo',
                            providerId: 'kilo-code',
                            providerModel: model,
	                        profile: 'kilo',
	                        provider: 'kilo-code',
                        model,
                        lastStatus: 'ok',
                        failureCount: 0,
                        successCount: 1,
                        lastFailureAt: null,
                        lastSuccessAt: Date.now(),
                        lastMessage: null,
                        lastErrorContext: null,
                        lastSuccessContext: 'llm.usage',
                        agentProbeStatus: null,
                        agentProbeFailureCount: 0,
                        agentProbeSuccessCount: 0,
                        lastAgentProbeFailureAt: null,
                        lastAgentProbeSuccessAt: null,
                        lastAgentProbeMessage: null,
                        lastAgentProbeErrorContext: null,
                    }
	                  : null;
        });
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'probe-ok',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 200000 },
                    },
                    byok: { freeTier: true, provider: 'kilo-code', profile: 'kilo' },
                },
                {
                    id: 'turn-ok',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 200000 },
                    },
                    byok: { freeTier: true, provider: 'kilo-code', profile: 'kilo' },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning 2');

        expect(ctx.output()).toContain('chat ok (probe');
        expect(ctx.output()).toContain('chat ok (turno');
    });

    it('exclui de recommend safe modelo com falha operacional recente', async () => {
        const now = Date.now();
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'cerebras-free|cerebras|gpt-oss-120b',
                routeProfile: 'cerebras-free',
                providerId: 'cerebras',
                providerModel: 'gpt-oss-120b',
                profile: 'cerebras-free',
                provider: 'cerebras',
                model: 'gpt-oss-120b',
                lastStatus: 'failed',
                failureCount: 3,
                successCount: 0,
                lastFailureAt: now,
                lastSuccessAt: null,
                lastMessage: 'Connection error',
                lastErrorContext: 'model_call',
            },
            {
                key: 'kilo|kilo-code|kilo/healthy',
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'kilo/healthy',
                profile: 'kilo',
                provider: 'kilo-code',
                model: 'kilo/healthy',
                lastStatus: 'ok',
                failureCount: 0,
                successCount: 1,
                lastFailureAt: null,
                lastSuccessAt: now,
                lastMessage: null,
                lastErrorContext: null,
                agentProbeStatus: 'ok',
                agentProbeFailureCount: 0,
                agentProbeSuccessCount: 1,
                lastAgentProbeFailureAt: null,
                lastAgentProbeSuccessAt: now,
            },
        ]);
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'gpt-oss-120b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        provider: 'cerebras',
                        profile: 'cerebras-free',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'kilo/healthy',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'kilo-code',
                        profile: 'kilo',
                        rateLimits: { maxRequestTokens: 128000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning safe 5');

        expect(ctx.output()).toContain('kilo/healthy');
        expect(ctx.output()).not.toContain('gpt-oss-120b');
    });

    it('mostra falha operacional em models quando safe não foi solicitado', async () => {
        const now = Date.now();
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'cerebras-free|cerebras|gpt-oss-120b',
                routeProfile: 'cerebras-free',
                providerId: 'cerebras',
                providerModel: 'gpt-oss-120b',
                profile: 'cerebras-free',
                provider: 'cerebras',
                model: 'gpt-oss-120b',
                lastStatus: 'failed',
                failureCount: 1,
                successCount: 0,
                lastFailureAt: now,
                lastSuccessAt: null,
                lastMessage: 'Connection error',
                lastErrorContext: 'model_call',
            },
        ]);
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'gpt-oss-120b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        provider: 'cerebras',
                        profile: 'cerebras-free',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.cerebras.ai/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models free reasoning 5');

        expect(ctx.output()).toContain('gpt-oss-120b');
        expect(ctx.output()).toContain('chat falhou');
    });

    it('recomenda modelos BYOK filtrando provider e modelos medidos', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'openrouter/free',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: true, provider: 'openrouter' },
                },
                {
                    id: 'openrouter/paid',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: false, provider: 'openrouter' },
                },
                {
                    id: 'groq/paid',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: false, provider: 'groq' },
                },
            ],
            source: 'remote',
            endpoint: 'https://openrouter.ai/api/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend provider:openrouter metered reasoning 5');

        expect(ctx.output()).toContain('Filtros');
        expect(ctx.output()).toContain('provedor:openrouter,pago/medido,raciocínio');
        expect(ctx.output()).toContain('openrouter/paid');
        expect(ctx.output()).not.toContain('openrouter/free');
        expect(ctx.output()).not.toContain('groq/paid');
    });

    it('recomenda modelos BYOK mostrando aviso quando o limite do provider é baixo', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'groq-small-budget',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000 },
                        provider: 'groq',
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.groq.com/openai/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning');

        expect(ctx.output()).toContain('groq-small-budget');
        expect(ctx.output()).toContain('baixo para turno real');
        expect(ctx.output()).toContain('sessão fresca');
    });

    it('recomenda modelos BYOK considerando o orçamento vivo da sessão atual', async () => {
        const now = Date.now();
        readByokProviderModelHealth.mockImplementation((input) => {
            const model = input.providerModel ?? input.model;
            return model === 'openrouter-roomy'
                ? {
                      key: 'openrouter|openrouter|openrouter-roomy',
                      routeProfile: null,
                      providerId: 'openrouter',
                      providerModel: model,
                      profile: null,
                      provider: 'openrouter',
                      model,
                      lastStatus: 'ok',
                      failureCount: 0,
                      successCount: 1,
                      lastFailureAt: null,
                      lastSuccessAt: now,
                      lastMessage: null,
                      lastErrorContext: null,
                      agentProbeStatus: 'ok',
                      agentProbeFailureCount: 0,
                      agentProbeSuccessCount: 1,
                      lastAgentProbeFailureAt: null,
                      lastAgentProbeSuccessAt: now,
                  }
                : null;
        });
        readTerminalRuntimeState.mockReturnValue({
            contextWindow: { tokens: 63000, tokenLimit: 200000, utilization: 0.315 },
        });
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'openrouter/almost-enough',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'openrouter-roomy',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 128000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://openrouter.ai/api/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning safe 5');

        expect(ctx.output()).toContain('Contexto');
        expect(ctx.output()).toContain('atual ≈63000/200000 tokens');
        expect(ctx.output()).toContain('estimativa pré-turno ≈64024 tokens');
        expect(ctx.output()).toContain('openrouter-roomy');
        expect(ctx.output()).not.toContain('openrouter/almost-enough');
        expect(ctx.output()).toContain('/byok probe agent model:openrouter-roomy');
    });

    it('recarrega .env.local sem imprimir segredos', async () => {
        process.env['COPILOT_BYOK_MODEL'] = 'stale-model';
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = 'stale-provider';
        process.env['COPILOT_BYOK_BASE_URL'] = 'https://stale.example/v1';
        loadDotenv.mockReturnValue({ parsed: { KILO_API_KEY: 'secret' } });
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'anthropic/claude-sonnet-4.5',
                auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'reload');

        expect(loadDotenv).toHaveBeenCalledWith({ path: '.env.local', override: true, quiet: true });
        expect(process.env['COPILOT_BYOK_MODEL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBeUndefined();
        expect(ctx.output()).toContain('.env.local recarregado');
        expect(ctx.output()).toContain('BYOK status');
        expect(ctx.output()).not.toContain('secret');
    });

    it('recarrega .env.local em modo statusless para handoff runtime sem imprimir cockpit legado', async () => {
        loadDotenv.mockReturnValue({ parsed: { KILO_API_KEY: 'secret' } });
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
                auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'reload --no-status');

        expect(loadDotenv).toHaveBeenCalledWith({ path: '.env.local', override: true, quiet: true });
        expect(ctx.output()).toContain('.env.local recarregado');
        expect(ctx.output()).toContain('Status');
        expect(ctx.output()).toContain('omitido por solicitação');
        expect(ctx.output()).not.toContain('BYOK status');
        expect(ctx.output()).not.toContain('secret');
    });

    it('troca provider efemero no processo atual', async () => {
        process.env['COPILOT_BYOK_PROFILE'] = 'kilo';
        mockProjection();
        const ctx = mockCtx();

        await cmdByok(
            { println: ctx.println },
            'provider kilo-code anthropic/claude-sonnet-4.5 https://api.kilo.ai/api/gateway wire:completions',
        );

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBe('kilo-code');
        expect(process.env['COPILOT_BYOK_MODEL']).toBe('anthropic/claude-sonnet-4.5');
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBe('https://api.kilo.ai/api/gateway');
        expect(process.env['COPILOT_BYOK_WIRE_API']).toBe('completions');
        expect(ctx.output()).toContain('BYOK status');
    });

    it('troca provider efemero limpando modelo e baseUrl antigos quando omitidos', async () => {
        process.env['COPILOT_BYOK_PROFILE'] = 'kilo';
        process.env['COPILOT_BYOK_MODEL'] = 'stale-model';
        process.env['COPILOT_BYOK_BASE_URL'] = 'https://stale.example/v1';
        process.env['COPILOT_BYOK_WIRE_API'] = 'responses';
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'provider openrouter');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBe('openrouter');
        expect(process.env['COPILOT_BYOK_MODEL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_WIRE_API']).toBeUndefined();
        expect(ctx.output()).toContain('BYOK status');
    });

    it('recusa wireApi invalido ao trocar provider efemero', async () => {
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = 'stale-provider';
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'provider openrouter openai/gpt-oss-120b https://openrouter.ai/api/v1 wire:bad');

        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBe('stale-provider');
        expect(process.env['COPILOT_BYOK_WIRE_API']).toBeUndefined();
        expect(ctx.output()).toContain('wireApi');
        expect(ctx.output()).toContain('inválido · use wire:completions ou wire:responses');
    });

    it('persiste perfil BYOK em .env.local sem gravar segredo novo', async () => {
        readFile.mockResolvedValue(
            [
                'COPILOT_BYOK_ENABLED=false',
                'COPILOT_BYOK_PROFILE=old',
                'COPILOT_BYOK_MODEL=old-model',
                'COPILOT_BYOK_PROVIDER_PRESET=old-provider',
                'KILO_CODE_API_KEY=existing-secret',
                '',
            ].join('\n'),
        );
        mockProjection({
            profiles: [
                {
                    name: 'kilo',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'kilo-auto/free',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'persist profile kilo');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBe('kilo');
        expect(writeFile).toHaveBeenCalledWith(
            '.env.local',
            expect.stringContaining('COPILOT_BYOK_PROFILE=kilo'),
            expect.objectContaining({ mode: 0o600 }),
        );
        const written = String(writeFile.mock.calls[0][1]);
        expect(written).toContain('COPILOT_BYOK_ENABLED=true');
        expect(written).not.toContain('COPILOT_BYOK_MODEL=old-model');
        expect(written).toContain('KILO_CODE_API_KEY=existing-secret');
        expect(rename).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Perfil BYOK persistido: kilo');
        expect(ctx.output()).not.toContain('existing-secret');
    });

    it('persiste volta ao SDK removendo seletores BYOK conflitantes', async () => {
        readFile.mockResolvedValue(
            [
                'COPILOT_BYOK_ENABLED=true',
                'COPILOT_BYOK_PROFILE=kilo',
                'COPILOT_BYOK_MODEL=kilo-auto/free',
                'COPILOT_BYOK_PROVIDER_PRESET=kilo-code',
                'COPILOT_BYOK_BASE_URL=https://api.kilo.ai/api/gateway',
                '',
            ].join('\n'),
        );
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'persist sdk');

        const written = String(writeFile.mock.calls[0][1]);
        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('false');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
        expect(written).toContain('COPILOT_BYOK_ENABLED=false');
        expect(written).not.toContain('COPILOT_BYOK_PROFILE=');
        expect(written).not.toContain('COPILOT_BYOK_MODEL=');
        expect(written).not.toContain('COPILOT_BYOK_PROVIDER_PRESET=');
        expect(ctx.output()).toContain('use /byok use sdk para aplicar o SDK Copilot na sessão atual');
    });
});
