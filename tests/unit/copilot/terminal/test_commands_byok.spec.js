// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass

import { afterEach, describe, expect, it, vi } from 'vitest';

const { buildCatalogRefreshEventBatch, buildCatalogRefreshStartedEvent, buildModelGatewayPreBuildReadinessReport, buildModelGatewayPreKCompatibilityReport, buildModelGatewayRouteCandidates, buildModelGatewayRuntimeSelectorPlan, buildModelGatewayRuntimeAutomationDecision, buildModelGatewayRuntimeAutomationControllerStep, DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH, explainModelGatewayRuntimeAutomationPolicySources, validateModelGatewayRuntimeAutomationPolicy, readModelGatewayRuntimeAutomationEffectivePolicy, readModelGatewayRuntimeAutomationPolicy, readModelGatewayRuntimeAutomationPolicyFile, writeModelGatewayRuntimeAutomationPolicyFile, buildModelGatewaySelectionDecisionTrace, buildProbeCompletedEvent, buildRouteDecisionEvent, auditCatalogImporterSet, auditModelGatewayCatalogSnapshotIntegrity, auditModelGatewayPostRuntimeSelection, auditModelGatewayPreRuntimeSelection, applyModelGatewayEligibilityToSnapshot, chmod, classifyByokProviderFailure, clearByokProviderModelHealth, compareModelGatewaySelectionAudits, createDefaultModelGatewayCatalogImporters, createEnvSecretRegistry, DEFAULT_MODEL_GATEWAY_CATALOG_PATH, DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR, deriveModelGatewayRuntimeAccountOverlaysFromHealth, discoverConfiguredByokModelsFromEnv, evaluateModelGatewayCatalogEligibility, evaluateModelGatewayProviderEnvRequirements, explainModelGatewayAccountLimitOverlays, explainModelGatewayCatalogEntry, explainModelGatewayProviderEntry, explainModelGatewayEligibilityDecision, explainModelGatewaySelectionComparison, flushAndMirrorByokProviderHealthToSqlite, flushByokProviderHealth, JsonModelGatewayCatalogStore, listByokProviderModelHealth, listModelGatewayCanonicalCommands, listProviderEndpointInventory, listProviderGatewayTraits, listProviderWireProbeMatrix, listTerminalSdkSessionInventory, loadDotenv, mirrorByokProviderHealthToSqlite, mirrorModelGatewayCatalogSnapshotToSqlite, MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON, persistModelGatewaySelectionDecisionTrace, planModelGatewayProbeBackoff, planModelGatewayCatalogRefresh, refreshModelGatewayCatalog, recommendCatalogDiffProbes, renderModelGatewayCanonicalCommandLines, renderModelGatewayLocalProviderOptInGuidance, resolveModelGatewaySelectionPolicy, resolveProviderEndpointInventory, resolveProviderGatewayTraits, routeGatewayModels, runConfiguredByokAgentProbe, runConfiguredByokChatProbe, runConfiguredByokJsonProbe, runConfiguredByokStreamingProbe, runConfiguredByokVisionProbe, searchModelGatewayCatalogEntries, readByokProviderHealthState, readByokProviderModelHealth, readConfiguredByokModelDiscoveryCacheFromEnv, readConfiguredByokProfilesFromEnv, readFile, readdir, readTerminalByokGatewayProjectionFromEnv, readTerminalByokProjection, readTerminalRuntimeState, recordByokProviderModelAgentProbeFailure, recordByokProviderModelAgentProbeSuccess, recordByokProviderModelCallFailure, recordByokProviderModelCallSuccess, recordByokProviderModelProbeResult, recordModelGatewayRouteDecision, rename, scheduleTerminalSdkSessionBootSelection, setTerminalModelProjection, SqliteModelGatewayCatalogStore, stat, summarizeCanonicalModelProjectionDiff, summarizeModelGatewayEligibilityDiff, summarizeModelGatewayAccountOverlays, summarizeModelGatewayLocalProviderOptInBlocks, summarizeModelGatewayProviderQuotaCapabilities, summarizeModelGatewayRuntimeAccountOverlays, summarizeModelGatewayProviderEnvRequirements, summarizeModelGatewayRefreshLogText, summarizeProviderWireProbeMatrix, toOpenAIModelCatalogList, writeFile } =
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
        readModelGatewayRuntimeAutomationPolicy: vi.fn(() => ({
            enabled: false,
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
            policy: { source: 'default' },
            profiles: { source: 'default' },
            allowLiveSetModel: { source: 'default' },
            allowNewSession: { source: 'default' },
            allowProviderProbes: { source: 'default' },
            allowLocalPrivate: { source: 'default' },
            accountWideFailureKinds: { source: 'default' },
        })),
        validateModelGatewayRuntimeAutomationPolicy: vi.fn(() => ({ ok: true, issues: [], allowedModes: ['prefer_runtime_proved'] })),
        readModelGatewayRuntimeAutomationEffectivePolicy: vi.fn(() =>
            Promise.resolve({
                enabled: false,
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
            { surface: 'package', phase: 'prebuild', command: 'npm run model-gateway:prebuild' },
            { surface: 'make', phase: 'prebuild', command: 'make model-gateway-prebuild' },
            { surface: 'terminal', phase: 'orientation', command: '/byok gateway commands' },
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
                            status: 'boot_scheduled',
                            targetModel: 'glm-4.5-flash',
                            selectedRouteKey: 'zai:glm-4.5-flash',
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
        rename: vi.fn(),
        setTerminalModelProjection: vi.fn(),
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
        writeFile: vi.fn(),
    }));

vi.mock('node:fs/promises', () => ({
    default: { readFile, writeFile, rename, chmod, readdir, stat },
    readFile,
    writeFile,
    rename,
    chmod,
    readdir,
    stat,
}));

vi.mock('dotenv', () => ({
    config: loadDotenv,
}));

vi.mock('#copilot/config', () => ({
    discoverConfiguredByokModelsFromEnv,
    readConfiguredByokModelDiscoveryCacheFromEnv,
    readConfiguredByokProfilesFromEnv,
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    listTerminalSdkSessionInventory,
    readTerminalByokGatewayProjectionFromEnv,
    readTerminalByokProjection,
    readTerminalRuntimeState,
    scheduleTerminalSdkSessionBootSelection,
    setTerminalModelProjection,
}));

vi.mock('#copilot/model-gateway', () => ({
    auditCatalogImporterSet,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    compareModelGatewaySelectionAudits,
    resolveModelGatewaySelectionPolicy,
    applyModelGatewayEligibilityToSnapshot,
    buildCatalogRefreshEventBatch,
    buildCatalogRefreshStartedEvent,
    buildModelGatewayPreBuildReadinessReport,
    buildModelGatewayPreKCompatibilityReport,
    buildModelGatewayRouteCandidates,
    buildModelGatewayRuntimeSelectorPlan,
    buildModelGatewayRuntimeAutomationDecision,
    buildModelGatewayRuntimeAutomationControllerStep,
    DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH,
    explainModelGatewayRuntimeAutomationPolicySources,
    validateModelGatewayRuntimeAutomationPolicy,
    readModelGatewayRuntimeAutomationEffectivePolicy,
    readModelGatewayRuntimeAutomationPolicy,
    readModelGatewayRuntimeAutomationPolicyFile,
    writeModelGatewayRuntimeAutomationPolicyFile,
    buildModelGatewaySelectionDecisionTrace,
    buildProbeCompletedEvent: buildProbeCompletedEvent,
    buildRouteDecisionEvent,
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
            { surface: 'package', phase: 'prebuild', command: 'npm run model-gateway:prebuild' },
            { surface: 'make', phase: 'prebuild', command: 'make model-gateway-prebuild' },
            { surface: 'terminal', phase: 'orientation', command: '/byok gateway commands' },
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
        expect(ctx.output()).toContain('.env.local');
        expect(ctx.output()).toContain('bearer=');
        expect(ctx.output()).toContain('prepared:');
        expect(ctx.output()).toContain('live binding:');
        expect(ctx.output()).toContain('/session sdk next new');
        expect(ctx.output()).toContain('/restart reinicia só o dialog loop');
        expect(ctx.output()).not.toContain('secret');
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

        expect(ctx.output()).toMatch(/vision=.*nao.*ctx=256000/su);
        expect(ctx.output()).toContain('source=provider-cache:model · overrides provider defaults');
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

        expect(ctx.output()).toContain('BYOK profile=ollama-cloud');
        expect(ctx.output()).toContain('BYOK profile=kilo');
        expect(ctx.output()).toContain('cruzam provider/perfil');
        expect(ctx.output()).toContain('/session sdk next new');
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

        expect(ctx.output()).toContain('healthGate: seleção ativa com falha recente');
        expect(ctx.output()).toContain('catálogo disponível não equivale a runtime saudável');
        expect(ctx.output()).toContain('/byok probe agent profile:openrouter-free model:openrouter/free');
        expect(ctx.output()).toContain('/byok use openrouter-free -> /byok model openrouter/free');
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
        expect(ctx.output()).toContain('meta=owner');
        expect(ctx.output()).not.toContain('secret');
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
        expect(ctx.output()).toContain('deltas=2/13 chars');
        expect(ctx.output()).not.toContain('token');
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
        expect(ctx.output()).toContain('BYOK agent probe');
        expect(ctx.output()).toContain('toolCalls=0');
        expect(ctx.output()).toContain('marker=0');
        expect(ctx.output()).toContain('read=0');
        expect(ctx.output()).toContain('tools representativas + ask_user');
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
        expect(ctx.output()).toContain('diagnóstico: provider BYOK recusou a chamada por credito');
        expect(ctx.output()).toContain('ação: troque para modelo free');
        expect(ctx.output()).toContain('erro: 402 402 status code (no body)');
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
        expect(ctx.output()).toContain('BYOK shortlist agent probe');
        expect(ctx.output()).toContain('kilo/model-a');
        expect(ctx.output()).toContain('openrouter/model-b');
        expect(ctx.output()).toContain('Shortlist encerrada: ok=2/2');
        expect(ctx.output()).toContain('/byok recommend ... safe');
        expect(ctx.output()).not.toContain('tmp-kilo-shortlist');
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
        expect(ctx.output()).toContain('Cobertura por perfil antes das probes');
        expect(ctx.output()).toContain('kilo: catalogo=1 · elegiveis=1 · shortlist=1');
        expect(ctx.output()).toContain('groq-free: catalogo=1 · safe removeu=1');
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
        expect(ctx.output()).toContain('admission-blocked');
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
        expect(ctx.output()).toContain('BYOK streaming probe');
        expect(ctx.output()).toContain('UX live ficaria cega');
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
        expect(ctx.output()).toContain('BYOK json probe');
        expect(ctx.output()).toContain('JSON probe confirma saída estruturada');
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
        expect(ctx.output()).toContain('BYOK vision probe');
        expect(ctx.output()).toContain('fixture=image/png/68 bytes');
        expect(ctx.output()).toContain('Vision probe confirma');
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
        expect(ctx.output()).toContain('resultado:');
        expect(ctx.output()).toContain('empty');
        expect(ctx.output()).toContain('resultado explícito sem prova visual positiva');
        expect(ctx.output()).not.toContain('Vision probe confirma que o provider aceitou');
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

        expect(ctx.output()).toContain('BYOK providers');
        expect(ctx.output()).toContain('openrouter-free');
        expect(ctx.output()).toContain('groq-free');
        expect(ctx.output()).toContain('← ativo');
        expect(ctx.output()).toContain('/byok use groq-free');
        expect(ctx.output()).toContain('/byok models refresh provider:groq');
        expect(ctx.output()).toContain('meta=tier,owner');
        expect(ctx.output()).toContain('cost=profile-free');
        expect(ctx.output()).toContain('chat=ok');
        expect(ctx.output()).not.toContain('secret');
    });

    it('mostra inventário de endpoints por provider sem chamar rede', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'providers endpoints kilo');

        expect(resolveProviderEndpointInventory).toHaveBeenCalledWith('kilo');
        expect(listProviderEndpointInventory).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK provider endpoints');
        expect(ctx.output()).toContain('kind=gateway');
        expect(ctx.output()).toContain('https://api.kilo.ai/api/gateway/models');
        expect(ctx.output()).toContain('POST /chat/completions');
        expect(ctx.output()).toContain('selectors=exact_model,gateway_auto,provider_model');
    });

    it('mostra traits provider/gateway normalizados sem chamar runtime', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway provider traits kilo');

        expect(resolveProviderGatewayTraits).toHaveBeenCalledWith('kilo');
        expect(listProviderGatewayTraits).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK provider/gateway traits');
        expect(ctx.output()).toContain('topology=gateway');
        expect(ctx.output()).toContain('openaiCompat=sim');
        expect(ctx.output()).toContain('runtimeKinds=chat_completions');
        expect(ctx.output()).toContain('metadata=pricing:sim');
    });

    it('mostra matriz provider/wire API de probes sem chamar runtime', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway probes matrix kilo');

        expect(listProviderWireProbeMatrix).toHaveBeenCalledWith({ providerId: 'kilo' });
        expect(summarizeProviderWireProbeMatrix).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK provider/wire probe matrix');
        expect(ctx.output()).toContain('wire=openai_chat_completions');
        expect(ctx.output()).toContain('implemented=chat,streaming,json,agent');
        expect(ctx.output()).toContain('pending=reasoning,forced_tool_choice,parallel_tool_calls');
        expect(ctx.output()).toContain('pendingKinds=forced_tool_choice:1, parallel_tool_calls:1, reasoning:1');
    });

    it('mostra orientação explícita para habilitar Ollama/local sem iniciar daemon', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway local');

        expect(ctx.output()).toContain('BYOK model-gateway local/Ollama');
        expect(ctx.output()).toContain('excludeLocalProvidersByDefault:true');
        expect(ctx.output()).toContain('local_provider_requires_explicit_request');
        expect(ctx.output()).toContain('nao inicia Ollama');
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
        expect(ctx.output()).toContain('BYOK probe backoff planner');
        expect(ctx.output()).toContain('ready=1');
        expect(ctx.output()).toContain('deferred=1');
        expect(ctx.output()).toContain('runtime_rate_limited');
        expect(ctx.output()).toContain('READY');
        expect(ctx.output()).toContain('DEFER');
    });

    it('mostra requisitos de env por provider sem expor valores de segredo', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway secrets kilo');

        expect(evaluateModelGatewayProviderEnvRequirements).toHaveBeenCalledWith({ env: process.env, providerId: 'kilo' });
        expect(summarizeModelGatewayProviderEnvRequirements).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK provider env requirements');
        expect(ctx.output()).toContain('status=missing');
        expect(ctx.output()).toContain('missingRequired=KILO_API_KEY,KILO_CODE_API_KEY');
        expect(ctx.output()).not.toContain('kilo-secret');
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
        expect(ctx.output()).toContain('BYOK model-gateway importer audit');
        expect(ctx.output()).toContain('selector=kilo');
        expect(ctx.output()).toContain('importers=2/3');
        expect(ctx.output()).toContain('providerEvidence=1');
        expect(ctx.output()).toContain('accountOverlays=1');
        expect(ctx.output()).toContain('kilo-gateway-models');
        expect(ctx.output()).toContain('hooks=fetchRaw,parseRows,toEvidenceFacts,toRouteOptions');
        expect(ctx.output()).toContain('uncoveredCatalogSources=kilo:catalog:public_docs:get:https-api-kilo-ai-docs');
        expect(ctx.output()).not.toContain('secret');
    });

    it('mostra gate pré-K do model-gateway com checks booleanos', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway');

        expect(buildModelGatewayPreKCompatibilityReport).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK model-gateway pre-K gate');
        expect(ctx.output()).toContain('checks=2/2');
        expect(ctx.output()).toContain('sdk_provider_config_boundary');
        expect(ctx.output()).toContain('route_trace_attributes_are_stable');
    });

    it('mostra readiness pré-build K+ do model-gateway com checks booleanos', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway prebuild');

        expect(buildModelGatewayPreBuildReadinessReport).toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK model-gateway pre-build readiness');
        expect(ctx.output()).toContain('checks=3/3');
        expect(ctx.output()).toContain('universal_catalog_contracts_are_exported');
        expect(ctx.output()).toContain('provider_gateway_traits_are_metadata');
        expect(ctx.output()).toContain('canonical_commands_are_published');
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
        expect(ctx.output()).toContain('BYOK model-gateway accounts/keys');
        expect(ctx.output()).toContain('status=rate_limited');
        expect(ctx.output()).toContain('secretRef=OPENROUTER_API_KEY');
        expect(ctx.output()).toContain('reset=2026-05-25T00:01:00.000Z');
        expect(ctx.output()).toContain('runtime health continua em /byok health');
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
        expect(ctx.output()).toContain('BYOK model-gateway account limits');
        expect(ctx.output()).toContain('active=1');
        expect(ctx.output()).toContain('expired=1');
        expect(ctx.output()).toContain('state=active');
        expect(ctx.output()).toContain('resetWindow=temporary');
        expect(ctx.output()).toContain('refresh=2026-05-25T00:01:00.000Z');
        expect(ctx.output()).toContain('next=wait_for_rate_limit_reset_or_choose_another_route');
        expect(ctx.output()).toContain('AssistantUsageQuotaSnapshot é quota SDK/Copilot');
    });

    it('mostra matriz de capacidades de quota por provider sem executar runtime', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway quota-matrix openrouter');

        expect(summarizeModelGatewayProviderQuotaCapabilities).toHaveBeenCalledWith(
            expect.objectContaining({ selector: 'openrouter' }),
        );
        expect(ctx.output()).toContain('BYOK model-gateway provider quota matrix');
        expect(ctx.output()).toContain('quota=key_credit_balance');
        expect(ctx.output()).toContain('sdkQuotaByokTruth=0');
        expect(ctx.output()).toContain('OPENROUTER_API_KEY');
        expect(ctx.output()).toContain('/api/v1/key');
    });

    it('mostra comandos canônicos do model-gateway para package, make e terminal', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway commands');

        expect(listModelGatewayCanonicalCommands).toHaveBeenCalledWith({ surface: undefined, phase: undefined });
        expect(renderModelGatewayCanonicalCommandLines).toHaveBeenCalledWith({ surface: undefined, phase: undefined });
        expect(ctx.output()).toContain('BYOK model-gateway canonical commands');
        expect(ctx.output()).toContain('track=Y');
        expect(ctx.output()).toContain('npm run model-gateway:prebuild');
        expect(ctx.output()).toContain('make model-gateway-prebuild');
        expect(ctx.output()).toContain('/byok gateway commands');
    });

    it('filtra comandos canônicos do model-gateway pela fase live-readiness', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'gateway commands live-readiness');

        expect(listModelGatewayCanonicalCommands).toHaveBeenCalledWith({ surface: undefined, phase: 'live-readiness' });
        expect(renderModelGatewayCanonicalCommandLines).toHaveBeenCalledWith({ surface: undefined, phase: 'live-readiness' });
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
        expect(ctx.output()).toContain('BYOK model-gateway selection audit');
        expect(ctx.output()).toContain('runtime=nao');
        expect(ctx.output()).toContain('repo_agent');
        expect(ctx.output()).toContain('provider_explicit');
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
        expect(ctx.output()).toContain('BYOK model-gateway auto');
        expect(ctx.output()).toContain('liveSetModel=nao');
        expect(ctx.output()).toContain('prepare_new_sdk_session:dry');
        expect(ctx.output()).toContain('action=prepare_new_session');
        expect(ctx.output()).toContain('/session sdk next new');
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
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto apply profile:repo_agent allow-live-set-model');

        expect(setTerminalModelProjection).toHaveBeenCalledWith('openai/gpt-oss-120b');
        expect(ctx.output()).toContain('Auto apply: modelo vivo atualizado para openai/gpt-oss-120b');
    });

    it('persiste auto on sem aplicar efeitos na sessao viva', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto on profile:repo_agent allow-live-set-model');

        expect(ctx.output()).toContain('BYOK model-gateway auto on');
        expect(ctx.output()).toContain('COPILOT_BYOK_GATEWAY_AUTO=true');
        expect(ctx.output()).toContain('COPILOT_BYOK_GATEWAY_AUTO_PROFILES=repo_agent');
        expect(ctx.output()).toContain('COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL=true');
        expect(writeModelGatewayRuntimeAutomationPolicyFile).toHaveBeenCalledWith(
            expect.objectContaining({
                enabled: true,
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
            profiles: ['repo_agent'],
            allowLiveSetModel: true,
        });
        readModelGatewayRuntimeAutomationEffectivePolicy.mockResolvedValueOnce({
            enabled: true,
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

        expect(policyCtx.output()).toContain('BYOK model-gateway auto policy');
        expect(policyCtx.output()).toContain(DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH);
        expect(policyCtx.output()).toContain('enabled');
        expect(policyCtx.output()).toContain('repo_agent');

        readModelGatewayRuntimeAutomationEffectivePolicy.mockResolvedValueOnce({
            enabled: true,
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

        expect(offCtx.output()).toContain('model-gateway auto off');
        expect(writeModelGatewayRuntimeAutomationPolicyFile).toHaveBeenCalledWith(
            expect.objectContaining({ enabled: false, profiles: ['repo_agent'] }),
        );
    });

    it('registra decisão auto sem aplicar efeitos e explica auto off', async () => {
        mockProjection();
        const recordCtx = mockCtx();
        await cmdByok({ println: recordCtx.println }, 'auto record profile:repo_agent');
        expect(recordCtx.output()).toContain('decision(s) gravada(s)');

        const offCtx = mockCtx();
        await cmdByok({ println: offCtx.println }, 'auto off');
        expect(offCtx.output()).toContain('model-gateway auto off');
        expect(offCtx.output()).toContain('COPILOT_BYOK_GATEWAY_AUTO');
    });

    it('mostra historico auto persistido sem executar efeitos', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'auto history 5');

        expect(ctx.output()).toContain('BYOK model-gateway auto history');
        expect(ctx.output()).toContain('prepare_new_session');
        expect(ctx.output()).toContain('zai:glm-4.5-flash');
        expect(setTerminalModelProjection).not.toHaveBeenCalled();
    });

    it('mostra handoffs, confirmations e recoveries auto persistidos sem executar efeitos', async () => {
        mockProjection();
        const handoffsCtx = mockCtx();
        const confirmationsCtx = mockCtx();
        const recoveriesCtx = mockCtx();

        await cmdByok({ println: handoffsCtx.println }, 'auto handoffs 5');
        await cmdByok({ println: confirmationsCtx.println }, 'auto confirmations 5');
        await cmdByok({ println: recoveriesCtx.println }, 'auto recoveries 5');

        expect(handoffsCtx.output()).toContain('BYOK model-gateway auto handoffs');
        expect(handoffsCtx.output()).toContain('boot_scheduled');
        expect(confirmationsCtx.output()).toContain('BYOK model-gateway auto confirmations');
        expect(confirmationsCtx.output()).toContain('matched_handoff');
        expect(recoveriesCtx.output()).toContain('BYOK model-gateway auto recoveries');
        expect(recoveriesCtx.output()).toContain('rate-limit');
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

        expect(ctx.output()).toContain('BYOK model-gateway auto doctor');
        expect(ctx.output()).toContain('profile=repo_agent');
        expect(ctx.output()).toContain('activeSnapshot=sim');
        expect(ctx.output()).toContain('decision:');
        expect(ctx.output()).toContain('policy source:');
        expect(ctx.output()).toContain('cooldown:');
        expect(ctx.output()).toContain('reset=2026-06-01T10:00:00.000Z');
        expect(ctx.output()).toContain('ledgers:');
        expect(setTerminalModelProjection).not.toHaveBeenCalled();
    });

    it('explica e aciona switch auto usando apenas efeitos autorizados', async () => {
        mockProjection();
        const explainCtx = mockCtx();
        const switchCtx = mockCtx();

        await cmdByok({ println: explainCtx.println }, 'auto explain profile:repo_agent');
        await cmdByok({ println: switchCtx.println }, 'auto switch profile:repo_agent');

        expect(explainCtx.output()).toContain('BYOK model-gateway auto');
        expect(explainCtx.output()).toContain('BYOK model-gateway auto doctor');
        expect(switchCtx.output()).toContain('BYOK model-gateway auto');
        expect(switchCtx.output()).toContain('trilha auto:');
    });

    it('centraliza executor terminal dos efeitos auto', async () => {
        const result = await applyTerminalByokGatewayAutoEffects({
            effects: [
                { kind: 'set_live_model', model: 'anthropic/claude-sonnet-4.5', execute: true },
                { kind: 'prepare_new_sdk_session', model: 'anthropic/claude-sonnet-4.5', execute: true },
                { kind: 'set_live_model', model: 'dry-model', execute: false },
            ],
        });

        expect(setTerminalModelProjection).toHaveBeenCalledWith('anthropic/claude-sonnet-4.5');
        expect(scheduleTerminalSdkSessionBootSelection).toHaveBeenCalledWith({ mode: 'new' });
        expect(result.applied).toHaveLength(2);
        expect(result.applied.map(describeTerminalByokGatewayAutoEffect)).toEqual(
            expect.arrayContaining([
                'modelo vivo atualizado para anthropic/claude-sonnet-4.5',
                'novo boot SDK preparado para anthropic/claude-sonnet-4.5',
            ]),
        );
        expect(result.skipped).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'set_live_model', skippedReason: 'effect_not_authorized' }),
            ]),
        );
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
                    status: 'applied',
                    applied: true,
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
                status: 'boot_scheduled',
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
        expect(result.application?.skipped).toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'replan_after_turn_failure' })]),
        );
        expect(result.effectPersistence).toEqual(
            expect.objectContaining({
                automationEffectApplications: expect.any(Number),
                recoveryAttempts: expect.any(Number),
                sdkSessionHandoffs: expect.any(Number),
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

        expect(ctx.output()).toContain('local_provider_requires_explicit_request');
        expect(ctx.output()).toContain('Ollama/local foi bloqueado por padrão nos perfis cheap_chat');
    });

    it('mostra seleção efetiva com health observado sem persistir nem executar probes', async () => {
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
        expect(ctx.output()).toContain('mode=allow_probe_unknown+effective');
        expect(ctx.output()).toContain('persisted=nao');
        expect(ctx.output()).toContain('observedHealth=');
        expect(ctx.output()).toContain('postRuntimeProfiles=1/1');
        expect(ctx.output()).toContain('compare changed=1/1');
        expect(ctx.output()).toContain('compare reasons=post_runtime_proved_better_route:1');
        expect(ctx.output()).toContain('compare=post_runtime_proved_better_route');
        expect(ctx.output()).toContain('policy=metadata_first');
        expect(ctx.output()).toContain('finalSelected=1/1');
        expect(ctx.output()).toContain('runtimeSelector=ready');
        expect(ctx.output()).toContain('blocked=0');
        expect(ctx.output()).toContain('envReady=1');
        expect(ctx.output()).toContain('envBlocked=0');
        expect(ctx.output()).toContain('post-runtime mudou -> groq:openai/gpt-oss-120b');
        expect(ctx.output()).toContain('healthProofs=1');
        expect(ctx.output()).toContain('probeProofs=1');
        expect(ctx.output()).toContain('runtimeOverlays=1');
        expect(ctx.output()).toContain('active=1');
        expect(ctx.output()).toContain('expired=0');
        expect(ctx.output()).toContain('failures=rate-limit:1');
        expect(ctx.output()).toContain('providers=groq:1');
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
        expect(ctx.output()).toContain('mode=allow_probe_unknown+effective+require-proof');
        expect(ctx.output()).toContain('policy=require_runtime_proof');
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
        expect(ctx.output()).toContain('tracePersisted=sim');
        expect(ctx.output()).toContain('persisted=sim');
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
        expect(ctx.output()).toContain('BYOK model-gateway catalog refresh');
        expect(ctx.output()).toContain('schema=OpenAI+x_model_gateway');
        expect(ctx.output()).toContain('projections=1');
        expect(ctx.output()).toContain('openai=1');
        expect(ctx.output()).toContain('added=1');
        expect(ctx.output()).toContain('changed=1');
        expect(ctx.output()).toContain('write=commit');
        expect(ctx.output()).toContain('eligibility diff: added=1');
        expect(ctx.output()).toContain('pricing_changed');
        expect(ctx.output()).toContain('probe suggestions: 1');
        expect(ctx.output()).toContain('/byok probe agent model:changed-model');
        expect(ctx.output()).toContain('openrouter:new-model:default');
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
        expect(ctx.output()).toContain('BYOK model-gateway refresh log');
        expect(ctx.output()).toContain('events=6');
        expect(ctx.output()).toContain('completed=sim');
        expect(ctx.output()).toContain('projections=42');
        expect(ctx.output()).toContain('openrouter-models');
        expect(ctx.output()).toContain('failures=0');
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
        expect(ctx.output()).toContain('BYOK model-gateway catalog refresh plan');
        expect(ctx.output()).toContain('sem rede');
        expect(ctx.output()).toContain('selected=1');
        expect(ctx.output()).toContain('run');
        expect(ctx.output()).toContain('openrouter-models');
        expect(ctx.output()).toContain('source_ttl_expired');
        expect(ctx.output()).toContain('skip openai-models');
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
        expect(ctx.output()).toContain('BYOK model-gateway catalog diff');
        expect(ctx.output()).toContain('sem rede');
        expect(ctx.output()).toContain('added=1');
        expect(ctx.output()).toContain('capabilities_changed');
        expect(ctx.output()).toContain('probe suggestions: 1');
    });

    it('exibe runs e diff persistidos de eligibility sem executar runtime', async () => {
        mockProjection();
        const runsCtx = mockCtx();
        const diffCtx = mockCtx();

        await cmdByok({ println: runsCtx.println }, 'gateway eligibility runs');
        await cmdByok({ println: diffCtx.println }, 'gateway eligibility diff');

        expect(refreshModelGatewayCatalog).not.toHaveBeenCalled();
        expect(summarizeModelGatewayEligibilityDiff).toHaveBeenCalled();
        expect(runsCtx.output()).toContain('BYOK model-gateway eligibility runs');
        expect(runsCtx.output()).toContain('eligibility-run-1');
        expect(runsCtx.output()).toContain('diff added=1');
        expect(diffCtx.output()).toContain('BYOK model-gateway eligibility diff');
        expect(diffCtx.output()).toContain('becameEligible=0');
        expect(diffCtx.output()).toContain('disposition_changed');
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
        expect(ctx.output()).toContain('selector=openrouter');
        expect(ctx.output()).toContain('openrouter-models');
        expect(ctx.output()).not.toContain('openai-models · schema');
    });

    it('encaminha /models catalog diff para a mesma UX persistida', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models catalog diff');

        expect(refreshModelGatewayCatalog).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK model-gateway catalog diff');
    });

    it('exibe conflitos persistidos do catálogo via /models conflicts', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models conflicts');

        expect(refreshModelGatewayCatalog).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('BYOK model-gateway catalog conflicts');
        expect(ctx.output()).toContain('capabilities.tools');
        expect(ctx.output()).toContain('catalog-tools');
        expect(ctx.output()).toContain('heuristic-tools');
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

        expect(ctx.output()).toContain('BYOK operational health');
        expect(ctx.output()).toContain('byok-provider-health.json');
        expect(ctx.output()).toContain('providerId=kilo-code');
        expect(ctx.output()).toContain('chat=ok');
        expect(ctx.output()).toContain('capabilities=streaming=okx2 vision=failed');
        expect(ctx.output()).toContain('protocol=live_ask_user=ok live_tool_protocol=ok');
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

        expect(ctx.output()).toContain('filtro provider=openrouter');
        expect(ctx.output()).toContain('BYOK operational health');
        expect(ctx.output()).toContain('(1)');
        expect(ctx.output()).toContain('providerId=openrouter');
        expect(ctx.output()).not.toContain('providerId=groq');
    });

    it('limpa health operacional BYOK quando solicitado', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'health clear');

        expect(clearByokProviderModelHealth).toHaveBeenCalledWith({});
        expect(flushByokProviderHealth).toHaveBeenCalledOnce();
        expect(ctx.output()).toContain('BYOK operational health limpo');
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
        expect(ctx.output()).toContain('provider=openrouter');
        expect(ctx.output()).toContain('model=openai/gpt-oss-120b');
        expect(ctx.output()).toContain('profile=repo_agent');
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
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'model anthropic/claude-sonnet-4.5');

        expect(setTerminalModelProjection).toHaveBeenCalledWith('anthropic/claude-sonnet-4.5');
        expect(ctx.output()).toContain('Modelo BYOK solicitado na sessão viva');
        expect(ctx.output()).toContain('Provider/perfil foram preservados');
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
        expect(ctx.output()).toContain('Sessão viva não está bound ao mesmo provider BYOK');
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

        expect(ctx.output()).toContain('fonte=provider');
        expect(ctx.output()).toContain('remote-a');
        expect(ctx.output()).toContain('free');
        expect(ctx.output()).toContain('provider=fixture');
        expect(ctx.output()).toContain('ctx=200000');
        expect(ctx.output()).toContain('maxReq=6000');
        expect(ctx.output()).toContain('TPM=6000');
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
        expect(ctx.output()).toContain('BYOK model route');
        expect(ctx.output()).toContain('decision=route-test');
        expect(ctx.output()).toContain('modo=pre-probe');
        expect(ctx.output()).toContain('selecionado');
        expect(ctx.output()).toContain('kilo-auto/free');
        expect(ctx.output()).toContain('fallback chain');
        expect(ctx.output()).toContain('missing_capability:tools');
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
        expect(ctx.output()).toContain('/byok models route repo_agent provider:ollama');
        expect(ctx.output()).toContain('local_provider_requires_explicit_request');
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
        expect(ctx.output()).toContain('selecionado');
        expect(ctx.output()).toContain('provider=nvidia-nim');
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
        expect(ctx.output()).toContain('selecionado');
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
        expect(ctx.output()).toContain('fonte=model-gateway-static=1');
        expect(ctx.output()).toContain('selecionado');
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
        expect(ctx.output()).toContain('selecionado');
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

        expect(ctx.output()).toContain('fonte=model-gateway/static-fallback');
        expect(ctx.output()).toContain('gateway-model');
        expect(ctx.output()).toContain('provider=openrouter');
        expect(ctx.output()).toContain('maxReq=64000');
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
        expect(ctx.output()).toContain('ordem=free/capability/context');
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
        expect(defaultCtx.output()).toContain('exibindo 24/30');

        const expandedCtx = mockCtx();
        await cmdByok({ println: expandedCtx.println }, 'models refresh 26');

        expect(expandedCtx.output()).toContain('remote-26');
        expect(expandedCtx.output()).not.toContain('remote-27');
        expect(expandedCtx.output()).toContain('exibindo 26/30');
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

        expect(ctx.output()).toContain('filtros=provider:openrouter,free,reasoning,safe');
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
        expect(ctx.output()).toContain('filtros=all-providers,free,reasoning,safe');
        expect(ctx.output()).toContain('perfis=2');
        expect(ctx.output()).toContain('openrouter/free-reasoning');
        expect(ctx.output()).toContain('groq/free-reasoning');
        expect(ctx.output()).toContain('profile=openrouter-free');
        expect(ctx.output()).toContain('profile=groq-free');
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

        expect(ctx.output()).toContain('(1 grupos/2)');
        expect(ctx.output()).toContain('shared/free-model');
        expect(ctx.output()).toContain('variants=openrouter-free/openrouter|groq-free/groq');
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
        expect(ctx.output()).toContain('filtros=all-providers,provider:groq,free,reasoning,safe');
        expect(ctx.output()).toContain('groq/free-reasoning');
        expect(ctx.output()).not.toContain('openrouter');
        expect(ctx.output()).toContain('/byok probe agent profile:groq-free model:groq/free-reasoning');
        expect(ctx.output()).toContain('/byok use groq-free -> /byok model groq/free-reasoning');
    });

    it('trata plano gratuito declarado no perfil como profile-free sem mascarar custo por modelo desconhecido', async () => {
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
        expect(ctx.output()).toContain('profile-free');
        expect(ctx.output()).toContain('freeHint=6k TPM observed on current plan');
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

        expect(ctx.output()).toContain("model configurado 'provider/stale-model' nao apareceu no catalogo remoto atual");
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

        expect(ctx.output()).toContain('Nenhum modelo BYOK encontrado');
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

        expect(ctx.output()).toContain('BYOK recommend');
        expect(ctx.output()).toContain('free-comfortable');
        expect(ctx.output()).not.toContain('free-low-limit');
        expect(ctx.output()).not.toContain('paid-vision');
        expect(ctx.output()).toContain('ok para uso geral');
        expect(ctx.output()).toContain('/byok probe agent model:free-comfortable');
        expect(ctx.output()).toContain('live fake descartável');
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
        expect(ctx.output()).toContain('Use /byok models para explorar catalogo bruto');
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

        expect(ctx.output()).toContain('chat=ok(probe,');
        expect(ctx.output()).toContain('chat=ok(turno,');
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
        expect(ctx.output()).toContain('chat=failed');
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

        expect(ctx.output()).toContain('filtros=provider:openrouter,metered,reasoning');
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

        expect(ctx.output()).toContain('contexto atual≈63000/200000 tokens');
        expect(ctx.output()).toContain('estimativa pré-turno≈64024 tokens');
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
        expect(ctx.output()).toContain('Status omitido');
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
        expect(ctx.output()).toContain('wireApi inválido');
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
            expect.stringMatching(/^\.env\.local\.tmp-/),
            expect.stringContaining('COPILOT_BYOK_PROFILE=kilo'),
            expect.objectContaining({ mode: 0o600 }),
        );
        const written = String(writeFile.mock.calls[0][1]);
        expect(written).toContain('COPILOT_BYOK_ENABLED=true');
        expect(written).not.toContain('COPILOT_BYOK_MODEL=old-model');
        expect(written).toContain('KILO_CODE_API_KEY=existing-secret');
        expect(rename).toHaveBeenCalledWith(expect.stringMatching(/^\.env\.local\.tmp-/), '.env.local');
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
        expect(ctx.output()).toContain('SDK Copilot governará o próximo boot');
    });
});
