#!/usr/bin/env node
import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    buildModelGatewayRuntimeSelectorPlan,
    compareModelGatewaySelectionAudits,
    createEnvSecretRegistry,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    evaluateModelGatewayCatalogEligibility,
    executeModelGatewayRuntimeSelectorPlanWithFallbacks,
    listByokProviderModelHealth,
    mergeByokProviderHealthRecords,
    resolveModelGatewaySelectionPolicy,
    summarizeModelGatewayRuntimeAccountOverlays,
} from '../src/copilot/model-gateway/index.js';
import { setDbLogger } from '../src/copilot/db/sqlite.js';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway-runtime-selector.mjs [--json] [--execute] [--fail] [--profile ID] [--fallback-profiles a,b] [--selection-policy metadata_first|prefer_runtime_proved|require_runtime_proof] [--require-runtime-proof] [--allow-probe] [--allow-env-missing] [--attempts-per-route N] [--retry-delay-ms N] [--max-retry-delay-ms N] [--timeout-ms N]

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
    if (profile) values.push(profile);
    if (profiles) values.push(...profiles.split(','));
    return values.map((item) => item.trim()).filter(Boolean);
}

function readInteger(name, fallback) {
    const raw = readArg(name);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

async function buildRuntimeSelectorContext({ strict, requireRuntimeProof, requireRuntimeEnvReady, selectionPolicy, runtimeSource }) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const integrity = auditModelGatewayCatalogSnapshotIntegrity(snapshot);
    const secretRegistry = createEnvSecretRegistry();
    const fileHealthRecords = listByokProviderModelHealth();
    let sqliteHealthRecords = [];
    let sqliteRuntimeError = null;
    if (runtimeSource === 'sqlite' || runtimeSource === 'merged') {
        try {
            sqliteHealthRecords = await new SqliteModelGatewayCatalogStore().listLatestRuntimeHealthRecords();
        } catch (error) {
            sqliteRuntimeError = error instanceof Error ? error.message : String(error);
        }
    }
    const healthRecords =
        runtimeSource === 'file'
            ? fileHealthRecords
            : runtimeSource === 'sqlite'
              ? sqliteHealthRecords
              : mergeByokProviderHealthRecords(fileHealthRecords, sqliteHealthRecords);
    const runtimeAccountOverlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth(healthRecords);
    const evaluationNow = new Date();
    const runtimeAccountOverlaySummary = summarizeModelGatewayRuntimeAccountOverlays(runtimeAccountOverlays, {
        now: evaluationNow,
    });
    const evaluated = evaluateModelGatewayCatalogEligibility({
        snapshot,
        secretRegistry,
        healthRecords,
        now: () => evaluationNow,
        policy: {
            unknownAccessPolicy: strict ? 'block' : 'allow_probe',
            policyProfile: strict ? 'runtime-selector-strict' : 'runtime-selector-allow-probe',
        },
    });
    const effectiveSnapshot = {
        ...snapshot,
        source: 'runtime-selector-effective-preview',
        modelEligibilityDecisions: evaluated.decisions,
        modelEligibilityRuns: [
            ...(Array.isArray(snapshot.modelEligibilityRuns) ? snapshot.modelEligibilityRuns : []),
            evaluated.run,
        ],
    };
    const profileIds = readProfiles();
    const selection = auditModelGatewayPreRuntimeSelection(effectiveSnapshot, {
        strict,
        profiles: profileIds,
        secretRegistry,
    });
    const postRuntimeSelection = auditModelGatewayPostRuntimeSelection(effectiveSnapshot, {
        strict,
        profiles: profileIds,
        secretRegistry,
        runtimeHealthRecords: healthRecords,
        requireRuntimeProof,
    });
    const comparison = compareModelGatewaySelectionAudits(selection, postRuntimeSelection);
    const policyResolution = resolveModelGatewaySelectionPolicy(comparison, { mode: selectionPolicy });
    const runtimeSelectorPlan = buildModelGatewayRuntimeSelectorPlan(policyResolution, {
        source: 'model-gateway-runtime-selector',
        requireRuntimeProof,
        requireRuntimeEnvReady,
        env: process.env,
    });
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
        selectedDispositions: selectedDispositions(selection),
        postRuntimeDispositions: selectedDispositions(postRuntimeSelection),
    };
}

const json = argSet.has('--json');
const execute = argSet.has('--execute');
const fail = argSet.has('--fail');
const strict = argSet.has('--strict') || !argSet.has('--allow-probe');
const requireRuntimeProof = argSet.has('--require-runtime-proof') || argSet.has('--runtime-proof');
const requireRuntimeEnvReady = !argSet.has('--allow-env-missing');
const runtimeSource = runtimeSourceArg();
const selectionPolicy = selectionPolicyArg(requireRuntimeProof);

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
});

let execution = null;
if (execute) {
    if (!context.runtimeSelectorPlan.ready || context.runtimeSelectorPlan.summary.blockedProfileCount > 0) {
        execution = {
            schema: 'model-gateway-runtime-selector-fallback-execution-result',
            ok: false,
            status: 'blocked',
            attemptedCount: 0,
            selectedProfileId: null,
            attempts: [],
            retryDecisions: [],
            final: null,
            error: 'runtime_selector_plan_not_ready',
        };
    } else {
        const fallbackProfiles = readArg('--fallback-profiles')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        execution = await executeModelGatewayRuntimeSelectorPlanWithFallbacks(context.runtimeSelectorPlan, {
            profileId: readArg('--profile') || undefined,
            fallbackProfileIds: fallbackProfiles,
            attemptsPerRoute: readInteger('--attempts-per-route', 1),
            retryDelayMs: readInteger('--retry-delay-ms', 0),
            maxRetryDelayMs: readInteger('--max-retry-delay-ms', 30_000),
            timeoutMs: readInteger('--timeout-ms', 45_000),
            env: process.env,
        });
    }
}

const summary = {
    schema: 'model-gateway-runtime-selector-command',
    ok:
        context.integrity.ok &&
        context.selection.ok &&
        context.postRuntimeSelection.ok &&
        context.policyResolution.ok &&
        context.runtimeSelectorPlan.ready &&
        context.runtimeSelectorPlan.summary.blockedProfileCount === 0 &&
        (execution?.ok ?? true),
    runtimeExecuted: execute,
    mode: strict ? 'strict_access_only_with_observed_health' : 'allow_probe_unknown_with_observed_health',
    runtimeSource,
    selectionPolicy,
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
    },
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
    nextCommands: execute
        ? ['npm run model-gateway:runtime-selector', 'npm run model-gateway:live:readiness']
        : [
              'npm run model-gateway:runtime-selector -- --fail',
              'npm run model-gateway:live:readiness',
              'npm run model-gateway:runtime-selector -- --execute --profile <profile>',
          ],
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
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
        `plan: ready=${context.runtimeSelectorPlan.ready ? 'yes' : 'no'} selected=${context.runtimeSelectorPlan.summary.selectedProfileCount}/${context.runtimeSelectorPlan.summary.profileCount} blocked=${context.runtimeSelectorPlan.summary.blockedProfileCount} envReady=${context.runtimeSelectorPlan.summary.runtimeEnvReadyCount} envBlocked=${context.runtimeSelectorPlan.summary.runtimeEnvBlockedCount} proofSelected=${context.runtimeSelectorPlan.summary.runtimeProofSelectedCount}\n`,
    );
    for (const route of context.runtimeSelectorPlan.routes) {
        const runtimeEnv = route.runtimeEnv;
        process.stdout.write(
            `  ${route.profileId}: ${route.status} route=${route.selectedRouteKey ?? '-'} env=${runtimeEnv?.status ?? '-'} missing=${runtimeEnv?.missingRequiredKeys.join(',') || '-'} reasons=${route.reasons.slice(0, 4).join(',') || '-'}\n`,
        );
    }
    if (execution) {
        process.stdout.write(
            `execution: ok=${execution.ok ? 'yes' : 'no'} status=${execution.status} attempted=${execution.attemptedCount} selected=${execution.selectedProfileId ?? '-'} error=${execution.error ?? '-'}\n`,
        );
    }
}

if (fail && !summary.ok) process.exit(1);
