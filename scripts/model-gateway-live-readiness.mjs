#!/usr/bin/env node
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPreRuntimeSelection,
    compareModelGatewayCatalogSnapshotParity,
    createEnvSecretRegistry,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    evaluateModelGatewayCatalogEligibility,
    listByokProviderModelHealth,
    summarizeModelGatewayRuntimeAccountOverlays,
} from '../src/copilot/model-gateway/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_RUNNER_PATH = path.join(ROOT, 'scripts/copilot/run-terminal-llm-b-live-test.mjs');
const DEFAULT_SQLITE_PATH = path.join(ROOT, 'data/copilot.sqlite');
const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway-live-readiness.mjs [--json] [--fail]

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

const json = argSet.has('--json');
const fail = argSet.has('--fail');
const sourceStore = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
const sqliteStore = new SqliteModelGatewayCatalogStore({ dbPath: DEFAULT_SQLITE_PATH });
const sourceSnapshot = await sourceStore.readSnapshot();
const sqliteSnapshot = await sqliteStore.readSnapshot();
const integrity = auditModelGatewayCatalogSnapshotIntegrity(sourceSnapshot);
const parity = compareModelGatewayCatalogSnapshotParity(sourceSnapshot, sqliteSnapshot);
const secretRegistry = createEnvSecretRegistry();
const healthRecords = listByokProviderModelHealth();
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
const effectiveSnapshot = {
    ...sourceSnapshot,
    source: 'live-readiness-effective-preview',
    modelEligibilityDecisions: effectiveEligibility.decisions,
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
const runnerExists = await fileExists(LIVE_RUNNER_PATH);
const strictSelectedDispositions = selectedDispositions(strictAccessSelection);
const effectiveSelectedDispositions = selectedDispositions(effectiveStrictSelection);
const strictOnlyKnownAccess =
    strictAccessSelection.ok &&
    strictSelectedDispositions.length > 0 &&
    strictSelectedDispositions.every((disposition) => disposition === 'eligible');
const effectiveOnlyKnownAccess =
    effectiveStrictSelection.ok &&
    effectiveSelectedDispositions.length > 0 &&
    effectiveSelectedDispositions.every((disposition) => disposition === 'eligible');
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
        id: 'runtime_not_promoted',
        ok: strictAccessSelection.profiles.every((profile) => optionalNumber(profile.decisionLayers['runtimeProbeProofCount']) === 0),
        detail: 'runtime proof count remains zero before live tests',
    },
    {
        id: 'live_runner_present',
        ok: runnerExists,
        detail: path.relative(ROOT, LIVE_RUNNER_PATH),
    },
];
const commands = [
    'npm run model-gateway:selection:effective -- --strict --fail',
    'npm run terminal:llm-b:live-test -- --no-pr --timeout-ms=180000',
    'npm run terminal:llm-b:live-test -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000',
    'npm run terminal:llm-b:live-test -- --byok-real --no-pr --timeout-ms=600000',
    'npm run terminal:llm-b:live-test -- --byok-real --timeout-ms=900000',
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
    },
    selection: {
        allowProbe: {
            ok: allowProbeSelection.ok,
            selected: allowProbeSelection.summary.selectedProfileCount,
            profiles: allowProbeSelection.summary.profileCount,
            providers: allowProbeSelection.summary.selectedProviders,
        },
        strictAccess: {
            ok: strictAccessSelection.ok,
            selected: strictAccessSelection.summary.selectedProfileCount,
            profiles: strictAccessSelection.summary.profileCount,
            providers: strictAccessSelection.summary.selectedProviders,
            dispositions: strictSelectedDispositions,
        },
        effectiveStrict: {
            ok: effectiveStrictSelection.ok,
            selected: effectiveStrictSelection.summary.selectedProfileCount,
            profiles: effectiveStrictSelection.summary.profileCount,
            providers: effectiveStrictSelection.summary.selectedProviders,
            dispositions: effectiveSelectedDispositions,
            healthRecords: healthRecords.length,
            runtimeAccountOverlays: runtimeAccountOverlays.length,
            runtimeAccountOverlaySummary,
            eligibilityDecisions: effectiveEligibility.decisions.length,
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
    process.stdout.write('\nrecommended live order:\n');
    commands.forEach((command, index) => process.stdout.write(`  ${index + 1}. ${command}\n`));
}

if (fail && !summary.ok) process.exit(1);
