#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from '../index.mjs';
import { listModelGatewayRuntimeAutomationPolicyPresets } from '../../../src/copilot/model-gateway/index.js';

import { createArgReader, readPositiveIntArg } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-operator-ready.mjs [--json] [--fail] [--profile ID] [--limit N]

Read-only operator/LLM readiness cockpit. It aggregates SQLite diagnostics, auto-ready, runtime selector, standby,
live runs and runtime-health diff without calling providers, running models or mutating terminal state.
`);
    process.exit(0);
}


/**
 * @param {string} name
 * @param {number} fallback
 */
function readPositiveInt(name, fallback) {
    return readPositiveIntArg(readArg, name, fallback);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/** @param {unknown} value */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {unknown} value */
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {keyof typeof MODEL_GATEWAY_SCRIPT_PATHS} scriptId
 * @param {string[]} [scriptArgs]
 */
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

/**
 * @param {string} id
 * @param {unknown} pass
 * @param {unknown} detail
 * @param {'error' | 'warn'} [severity]
 */
function check(id, pass, detail, severity = 'error') {
    return { id, pass: Boolean(pass), detail, severity };
}

/** @param {unknown} value */
function commandList(value) {
    return Array.isArray(value) ? value.map(optionalString).filter((item) => item !== null) : [];
}

/** @param {(string | null | undefined)[]} values */
function uniqueCommands(values) {
    return [...new Set(values.map(optionalString).filter((item) => item !== null))];
}

const json = argSet.has('--json');
const profile = readArg('--profile', 'repo_agent');
const limit = readPositiveInt('--limit', 12);

const diagnostics = runJson('sqliteDiagnostics', ['--json']);
const autoReady = runJson('autoReady', ['--json', `--profile=${profile}`]);
const runtimeSelector = runJson('runtimeSelector', [
    '--json',
    '--fail',
    `--profile=${profile}`,
    '--selection-policy=prefer_runtime_proved',
]);
const standby = runJson('autoStandby', [
    '--json',
    `--profile=${profile}`,
    `--limit=${limit}`,
    '--selection-policy=prefer_runtime_proved',
]);
const healthDiff = runJson('runtimeHealthDiff', ['--json']);
const liveRuns = runJson('liveRuns', ['--json', '--limit=8']);

const diagnosticsJson = optionalRecord(diagnostics.json);
const opsDatabase = diagnosticsJson;
const autoReadyJson = optionalRecord(autoReady.json);
const runtimeSelectorJson = optionalRecord(runtimeSelector.json);
const runtimeSelection = optionalRecord(runtimeSelectorJson?.['selection']);
const runtimePlan = optionalRecord(runtimeSelectorJson?.['runtimeSelectorPlan']);
const standbyJson = optionalRecord(standby.json);
const standbySummary = optionalRecord(standbyJson?.['summary']);
const latestPersistedStandby = optionalRecord(opsDatabase?.['latestStandbyPlan']);
const latestLiveScenarioRun = optionalRecord(opsDatabase?.['latestLiveScenarioRun']);
const healthDiffJson = optionalRecord(healthDiff.json);
const healthSummary = optionalRecord(optionalRecord(healthDiffJson?.['diff'])?.['summary']);
const liveRunsJson = optionalRecord(liveRuns.json);
const liveRunRows = Array.isArray(liveRunsJson?.['rows']) ? liveRunsJson['rows'].filter(optionalRecord) : [];
const liveScenarioRunRowCount = Math.max(optionalNumber(opsDatabase?.['liveScenarioRunRows']) ?? 0, liveRunRows.length);
const latestLiveScenarioRunEffective = optionalString(latestLiveScenarioRun?.['summaryPath']) ? latestLiveScenarioRun : (liveRunRows[0] ?? {});
const runtimeRoutes = Array.isArray(runtimePlan?.['routes']) ? runtimePlan['routes'].filter(optionalRecord) : [];
const selectedRuntimeRoute = runtimeRoutes.find((route) => route['profileId'] === profile) ?? null;
const standbyRoutes = Array.isArray(standbyJson?.['routes']) ? standbyJson['routes'].filter(optionalRecord) : [];
/** @param {Record<string, unknown>} route */
function buildCandidateAction(route) {
    const providerId = optionalString(route['providerId']);
    const providerModel = optionalString(route['providerModel']);
    const profileId = optionalString(route['profileId']) ?? profile;
    const commands = optionalRecord(route['commands']) ?? {};
    const clearHealth =
        providerId && providerModel
            ? `npm run model-gateway:runtime-health:clear -- --provider=${providerId} --model=${providerModel} --profile=${profileId}`
            : null;
    const clearHealthTerminal =
        providerId && providerModel
            ? `/byok health clear provider:${providerId} model:${providerModel} profile:${profileId}`
            : null;
    const newSession = optionalString(commands['newSession']);
    const provider = optionalString(commands['provider']);
    return {
        rank: optionalNumber(route['rank']),
        source: optionalString(route['source']),
        profileId,
        providerId,
        providerModel,
        standbyClass: optionalString(route['standbyClass']),
        recommendedAction: optionalString(route['recommendedAction']),
        recommendedCommand: optionalString(route['recommendedCommand']),
        needsProbe: route['needsProbe'] === true,
        hasRuntimeProof: route['hasRuntimeProof'] === true,
        runtimeEnvStatus: optionalString(route['runtimeEnvStatus']),
        commands: {
            probeAgent: optionalString(commands['probeAgent']),
            probeChat: optionalString(commands['probeChat']),
            liveModel: optionalString(commands['liveModel']),
            provider,
            persistProvider: optionalString(commands['persistProvider']),
            newSession,
            newSessionProvider: newSession && provider ? `${newSession} && ${provider}` : null,
            clearHealth,
            clearHealthTerminal,
            clearHealthApply: clearHealth ? `${clearHealth} --apply` : null,
        },
    };
}
const candidateActions = standbyRoutes.slice(0, limit).map(buildCandidateAction);
const nextSafeCommands = [
    ...commandList(standbyJson?.['nextCommands']),
    'npm run model-gateway:runtime-health:diff -- --write-snapshot --fail-on-regression',
    `npm run model-gateway:runtime-selector -- --fail --profile=${profile}`,
    `npm run model-gateway:auto:standby -- --profile=${profile} --limit=${limit}`,
    `npm run model-gateway:auto:standby -- --profile=${profile} --limit=${limit} --write-sqlite`,
];
const uniqueNextSafeCommands = [...new Set(nextSafeCommands)];
const liveCommands = [
    'npm run model-gateway:live:readiness -- --fail',
    'npm run model-gateway:live:runs -- --limit=8',
    'npm run model-gateway:live:auto-probe',
    'npm run model-gateway:live:llm-b -- --control-only --timeout-ms=180000',
    'npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --control-only --timeout-ms=240000',
    `npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=${profile} --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --control-only --timeout-ms=240000`,
];
/** @param {ReturnType<typeof listModelGatewayRuntimeAutomationPolicyPresets>[number]} preset */
function buildPolicyPresetAction(preset) {
    const presetId = optionalString(preset['preset']) ?? 'operator_manual';
    const profileArg = `profile:${profile}`;
    return {
        preset: presetId,
        policy: optionalString(preset['policy']) ?? 'prefer_runtime_proved',
        effects: {
            liveSetModel: preset['allowLiveSetModel'] === true,
            newSession: preset['allowNewSession'] === true,
            providerProbes: preset['allowProviderProbes'] === true,
            localPrivate: preset['allowLocalPrivate'] === true,
        },
        accountWideFailureKinds: commandList(preset['accountWideFailureKinds']),
        command: `/byok auto on ${profileArg} preset:${presetId}`,
        terminalPolicyCommand: '/byok auto policy',
        env: [
            'COPILOT_BYOK_GATEWAY_AUTO=true',
            `COPILOT_BYOK_GATEWAY_AUTO_PRESET=${presetId}`,
            `COPILOT_BYOK_GATEWAY_AUTO_POLICY=${optionalString(preset['policy']) ?? 'prefer_runtime_proved'}`,
            `COPILOT_BYOK_GATEWAY_AUTO_PROFILES=${profile}`,
            `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL=${preset['allowLiveSetModel'] === true ? 'true' : 'false'}`,
            `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_NEW_SESSION=${preset['allowNewSession'] === true ? 'true' : 'false'}`,
            `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_PROVIDER_PROBES=${preset['allowProviderProbes'] === true ? 'true' : 'false'}`,
            `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LOCAL_PRIVATE=${preset['allowLocalPrivate'] === true ? 'true' : 'false'}`,
        ],
    };
}
const policyPresets = listModelGatewayRuntimeAutomationPolicyPresets().map(buildPolicyPresetAction);
const commandGroups = {
    readOnly: uniqueCommands([
        'npm run model-gateway:operator-ready',
        'npm run model-gateway:operator-ready -- --json',
        `/byok gateway operator-ready profile:${profile}`,
        '/byok auto policy',
        ...uniqueNextSafeCommands,
    ]),
    probeBeforePromotion: uniqueCommands(candidateActions.flatMap((action) => [action.commands.probeAgent, action.commands.probeChat])),
    recommended: uniqueCommands(candidateActions.map((action) => action.recommendedCommand)),
    sameBoundarySwitch: uniqueCommands(candidateActions.map((action) => action.commands.liveModel)),
    newSessionHandoff: uniqueCommands(candidateActions.map((action) => action.commands.newSessionProvider)),
    persistence: uniqueCommands([
        `npm run model-gateway:auto:standby -- --profile=${profile} --limit=${limit} --write-sqlite`,
        ...candidateActions.map((action) => action.commands.persistProvider),
    ]),
    healthClear: uniqueCommands(candidateActions.flatMap((action) => [action.commands.clearHealthTerminal, action.commands.clearHealthApply])),
    liveTests: liveCommands,
};

const checks = [
    check(
        'database_ok',
        diagnostics.ok && optionalRecord(diagnosticsJson?.['activeSnapshot'])?.['exists'] === true,
        diagnostics.error ?? `snapshot=${optionalRecord(diagnosticsJson?.['activeSnapshot'])?.['source'] ?? '-'}`,
    ),
    check(
        'auto_ready_ok',
        autoReady.ok && autoReadyJson?.['ok'] === true,
        autoReady.error ?? `failed=${Array.isArray(autoReadyJson?.['blockers']) ? autoReadyJson['blockers'].length : 0}`,
    ),
    check(
        'live_readiness_ok',
        autoReady.ok && autoReadyJson?.['ok'] === true,
        `blockers=${Array.isArray(autoReadyJson?.['blockers']) ? autoReadyJson['blockers'].length : 0} warnings=${Array.isArray(autoReadyJson?.['warnings']) ? autoReadyJson['warnings'].length : 0}`,
    ),
    check(
        'runtime_selector_ok',
        runtimeSelector.ok && runtimeSelectorJson?.['ok'] === true && runtimePlan?.['ready'] === true,
        runtimeSelector.error ?? `selected=${runtimePlan?.['selectedCount'] ?? runtimeSelection?.['selected'] ?? '-'}`,
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
    check(
        'live_runs_visible',
        liveRuns.ok,
        liveRuns.ok ? `runs=${liveRunRows.length} latest=${latestLiveScenarioRunEffective?.['summaryPath'] ?? '-'}` : (liveRuns.error ?? 'live runs unavailable'),
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
        liveScenarioRuns: liveScenarioRunRowCount,
        runtimeSelected: runtimeSelection?.['selected'] ?? null,
        runtimeProfiles: runtimeSelection?.['profiles'] ?? null,
        nextSafeCommands: uniqueNextSafeCommands.length,
        liveCommands: liveCommands.length,
        candidateActions: candidateActions.length,
        policyPresets: policyPresets.length,
        commandGroups: Object.fromEntries(Object.entries(commandGroups).map(([group, commands]) => [group, commands.length])),
    },
    operatorDecision: {
        requiresHumanDecision: true,
        canApplyAutomatically: false,
        reason: 'operator_ready_is_read_only',
        safeReadOnly: true,
        applyCommand: `/byok auto apply profile:${profile} allow-live-set-model`,
        fullHandoffCommand: `/byok auto apply profile:${profile} allow-live-set-model allow-new-session`,
        standbyCommand: `npm run model-gateway:auto:standby -- --profile=${profile} --limit=${limit}`,
        defaultAutoOnCommand: `/byok auto on profile:${profile}`,
        guardedLlmCommand: `/byok auto on profile:${profile} preset:llm_operator_guarded`,
        prepareNewSessionCommand: `/byok auto on profile:${profile} preset:auto_prepare_new_session`,
        liveWarning: 'liveCommands may consume provider quota or start terminal live tests; do not run them implicitly.',
    },
    policyPresets,
    commandGroups,
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
    liveScenarioRuns: {
        rows: liveScenarioRunRowCount,
        latest: {
            runId: optionalString(latestLiveScenarioRunEffective?.['runId']),
            scenarioKind: optionalString(latestLiveScenarioRunEffective?.['scenarioKind']) ?? optionalString(latestLiveScenarioRunEffective?.['kind']),
            status: optionalString(latestLiveScenarioRunEffective?.['status']),
            ok: latestLiveScenarioRunEffective?.['ok'] === true ? true : latestLiveScenarioRunEffective?.['ok'] === false ? false : null,
            completedAtMs: optionalNumber(latestLiveScenarioRunEffective?.['completedAtMs']),
            completedAt: optionalString(latestLiveScenarioRunEffective?.['completedAt']),
            summaryPath: optionalString(latestLiveScenarioRunEffective?.['summaryPath']),
        },
        recent: liveRunRows.slice(0, 8).map((row) => ({
            runId: optionalString(row['runId']),
            scenarioKind: optionalString(row['scenarioKind']) ?? optionalString(row['kind']),
            status: optionalString(row['status']),
            ok: row['ok'] === true ? true : row['ok'] === false ? false : null,
            completedAt: optionalString(row['completedAt']),
            summaryPath: optionalString(row['summaryPath']),
            criteriaTotal: optionalNumber(row['criteriaTotal']),
            criteriaFailed: optionalNumber(row['criteriaFailed']),
        })),
        command: 'npm run model-gateway:live:runs -- --limit=8',
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
        needsProbe: route['needsProbe'] === true,
        standbyClass: optionalString(route['standbyClass']),
        recommendedAction: optionalString(route['recommendedAction']),
        recommendedCommand: optionalString(route['recommendedCommand']),
        runtimeEnvStatus: optionalString(route['runtimeEnvStatus']),
        commands: optionalRecord(route['commands']) ?? {},
    })),
    candidateActions,
    nextSafeCommands: uniqueNextSafeCommands,
    liveCommands,
    raw: {
        diagnostics: diagnosticsJson,
        autoReady: autoReadyJson,
        runtimeSelector: runtimeSelectorJson,
        standby: standbyJson,
        healthDiff: healthDiffJson,
        liveRuns: liveRunsJson,
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
    process.stdout.write(
        `  live-runs: rows=${output.liveScenarioRuns.rows} latest=${output.liveScenarioRuns.latest.scenarioKind ?? '-'} status=${output.liveScenarioRuns.latest.status ?? '-'} summary=${output.liveScenarioRuns.latest.summaryPath ?? '-'}\n`,
    );
    for (const run of output.liveScenarioRuns.recent.slice(0, 3)) {
        process.stdout.write(
            `  live: ${run.scenarioKind ?? '-'} status=${run.status ?? '-'} ok=${run.ok === true ? 'yes' : run.ok === false ? 'no' : '-'} summary=${run.summaryPath ?? '-'}\n`,
        );
    }
    for (const command of liveCommands.slice(0, 3)) process.stdout.write(`  live-command: ${command}\n`);
    for (const preset of policyPresets) process.stdout.write(`  preset: ${preset.preset} command=${preset.command}\n`);
    for (const [group, commands] of Object.entries(commandGroups)) {
        process.stdout.write(`  command-group: ${group} commands=${commands.length}\n`);
    }
    for (const command of uniqueNextSafeCommands.slice(0, 8)) process.stdout.write(`  next: ${command}\n`);
}

if (!output.ok && argSet.has('--fail')) process.exit(1);
