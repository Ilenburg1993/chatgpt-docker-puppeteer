#!/usr/bin/env node
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayValueRedaction,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    buildModelGatewayRuntimeSelectorPlan,
    collectModelGatewaySecretAuditEnvValues,
    compareModelGatewayCatalogSnapshotParity,
    compareModelGatewaySelectionAudits,
    createEnvSecretRegistry,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    evaluateModelGatewayCatalogEligibility,
    filterModelGatewayRuntimeEligibilityOverlayDecisions,
    listByokProviderModelHealth,
    mergeByokProviderHealthRecords,
    renderModelGatewayLocalProviderOptInGuidance,
    resolveModelGatewaySelectionPolicy,
    summarizeModelGatewayRuntimeAccountOverlays,
    summarizeModelGatewayLocalProviderOptInBlocks,
} from '../src/copilot/model-gateway/index.js';
import { setDbLogger } from '../src/copilot/db/sqlite.js';
import { loadModelGatewayDotenv } from './model-gateway-env.mjs';

loadModelGatewayDotenv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_RUNNER_PATH = path.join(ROOT, 'scripts/copilot/run-terminal-llm-b-live-test.mjs');
const DEFAULT_SQLITE_PATH = path.join(ROOT, 'data/copilot.sqlite');
const TERMINAL_LIVE_ROUTE_PROFILES = Object.freeze(['repo_agent', 'code', 'tool_agent']);
const TERMINAL_LIVE_PREFERRED_PROBE_KINDS = Object.freeze(['live_tool_protocol', 'live_ask_user']);
const TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS = Object.freeze([
    ...TERMINAL_LIVE_PREFERRED_PROBE_KINDS,
    'live_turn',
]);
const TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS = 900_000;
const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway-live-readiness.mjs [--json] [--fail] [--fail-on-supply-warning]

Check whether the model-gateway metadata database is ready for terminal llm-b live tests.
This does not start the terminal, execute providers, run models or run runtime probes.
`);
    process.exit(0);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function optionalNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : 0;
}

async function fileExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {ReturnType<typeof auditModelGatewayPreRuntimeSelection>} audit
 * @returns {string[]}
 */
function selectedDispositions(audit) {
    return [
        ...new Set(
            audit.profiles
                .map((profile) => optionalString(profile.selected?.['eligibilityDisposition']))
                .filter((item) => item !== null),
        ),
    ].sort();
}

/**
 * @param {ReturnType<typeof auditModelGatewayPreRuntimeSelection>} audit
 * @returns {{ total: number; byProfile: Record<string, number> }}
 */
function supplyWarningSummary(audit) {
    /** @type {Record<string, number>} */
    const byProfile = {};
    for (const profile of audit.profiles) {
        byProfile[profile.profileId] = profile.supplyWarnings.length;
    }
    return {
        total: Object.values(byProfile).reduce((sum, count) => sum + count, 0),
        byProfile,
    };
}

const json = argSet.has('--json');
const fail = argSet.has('--fail');
const failOnSupplyWarning = argSet.has('--fail-on-supply-warning');
if (json) {
    setDbLogger((level, message) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${message}\n`);
        }
    });
}
const sourceStore = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
const sqliteStore = new SqliteModelGatewayCatalogStore({ dbPath: DEFAULT_SQLITE_PATH });
const sourceSnapshot = await sourceStore.readSnapshot();
const sqliteSnapshot = await sqliteStore.readSnapshot();
const sqliteDiagnostics = await sqliteStore.readStorageDiagnostics();
const integrity = auditModelGatewayCatalogSnapshotIntegrity(sourceSnapshot);
const parity = compareModelGatewayCatalogSnapshotParity(sourceSnapshot, sqliteSnapshot);
const secretAuditValues = collectModelGatewaySecretAuditEnvValues(process.env);
const catalogRedaction = auditModelGatewayValueRedaction(sourceSnapshot, {
    surface: 'json:catalog',
    rootPath: 'catalog',
    additionalSecrets: secretAuditValues,
});
const sqliteRedaction = await sqliteStore.auditStoredPayloadRedaction({
    additionalSecrets: secretAuditValues,
});
const secretRegistry = createEnvSecretRegistry();
const fileHealthRecords = listByokProviderModelHealth();
let sqliteHealthRecords = [];
let sqliteRuntimeError = null;
try {
    sqliteHealthRecords = await sqliteStore.listLatestRuntimeHealthRecords();
} catch (error) {
    sqliteRuntimeError = error instanceof Error ? error.message : String(error);
}
const healthRecords = mergeByokProviderHealthRecords(fileHealthRecords, sqliteHealthRecords);
const sqliteProbeOnlyRecords = sqliteHealthRecords.filter((record) => record?.['runtimeHealthStatus'] === 'probe-only');
const sqliteRuntimeProbeProofRecords = sqliteHealthRecords.filter(
    (record) =>
        record &&
        typeof record === 'object' &&
        record['probes'] &&
        typeof record['probes'] === 'object' &&
        Object.values(record['probes']).some((probe) => probe && typeof probe === 'object' && probe['ok'] === true),
);
const runtimeAccountOverlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth(healthRecords);
const evaluationNow = new Date();
const runtimeAccountOverlaySummary = summarizeModelGatewayRuntimeAccountOverlays(runtimeAccountOverlays, {
    now: evaluationNow,
});
const effectiveEligibility = evaluateModelGatewayCatalogEligibility({
    snapshot: sourceSnapshot,
    secretRegistry,
    healthRecords,
    now: () => evaluationNow,
    policy: {
        unknownAccessPolicy: 'block',
        policyProfile: 'live-readiness-effective-strict',
    },
});
const runtimeOverlayDecisions = filterModelGatewayRuntimeEligibilityOverlayDecisions(effectiveEligibility.decisions);
const effectiveSnapshot = {
    ...sourceSnapshot,
    source: 'live-readiness-effective-preview',
    modelEligibilityDecisions: [
        ...(Array.isArray(sourceSnapshot.modelEligibilityDecisions) ? sourceSnapshot.modelEligibilityDecisions : []),
        ...runtimeOverlayDecisions,
    ],
    modelEligibilityRuns: [
        ...(Array.isArray(sourceSnapshot.modelEligibilityRuns) ? sourceSnapshot.modelEligibilityRuns : []),
        effectiveEligibility.run,
    ],
};
const allowProbeSelection = auditModelGatewayPreRuntimeSelection(sourceSnapshot, {
    strict: false,
    secretRegistry,
});
const strictAccessSelection = auditModelGatewayPreRuntimeSelection(sourceSnapshot, {
    strict: true,
    secretRegistry,
});
const effectiveStrictSelection = auditModelGatewayPreRuntimeSelection(effectiveSnapshot, {
    strict: true,
    secretRegistry,
});
const postRuntimeEffectiveSelection = auditModelGatewayPostRuntimeSelection(effectiveSnapshot, {
    strict: true,
    secretRegistry,
    runtimeHealthRecords: healthRecords,
});
const runtimeSelectionComparison = compareModelGatewaySelectionAudits(effectiveStrictSelection, postRuntimeEffectiveSelection);
const runtimeSelectionPolicy = resolveModelGatewaySelectionPolicy(runtimeSelectionComparison, { mode: 'metadata_first' });
const runtimeSelectorPlan = buildModelGatewayRuntimeSelectorPlan(runtimeSelectionPolicy, {
    source: 'model-gateway-live-readiness',
    requireRuntimeEnvReady: true,
    env: process.env,
});
const terminalLiveBaseSelection = auditModelGatewayPreRuntimeSelection(effectiveSnapshot, {
    strict: true,
    secretRegistry,
    profiles: TERMINAL_LIVE_ROUTE_PROFILES,
});
const terminalLivePostRuntimeSelection = auditModelGatewayPostRuntimeSelection(effectiveSnapshot, {
    strict: true,
    secretRegistry,
    profiles: TERMINAL_LIVE_ROUTE_PROFILES,
    runtimeHealthRecords: healthRecords,
    preferredProbeKinds: TERMINAL_LIVE_PREFERRED_PROBE_KINDS,
    blockFailedProbeKinds: TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS,
    temporaryFailureCooldownMs: TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS,
});
const terminalLiveRuntimeSelectionComparison = compareModelGatewaySelectionAudits(
    terminalLiveBaseSelection,
    terminalLivePostRuntimeSelection,
);
const terminalLiveRuntimeSelectionPolicy = resolveModelGatewaySelectionPolicy(terminalLiveRuntimeSelectionComparison, {
    mode: 'prefer_runtime_proved',
});
const terminalLiveRuntimeSelectorPlan = buildModelGatewayRuntimeSelectorPlan(terminalLiveRuntimeSelectionPolicy, {
    source: 'model-gateway-live-readiness:terminal-live',
    requireRuntimeEnvReady: true,
    env: process.env,
    runtimeHealthRecords: healthRecords,
    preferredProbeKinds: TERMINAL_LIVE_PREFERRED_PROBE_KINDS,
    blockFailedProbeKinds: TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS,
    temporaryFailureCooldownMs: TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS,
});
const runnerExists = await fileExists(LIVE_RUNNER_PATH);
const strictSelectedDispositions = selectedDispositions(strictAccessSelection);
const effectiveSelectedDispositions = selectedDispositions(effectiveStrictSelection);
const postRuntimeSelectedDispositions = selectedDispositions(postRuntimeEffectiveSelection);
const allowProbeSupplyWarnings = supplyWarningSummary(allowProbeSelection);
const strictAccessSupplyWarnings = supplyWarningSummary(strictAccessSelection);
const effectiveStrictSupplyWarnings = supplyWarningSummary(effectiveStrictSelection);
const postRuntimeEffectiveSupplyWarnings = supplyWarningSummary(postRuntimeEffectiveSelection);
const localProviderOptIn = {
    allowProbe: summarizeModelGatewayLocalProviderOptInBlocks(allowProbeSelection),
    strictAccess: summarizeModelGatewayLocalProviderOptInBlocks(strictAccessSelection),
    effectiveStrict: summarizeModelGatewayLocalProviderOptInBlocks(effectiveStrictSelection),
    postRuntimeEffective: summarizeModelGatewayLocalProviderOptInBlocks(postRuntimeEffectiveSelection),
};
const strictOnlyKnownAccess =
    strictAccessSelection.ok &&
    strictSelectedDispositions.length > 0 &&
    strictSelectedDispositions.every((disposition) => disposition === 'eligible');
const effectiveOnlyKnownAccess =
    effectiveStrictSelection.ok &&
    effectiveSelectedDispositions.length > 0 &&
    effectiveSelectedDispositions.every((disposition) => disposition === 'eligible');
const postRuntimeOnlyKnownAccess =
    postRuntimeEffectiveSelection.ok &&
    postRuntimeSelectedDispositions.length > 0 &&
    postRuntimeSelectedDispositions.every((disposition) => disposition === 'eligible');
const checks = [
    {
        id: 'catalog_integrity',
        ok: integrity.ok,
        detail: `duplicate checks ok=${integrity.ok}`,
    },
    {
        id: 'sqlite_parity',
        ok: parity.ok,
        detail: `count mismatches=${parity.countMismatches.length}, key mismatches=${parity.keyMismatches.length}`,
    },
    {
        id: 'redaction_audit',
        ok: catalogRedaction.ok && sqliteRedaction.ok,
        detail: `catalogLeaks=${catalogRedaction.leakCount}, sqliteLeaks=${sqliteRedaction.leakCount}`,
    },
    {
        id: 'selection_allow_probe',
        ok: allowProbeSelection.ok,
        detail: `${allowProbeSelection.summary.selectedProfileCount}/${allowProbeSelection.summary.profileCount} profiles selected`,
    },
    {
        id: 'selection_strict_access',
        ok: strictAccessSelection.ok && strictOnlyKnownAccess,
        detail: `${strictAccessSelection.summary.selectedProfileCount}/${strictAccessSelection.summary.profileCount} profiles selected, dispositions=${strictSelectedDispositions.join(',') || 'none'}`,
    },
    {
        id: 'selection_effective_observed_health',
        ok: effectiveStrictSelection.ok && effectiveOnlyKnownAccess,
        detail: `${effectiveStrictSelection.summary.selectedProfileCount}/${effectiveStrictSelection.summary.profileCount} profiles selected, runtimeOverlays=${runtimeAccountOverlays.length} active=${runtimeAccountOverlaySummary.activeCount} expired=${runtimeAccountOverlaySummary.expiredCount}, dispositions=${effectiveSelectedDispositions.join(',') || 'none'}`,
    },
    {
        id: 'selection_post_runtime_observed_health',
        ok: postRuntimeEffectiveSelection.ok && postRuntimeOnlyKnownAccess,
        detail: `${postRuntimeEffectiveSelection.summary.selectedProfileCount}/${postRuntimeEffectiveSelection.summary.profileCount} profiles selected, healthMatches=${postRuntimeEffectiveSelection.summary.healthRecordCount}, healthProofs=${postRuntimeEffectiveSelection.summary.runtimeHealthProofCount}, agentProofs=${postRuntimeEffectiveSelection.summary.runtimeAgentProbeProofCount}, probeProofs=${postRuntimeEffectiveSelection.summary.runtimeProbeProofCount}, dispositions=${postRuntimeSelectedDispositions.join(',') || 'none'}`,
    },
    {
        id: 'runtime_selector_plan_ready',
        ok: runtimeSelectorPlan.ready && runtimeSelectorPlan.summary.blockedProfileCount === 0,
        detail: `${runtimeSelectorPlan.summary.selectedProfileCount}/${runtimeSelectorPlan.summary.profileCount} routes selected, blocked=${runtimeSelectorPlan.summary.blockedProfileCount}, accessBlocked=${runtimeSelectorPlan.summary.accountAccessBlockedCount ?? 0}, envReady=${runtimeSelectorPlan.summary.runtimeEnvReadyCount}, envBlocked=${runtimeSelectorPlan.summary.runtimeEnvBlockedCount}, proofSelected=${runtimeSelectorPlan.summary.runtimeProofSelectedCount}`,
    },
    {
        id: 'terminal_live_runtime_selector_plan_ready',
        ok:
            terminalLiveRuntimeSelectorPlan.ready &&
            terminalLiveRuntimeSelectorPlan.summary.selectedProfileCount === TERMINAL_LIVE_ROUTE_PROFILES.length &&
            terminalLiveRuntimeSelectorPlan.summary.blockedProfileCount === 0,
        detail: `${terminalLiveRuntimeSelectorPlan.summary.selectedProfileCount}/${terminalLiveRuntimeSelectorPlan.summary.profileCount} terminal routes selected, blocked=${terminalLiveRuntimeSelectorPlan.summary.blockedProfileCount}, accessBlocked=${terminalLiveRuntimeSelectorPlan.summary.accountAccessBlockedCount ?? 0}, envReady=${terminalLiveRuntimeSelectorPlan.summary.runtimeEnvReadyCount}, envBlocked=${terminalLiveRuntimeSelectorPlan.summary.runtimeEnvBlockedCount}, proofSelected=${terminalLiveRuntimeSelectorPlan.summary.runtimeProofSelectedCount}, probeBlocked=${terminalLiveRuntimeSelectorPlan.summary.runtimeProbeBlockedCount}`,
    },
    {
        id: 'selection_supply_warnings',
        ok: !failOnSupplyWarning || (effectiveStrictSupplyWarnings.total === 0 && postRuntimeEffectiveSupplyWarnings.total === 0),
        detail: `allow=${allowProbeSupplyWarnings.total}, strict=${strictAccessSupplyWarnings.total}, effective=${effectiveStrictSupplyWarnings.total}, postRuntime=${postRuntimeEffectiveSupplyWarnings.total}`,
    },
    {
        id: 'runtime_not_promoted',
        ok: strictAccessSelection.profiles.every((profile) => optionalNumber(profile.decisionLayers['runtimeProbeProofCount']) === 0),
        detail: 'runtime proof count remains zero before live tests',
    },
    {
        id: 'runtime_sqlite_observability',
        ok: true,
        detail: `runtimeRows=${sqliteDiagnostics.runtimeRows}, healthObservations=${sqliteDiagnostics.tableCounts.copilot_model_gateway_health_observations}, probeResults=${sqliteDiagnostics.tableCounts.copilot_model_gateway_runtime_probe_results}`,
    },
    {
        id: 'runtime_sqlite_probe_source',
        ok: true,
        detail: `sqliteHealthRecords=${sqliteHealthRecords.length}, probeOnly=${sqliteProbeOnlyRecords.length}, probeProofRecords=${sqliteRuntimeProbeProofRecords.length}`,
    },
    {
        id: 'live_runner_present',
        ok: runnerExists,
        detail: path.relative(ROOT, LIVE_RUNNER_PATH),
    },
];
const commands = [
    'npm run model-gateway:selection:effective -- --strict --fail',
    'npm run model-gateway:runtime-selector -- --fail',
    'npm run model-gateway:runtime-health:diff -- --write-snapshot',
    'npm run model-gateway:runtime-health:mirror',
    'npm run terminal:llm-b:live-test -- --no-pr --timeout-ms=180000',
    'npm run terminal:llm-b:live-test -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000',
    `npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=${TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS} --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --no-pr --timeout-ms=240000`,
    `npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=${TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS} --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --timeout-ms=900000`,
];
const summary = {
    schema: 'model-gateway-live-readiness',
    ok: checks.every((check) => check.ok),
    storePath: sourceStore.filePath,
    sqlitePath: DEFAULT_SQLITE_PATH,
    snapshotId: sourceSnapshot.snapshotId,
    generatedAt: sourceSnapshot.generatedAt,
    checks,
    integrity: {
        ok: integrity.ok,
        redactedIdentityCount: integrity.redactedIdentityCount,
    },
    sqlite: {
        parityOk: parity.ok,
        countMismatches: parity.countMismatches,
        keyMismatches: parity.keyMismatches,
        runtimeRows: sqliteDiagnostics.runtimeRows,
        healthObservations: sqliteDiagnostics.tableCounts.copilot_model_gateway_health_observations,
        runtimeProbeRuns: sqliteDiagnostics.tableCounts.copilot_model_gateway_runtime_probe_runs,
        runtimeProbeResults: sqliteDiagnostics.tableCounts.copilot_model_gateway_runtime_probe_results,
        runtimeProbeOnlyRecords: sqliteProbeOnlyRecords.length,
        runtimeProbeProofRecords: sqliteRuntimeProbeProofRecords.length,
    },
    redaction: {
        ok: catalogRedaction.ok && sqliteRedaction.ok,
        envSecretCandidateCount: secretAuditValues.length,
        catalog: {
            ok: catalogRedaction.ok,
            leakCount: catalogRedaction.leakCount,
            scannedStringCount: catalogRedaction.scannedStringCount,
        },
        sqlite: {
            ok: sqliteRedaction.ok,
            leakCount: sqliteRedaction.leakCount,
            scannedStringCount: sqliteRedaction.scannedStringCount,
            tableCount: sqliteRedaction.tableCount,
        },
    },
    selection: {
        allowProbe: {
            ok: allowProbeSelection.ok,
            selected: allowProbeSelection.summary.selectedProfileCount,
            profiles: allowProbeSelection.summary.profileCount,
            providers: allowProbeSelection.summary.selectedProviders,
            supplyWarnings: allowProbeSupplyWarnings,
            localProviderOptIn: localProviderOptIn.allowProbe,
        },
        strictAccess: {
            ok: strictAccessSelection.ok,
            selected: strictAccessSelection.summary.selectedProfileCount,
            profiles: strictAccessSelection.summary.profileCount,
            providers: strictAccessSelection.summary.selectedProviders,
            dispositions: strictSelectedDispositions,
            supplyWarnings: strictAccessSupplyWarnings,
            localProviderOptIn: localProviderOptIn.strictAccess,
        },
        effectiveStrict: {
            ok: effectiveStrictSelection.ok,
            selected: effectiveStrictSelection.summary.selectedProfileCount,
            profiles: effectiveStrictSelection.summary.profileCount,
            providers: effectiveStrictSelection.summary.selectedProviders,
            dispositions: effectiveSelectedDispositions,
            supplyWarnings: effectiveStrictSupplyWarnings,
            localProviderOptIn: localProviderOptIn.effectiveStrict,
            healthRecords: healthRecords.length,
            fileHealthRecords: fileHealthRecords.length,
            sqliteHealthRecords: sqliteHealthRecords.length,
            sqliteRuntimeError,
            runtimeAccountOverlays: runtimeAccountOverlays.length,
            runtimeAccountOverlaySummary,
            eligibilityDecisions: effectiveEligibility.decisions.length,
            runtimeOverlayDecisions: runtimeOverlayDecisions.length,
        },
        postRuntimeEffective: {
            ok: postRuntimeEffectiveSelection.ok,
            selected: postRuntimeEffectiveSelection.summary.selectedProfileCount,
            profiles: postRuntimeEffectiveSelection.summary.profileCount,
            providers: postRuntimeEffectiveSelection.summary.selectedProviders,
            dispositions: postRuntimeSelectedDispositions,
            supplyWarnings: postRuntimeEffectiveSupplyWarnings,
            localProviderOptIn: localProviderOptIn.postRuntimeEffective,
            healthRecordMatches: postRuntimeEffectiveSelection.summary.healthRecordCount,
            runtimeHealthProofs: postRuntimeEffectiveSelection.summary.runtimeHealthProofCount,
            runtimeAgentProofs: postRuntimeEffectiveSelection.summary.runtimeAgentProbeProofCount,
            runtimeProbeProofs: postRuntimeEffectiveSelection.summary.runtimeProbeProofCount,
            healthRecords: healthRecords.length,
        },
        runtimeSelectorPlan: {
            ok: runtimeSelectorPlan.ok,
            ready: runtimeSelectorPlan.ready,
            mode: runtimeSelectorPlan.mode,
            selected: runtimeSelectorPlan.summary.selectedProfileCount,
            profiles: runtimeSelectorPlan.summary.profileCount,
            blocked: runtimeSelectorPlan.summary.blockedProfileCount,
            accountAccessBlocked: runtimeSelectorPlan.summary.accountAccessBlockedCount ?? 0,
            runtimeProofSelected: runtimeSelectorPlan.summary.runtimeProofSelectedCount,
            runtimeEnvReady: runtimeSelectorPlan.summary.runtimeEnvReadyCount,
            runtimeEnvBlocked: runtimeSelectorPlan.summary.runtimeEnvBlockedCount,
        },
        terminalLiveRuntimeSelectorPlan: {
            ok: terminalLiveRuntimeSelectorPlan.ok,
            ready: terminalLiveRuntimeSelectorPlan.ready,
            mode: terminalLiveRuntimeSelectorPlan.mode,
            profiles: TERMINAL_LIVE_ROUTE_PROFILES,
            preferredProbeKinds: TERMINAL_LIVE_PREFERRED_PROBE_KINDS,
            blockFailedProbeKinds: TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS,
            temporaryFailureCooldownMs: TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS,
            selected: terminalLiveRuntimeSelectorPlan.summary.selectedProfileCount,
            blocked: terminalLiveRuntimeSelectorPlan.summary.blockedProfileCount,
            accountAccessBlocked: terminalLiveRuntimeSelectorPlan.summary.accountAccessBlockedCount ?? 0,
            runtimeProofSelected: terminalLiveRuntimeSelectorPlan.summary.runtimeProofSelectedCount,
            runtimeEnvReady: terminalLiveRuntimeSelectorPlan.summary.runtimeEnvReadyCount,
            runtimeEnvBlocked: terminalLiveRuntimeSelectorPlan.summary.runtimeEnvBlockedCount,
            runtimeHealthBlocked: terminalLiveRuntimeSelectorPlan.summary.runtimeHealthBlockedCount,
            runtimeProbeBlocked: terminalLiveRuntimeSelectorPlan.summary.runtimeProbeBlockedCount,
            selectedRoutes: terminalLiveRuntimeSelectorPlan.routes.map((route) => ({
                profileId: route.profileId,
                status: route.status,
                providerId: optionalString(route.selected?.['providerId']),
                providerModel: optionalString(route.selected?.['providerModel']),
                routeProfile: optionalString(route.selected?.['routeProfile']),
                hasRuntimeProof: route.hasRuntimeProof,
                reasons: route.reasons,
            })),
        },
    },
    livePlan: {
        executeNow: false,
        commands,
    },
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway live readiness: ok=${summary.ok ? 'yes' : 'no'}\n`);
    for (const check of checks) {
        process.stdout.write(`  ${check.ok ? 'OK' : 'FAIL'} ${check.id}: ${check.detail}\n`);
    }
    if (localProviderOptIn.effectiveStrict.hasBlocks) {
        process.stdout.write(`\n${renderModelGatewayLocalProviderOptInGuidance({ profileIds: localProviderOptIn.effectiveStrict.blockedProfileIds })}\n`);
    }
    process.stdout.write('\nrecommended live order:\n');
    commands.forEach((command, index) => process.stdout.write(`  ${index + 1}. ${command}\n`));
}

if (fail && !summary.ok) process.exit(1);
