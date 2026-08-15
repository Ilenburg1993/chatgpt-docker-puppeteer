// @ts-check
/**
 * Read-only Model Gateway application service.
 *
 * It exposes bounded, structured use cases without depending on terminal rendering or shell commands.
 *
 * @module copilot/model-gateway/control-plane/read-model
 */

import { importConfiguredByokFromEnv } from '../registry/env-byok-compat-importer.js';
import { buildModelGatewayOperatorProjection } from '../registry/projection.js';
import { applyModelGatewayBindingStrategy } from '../ingress/binding-strategy.js';
import { createModelGatewayModelIdentity } from '../contracts/model-identity.js';
import { evaluateModelGatewayModelLifecycle } from '../contracts/model-lifecycle.js';
import { searchModelGatewayCatalogEntries } from '../catalog/search.js';
import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';
import { listByokProviderModelHealth } from '../health/provider-health.js';
import { planModelGatewayProbeBackoff } from '../probes/backoff-planner.js';
import { planCostBoundedCatalogProbes } from '../probes/planner.js';
import { recommendCatalogDiffProbes } from '../probes/recommendations.js';
import { buildModelGatewayRouteCandidates } from '../routing/candidate-builder.js';
import { explainGatewayRouteDecision } from '../routing/explain.js';
import {
    routeModelGatewayCatalogSnapshot,
    scoreGatewayModelCandidate,
} from '../routing/policy-engine.js';
import { resolveModelGatewayTaskProfile } from '../routing/task-profiles.js';
import { diagnoseModelGatewayProviderSecretRefs } from '../secrets/diagnostics.js';
import { createModelGatewayEnvProfileStore } from '../profiles/env-profile-store.js';
import {
    listModelGatewayRuntimeAutomationPolicyPresets,
    mergeModelGatewayRuntimeAutomationPolicy,
    readModelGatewayRuntimeAutomationEffectivePolicy,
    validateModelGatewayRuntimeAutomationPolicy,
} from '../automation/policy.js';
import { readModelGatewayDirectRebindEvidence } from './binding-evidence.js';
import { classifyModelGatewayDeferredRouteOperation } from './deferred-route-operation.js';
import { createModelGatewayControlPlaneResult } from './result-envelope.js';
import {
    assertModelGatewayCatalogReadPort,
    assertModelGatewayProviderProfileStorePort,
} from './ports.js';

export const MODEL_GATEWAY_READ_LATENCY_BUDGET_MS = Object.freeze({
    overview: 1_000,
    routePlan: 3_000,
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {number} startedAtMs
 * @param {number} completedAtMs
 * @param {number} budgetMs
 */
function latencyObservation(startedAtMs, completedAtMs, budgetMs) {
    const elapsedMs = Math.max(0, completedAtMs - startedAtMs);
    return {
        elapsedMs,
        budgetMs,
        withinBudget: elapsedMs <= budgetMs,
    };
}

/**
 * @param {Record<string, any>} projection
 * @returns {string}
 */
function projectionKey(projection) {
    return [
        optionalString(projection['providerId']) ?? 'unknown-provider',
        optionalString(projection['providerModel']) ?? 'unknown-model',
        optionalString(projection['routeProfile']) ?? 'default',
    ].join(':');
}

/**
 * @param {unknown} value
 * @returns {{ added: string[]; removed: string[]; changed: Array<{ key: string; changedKinds: string[] }> }}
 */
function normalizeCatalogDiff(value) {
    const diff = isRecord(value) ? value : {};
    return {
        added: Array.isArray(diff['added']) ? diff['added'].map(String) : [],
        removed: Array.isArray(diff['removed']) ? diff['removed'].map(String) : [],
        changed: Array.isArray(diff['changed'])
            ? diff['changed'].filter(isRecord).map((item) => ({
                  key: optionalString(item['key']) ?? 'unknown',
                  changedKinds: Array.isArray(item['changedKinds']) ? item['changedKinds'].map(String) : [],
              }))
            : [],
    };
}

/**
 * @param {Record<string, any>[]} importRuns
 * @returns {Record<string, any> | null}
 */
function latestCatalogRefreshRun(importRuns) {
    return (
        [...importRuns]
            .reverse()
            .find(
                (run) => run['providerId'] === 'model-gateway' && run['sourceId'] === 'catalog-refresh' && run['diff'],
            ) ?? null
    );
}

/**
 * @param {Record<string, any>[]} projections
 * @param {string[]} modelIds
 * @param {string | null} providerId
 * @returns {string[]}
 */
function resolveRequestedProjectionKeys(projections, modelIds, providerId) {
    const requested = new Set(modelIds.map((item) => item.toLowerCase()));
    return projections
        .filter((projection) => !providerId || optionalString(projection['providerId']) === providerId)
        .filter((projection) => {
            if (requested.size === 0) return true;
            const identities = [
                projectionKey(projection),
                projection['id'],
                projection['canonicalModelId'],
                projection['providerModel'],
                `${projection['providerId']}:${projection['providerModel']}`,
            ]
                .filter((item) => typeof item === 'string')
                .map((item) => String(item).toLowerCase());
            return identities.some((identity) => requested.has(identity));
        })
        .map(projectionKey);
}

/**
 * @param {string} objective
 * @param {string} taskProfile
 */
function buildPolicyProposalPatch(objective, taskProfile) {
    const guarded = {
        enabled: true,
        profiles: [taskProfile],
        allowLiveSetModel: false,
        allowNewSession: false,
        allowProviderProbes: false,
        allowLocalPrivate: false,
    };
    if (objective === 'lower_cost') {
        return {
            patch: { ...guarded, preset: 'operator_manual', policy: 'metadata_first' },
            rationale: ['prefer_catalog_metadata_for_cost_comparison', 'keep_runtime_mutations_manual'],
            risks: ['pricing_metadata_can_be_missing_or_stale'],
        };
    }
    if (objective === 'higher_reliability') {
        return {
            patch: { ...guarded, preset: 'llm_operator_guarded', policy: 'require_runtime_proof' },
            rationale: ['require_runtime_proof_before_automation', 'keep_runtime_mutations_manual'],
            risks: ['models_without_recent_runtime_proof_will_be_excluded'],
        };
    }
    if (objective === 'require_tools') {
        return {
            patch: { ...guarded, preset: 'llm_operator_guarded', policy: 'require_runtime_proof' },
            rationale: ['require_runtime_proof_for_tool_agent_candidates', 'keep_runtime_mutations_manual'],
            risks: ['automation_policy_does_not_replace_capability_eligibility_checks'],
        };
    }
    if (objective === 'local_private') {
        return {
            patch: {
                ...guarded,
                preset: 'operator_manual',
                policy: 'require_runtime_proof',
                allowLocalPrivate: true,
            },
            rationale: ['allow_explicit_local_private_routing', 'require_runtime_proof', 'keep_runtime_mutations_manual'],
            risks: ['local_private_boundary_change_requires_operator_review'],
        };
    }
    if (objective === 'balanced') {
        return {
            patch: { ...guarded, preset: 'operator_manual', policy: 'prefer_runtime_proved' },
            rationale: ['prefer_runtime_proof_without_excluding_metadata_only_candidates', 'keep_runtime_mutations_manual'],
            risks: ['metadata_only_candidates_can_still_be_selected_for_review'],
        };
    }
    return {
        patch: { ...guarded, preset: 'operator_manual', policy: 'prefer_runtime_proved' },
        rationale: ['prefer_runtime_proved_candidates', 'keep_runtime_mutations_manual'],
        risks: ['runtime_proof_can_expire_or_be_route_profile_specific'],
    };
}

/**
 * @param {ReturnType<typeof importConfiguredByokFromEnv>} byok
 * @param {Record<string, any> | null} selectedModel
 * @param {Record<string, unknown> | null} [bindingDecision]
 */
function buildSessionTransitionPlan(byok, selectedModel, bindingDecision = null) {
    const active = isRecord(byok.active) ? byok.active : {};
    const provider = byok.provider && isRecord(byok.provider) ? byok.provider : {};
    const activeProviderId = optionalString(active['providerId']) ?? optionalString(provider['id']);
    const activeModelId = optionalString(active['model']) ?? optionalString(active['modelId']);
    const selectedProviderId = optionalString(selectedModel?.['providerId']);
    const selectedModelId =
        optionalString(selectedModel?.['providerModel']) ??
        optionalString(selectedModel?.['canonicalModelId']) ??
        optionalString(selectedModel?.['id']);
    if (!selectedProviderId || !selectedModelId) {
        return {
            status: 'blocked',
            activeProviderId,
            activeModelId,
            selectedProviderId,
            selectedModelId,
            sameProviderBoundary: false,
            liveModelSwitchAllowed: false,
            requiresNewSession: false,
            autoLoopAllowed: false,
            reason: 'route_has_no_selected_provider_model',
            nextAction: 'review_route_rejections',
        };
    }
    const bindingStrategy = optionalString(bindingDecision?.['strategy']);
    if (bindingStrategy === 'blocked') {
        const nextActions = Array.isArray(bindingDecision?.['nextActions'])
            ? bindingDecision['nextActions'].map(String)
            : [];
        return {
            status: 'blocked',
            activeProviderId,
            activeModelId,
            selectedProviderId,
            selectedModelId,
            sameProviderBoundary: false,
            sameSessionRequired: true,
            liveRouteSwitchAllowed: false,
            liveModelSwitchAllowed: false,
            providerRebindRequired: true,
            bindingStrategy,
            bindingDecision,
            requiresNewSession: false,
            newSessionAllowedOnlyWhenExplicit: true,
            autoLoopAllowed: false,
            reason: 'selected_route_binding_strategy_blocked',
            nextAction: nextActions[0] ?? 'review_binding_strategy',
        };
    }
    const sameProviderBoundary = activeProviderId !== null && activeProviderId === selectedProviderId;
    return {
        status: 'live_route_switch_candidate',
        activeProviderId,
        activeModelId,
        selectedProviderId,
        selectedModelId,
        sameProviderBoundary,
        sameSessionRequired: true,
        liveRouteSwitchAllowed: true,
        liveModelSwitchAllowed: sameProviderBoundary,
        providerRebindRequired: !sameProviderBoundary,
        providerRebindCapability: sameProviderBoundary ? 'not_required' : 'same_session_reattach_preferred',
        bindingStrategy: bindingStrategy ?? 'direct',
        bindingDecision,
        requiresNewSession: false,
        newSessionAllowedOnlyWhenExplicit: true,
        autoLoopAllowed: false,
        reason: sameProviderBoundary
            ? 'selected_route_matches_active_provider_boundary'
            : activeProviderId
              ? 'selected_route_requires_live_provider_rebind'
              : 'active_provider_boundary_unknown_live_preflight_required',
        nextAction: 'plan_transactional_live_route_switch',
    };
}

/**
 * @param {Record<string, any> | null} selectedModel
 * @param {string | null} selectedRouteKey
 * @param {string} taskProfile
 */
function buildLiveRouteSwitchTarget(selectedModel, selectedRouteKey, taskProfile) {
    if (!selectedModel) return null;
    const routing = isRecord(selectedModel['routing']) ? selectedModel['routing'] : {};
    const normalizedPolicy = isRecord(selectedModel['normalizedPolicy']) ? selectedModel['normalizedPolicy'] : {};
    const providerId = optionalString(selectedModel['providerId']);
    const providerModel =
        optionalString(selectedModel['providerModel']) ??
        optionalString(selectedModel['selectorSyntax']) ??
        optionalString(selectedModel['id']);
    if (!providerId || !providerModel) return null;
    return applyModelGatewayBindingStrategy({
        providerId,
        providerModel,
        providerType:
            optionalString(selectedModel['providerType']) ??
            optionalString(routing['providerType']) ??
            optionalString(normalizedPolicy['providerType']),
        selectorSyntax: optionalString(selectedModel['selectorSyntax']),
        baseUrl:
            optionalString(selectedModel['baseUrl']) ??
            optionalString(routing['baseUrl']) ??
            optionalString(normalizedPolicy['baseUrl']),
        openAICompatibleBaseUrl:
            optionalString(selectedModel['openAICompatibleBaseUrl']) ??
            optionalString(routing['openAICompatibleBaseUrl']) ??
            optionalString(normalizedPolicy['openAICompatibleBaseUrl']),
        openAICompatible:
            selectedModel['openAICompatible'] === true ||
            routing['openAICompatible'] === true ||
            normalizedPolicy['openAICompatible'] === true,
        wireApi:
            optionalString(selectedModel['wireApi']) ??
            optionalString(routing['wireApi']) ??
            optionalString(normalizedPolicy['wireApi']),
        providerProfile:
            optionalString(selectedModel['providerProfile']) ??
            optionalString(routing['providerProfile']) ??
            optionalString(normalizedPolicy['providerProfile']),
        directRebindReliability:
            optionalString(selectedModel['directRebindReliability']) ??
            optionalString(routing['directRebindReliability']) ??
            optionalString(normalizedPolicy['directRebindReliability']),
        directRebindSupported:
            typeof selectedModel['directRebindSupported'] === 'boolean'
                ? selectedModel['directRebindSupported']
                : typeof routing['directRebindSupported'] === 'boolean'
                  ? routing['directRebindSupported']
                  : normalizedPolicy['directRebindSupported'],
        directRebindReliable:
            typeof selectedModel['directRebindReliable'] === 'boolean'
                ? selectedModel['directRebindReliable']
                : typeof routing['directRebindReliable'] === 'boolean'
                  ? routing['directRebindReliable']
                  : normalizedPolicy['directRebindReliable'],
        bindingCapabilities:
            (isRecord(selectedModel['bindingCapabilities']) && selectedModel['bindingCapabilities']) ||
            (isRecord(routing['bindingCapabilities']) && routing['bindingCapabilities']) ||
            (isRecord(normalizedPolicy['bindingCapabilities']) && normalizedPolicy['bindingCapabilities']) ||
            null,
        runtimeEvidence: isRecord(selectedModel['runtimeEvidence']) ? selectedModel['runtimeEvidence'] : null,
        routeProfile: taskProfile,
        selectedRouteKey,
    });
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} operationId
 * @returns {boolean}
 */
function hasOperationId(record, operationId) {
    const expected = operationId.toLowerCase();
    return Object.entries(record).some(([key, value]) => {
        if (!/(?:id|key|ref)$/iu.test(key)) return false;
        return typeof value === 'string' && value.toLowerCase() === expected;
    });
}

/**
 * @param {Record<string, unknown>} diagnostics
 * @param {number} maxSnapshotAgeHours
 * @param {number} now
 */
function buildReadiness(diagnostics, maxSnapshotAgeHours, now) {
    const active = isRecord(diagnostics['activeSnapshot']) ? diagnostics['activeSnapshot'] : {};
    const generatedAtMs = typeof active['generatedAtMs'] === 'number' ? active['generatedAtMs'] : null;
    const ageHours = generatedAtMs === null ? null : Math.max(0, (now - generatedAtMs) / 3_600_000);
    const confirmation = isRecord(diagnostics['latestSdkSessionConfirmation'])
        ? diagnostics['latestSdkSessionConfirmation']
        : {};
    const mismatch = optionalString(confirmation['status']) === 'model_mismatch';
    const snapshotFresh = ageHours !== null && ageHours <= maxSnapshotAgeHours;
    const catalogRows = typeof diagnostics['catalogRows'] === 'number' ? diagnostics['catalogRows'] : 0;
    const standby = isRecord(diagnostics['latestStandbyPlan']) ? diagnostics['latestStandbyPlan'] : {};
    const standbyReady =
        optionalString(standby['status']) === 'ready' &&
        typeof standby['routeCount'] === 'number' &&
        standby['routeCount'] > 0 &&
        optionalString(standby['selectedRouteKey']) !== null;
    const live = isRecord(diagnostics['latestLiveScenarioRun']) ? diagnostics['latestLiveScenarioRun'] : {};
    const liveReady = live['ok'] === true;
    const structuralReasons = [];
    const operationalReasons = [];
    const liveReasons = [];
    if (active['exists'] !== true) structuralReasons.push('active_snapshot_missing');
    if (catalogRows < 1) structuralReasons.push('catalog_empty');
    if (!snapshotFresh) operationalReasons.push(ageHours === null ? 'snapshot_age_unknown' : 'snapshot_stale');
    if (mismatch) operationalReasons.push('runtime_model_mismatch');
    if (!standbyReady) operationalReasons.push('standby_plan_missing_or_invalid');
    if (!liveReady) liveReasons.push(live['runId'] ? 'latest_live_scenario_failed' : 'live_scenario_missing');
    const reasons = [...structuralReasons, ...operationalReasons, ...liveReasons];
    const recommendedActions = [...new Set(
        reasons.map((reason) => {
            if (reason === 'active_snapshot_missing' || reason === 'catalog_empty') return 'refresh_catalog';
            if (reason === 'snapshot_age_unknown' || reason === 'snapshot_stale') return 'plan_catalog_refresh';
            if (reason === 'runtime_model_mismatch') return 'reconcile_runtime_model';
            if (reason === 'standby_plan_missing_or_invalid') return 'build_and_persist_standby_plan';
            return 'run_controlled_live_scenario';
        }),
    )];
    const structuralReady = structuralReasons.length === 0;
    const operationalReady = operationalReasons.length === 0;
    return {
        ready: structuralReady && operationalReady && liveReady,
        structuralReady,
        operationalReady,
        liveReady,
        structural: { ready: structuralReady, reasons: structuralReasons },
        operational: { ready: operationalReady, reasons: operationalReasons },
        live: {
            ready: liveReady,
            reasons: liveReasons,
            latestRunId: optionalString(live['runId']),
            latestStatus: optionalString(live['status']),
        },
        snapshotFresh,
        snapshotAgeHours: ageHours === null ? null : Math.round(ageHours * 100) / 100,
        maxSnapshotAgeHours,
        runtimeMismatch: mismatch,
        standbyReady,
        reasons,
        recommendedActions,
    };
}

export class ModelGatewayReadControlPlane {
    /** @type {import('../catalog/json-catalog-store.js').JsonModelGatewayCatalogStore | SqliteModelGatewayCatalogStore} */
    #catalogStore;
    /** @type {SqliteModelGatewayCatalogStore} */
    #sqliteStore;
    /** @type {Record<string, string | undefined>} */
    #env;
    /** @type {ReturnType<typeof createModelGatewayEnvProfileStore>} */
    #profileStore;
    /** @type {() => number} */
    #now;

    /**
     * @param {{
     *   catalogStore?: import('../catalog/json-catalog-store.js').JsonModelGatewayCatalogStore | SqliteModelGatewayCatalogStore;
     *   sqliteStore?: SqliteModelGatewayCatalogStore;
     *   profileStore?: ReturnType<typeof createModelGatewayEnvProfileStore>;
     *   env?: Record<string, string | undefined>;
     *   now?: () => number;
     * }} [options]
     */
    constructor(options = {}) {
        this.#sqliteStore = options.sqliteStore ?? new SqliteModelGatewayCatalogStore();
        this.#catalogStore = /** @type {import('../catalog/json-catalog-store.js').JsonModelGatewayCatalogStore | SqliteModelGatewayCatalogStore} */ (
            assertModelGatewayCatalogReadPort(options.catalogStore ?? this.#sqliteStore)
        );
        this.#env = options.env ?? process.env;
        this.#profileStore = /** @type {ReturnType<typeof createModelGatewayEnvProfileStore>} */ (
            assertModelGatewayProviderProfileStorePort(
                options.profileStore ?? createModelGatewayEnvProfileStore({ env: this.#env }),
            )
        );
        this.#now = options.now ?? Date.now;
    }

    /**
     * @param {{ includeImportRuns?: boolean }} [options]
     */
    async #readRoutingSnapshot(options = {}) {
        if (this.#catalogStore instanceof SqliteModelGatewayCatalogStore) {
            return this.#catalogStore.readRoutingSnapshot(options);
        }
        return this.#catalogStore.readSnapshot();
    }

    /**
     * @param {{ maxSnapshotAgeHours: number; operationLimit: number }} input
     */
    async inspectOverview(input) {
        const startedAtMs = this.#now();
        const diagnostics = await this.#sqliteStore.readStorageDiagnostics();
        const byok = importConfiguredByokFromEnv(this.#env);
        const byokProjection = buildModelGatewayOperatorProjection({
            source: 'env_compat',
            generatedAt: new Date(this.#now()).toISOString(),
            active: byok.active,
            providers: byok.provider ? [byok.provider] : [],
            models: byok.models,
        });
        const activeByok = isRecord(byok.active) ? byok.active : {};
        const activeProvider = byok.provider && isRecord(byok.provider) ? byok.provider : null;
        /** @type {Record<string, unknown>[]} */
        let providerProfiles = [];
        /** @type {string | null} */
        let providerProfileError = null;
        try {
            providerProfiles = this.#profileStore.list();
        } catch (error) {
            providerProfileError = error instanceof Error ? error.message : String(error);
        }
        const activeProviderProfileName = optionalString(this.#env['COPILOT_BYOK_PROFILE']);
        const activeProviderProfile =
            providerProfiles.find((profile) => profile['name'] === activeProviderProfileName) ?? null;
        const secretDiagnostics = activeProvider
            ? diagnoseModelGatewayProviderSecretRefs(String(activeByok['providerId'] ?? activeProvider['id'] ?? ''), {
                  env: this.#env,
                  configuredRefs: Array.isArray(activeProvider['secretRefs'])
                      ? activeProvider['secretRefs'].map(String)
                      : [],
              })
            : null;
        const readiness = buildReadiness(
            /** @type {Record<string, unknown>} */ (diagnostics),
            input.maxSnapshotAgeHours,
            this.#now(),
        );
        const pendingHandoffs = {
            active: diagnostics.sdkSessionDeferredHandoffRows,
            latest: diagnostics.latestDeferredSdkSessionHandoff,
        };
        const latency = latencyObservation(startedAtMs, this.#now(), MODEL_GATEWAY_READ_LATENCY_BUDGET_MS.overview);
        return createModelGatewayControlPlaneResult({
            operation: 'overview.inspect',
            ok: readiness.ready,
            status: readiness.ready ? 'ready' : 'attention_required',
            data: {
                readiness,
                latency,
                activeByok: byok.active,
                effectiveRoute: byokProjection.effectiveRoute,
                pendingHandoffs,
                modelGateway: {
                    source: byokProjection.source,
                    providerCount: byokProjection.providerCount,
                    modelCount: byokProjection.modelCount,
                    enabledModelCount: byokProjection.enabledModelCount,
                    effectiveRoute: byokProjection.effectiveRoute,
                    pendingHandoffs,
                },
                providerProfiles: {
                    count: providerProfiles.length,
                    active: activeProviderProfile,
                    entries: providerProfiles.slice(0, 20),
                    truncated: providerProfiles.length > 20,
                    error: providerProfileError,
                },
                secretDiagnostics,
                counts: {
                    catalogRows: diagnostics.catalogRows,
                    providers: diagnostics.tableCounts['copilot_model_gateway_provider_projections'] ?? 0,
                    projections: diagnostics.tableCounts['copilot_model_gateway_model_projections'] ?? 0,
                    routeOptions: diagnostics.tableCounts['copilot_model_gateway_route_options'] ?? 0,
                    runtimeRows: diagnostics.runtimeRows,
                    routeDecisions: diagnostics.routeDecisionRows,
                    handoffs: diagnostics.sdkSessionHandoffRows,
                    confirmations: diagnostics.sdkSessionConfirmationRows,
                    standbyPlans: diagnostics.standbyPlanRows,
                },
                latest: {
                    automationDecision: diagnostics.latestAutomationDecision,
                    handoff: diagnostics.latestSdkSessionHandoff,
                    confirmation: diagnostics.latestSdkSessionConfirmation,
                    liveScenario: diagnostics.latestLiveScenarioRun,
                },
                requestedOperationLimit: input.operationLimit,
            },
            warnings: [
                ...byok.warnings,
                ...(providerProfileError ? ['provider_profile_store_invalid'] : []),
                ...readiness.reasons,
                ...(latency.withinBudget ? [] : ['overview_latency_budget_exceeded']),
            ],
            nextActions: readiness.ready ? ['inspect_route_plan'] : readiness.recommendedActions,
        });
    }

    /**
     * @param {{
     *   query: string | null;
     *   providerId: string | null;
     *   onlyEligible: boolean;
     *   requireTools: boolean;
     *   requireStreaming: boolean;
     *   requireReasoning: boolean;
     *   limit: number;
     * }} input
     */
    async searchCatalog(input) {
        const snapshot = await this.#readRoutingSnapshot();
        const entries = searchModelGatewayCatalogEntries(snapshot, {
            ...(input.query ? { query: input.query } : {}),
            ...(input.providerId ? { providerId: input.providerId } : {}),
            onlyEligible: input.onlyEligible,
            requireTools: input.requireTools,
            requireStreaming: input.requireStreaming,
            requireReasoning: input.requireReasoning,
            limit: input.limit,
        }).map((entry) => ({
            key: entry.key,
            providerId: entry.providerId,
            providerModel: entry.providerModel,
            displayName: entry.displayName,
            score: entry.score,
            matchedFields: entry.matchedFields,
            routeOptionCount: entry.routeOptionCount,
            accountOverlayCount: entry.accountOverlayCount,
            eligibilityStatus: entry.eligibilityStatus,
        }));
        return createModelGatewayControlPlaneResult({
            operation: 'catalog.search',
            data: {
                snapshotId: snapshot.snapshotId,
                generatedAt: snapshot.generatedAt,
                source: snapshot.source,
                matchCount: entries.length,
                entries,
            },
            warnings: snapshot.generatedAt ? [] : ['catalog_generated_at_missing'],
            nextActions: entries.length > 0 ? ['inspect_route_plan'] : ['broaden_search_or_refresh_catalog'],
        });
    }

    /**
     * @param {{ taskProfile: string; maxCandidates: number; evaluateEligibility: boolean; requireAgentProbeOk?: boolean; requireRuntimeProof?: boolean; maxRuntimeProofAgeMs?: number; ignoreRuntimeHealth?: boolean; pricePenaltyWeight?: number; latencyPenaltyWeight?: number; runtimeProofWeights?: Record<string, number> }} input
     */
    async planRoute(input) {
        const startedAtMs = this.#now();
        const snapshot = await this.#readRoutingSnapshot();
        const route = routeModelGatewayCatalogSnapshot(snapshot, input.taskProfile, {
            evaluateEligibility: input.evaluateEligibility,
            ...(input.requireAgentProbeOk === undefined ? {} : { requireAgentProbeOk: input.requireAgentProbeOk }),
            ...(input.requireRuntimeProof === undefined ? {} : { requireRuntimeProof: input.requireRuntimeProof }),
            ...(typeof input.maxRuntimeProofAgeMs === 'number' ? { maxRuntimeProofAgeMs: input.maxRuntimeProofAgeMs } : {}),
            ...(input.ignoreRuntimeHealth === undefined ? {} : { ignoreRuntimeHealth: input.ignoreRuntimeHealth }),
            ...(typeof input.pricePenaltyWeight === 'number' ? { pricePenaltyWeight: input.pricePenaltyWeight } : {}),
            ...(typeof input.latencyPenaltyWeight === 'number' ? { latencyPenaltyWeight: input.latencyPenaltyWeight } : {}),
            ...(input.runtimeProofWeights ? { runtimeProofWeights: input.runtimeProofWeights } : {}),
        });
        const explanation = explainGatewayRouteDecision(route);
        const byok = importConfiguredByokFromEnv(this.#env);
        const active = isRecord(byok.active) ? byok.active : {};
        const activeProvider = byok.provider && isRecord(byok.provider) ? byok.provider : {};
        const activeProviderId =
            optionalString(active['providerId']) ?? optionalString(activeProvider['id']);
        const selectedRouteBase = buildLiveRouteSwitchTarget(
            route.selected?.model ?? null,
            explanation.selectedId,
            input.taskProfile,
        );
        /** @type {Record<string, unknown> | null} */
        let bindingEvidence = null;
        let bindingEvidenceReadFailed = false;
        if (selectedRouteBase) {
            try {
                const observedEvidence = await readModelGatewayDirectRebindEvidence({
                    store: this.#sqliteStore,
                    previousProviderId: activeProviderId,
                    providerId: String(selectedRouteBase['providerId']),
                    wireApi: optionalString(selectedRouteBase['wireApi']),
                    now: this.#now(),
                });
                if (typeof observedEvidence['sampleSize'] === 'number' && observedEvidence['sampleSize'] > 0) {
                    bindingEvidence = observedEvidence;
                }
            } catch {
                bindingEvidenceReadFailed = true;
            }
        }
        const selectedRoute = selectedRouteBase
            ? applyModelGatewayBindingStrategy({
                  ...selectedRouteBase,
                  ...(bindingEvidence
                      ? {
                            runtimeEvidence: {
                                ...(isRecord(selectedRouteBase['runtimeEvidence'])
                                    ? selectedRouteBase['runtimeEvidence']
                                    : {}),
                                ...bindingEvidence,
                            },
                        }
                      : {}),
              })
            : null;
        const bindingDecision = isRecord(selectedRoute?.['bindingDecision']) ? selectedRoute['bindingDecision'] : null;
        const bindingBlocked = bindingDecision?.['strategy'] === 'blocked';
        const sessionTransition = buildSessionTransitionPlan(
            byok,
            route.selected?.model ?? null,
            bindingDecision,
        );
        const latency = latencyObservation(startedAtMs, this.#now(), MODEL_GATEWAY_READ_LATENCY_BUDGET_MS.routePlan);
        return createModelGatewayControlPlaneResult({
            operation: 'route.plan',
            ok: explanation.selected && !bindingBlocked,
            status: explanation.selected && !bindingBlocked ? 'planned' : 'blocked',
            dryRun: true,
            data: {
                snapshotId: snapshot.snapshotId,
                latency,
                taskProfile: input.taskProfile,
                selectedId: explanation.selectedId,
                selectedRoute,
                bindingDecision,
                sessionTransition,
                summary: explanation.summary,
                snapshotContext: route.snapshotContext,
                decisionLayers: explanation.decisionLayers,
                candidates: explanation.candidateSummaries.slice(0, input.maxCandidates),
                rejected: explanation.rejectedSummaries.slice(0, input.maxCandidates),
                rejectedReasonCounts: explanation.rejectedReasonCounts,
                fallbackChain: explanation.fallbackChain.slice(0, input.maxCandidates),
            },
            warnings: [
                ...explanation.topRejectedReasons,
                ...(latency.withinBudget ? [] : ['route_plan_latency_budget_exceeded']),
                ...(sessionTransition.providerRebindRequired ? ['selected_route_requires_live_provider_rebind'] : []),
                ...(Array.isArray(bindingDecision?.['warnings']) ? bindingDecision['warnings'].map(String) : []),
                ...(bindingEvidenceReadFailed ? ['direct_rebind_evidence_unavailable'] : []),
                ...(bindingBlocked ? ['selected_route_binding_strategy_blocked'] : []),
            ],
            nextActions: [
                ...new Set([
                    ...explanation.nextActions,
                    sessionTransition.nextAction,
                    ...(Array.isArray(bindingDecision?.['nextActions'])
                        ? bindingDecision['nextActions'].map(String)
                        : []),
                ]),
            ],
        });
    }

    /**
     * @param {{ modelIds: string[]; taskProfile: string; maxResults: number }} input
     */
    async evaluateModels(input) {
        const snapshot = await this.#readRoutingSnapshot();
        const profile = resolveModelGatewayTaskProfile(input.taskProfile);
        if (!profile) throw new Error(`MODEL_GATEWAY_TASK_PROFILE_UNKNOWN: ${input.taskProfile}`);
        const requested = new Set(input.modelIds.map((item) => item.toLowerCase()));
        const candidates = buildModelGatewayRouteCandidates({
            projections: snapshot.projections,
            routeOptions: snapshot.routeOptions,
            includeProjectionOnly: true,
        }).filter((candidate) => {
            const identities = [
                candidate['id'],
                candidate['canonicalModelId'],
                candidate['providerModel'],
                `${candidate['providerId']}:${candidate['providerModel']}`,
            ]
                .filter((item) => typeof item === 'string')
                .map((item) => String(item).toLowerCase());
            return identities.some((identity) => requested.has(identity));
        });
        const evaluated = candidates
            .map((candidate) =>
                scoreGatewayModelCandidate(candidate, profile, {
                    routeOptions: snapshot.routeOptions,
                    accountOverlays: snapshot.accountOverlays,
                    eligibilityDecisions: snapshot.modelEligibilityDecisions,
                }),
            )
            .sort((left, right) => right.score - left.score)
            .slice(0, input.maxResults)
            .map((item) => ({
                id: item.model['id'],
                canonicalModelId: item.model['canonicalModelId'] ?? null,
                providerId: item.model['providerId'],
                providerModel: item.model['providerModel'],
                identity: createModelGatewayModelIdentity({
                    providerId: item.model['providerId'],
                    providerModel: item.model['providerModel'],
                    canonicalModelId: item.model['canonicalModelId'] ?? null,
                    routeProfile: item.model['routeProfile'] ?? input.taskProfile,
                    snapshotId: snapshot.snapshotId,
                }),
                lifecycle: evaluateModelGatewayModelLifecycle(item.model),
                score: item.score,
                included: item.include,
                positiveReasons: item.reasons,
                rejectedReasons: item.rejectedReasons,
                eligibility: item.eligibility,
            }));
        const resolvedIds = new Set(
            evaluated.flatMap((item) => [item.id, item.canonicalModelId, item.providerModel]).filter(Boolean).map(String),
        );
        const unresolvedModelIds = input.modelIds.filter(
            (modelId) => ![...resolvedIds].some((resolved) => resolved.toLowerCase() === modelId.toLowerCase()),
        );
        return createModelGatewayControlPlaneResult({
            operation: 'model.evaluate',
            ok: evaluated.length > 0,
            status: evaluated.length > 0 ? 'completed' : 'not_found',
            data: {
                snapshotId: snapshot.snapshotId,
                taskProfile: input.taskProfile,
                requestedModelIds: input.modelIds,
                unresolvedModelIds,
                resultCount: evaluated.length,
                results: evaluated,
            },
            warnings: unresolvedModelIds.map((modelId) => `model_not_found:${modelId}`),
            nextActions: evaluated.length > 0 ? ['review_route_plan'] : ['search_catalog'],
        });
    }

    /**
     * @param {{
     *   objective: string;
     *   taskProfile: string;
     *   candidateModelIds: string[];
     *   maxCandidates: number;
     * }} input
     */
    async proposePolicy(input) {
        const proposal = buildPolicyProposalPatch(input.objective, input.taskProfile);
        const currentPolicy = await readModelGatewayRuntimeAutomationEffectivePolicy({ env: this.#env });
        const proposedPolicy = mergeModelGatewayRuntimeAutomationPolicy(currentPolicy, proposal.patch);
        const validation = validateModelGatewayRuntimeAutomationPolicy(proposedPolicy);
        const routeEvidence = await this.planRoute({
            taskProfile: input.taskProfile,
            maxCandidates: input.maxCandidates,
            evaluateEligibility: true,
        });
        const modelEvidence =
            input.candidateModelIds.length > 0
                ? await this.evaluateModels({
                      modelIds: input.candidateModelIds,
                      taskProfile: input.taskProfile,
                      maxResults: input.maxCandidates,
                  })
                : null;
        const currentPolicyRecord = /** @type {Record<string, unknown>} */ (currentPolicy);
        const proposedPolicyRecord = /** @type {Record<string, unknown>} */ (proposedPolicy);
        const changedFields = Object.keys(proposedPolicyRecord).filter(
            (field) => JSON.stringify(proposedPolicyRecord[field]) !== JSON.stringify(currentPolicyRecord[field]),
        );
        const routeWarnings = Array.isArray(routeEvidence['warnings']) ? routeEvidence['warnings'].map(String) : [];
        const modelWarnings =
            modelEvidence && Array.isArray(modelEvidence['warnings']) ? modelEvidence['warnings'].map(String) : [];
        return createModelGatewayControlPlaneResult({
            operation: 'policy.propose',
            ok: validation.ok,
            status: validation.ok ? 'proposed' : 'invalid_proposal',
            dryRun: true,
            data: {
                objective: input.objective,
                taskProfile: input.taskProfile,
                currentPolicy,
                proposedPatch: proposal.patch,
                proposedPolicy,
                changedFields,
                validation,
                rationale: proposal.rationale,
                risks: proposal.risks,
                evidence: {
                    routePlan: routeEvidence['data'],
                    modelEvaluation: modelEvidence?.['data'] ?? null,
                },
                availablePresets: listModelGatewayRuntimeAutomationPolicyPresets(),
                application: {
                    supported: false,
                    reason: 'policy_proposals_are_review_only',
                    applicationTool: null,
                },
            },
            warnings: [...new Set([...proposal.risks, ...routeWarnings, ...modelWarnings, ...validation.issues])],
            errors: validation.ok
                ? []
                : validation.issues.map((issue) => ({
                      code: 'MODEL_GATEWAY_POLICY_PROPOSAL_INVALID',
                      message: issue,
                      retryable: true,
                  })),
            nextActions: validation.ok
                ? ['review_policy_proposal', 'run_route_plan', 'do_not_apply_without_human_approval']
                : ['revise_policy_proposal'],
        });
    }

    /**
     * @param {{
     *   modelIds: string[];
     *   providerId: string | null;
     *   allowedProbeKinds: string[];
     *   maxProbeCount: number;
     *   maxEstimatedCostUsd: number;
     *   unknownCostPolicy: 'allow' | 'skip';
     *   recommendationLimit: number;
     *   probeFailureCooldownSeconds: number;
     * }} input
     */
    async planProbes(input) {
        const snapshot = await this.#readRoutingSnapshot({ includeImportRuns: true });
        const projections = snapshot.projections.filter(
            (projection) => !input.providerId || optionalString(projection['providerId']) === input.providerId,
        );
        const requestedKeys = resolveRequestedProjectionKeys(projections, input.modelIds, input.providerId);
        const latestRun = latestCatalogRefreshRun(snapshot.importRuns);
        const diff =
            input.modelIds.length > 0
                ? { added: requestedKeys, removed: [], changed: [] }
                : normalizeCatalogDiff(latestRun?.['diff']);
        const recommendations = recommendCatalogDiffProbes({
            diff,
            projections,
            eligibilityDecisions: snapshot.modelEligibilityDecisions,
            requireEligibilityDecision: snapshot.modelEligibilityDecisions.length > 0,
            limit: input.recommendationLimit,
        }).filter((recommendation) => !input.providerId || recommendation.providerId === input.providerId);
        const backoff = planModelGatewayProbeBackoff({
            recommendations,
            accountOverlays: snapshot.accountOverlays,
            healthRecords: listByokProviderModelHealth(),
            now: this.#now(),
            probeFailureCooldownSeconds: input.probeFailureCooldownSeconds,
        });
        const readyKeys = new Set(backoff.ready.map((item) => item.key));
        const budget = planCostBoundedCatalogProbes({
            recommendations: recommendations.filter((item) => readyKeys.has(item.key)),
            projections,
            allowedProbeKinds: input.allowedProbeKinds,
            maxProbeCount: input.maxProbeCount,
            maxEstimatedCostUsd: input.maxEstimatedCostUsd,
            unknownCostPolicy: input.unknownCostPolicy,
        });
        const noCandidates = recommendations.length === 0;
        return createModelGatewayControlPlaneResult({
            operation: 'probe.plan',
            ok: !noCandidates,
            status: noCandidates ? 'no_candidates' : 'planned',
            dryRun: true,
            data: {
                snapshotId: snapshot.snapshotId,
                source: input.modelIds.length > 0 ? 'explicit_model_shortlist' : 'latest_catalog_refresh_diff',
                latestCatalogRefreshRunId: optionalString(latestRun?.['runId']),
                requestedModelIds: input.modelIds,
                unresolvedModelIds:
                    input.modelIds.length > 0 && requestedKeys.length === 0 ? [...input.modelIds] : [],
                providerId: input.providerId,
                constraints: {
                    allowedProbeKinds: input.allowedProbeKinds,
                    maxProbeCount: input.maxProbeCount,
                    maxEstimatedCostUsd: input.maxEstimatedCostUsd,
                    unknownCostPolicy: input.unknownCostPolicy,
                    recommendationLimit: input.recommendationLimit,
                    probeFailureCooldownSeconds: input.probeFailureCooldownSeconds,
                },
                recommendationCount: recommendations.length,
                recommendations,
                backoff,
                budget,
                execution: {
                    supported: false,
                    reason: 'probe_plan_is_read_only',
                    executionTool: null,
                },
            },
            warnings: [
                ...(noCandidates ? ['no_probe_candidates'] : []),
                ...(backoff.deferred.length > 0 ? ['probe_candidates_deferred_by_rate_limit_or_cooldown'] : []),
                ...(budget.skipped.length > 0 ? ['probe_candidates_skipped_by_budget_or_kind_policy'] : []),
            ],
            nextActions:
                budget.selected.length > 0
                    ? ['review_probe_plan', 'request_authorized_probe_execution']
                    : ['review_probe_constraints_or_refresh_catalog'],
        });
    }

    /**
     * @param {{ operationId: string | null; limit: number }} input
     */
    async inspectOperation(input) {
        const readLimit = Math.min(Math.max(input.limit * 5, input.limit), 100);
        const [routeDecisions, handoffs, confirmations, runtimeProbeRun] = await Promise.all([
            this.#sqliteStore.readRouteDecisionEvents({ limit: readLimit }),
            this.#sqliteStore.readSdkSessionHandoffRecords({ limit: readLimit }),
            this.#sqliteStore.readSdkSessionConfirmationRecords({ limit: readLimit }),
            input.operationId ? this.#sqliteStore.readRuntimeProbeRunRecord(input.operationId) : Promise.resolve(null),
        ]);
        /**
         * @param {Record<string, unknown>[]} rows
         * @returns {Record<string, unknown>[]}
         */
        const filter = (rows) =>
            rows
                .filter(isRecord)
                .filter((row) => !input.operationId || hasOperationId(row, input.operationId))
                .slice(0, input.limit);
        const matchedHandoffs = filter(handoffs);
        const deferredOperations = matchedHandoffs.flatMap((handoff) => {
            const operation = isRecord(handoff['operation']) ? handoff['operation'] : null;
            if (!operation || operation['state'] !== 'deferred_until_turn_boundary') return [];
            return [classifyModelGatewayDeferredRouteOperation(operation, { now: this.#now() })];
        });
        const data = {
            operationId: input.operationId,
            routeDecisions: filter(routeDecisions),
            handoffs: matchedHandoffs,
            confirmations: filter(confirmations),
            runtimeProbeRuns: runtimeProbeRun ? [runtimeProbeRun] : [],
            deferredOperations,
            deferredSummary: {
                total: deferredOperations.length,
                promotable: deferredOperations.filter((entry) => entry.promotable).length,
                expired: deferredOperations.filter((entry) => entry.expired).length,
                reviewRequired: deferredOperations.filter((entry) => entry.requiresReview).length,
            },
        };
        const matchCount =
            data.routeDecisions.length + data.handoffs.length + data.confirmations.length + data.runtimeProbeRuns.length;
        return createModelGatewayControlPlaneResult({
            operation: 'operation.inspect',
            ok: input.operationId === null || matchCount > 0,
            status: input.operationId !== null && matchCount === 0 ? 'not_found' : 'completed',
            data: { ...data, matchCount },
            warnings: input.operationId !== null && matchCount === 0 ? ['operation_not_found'] : [],
            nextActions: matchCount > 0 ? ['inspect_related_route_or_confirmation'] : ['verify_operation_id'],
        });
    }
}

export function createModelGatewayReadControlPlane(options = {}) {
    return new ModelGatewayReadControlPlane(options);
}
