#!/usr/bin/env node
import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    buildModelGatewayRuntimeSelectorPlan,
    buildModelGatewayRuntimeSelectorProbeRun,
    createGatewayRuntimeHealthIndex,
    compareModelGatewaySelectionAudits,
    createModelGatewayRouteDecisionCapture,
    createEnvSecretRegistry,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    evaluateModelGatewayCatalogEligibility,
    executeModelGatewayRuntimeSelectorPlanWithFallbacks,
    filterModelGatewayRuntimeEligibilityOverlayDecisions,
    flushAndMirrorByokProviderHealthToSqlite,
    listByokProviderModelHealth,
    MODEL_GATEWAY_LIVE_PROTOCOL_PROBE_KINDS,
    mergeByokProviderHealthRecords,
    resolveModelGatewaySelectionPolicy,
    summarizeModelGatewayRuntimeAccountOverlays,
} from '../../../src/copilot/model-gateway/index.js';
import { setDbLogger } from '../../../src/copilot/db/sqlite.js';
import { shutdownClient } from '../../../src/copilot/sdk/session/index.js';
import { loadModelGatewayDotenv } from '../lib/env.mjs';

loadModelGatewayDotenv();

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-runtime-selector.mjs [--json] [--full-json] [--execute] [--fail] [--profile ID] [--fallback-profiles a,b] [--selection-policy metadata_first|prefer_runtime_proved|require_runtime_proof] [--require-runtime-proof] [--runtime-proof-weights key=value,...] [--allow-probe] [--allow-env-missing] [--prefer-provider-diversity] [--preferred-probes a,b] [--block-failed-probes a,b] [--require-agent-probe-profiles a,b] [--runtime-health-limit N] [--temporary-failure-cooldown-ms N] [--max-attempts N] [--max-attempts-per-provider N] [--attempts-per-route N] [--retry-delay-ms N] [--max-retry-delay-ms N] [--timeout-ms N]

Build the final model-gateway runtime selector plan. By default this is dry-run only: it reads metadata plus already
observed health, validates route-aware BYOK env readiness, and does not execute providers. Provider calls require the
explicit --execute flag.
`);
    process.exit(0);
}

function readArg(name, fallback = '') {
    const prefix = `${name}=`;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg.startsWith(prefix)) return arg.slice(prefix.length);
        if (arg === name) return args[index + 1] ?? fallback;
    }
    return fallback;
}

function readProfiles() {
    const values = [];
    const profile = readArg('--profile');
    const profiles = readArg('--profiles');
    const fallbackProfiles = readArg('--fallback-profiles');
    if (profile) values.push(profile);
    if (profiles) values.push(...profiles.split(','));
    if (fallbackProfiles) values.push(...fallbackProfiles.split(','));
    return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function readInteger(name, fallback) {
    const raw = readArg(name);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readStringList(name) {
    return [
        ...new Set(
            readArg(name)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    ];
}

function readRuntimeProofWeights() {
    const raw = readArg('--runtime-proof-weights');
    if (!raw.trim()) return null;
    const weights = {};
    for (const item of raw.split(',')) {
        const [key, value] = item.split(/[=:]/u, 2).map((part) => part.trim());
        if (!key || !value) continue;
        const number = Number(value);
        if (Number.isFinite(number)) weights[key] = number;
    }
    return Object.keys(weights).length > 0 ? weights : null;
}

function selectedDispositions(selection) {
    return [
        ...new Set(
            selection.profiles
                .map((profile) =>
                    typeof profile.selected?.['eligibilityDisposition'] === 'string'
                        ? profile.selected['eligibilityDisposition']
                        : null,
                )
                .filter((item) => item !== null),
        ),
    ].sort();
}

function runtimeSourceArg() {
    const value = readArg('--runtime-source', 'merged');
    return ['file', 'sqlite', 'merged'].includes(value) ? value : 'merged';
}

function selectionPolicyArg(requireRuntimeProof) {
    if (requireRuntimeProof) return 'require_runtime_proof';
    const value = readArg('--selection-policy', 'metadata_first').replaceAll('-', '_');
    return ['metadata_first', 'prefer_runtime_proved', 'require_runtime_proof'].includes(value) ? value : 'metadata_first';
}

function formatCountMap(counts) {
    return Object.entries(counts ?? {})
        .map(([key, count]) => `${key}:${count}`)
        .join(',') || '-';
}

async function measured(timings, name, callback) {
    const started = Date.now();
    try {
        return await callback();
    } finally {
        timings.push({ name, durationMs: Date.now() - started });
    }
}

function measuredSync(timings, name, callback) {
    const started = Date.now();
    try {
        return callback();
    } finally {
        timings.push({ name, durationMs: Date.now() - started });
    }
}

async function buildRuntimeSelectorContext({
    strict,
    requireRuntimeProof,
    requireRuntimeEnvReady,
    selectionPolicy,
    runtimeSource,
    runtimeHealthLimit,
    preferredProbeKinds = [],
    blockFailedProbeKinds = [],
    requireAgentProbeProfiles = [],
    temporaryFailureCooldownMs = null,
    preferProviderDiversity = false,
    runtimeProofWeights = null,
}) {
    const timings = [];
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await measured(timings, 'catalog.read_json_snapshot', () => store.readSnapshot());
    const integrity = measuredSync(timings, 'catalog.integrity_audit', () => auditModelGatewayCatalogSnapshotIntegrity(snapshot));
    const secretRegistry = measuredSync(timings, 'env.secret_registry', () => createEnvSecretRegistry());
    const fileHealthRecords = measuredSync(timings, 'health.read_file_store', () => listByokProviderModelHealth());
    let sqliteHealthRecords = [];
    let sqliteRuntimeError = null;
    if (runtimeSource === 'sqlite' || runtimeSource === 'merged') {
        try {
            sqliteHealthRecords = await measured(timings, 'health.read_sqlite_store', () =>
                new SqliteModelGatewayCatalogStore().listLatestRuntimeHealthRecords({ limit: runtimeHealthLimit }),
            );
        } catch (error) {
            sqliteRuntimeError = error instanceof Error ? error.message : String(error);
        }
    }
    const healthRecords = measuredSync(timings, 'health.merge_runtime_sources', () =>
        runtimeSource === 'file'
            ? fileHealthRecords
            : runtimeSource === 'sqlite'
              ? sqliteHealthRecords
              : mergeByokProviderHealthRecords(fileHealthRecords, sqliteHealthRecords),
    );
    const runtimeAccountOverlays = measuredSync(timings, 'account.runtime_overlays_from_health', () =>
        deriveModelGatewayRuntimeAccountOverlaysFromHealth(healthRecords, {
            accountWideFailureKinds: ['auth', 'credits', 'rate-limit'],
        }),
    );
    const evaluationNow = new Date();
    const runtimeAccountOverlaySummary = measuredSync(timings, 'account.runtime_overlay_summary', () =>
        summarizeModelGatewayRuntimeAccountOverlays(runtimeAccountOverlays, {
            now: evaluationNow,
        }),
    );
    const evaluated = measuredSync(timings, 'eligibility.evaluate_effective', () =>
        evaluateModelGatewayCatalogEligibility({
            snapshot,
            secretRegistry,
            healthRecords,
            now: () => evaluationNow,
            policy: {
                unknownAccessPolicy: strict ? 'block' : 'allow_probe',
                policyProfile: strict ? 'runtime-selector-strict' : 'runtime-selector-allow-probe',
                runtimeAccountWideFailureKinds: ['auth', 'credits', 'rate-limit'],
            },
        }),
    );
    const runtimeOverlayDecisions = measuredSync(timings, 'eligibility.filter_runtime_overlays', () =>
        filterModelGatewayRuntimeEligibilityOverlayDecisions(evaluated.decisions),
    );
    const runtimeHealthIndex = measuredSync(timings, 'health.build_runtime_index', () =>
        createGatewayRuntimeHealthIndex(healthRecords),
    );
    const effectiveSnapshot = {
        ...snapshot,
        source: 'runtime-selector-effective-preview',
        modelEligibilityDecisions: [
            ...(Array.isArray(snapshot.modelEligibilityDecisions) ? snapshot.modelEligibilityDecisions : []),
            ...runtimeOverlayDecisions,
        ],
        modelEligibilityRuns: [
            ...(Array.isArray(snapshot.modelEligibilityRuns) ? snapshot.modelEligibilityRuns : []),
            evaluated.run,
        ],
    };
    const profileIds = readProfiles();
    const selection = measuredSync(timings, 'selection.pre_runtime_audit', () =>
        auditModelGatewayPreRuntimeSelection(effectiveSnapshot, {
            strict,
            profiles: profileIds,
            secretRegistry,
            ...(runtimeProofWeights ? { runtimeProofWeights } : {}),
            ...(preferredProbeKinds.length > 0 ? { preferredProbeKinds } : {}),
            ...(blockFailedProbeKinds.length > 0 ? { blockFailedProbeKinds } : {}),
            ...(temporaryFailureCooldownMs !== null ? { temporaryFailureCooldownMs } : {}),
        }),
    );
    const postRuntimeSelection = measuredSync(timings, 'selection.post_runtime_audit', () =>
        auditModelGatewayPostRuntimeSelection(effectiveSnapshot, {
            strict,
            profiles: profileIds,
            secretRegistry,
            runtimeHealthRecords: healthRecords,
            runtimeHealthIndex,
            requireRuntimeProof,
            ...(runtimeProofWeights ? { runtimeProofWeights } : {}),
            ...(preferredProbeKinds.length > 0 ? { preferredProbeKinds } : {}),
            ...(blockFailedProbeKinds.length > 0 ? { blockFailedProbeKinds } : {}),
            ...(temporaryFailureCooldownMs !== null ? { temporaryFailureCooldownMs } : {}),
        }),
    );
    const comparison = measuredSync(timings, 'selection.compare_audits', () =>
        compareModelGatewaySelectionAudits(selection, postRuntimeSelection),
    );
    const policyResolution = measuredSync(timings, 'selection.resolve_policy', () =>
        resolveModelGatewaySelectionPolicy(comparison, { mode: selectionPolicy }),
    );
    const runtimeSelectorPlan = measuredSync(timings, 'selector.build_plan', () =>
        buildModelGatewayRuntimeSelectorPlan(policyResolution, {
            source: 'model-gateway-runtime-selector',
            requireRuntimeProof,
            requireRuntimeEnvReady,
            env: process.env,
            runtimeHealthRecords: healthRecords,
            runtimeHealthIndex,
            requireAgentProbeProfiles,
            preferProviderDiversity,
            ...(blockFailedProbeKinds.length > 0 ? { blockFailedProbeKinds } : {}),
            ...(temporaryFailureCooldownMs !== null ? { temporaryFailureCooldownMs } : {}),
        }),
    );
    return {
        storePath: store.filePath,
        snapshot,
        integrity,
        healthRecords,
        sqliteRuntimeError,
        runtimeAccountOverlaySummary,
        eligibility: evaluated,
        selection,
        postRuntimeSelection,
        comparison,
        policyResolution,
        runtimeSelectorPlan,
        runtimeOverlayDecisionCount: runtimeOverlayDecisions.length,
        selectedDispositions: selectedDispositions(selection),
        postRuntimeDispositions: selectedDispositions(postRuntimeSelection),
        timings,
    };
}

const json = argSet.has('--json');
const fullJson = argSet.has('--full-json');
const execute = argSet.has('--execute');
const fail = argSet.has('--fail');
const strict = argSet.has('--strict') || !argSet.has('--allow-probe');
const requireRuntimeProof = argSet.has('--require-runtime-proof') || argSet.has('--runtime-proof');
const requireRuntimeEnvReady = !argSet.has('--allow-env-missing');
const runtimeSource = runtimeSourceArg();
const selectionPolicy = selectionPolicyArg(requireRuntimeProof);
const preferredProbeKinds = readStringList('--preferred-probes');
const blockFailedProbeKinds = readStringList('--block-failed-probes');
const requireAgentProbeProfiles = readStringList('--require-agent-probe-profiles');
const temporaryFailureCooldownMs = readInteger('--temporary-failure-cooldown-ms', 0);
const runtimeHealthLimit = readInteger('--runtime-health-limit', 1_500);
const runtimeProofWeights = readRuntimeProofWeights();
const requestedExecutionProfile = readArg('--profile') || null;
const fallbackExecutionProfiles = readArg('--fallback-profiles')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

if (json) {
    setDbLogger((level, message) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${message}\n`);
        }
    });
}

const context = await buildRuntimeSelectorContext({
    strict,
    requireRuntimeProof,
    requireRuntimeEnvReady,
    selectionPolicy,
    runtimeSource,
    runtimeHealthLimit,
    preferredProbeKinds,
    blockFailedProbeKinds,
    requireAgentProbeProfiles,
    temporaryFailureCooldownMs: temporaryFailureCooldownMs > 0 ? temporaryFailureCooldownMs : null,
    preferProviderDiversity: argSet.has('--prefer-provider-diversity'),
    runtimeProofWeights,
});

let execution = null;
let routeDecisionPersistence = {
    attempted: false,
    ok: true,
    written: 0,
    error: null,
};
let runtimeHealthPersistence = {
    attempted: false,
    ok: true,
    records: 0,
    healthObservations: 0,
    probeResults: 0,
    skippedRecords: 0,
    runId: null,
    error: null,
};
let runtimeProbePersistence = {
    attempted: false,
    ok: true,
    runId: null,
    probeResults: 0,
    skippedResults: 0,
    successCount: 0,
    failureCount: 0,
    error: null,
};

function routeRequestProfiles() {
    return [requestedExecutionProfile, ...fallbackExecutionProfiles].filter(
        (profile) => typeof profile === 'string' && profile.trim(),
    );
}

function hasSelectedRequestedOrFallbackRoute(plan) {
    const profiles = new Set(routeRequestProfiles());
    if (profiles.size === 0) return plan.summary.blockedProfileCount === 0;
    return plan.routes.some((route) => profiles.has(route.profileId) && route.status === 'selected' && route.selected);
}

if (execute) {
    if (!context.runtimeSelectorPlan.ready) {
        execution = {
            schema: 'model-gateway-runtime-selector-fallback-execution-result',
            ok: false,
            status: 'blocked',
            attemptedCount: 0,
            selectedProfileId: null,
            attempts: [],
            retryDecisions: [],
            skippedAttemptCount: 0,
            skippedAttempts: [],
            routeDecisionRecordedCount: 0,
            final: null,
            error: 'runtime_selector_plan_not_ready',
        };
    } else {
        const runtimeRouteDecisionCapture = createModelGatewayRouteDecisionCapture();
        const maxAttempts = readInteger('--max-attempts', 0);
        const maxAttemptsPerProvider = readInteger('--max-attempts-per-provider', 4);
        execution = await executeModelGatewayRuntimeSelectorPlanWithFallbacks(context.runtimeSelectorPlan, {
            profileId: requestedExecutionProfile || undefined,
            fallbackProfileIds: fallbackExecutionProfiles,
            ...(maxAttempts > 0 ? { maxAttempts } : {}),
            maxAttemptsPerProvider,
            attemptsPerRoute: readInteger('--attempts-per-route', 1),
            retryDelayMs: readInteger('--retry-delay-ms', 0),
            maxRetryDelayMs: readInteger('--max-retry-delay-ms', 30_000),
            timeoutMs: readInteger('--timeout-ms', 45_000),
            env: process.env,
            deps: {
                recordRouteDecision: runtimeRouteDecisionCapture.record,
            },
        });
        const decisionEvents = runtimeRouteDecisionCapture.listUnique();
        routeDecisionPersistence = {
            attempted: decisionEvents.length > 0,
            ok: true,
            written: 0,
            error: null,
        };
        if (decisionEvents.length > 0) {
            try {
                await new SqliteModelGatewayCatalogStore().writeRouteDecisionEvents(decisionEvents);
                routeDecisionPersistence.written = decisionEvents.length;
            } catch (error) {
                routeDecisionPersistence.ok = false;
                routeDecisionPersistence.error = error instanceof Error ? error.message : String(error);
            }
        }
        const directRuntimeProbeRun = buildModelGatewayRuntimeSelectorProbeRun(execution, { observedAt: new Date() });
        runtimeProbePersistence = {
            attempted: directRuntimeProbeRun.results.length > 0 || directRuntimeProbeRun.skippedCount > 0,
            ok: true,
            runId: null,
            probeResults: 0,
            skippedResults: 0,
            successCount: 0,
            failureCount: 0,
            error: null,
        };
        if (runtimeProbePersistence.attempted) {
            try {
                const result = await new SqliteModelGatewayCatalogStore().writeRuntimeProbeRun(directRuntimeProbeRun);
                runtimeProbePersistence = {
                    attempted: true,
                    ok: true,
                    runId: result.runId,
                    probeResults: result.probeResults,
                    skippedResults: result.skippedResults,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                    error: null,
                };
            } catch (error) {
                runtimeProbePersistence.ok = false;
                runtimeProbePersistence.error = error instanceof Error ? error.message : String(error);
            }
        }
        const healthRecordsAfterExecution = listByokProviderModelHealth();
        runtimeHealthPersistence = {
            attempted: healthRecordsAfterExecution.length > 0,
            ok: true,
            records: healthRecordsAfterExecution.length,
            healthObservations: 0,
            probeResults: 0,
            skippedRecords: 0,
            runId: null,
            error: null,
        };
        if (healthRecordsAfterExecution.length > 0) {
            try {
                const result = await flushAndMirrorByokProviderHealthToSqlite({
                    sqliteStore: new SqliteModelGatewayCatalogStore(),
                    records: healthRecordsAfterExecution,
                    observedAt: new Date(),
                });
                runtimeHealthPersistence = {
                    attempted: true,
                    ok: true,
                    records: result.records,
                    healthObservations: result.healthObservations,
                    probeResults: result.probeResults,
                    skippedRecords: result.skippedRecords,
                    runId: result.runId,
                    error: null,
                };
            } catch (error) {
                runtimeHealthPersistence.ok = false;
                runtimeHealthPersistence.error = error instanceof Error ? error.message : String(error);
            }
        }
    }
}

const commandOk =
    context.integrity.ok &&
    context.selection.ok &&
    context.postRuntimeSelection.ok &&
    context.policyResolution.ok &&
    context.runtimeSelectorPlan.ready &&
    (execute ? execution?.ok === true : hasSelectedRequestedOrFallbackRoute(context.runtimeSelectorPlan)) &&
    routeDecisionPersistence.ok &&
    runtimeProbePersistence.ok &&
    runtimeHealthPersistence.ok;

const summary = {
    schema: 'model-gateway-runtime-selector-command',
    ok: commandOk,
    runtimeExecuted: execute,
    routeRequest: {
        profileId: requestedExecutionProfile,
        fallbackProfileIds: fallbackExecutionProfiles,
        executionOkCanSucceedWithBlockedFallbackProfiles: execute,
        dryRunOkCanSucceedWithSelectedFallbackProfile: !execute,
    },
    mode: strict ? 'strict_access_only_with_observed_health' : 'allow_probe_unknown_with_observed_health',
    runtimeSource,
    selectionPolicy,
    runtimeProofWeights,
    preferredProbeKinds,
    blockFailedProbeKinds,
    requireAgentProbeProfiles,
    liveProtocolProbeKinds: MODEL_GATEWAY_LIVE_PROTOCOL_PROBE_KINDS,
    requireRuntimeProof,
    requireRuntimeEnvReady,
    storePath: context.storePath,
    snapshotId: context.snapshot.snapshotId,
    generatedAt: context.snapshot.generatedAt,
    integrity: {
        ok: context.integrity.ok,
        redactedIdentityCount: context.integrity.redactedIdentityCount,
    },
    observed: {
        healthRecordCount: context.healthRecords.length,
        sqliteRuntimeError: context.sqliteRuntimeError,
        runtimeAccountOverlaySummary: context.runtimeAccountOverlaySummary,
        eligibilityDecisionCount: context.eligibility.decisions.length,
        runtimeOverlayDecisionCount: context.runtimeOverlayDecisionCount,
    },
    timings: context.timings,
    selection: {
        selected: context.selection.summary.selectedProfileCount,
        profiles: context.selection.summary.profileCount,
        providers: context.selection.summary.selectedProviders,
        dispositions: context.selectedDispositions,
    },
    postRuntimeSelection: {
        selected: context.postRuntimeSelection.summary.selectedProfileCount,
        profiles: context.postRuntimeSelection.summary.profileCount,
        providers: context.postRuntimeSelection.summary.selectedProviders,
        dispositions: context.postRuntimeDispositions,
        healthProofs: context.postRuntimeSelection.summary.runtimeHealthProofCount,
        probeProofs: context.postRuntimeSelection.summary.runtimeProbeProofCount,
    },
    policyResolution: context.policyResolution,
    runtimeSelectorPlan: context.runtimeSelectorPlan,
    execution,
    routeDecisionPersistence,
    runtimeProbePersistence,
    runtimeHealthPersistence,
    nextCommands: execute
        ? ['npm run model-gateway:runtime-selector', 'npm run model-gateway:live:readiness']
        : [
              'npm run model-gateway:runtime-selector -- --fail',
              'npm run model-gateway:live:readiness',
              'npm run model-gateway:runtime-selector -- --execute --profile <profile>',
          ],
};

function compactHealthDecision(value) {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!row) return null;
    const health = row['health'] && typeof row['health'] === 'object' && !Array.isArray(row['health']) ? row['health'] : null;
    return {
        include: row['include'] === true,
        reason: typeof row['reason'] === 'string' ? row['reason'] : null,
        providerId: typeof health?.['providerId'] === 'string' ? health['providerId'] : null,
        providerModel: typeof health?.['providerModel'] === 'string' ? health['providerModel'] : null,
        lastStatus: typeof health?.['lastStatus'] === 'string' ? health['lastStatus'] : null,
        agentProbeStatus: typeof health?.['agentProbeStatus'] === 'string' ? health['agentProbeStatus'] : null,
        verifiedProbes: Array.isArray(health?.['verifiedProbes']) ? health['verifiedProbes'].slice(0, 8) : [],
        failedProbes: Array.isArray(health?.['failedProbes']) ? health['failedProbes'].slice(0, 8) : [],
    };
}

function compactProviderCooldown(value) {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!row) return null;
    return {
        include: row['include'] === true,
        reason: typeof row['reason'] === 'string' ? row['reason'] : null,
        providerId: typeof row['providerId'] === 'string' ? row['providerId'] : null,
        failureKinds: Array.isArray(row['failureKinds']) ? row['failureKinds'].slice(0, 8) : [],
        failedModelCount: typeof row['failedModelCount'] === 'number' ? row['failedModelCount'] : null,
        retryAfterSeconds: typeof row['retryAfterSeconds'] === 'number' ? row['retryAfterSeconds'] : null,
        resetAt: typeof row['resetAt'] === 'string' ? row['resetAt'] : null,
    };
}

function compactSelectedRoute(selected) {
    const row = selected && typeof selected === 'object' && !Array.isArray(selected) ? selected : null;
    if (!row) return null;
    return {
        id: typeof row['id'] === 'string' ? row['id'] : null,
        providerId: typeof row['providerId'] === 'string' ? row['providerId'] : null,
        providerModel: typeof row['providerModel'] === 'string' ? row['providerModel'] : null,
        selectorSyntax: typeof row['selectorSyntax'] === 'string' ? row['selectorSyntax'] : null,
        routeProfile: typeof row['routeProfile'] === 'string' ? row['routeProfile'] : null,
        routeLayer: typeof row['routeLayer'] === 'string' ? row['routeLayer'] : null,
        wireApi: typeof row['wireApi'] === 'string' ? row['wireApi'] : null,
        baseUrl: typeof row['baseUrl'] === 'string' ? row['baseUrl'] : null,
        openAICompatibleBaseUrl:
            typeof row['openAICompatibleBaseUrl'] === 'string' ? row['openAICompatibleBaseUrl'] : null,
        localPrivate: row['localPrivate'] === true,
        score: typeof row['score'] === 'number' ? row['score'] : null,
        hasRuntimeProof: row['hasRuntimeProof'] === true,
        reasons: Array.isArray(row['reasons']) ? row['reasons'].slice(0, 12) : [],
    };
}

function compactDecisionEvent(event) {
    const row = event && typeof event === 'object' && !Array.isArray(event) ? event : null;
    if (!row) return null;
    return {
        type: typeof row['type'] === 'string' ? row['type'] : null,
        decisionId: typeof row['decisionId'] === 'string' ? row['decisionId'] : null,
        taskProfile: typeof row['taskProfile'] === 'string' ? row['taskProfile'] : null,
        routeProfile: typeof row['routeProfile'] === 'string' ? row['routeProfile'] : null,
        mode: typeof row['mode'] === 'string' ? row['mode'] : null,
        source: typeof row['source'] === 'string' ? row['source'] : null,
        selected: row['selected'] === true,
        providerId: typeof row['providerId'] === 'string' ? row['providerId'] : null,
        modelId: typeof row['modelId'] === 'string' ? row['modelId'] : null,
        failure: typeof row['failure'] === 'string' ? row['failure'] : null,
    };
}

function compactSelectorRoute(route) {
    return {
        profileId: route.profileId,
        status: route.status,
        source: route.source,
        selected: compactSelectedRoute(route.selected),
        selectedRouteKey: route.selectedRouteKey,
        hasRuntimeProof: route.hasRuntimeProof,
        runtimeEnv: route.runtimeEnv,
        runtimeHealth: compactHealthDecision(route.runtimeHealth),
        providerCooldown: compactProviderCooldown(route.providerCooldown),
        alternativeSummary: route.alternativeSummary,
        candidateAlternatives: route.candidateAlternatives.slice(0, 12).map((candidate) => ({
            profileId: candidate['profileId'],
            status: candidate['status'],
            source: candidate['source'],
            selected: compactSelectedRoute(candidate['selected']),
            selectedRouteKey: candidate['selectedRouteKey'],
            hasRuntimeProof: candidate['hasRuntimeProof'] === true,
            runtimeEnv: candidate['runtimeEnv'],
            runtimeHealth: compactHealthDecision(candidate['runtimeHealth']),
            providerCooldown: compactProviderCooldown(candidate['providerCooldown']),
            reasons: Array.isArray(candidate['reasons']) ? candidate['reasons'].slice(0, 12) : [],
            nextActions: Array.isArray(candidate['nextActions']) ? candidate['nextActions'].slice(0, 8) : [],
            decisionEvent: compactDecisionEvent(candidate['decisionEvent']),
        })),
        reasons: route.reasons.slice(0, 16),
        nextActions: route.nextActions.slice(0, 8),
        decisionEvent: compactDecisionEvent(route.decisionEvent),
    };
}

function compactRuntimeSelectorPlan(plan) {
    return {
        ...plan,
        routes: plan.routes.map(compactSelectorRoute),
    };
}

function compactPolicyResolution(policyResolution) {
    return {
        schema: policyResolution.schema,
        ok: policyResolution.ok,
        mode: policyResolution.mode,
        summary: policyResolution.summary,
        rows: policyResolution.rows.map((row) => ({
            profileId: row['profileId'],
            source: row['source'],
            changedFromPreRuntime: row['changedFromPreRuntime'] === true,
            hasRuntimeProof: row['hasRuntimeProof'] === true,
            selected: compactSelectedRoute(row['selected']),
            preSelected: compactSelectedRoute(row['preSelected']),
            postSelected: compactSelectedRoute(row['postSelected']),
            candidateAlternates: Array.isArray(row['candidateAlternates'])
                ? row['candidateAlternates'].slice(0, 12).map(compactSelectedRoute)
                : [],
        })),
    };
}

function compactSummaryForJson(value) {
    if (fullJson) return value;
    return {
        ...value,
        policyResolution: compactPolicyResolution(value.policyResolution),
        runtimeSelectorPlan: compactRuntimeSelectorPlan(value.runtimeSelectorPlan),
    };
}

if (json) {
    process.stdout.write(`${JSON.stringify(compactSummaryForJson(summary), null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway runtime selector: ok=${summary.ok ? 'yes' : 'no'} runtime=${execute ? 'yes' : 'no'} mode=${summary.mode}\n`,
    );
    process.stdout.write(
        `selection: selected=${summary.selection.selected}/${summary.selection.profiles} providers=${formatCountMap(summary.selection.providers)} dispositions=${summary.selection.dispositions.join(',') || '-'}\n`,
    );
    process.stdout.write(
        `post-runtime: selected=${summary.postRuntimeSelection.selected}/${summary.postRuntimeSelection.profiles} healthProofs=${summary.postRuntimeSelection.healthProofs} probeProofs=${summary.postRuntimeSelection.probeProofs}\n`,
    );
    process.stdout.write(
        `timings: ${context.timings.map((item) => `${item.name}=${item.durationMs}ms`).join(' · ') || '-'}\n`,
    );
    process.stdout.write(
        `plan: ready=${context.runtimeSelectorPlan.ready ? 'yes' : 'no'} selected=${context.runtimeSelectorPlan.summary.selectedProfileCount}/${context.runtimeSelectorPlan.summary.profileCount} blocked=${context.runtimeSelectorPlan.summary.blockedProfileCount} envReady=${context.runtimeSelectorPlan.summary.runtimeEnvReadyCount} envBlocked=${context.runtimeSelectorPlan.summary.runtimeEnvBlockedCount} proofSelected=${context.runtimeSelectorPlan.summary.runtimeProofSelectedCount}\n`,
    );
    for (const route of context.runtimeSelectorPlan.routes) {
        const runtimeEnv = route.runtimeEnv;
        const selected = route.selected ?? {};
        process.stdout.write(
            `  ${route.profileId}: ${route.status} route=${route.selectedRouteKey ?? '-'} selector=${selected['selectorKind'] ?? '-'}:${selected['selectorSyntax'] ?? '-'} layer=${selected['routeLayer'] ?? '-'} wire=${selected['wireApi'] ?? '-'} upstream=${selected['upstreamProvider'] ?? '-'} env=${runtimeEnv?.status ?? '-'} missing=${runtimeEnv?.missingRequiredKeys.join(',') || '-'} alternatives=${route.alternativeSummary?.usableCount ?? 0}/${route.alternativeSummary?.evaluatedCount ?? 0} reasons=${route.reasons.slice(0, 4).join(',') || '-'}\n`,
        );
    }
    if (execution) {
        process.stdout.write(
            `execution: ok=${execution.ok ? 'yes' : 'no'} status=${execution.status} attempted=${execution.attemptedCount} skipped=${execution.skippedAttemptCount ?? 0} selected=${execution.selectedProfileId ?? '-'} routeDecisionEvents=${execution.routeDecisionRecordedCount ?? 0} error=${execution.error ?? '-'}\n`,
        );
        process.stdout.write(
            `route-decisions: attempted=${routeDecisionPersistence.attempted ? 'yes' : 'no'} written=${routeDecisionPersistence.written} error=${routeDecisionPersistence.error ?? '-'}\n`,
        );
        process.stdout.write(
            `runtime-probes: attempted=${runtimeProbePersistence.attempted ? 'yes' : 'no'} results=${runtimeProbePersistence.probeResults} success=${runtimeProbePersistence.successCount} failed=${runtimeProbePersistence.failureCount} skipped=${runtimeProbePersistence.skippedResults} run=${runtimeProbePersistence.runId ?? '-'} error=${runtimeProbePersistence.error ?? '-'}\n`,
        );
        process.stdout.write(
            `runtime-health: attempted=${runtimeHealthPersistence.attempted ? 'yes' : 'no'} records=${runtimeHealthPersistence.records} observations=${runtimeHealthPersistence.healthObservations} probes=${runtimeHealthPersistence.probeResults} skipped=${runtimeHealthPersistence.skippedRecords} run=${runtimeHealthPersistence.runId ?? '-'} error=${runtimeHealthPersistence.error ?? '-'}\n`,
        );
    }
}

if (execute) {
    await shutdownClient({ force: true });
}

if (fail && !summary.ok) process.exit(1);
