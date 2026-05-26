#!/usr/bin/env node
import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPreRuntimeSelection,
    createEnvSecretRegistry,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    evaluateModelGatewayCatalogEligibility,
    listByokProviderModelHealth,
    summarizeModelGatewayRuntimeAccountOverlays,
} from '../src/copilot/model-gateway/index.js';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway-effective-selection.mjs [--json] [--strict] [--profiles=a,b] [--fail] [--fail-on-supply-warning]

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
const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
const snapshot = await store.readSnapshot();
const integrity = auditModelGatewayCatalogSnapshotIntegrity(snapshot);
const secretRegistry = createEnvSecretRegistry();
const healthRecords = listByokProviderModelHealth();
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
        policyProfile: strict ? 'effective-strict-no-runtime' : 'effective-allow-probe-no-runtime',
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
const dispositions = selectedDispositions(selection);
const supplyWarningCount = selection.profiles.reduce((sum, profile) => sum + profile.supplyWarnings.length, 0);
const summary = {
    schema: 'model-gateway-effective-selection',
    ok: integrity.ok && selection.ok && (!failOnSupplyWarning || supplyWarningCount === 0),
    persisted: false,
    runtimeExecuted: false,
    mode: strict ? 'strict_access_only_with_observed_health' : 'allow_probe_unknown_with_observed_health',
    storePath: store.filePath,
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    integrity: {
        ok: integrity.ok,
        redactedIdentityCount: integrity.redactedIdentityCount,
    },
    observedRuntime: {
        healthRecordCount: healthRecords.length,
        runtimeAccountOverlayCount: runtimeAccountOverlays.length,
        runtimeAccountOverlaySummary,
        eligibilityDecisionCount: evaluated.decisions.length,
        eligibilitySummary: evaluated.summary,
    },
    selection: {
        ...selection,
        selectedDispositions: dispositions,
        supplyWarningCount,
    },
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
}

if (fail && !summary.ok) process.exit(1);
