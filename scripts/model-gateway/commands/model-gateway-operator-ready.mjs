#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from '../index.mjs';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-operator-ready.mjs [--json] [--fail] [--profile ID] [--limit N]

Read-only operator/LLM readiness cockpit. It aggregates ops, auto-ready, runtime selector, standby and runtime-health
diff without calling providers, running models or mutating terminal state.
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

function readPositiveInt(name, fallback) {
    const value = Number.parseInt(readArg(name), 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function runJson(scriptId, scriptArgs = []) {
    const result = spawnSync(process.execPath, [MODEL_GATEWAY_SCRIPT_PATHS[scriptId], ...scriptArgs], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        return {
            ok: false,
            status: result.status,
            error: result.stderr || result.stdout || `command failed with status ${result.status}`,
            json: null,
        };
    }
    try {
        return { ok: true, status: result.status, error: null, json: JSON.parse(result.stdout) };
    } catch (error) {
        return { ok: false, status: result.status, error: error instanceof Error ? error.message : String(error), json: null };
    }
}

function check(id, pass, detail, severity = 'error') {
    return { id, pass: Boolean(pass), detail, severity };
}

function commandList(value) {
    return Array.isArray(value) ? value.map(optionalString).filter((item) => item !== null) : [];
}

const json = argSet.has('--json');
const profile = readArg('--profile', 'repo_agent');
const limit = readPositiveInt('--limit', 12);

const ops = runJson('ops', ['--json', `--profile=${profile}`]);
const autoReady = runJson('autoReady', ['--json', `--profile=${profile}`]);
const runtimeSelector = runJson('runtimeSelector', ['--json', '--fail', `--profile=${profile}`]);
const standby = runJson('autoStandby', ['--json', `--profile=${profile}`, `--limit=${limit}`]);
const healthDiff = runJson('runtimeHealthDiff', ['--json']);

const opsJson = optionalRecord(ops.json);
const opsDatabase = optionalRecord(opsJson?.['database']);
const opsReadiness = optionalRecord(opsJson?.['readiness']);
const opsAutomation = optionalRecord(opsJson?.['automation']);
const autoReadyJson = optionalRecord(autoReady.json);
const runtimeSelectorJson = optionalRecord(runtimeSelector.json);
const runtimePlan = optionalRecord(runtimeSelectorJson?.['runtimeSelectorPlan']);
const standbyJson = optionalRecord(standby.json);
const standbySummary = optionalRecord(standbyJson?.['summary']);
const latestPersistedStandby = optionalRecord(opsDatabase?.['latestStandbyPlan']);
const healthDiffJson = optionalRecord(healthDiff.json);
const healthSummary = optionalRecord(optionalRecord(healthDiffJson?.['diff'])?.['summary']);
const readyChecks = Array.isArray(autoReadyJson?.['checks']) ? autoReadyJson['checks'].filter(optionalRecord) : [];
const runtimeRoutes = Array.isArray(runtimePlan?.['routes']) ? runtimePlan['routes'].filter(optionalRecord) : [];
const selectedRuntimeRoute = runtimeRoutes.find((route) => route['profileId'] === profile) ?? null;
const standbyRoutes = Array.isArray(standbyJson?.['routes']) ? standbyJson['routes'].filter(optionalRecord) : [];
const nextSafeCommands = [
    ...commandList(opsAutomation?.['nextCommands']),
    ...commandList(standbyJson?.['nextCommands']),
    'npm run model-gateway:runtime-health:diff -- --write-snapshot --fail-on-regression',
    `npm run model-gateway:runtime-selector -- --fail --profile=${profile}`,
    `npm run model-gateway:auto:standby -- --profile=${profile} --limit=${limit}`,
    `npm run model-gateway:auto:standby -- --profile=${profile} --limit=${limit} --write-sqlite`,
];
const uniqueNextSafeCommands = [...new Set(nextSafeCommands)];

const checks = [
    check('ops_ok', ops.ok && opsJson?.['ok'] === true, ops.error ?? 'ops read-only cockpit returned ok'),
    check('auto_ready_ok', autoReady.ok && autoReadyJson?.['ok'] === true, autoReady.error ?? `failed=${autoReadyJson?.['blockers']?.length ?? 0}`),
    check(
        'live_readiness_ok',
        opsReadiness?.['ok'] === true,
        `terminalSelected=${opsReadiness?.['terminalSelectedProfileCount'] ?? '-'} terminalBlocked=${opsReadiness?.['terminalBlockedProfileCount'] ?? '-'}`,
    ),
    check(
        'runtime_selector_ok',
        runtimeSelector.ok && runtimeSelectorJson?.['ok'] === true && runtimePlan?.['ready'] === true,
        runtimeSelector.error ?? `selected=${runtimePlan?.['selectedCount'] ?? runtimeSelectorJson?.['selection']?.['selected'] ?? '-'}`,
    ),
    check(
        'standby_available',
        standby.ok && (optionalNumber(standbySummary?.['routeCount']) ?? 0) > 0,
        standby.error ?? `routes=${standbySummary?.['routeCount'] ?? 0} providers=${standbySummary?.['providerCount'] ?? 0}`,
    ),
    check(
        'standby_persistence_visible',
        (optionalNumber(opsDatabase?.['standbyPlanRows']) ?? 0) > 0,
        `persisted=${opsDatabase?.['standbyPlanRows'] ?? 0} latest=${latestPersistedStandby?.['standbyPlanId'] ?? '-'}`,
        'warn',
    ),
    check(
        'runtime_health_no_regression',
        healthDiff.ok && (optionalNumber(healthSummary?.['regressions']) ?? 0) === 0 && (optionalNumber(healthSummary?.['newFailures']) ?? 0) === 0,
        healthDiff.error ?? `regressions=${healthSummary?.['regressions'] ?? '-'} newFailures=${healthSummary?.['newFailures'] ?? '-'}`,
    ),
    check(
        'next_safe_commands_available',
        uniqueNextSafeCommands.length > 0,
        `commands=${uniqueNextSafeCommands.length}`,
        'warn',
    ),
];
const blockers = checks.filter((item) => !item.pass && item.severity === 'error');
const warnings = checks.filter((item) => !item.pass && item.severity !== 'error');

const output = {
    schema: 'model-gateway-operator-ready',
    ok: blockers.length === 0,
    profile,
    generatedAt: new Date().toISOString(),
    summary: {
        checks: checks.length,
        passed: checks.filter((item) => item.pass).length,
        blockers: blockers.length,
        warnings: warnings.length,
        standbyRoutes: optionalNumber(standbySummary?.['routeCount']) ?? 0,
        standbyProviders: optionalNumber(standbySummary?.['providerCount']) ?? 0,
        standbyPersistedRows: optionalNumber(opsDatabase?.['standbyPlanRows']) ?? 0,
        runtimeSelected: runtimeSelectorJson?.['selection']?.['selected'] ?? null,
        runtimeProfiles: runtimeSelectorJson?.['selection']?.['profiles'] ?? null,
        nextSafeCommands: uniqueNextSafeCommands.length,
    },
    checks,
    blockers,
    warnings,
    standbyPersistence: {
        generatedNow: {
            routeCount: optionalNumber(standbySummary?.['routeCount']) ?? 0,
            providerCount: optionalNumber(standbySummary?.['providerCount']) ?? 0,
            runtimeProofCount: optionalNumber(standbySummary?.['runtimeProofCount']) ?? 0,
            generatedAt: optionalString(standbyJson?.['generatedAt']),
        },
        persisted: {
            rows: optionalNumber(opsDatabase?.['standbyPlanRows']) ?? 0,
            standbyPlanId: optionalString(latestPersistedStandby?.['standbyPlanId']),
            routeProfile: optionalString(latestPersistedStandby?.['routeProfile']),
            status: optionalString(latestPersistedStandby?.['status']),
            routeCount: optionalNumber(latestPersistedStandby?.['routeCount']),
            providerCount: optionalNumber(latestPersistedStandby?.['providerCount']),
            runtimeProofCount: optionalNumber(latestPersistedStandby?.['runtimeProofCount']),
            selectedRouteKey: optionalString(latestPersistedStandby?.['selectedRouteKey']),
            source: optionalString(latestPersistedStandby?.['source']),
            generatedAtMs: optionalNumber(latestPersistedStandby?.['generatedAtMs']),
        },
        persistCommand: `npm run model-gateway:auto:standby -- --profile=${profile} --limit=${limit} --write-sqlite`,
    },
    selectedRuntimeRoute: selectedRuntimeRoute
        ? {
              profileId: optionalString(selectedRuntimeRoute['profileId']),
              status: optionalString(selectedRuntimeRoute['status']),
              providerId: optionalString(optionalRecord(selectedRuntimeRoute['selected'])?.['providerId']),
              providerModel: optionalString(optionalRecord(selectedRuntimeRoute['selected'])?.['providerModel']),
              reasons: Array.isArray(selectedRuntimeRoute['reasons']) ? selectedRuntimeRoute['reasons'].map(optionalString).filter(Boolean) : [],
          }
        : null,
    standby: standbyRoutes.slice(0, limit).map((route) => ({
        source: optionalString(route['source']),
        rank: optionalNumber(route['rank']),
        profileId: optionalString(route['profileId']),
        providerId: optionalString(route['providerId']),
        providerModel: optionalString(route['providerModel']),
        hasRuntimeProof: route['hasRuntimeProof'] === true,
        runtimeEnvStatus: optionalString(route['runtimeEnvStatus']),
        commands: optionalRecord(route['commands']) ?? {},
    })),
    nextSafeCommands: uniqueNextSafeCommands,
    raw: {
        ops: opsJson,
        autoReady: autoReadyJson,
        runtimeSelector: runtimeSelectorJson,
        standby: standbyJson,
        healthDiff: healthDiffJson,
    },
};

if (json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway operator-ready: ok=${output.ok ? 'yes' : 'no'} profile=${profile}\n`);
    for (const item of checks) {
        process.stdout.write(`  ${item.pass ? 'PASS' : item.severity.toUpperCase()} ${item.id}: ${item.detail}\n`);
    }
    process.stdout.write(
        `  standby: generated=${output.summary.standbyRoutes} providers=${output.summary.standbyProviders} persisted=${output.summary.standbyPersistedRows} nextCommands=${output.summary.nextSafeCommands}\n`,
    );
    process.stdout.write(
        `  standby-persisted: latest=${output.standbyPersistence.persisted.standbyPlanId ?? '-'} profile=${output.standbyPersistence.persisted.routeProfile ?? '-'} routes=${output.standbyPersistence.persisted.routeCount ?? '-'}\n`,
    );
    for (const command of uniqueNextSafeCommands.slice(0, 8)) process.stdout.write(`  next: ${command}\n`);
}

if (!output.ok && argSet.has('--fail')) process.exit(1);
