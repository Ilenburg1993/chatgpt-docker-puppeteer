#!/usr/bin/env node
import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    applyModelGatewaySelectionTraceRetention,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    buildModelGatewayRuntimeSelectorPlan,
    buildModelGatewaySelectionDecisionTrace,
    compareModelGatewaySelectionAudits,
    createEnvSecretRegistry,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    evaluateModelGatewayCatalogEligibility,
    listByokProviderModelHealth,
    mergeByokProviderHealthRecords,
    persistModelGatewaySelectionDecisionTrace,
    renderModelGatewayLocalProviderOptInGuidance,
    resolveModelGatewaySelectionPolicy,
    summarizeModelGatewayRuntimeAccountOverlays,
    summarizeModelGatewayLocalProviderOptInBlocks,
} from '../src/copilot/model-gateway/index.js';
import { setDbLogger } from '../src/copilot/db/sqlite.js';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway-effective-selection.mjs [--json] [--strict] [--runtime-source file|sqlite|merged] [--selection-policy metadata_first|prefer_runtime_proved|require_runtime_proof] [--profile <id>|--profile=<id>] [--profiles a,b|--profiles=a,b] [--require-runtime-proof] [--write-trace] [--trace-dir <path>] [--prune-traces] [--trace-retention-apply] [--trace-retention-max <n>] [--fail] [--fail-on-supply-warning]

Build a non-mutating effective selection view from the persisted metadata catalog plus already-observed account/runtime
health. This does not fetch providers, execute models, run probes or persist eligibility decisions.
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
    const profiles = [];
    const profile = readArg('--profile');
    const profileList = readArg('--profiles');
    if (profile) profiles.push(profile);
    if (profileList) profiles.push(...profileList.split(','));
    return profiles.map((item) => item.trim()).filter(Boolean);
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

function formatCountMap(counts) {
    return Object.entries(counts ?? {})
        .map(([key, count]) => `${key}:${count}`)
        .join(',') || '-';
}

const json = argSet.has('--json');
const strict = argSet.has('--strict') || !argSet.has('--allow-probe');
const fail = argSet.has('--fail');
const failOnSupplyWarning = argSet.has('--fail-on-supply-warning');
const requireRuntimeProof = argSet.has('--require-runtime-proof') || argSet.has('--runtime-proof');
const selectionPolicy = requireRuntimeProof ? 'require_runtime_proof' : readArg('--selection-policy', 'metadata_first');
const writeTrace = argSet.has('--write-trace') || argSet.has('--persist-trace');
const traceDir = readArg('--trace-dir', DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR);
const traceId = readArg('--trace-id');
const pruneTraces = argSet.has('--prune-traces') || argSet.has('--trace-retention-preview') || argSet.has('--trace-retention-apply');
const traceRetentionApply = argSet.has('--trace-retention-apply');
const traceRetentionMax = Number.parseInt(readArg('--trace-retention-max', '100'), 10);
const runtimeSource = ['file', 'sqlite', 'merged'].includes(readArg('--runtime-source'))
    ? readArg('--runtime-source')
    : 'merged';
if (json) {
    setDbLogger((level, message) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${message}\n`);
        }
    });
}
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
        policyProfile: strict ? 'effective-strict-runtime-state' : 'effective-allow-probe-runtime-state',
    },
});
const effectiveSnapshot = {
    ...snapshot,
    source: 'effective-selection-preview',
    modelEligibilityDecisions: evaluated.decisions,
    modelEligibilityRuns: [
        ...(Array.isArray(snapshot.modelEligibilityRuns) ? snapshot.modelEligibilityRuns : []),
        evaluated.run,
    ],
};
const selection = auditModelGatewayPreRuntimeSelection(effectiveSnapshot, {
    strict,
    profiles: readProfiles(),
    secretRegistry,
});
const postRuntimeSelection = auditModelGatewayPostRuntimeSelection(effectiveSnapshot, {
    strict,
    profiles: readProfiles(),
    secretRegistry,
    runtimeHealthRecords: healthRecords,
    requireRuntimeProof,
});
const selectionComparison = compareModelGatewaySelectionAudits(selection, postRuntimeSelection);
const policyResolution = resolveModelGatewaySelectionPolicy(selectionComparison, { mode: selectionPolicy });
const runtimeSelectorPlan = buildModelGatewayRuntimeSelectorPlan(policyResolution, {
    source: 'model-gateway-effective-selection',
    requireRuntimeProof,
});
const decisionTrace = buildModelGatewaySelectionDecisionTrace({
    snapshot,
    integrity,
    selection,
    postRuntimeSelection,
    selectionComparison,
    policyResolution,
    runtimeSource,
    runtimeHealthRecordCount: healthRecords.length,
    runtimeAccountOverlaySummary,
    ...(traceId ? { traceId } : {}),
    source: 'model-gateway-effective-selection',
});
const tracePersistence = writeTrace
    ? await persistModelGatewaySelectionDecisionTrace(decisionTrace, { directory: traceDir })
    : {
          schema: 'model-gateway-selection-decision-trace-persistence',
          ok: true,
          written: false,
          traceId: typeof decisionTrace.traceId === 'string' ? decisionTrace.traceId : 'selection-trace',
          filePath: null,
          latestPath: null,
          error: null,
      };
const traceRetention = pruneTraces
    ? await applyModelGatewaySelectionTraceRetention({
          directory: traceDir,
          maxFiles: traceRetentionMax,
          dryRun: !traceRetentionApply,
      })
    : null;
const dispositions = selectedDispositions(selection);
const postRuntimeDispositions = selectedDispositions(postRuntimeSelection);
const supplyWarningCount = selection.profiles.reduce((sum, profile) => sum + profile.supplyWarnings.length, 0);
const postRuntimeSupplyWarningCount = postRuntimeSelection.profiles.reduce(
    (sum, profile) => sum + profile.supplyWarnings.length,
    0,
);
const localProviderOptIn = summarizeModelGatewayLocalProviderOptInBlocks(selection);
const postRuntimeLocalProviderOptIn = summarizeModelGatewayLocalProviderOptInBlocks(postRuntimeSelection);
const summary = {
    schema: 'model-gateway-effective-selection',
    ok:
        integrity.ok &&
        selection.ok &&
        postRuntimeSelection.ok &&
        policyResolution.ok &&
        tracePersistence.ok &&
        (traceRetention?.ok ?? true) &&
        (!failOnSupplyWarning || (supplyWarningCount === 0 && postRuntimeSupplyWarningCount === 0)),
    persisted: false,
    runtimeExecuted: false,
    runtimeSource,
    mode: strict ? 'strict_access_only_with_observed_health' : 'allow_probe_unknown_with_observed_health',
    storePath: store.filePath,
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    integrity: {
        ok: integrity.ok,
        redactedIdentityCount: integrity.redactedIdentityCount,
    },
    observedRuntime: {
        source: runtimeSource,
        fileHealthRecordCount: fileHealthRecords.length,
        sqliteHealthRecordCount: sqliteHealthRecords.length,
        healthRecordCount: healthRecords.length,
        sqliteRuntimeError,
        runtimeAccountOverlayCount: runtimeAccountOverlays.length,
        runtimeAccountOverlaySummary,
        eligibilityDecisionCount: evaluated.decisions.length,
        eligibilitySummary: evaluated.summary,
    },
    selection: {
        ...selection,
        selectedDispositions: dispositions,
        supplyWarningCount,
        localProviderOptIn,
    },
    postRuntimeSelection: {
        ...postRuntimeSelection,
        selectedDispositions: postRuntimeDispositions,
        supplyWarningCount: postRuntimeSupplyWarningCount,
        localProviderOptIn: postRuntimeLocalProviderOptIn,
    },
    selectionComparison,
    policyResolution,
    runtimeSelectorPlan,
    decisionTrace: {
        requested: writeTrace,
        ...tracePersistence,
    },
    selectionTraceRetention: traceRetention,
    nextCommands: [
        'npm run model-gateway:selection:audit -- --strict --fail-on-unselected',
        'npm run model-gateway:live:readiness',
        'npm run terminal:llm-b:live-test -- --byok-real --no-pr --timeout-ms=600000',
    ],
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway effective selection: ok=${summary.ok ? 'yes' : 'no'} mode=${summary.mode} persisted=no runtime=no\n`,
    );
    process.stdout.write(
        `observed: health=${healthRecords.length} runtimeOverlays=${runtimeAccountOverlays.length} eligibility=${evaluated.decisions.length}\n`,
    );
    process.stdout.write(
        `volatile overlays: active=${runtimeAccountOverlaySummary.activeCount} expired=${runtimeAccountOverlaySummary.expiredCount} providers=${Object.entries(runtimeAccountOverlaySummary.byProvider)
            .map(([providerId, count]) => `${providerId}:${count}`)
            .join(',') || '-'} failures=${Object.entries(runtimeAccountOverlaySummary.byFailureKind)
            .map(([failureKind, count]) => `${failureKind}:${count}`)
            .join(',') || '-'}\n`,
    );
    process.stdout.write(
        `profiles: selected=${selection.summary.selectedProfileCount}/${selection.summary.profileCount} dispositions=${dispositions.join(',') || '-'}\n`,
    );
    for (const profile of selection.profiles) {
        const selected = profile.selected;
        const label = selected
            ? `${selected['providerId']}:${selected['providerModel']} selector=${selected['selectorKind']} score=${selected['score'] ?? '-'}`
            : `none next=${profile.nextActions.slice(0, 3).join(',') || '-'}`;
        process.stdout.write(`  ${profile.profileId}: ${label}\n`);
        if (profile.capabilitySupply) {
            process.stdout.write(
                `    supply required=${formatCountMap(profile.capabilitySupply.required)} soft=${formatCountMap(profile.capabilitySupply.softRequired)} preferred=${formatCountMap(profile.capabilitySupply.preferred)}\n`,
            );
        }
        if (Array.isArray(profile.supplyWarnings) && profile.supplyWarnings.length > 0) {
            process.stdout.write(`    warnings=${profile.supplyWarnings.slice(0, 8).join(',')}\n`);
        }
    }
    process.stdout.write(
        `post-runtime: selected=${postRuntimeSelection.summary.selectedProfileCount}/${postRuntimeSelection.summary.profileCount} health=${postRuntimeSelection.summary.healthRecordCount} healthProofs=${postRuntimeSelection.summary.runtimeHealthProofCount} agentProofs=${postRuntimeSelection.summary.runtimeAgentProbeProofCount} probeProofs=${postRuntimeSelection.summary.runtimeProbeProofCount} providers=${formatCountMap(postRuntimeSelection.summary.selectedProviders)}\n`,
    );
    process.stdout.write(
        `comparison: changed=${selectionComparison.summary.changedCount}/${selectionComparison.summary.profileCount} postProofSelected=${selectionComparison.summary.postRuntimeProofSelectedCount}/${selectionComparison.summary.profileCount} requireProof=${requireRuntimeProof ? 'yes' : 'no'}\n`,
    );
    process.stdout.write(
        `policy: mode=${policyResolution.mode} selected=${policyResolution.summary.selectedCount}/${policyResolution.summary.profileCount} postWinners=${policyResolution.summary.postRuntimeWinnerCount} changed=${policyResolution.summary.changedFromPreRuntimeCount}\n`,
    );
    process.stdout.write(
        `runtime-selector: ready=${runtimeSelectorPlan.ready ? 'yes' : 'no'} selected=${runtimeSelectorPlan.summary.selectedProfileCount}/${runtimeSelectorPlan.summary.profileCount} blocked=${runtimeSelectorPlan.summary.blockedProfileCount} envReady=${runtimeSelectorPlan.summary.runtimeEnvReadyCount} envBlocked=${runtimeSelectorPlan.summary.runtimeEnvBlockedCount} proofSelected=${runtimeSelectorPlan.summary.runtimeProofSelectedCount}\n`,
    );
    if (writeTrace) {
        process.stdout.write(
            `trace: written=${tracePersistence.written ? 'yes' : 'no'} path=${tracePersistence.filePath ?? '-'} latest=${tracePersistence.latestPath ?? '-'} error=${tracePersistence.error ?? '-'}\n`,
        );
    }
    if (traceRetention) {
        process.stdout.write(
            `trace-retention: dryRun=${traceRetention.dryRun ? 'yes' : 'no'} max=${traceRetention.maxFiles} candidates=${traceRetention.candidateCount} pruned=${traceRetention.prunedCount} deleted=${traceRetention.deletedCount} error=${traceRetention.error ?? '-'}\n`,
        );
    }
    for (const row of selectionComparison.rows.filter((item) => item.changed).slice(0, 12)) {
        const pre = row.preSelected ? `${row.preSelected['providerId']}:${row.preSelected['providerModel']}` : 'none';
        const post = row.postSelected ? `${row.postSelected['providerId']}:${row.postSelected['providerModel']}` : 'none';
        process.stdout.write(`  changed ${row.profileId}: ${pre} -> ${post} proof=${row.postSelectedHasRuntimeProof ? 'yes' : 'no'}\n`);
    }
    if (localProviderOptIn.hasBlocks) {
        process.stdout.write(`\n${renderModelGatewayLocalProviderOptInGuidance({ profileIds: localProviderOptIn.blockedProfileIds })}\n`);
    }
}

if (fail && !summary.ok) process.exit(1);
