#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from '../index.mjs';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-ops.mjs [--json] [--fail] [--profile ID] [--subcommand-timeout-ms N]

Read-only model-gateway cockpit for operators and LLM agents. It summarizes SQLite diagnostics, live readiness,
canonical commands and the pure automation status without fetching providers, running models or mutating the terminal.
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

function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readPositiveInteger(name, fallback) {
    const raw = readArg(name);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function runJson(scriptId, scriptArgs = []) {
    const startedAtMs = Date.now();
    const result = spawnSync(process.execPath, [MODEL_GATEWAY_SCRIPT_PATHS[scriptId], ...scriptArgs], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: subcommandTimeoutMs,
    });
    const durationMs = Date.now() - startedAtMs;
    if (result.error) {
        const timedOut = result.error.code === 'ETIMEDOUT';
        return {
            ok: false,
            status: result.status,
            durationMs,
            timedOut,
            error: timedOut
                ? `${scriptId} exceeded ${subcommandTimeoutMs}ms`
                : result.error.message,
            json: null,
        };
    }
    if (result.status !== 0) {
        return {
            ok: false,
            status: result.status,
            durationMs,
            timedOut: false,
            error: result.stderr || result.stdout || `command failed with status ${result.status}`,
            json: null,
        };
    }
    try {
        return {
            ok: true,
            status: result.status,
            durationMs,
            timedOut: false,
            error: null,
            json: JSON.parse(result.stdout),
        };
    } catch (error) {
        return {
            ok: false,
            status: result.status,
            durationMs,
            timedOut: false,
            error: error instanceof Error ? error.message : String(error),
            json: null,
        };
    }
}

function readDatabaseSummary(diagnostics) {
    const json = optionalRecord(diagnostics.json);
    const activeSnapshot = optionalRecord(json?.['activeSnapshot']);
    const runtime = optionalRecord(json?.['runtime']);
    const latestAutomationDecision = optionalRecord(json?.['latestAutomationDecision']);
    const latestStandbyPlan = optionalRecord(json?.['latestStandbyPlan']);
    const latestLiveScenarioRun = optionalRecord(json?.['latestLiveScenarioRun']);
    const latestDeferredHandoff = optionalRecord(json?.['latestDeferredSdkSessionHandoff']);
    return {
        ok: diagnostics.ok && activeSnapshot?.['exists'] === true,
        schemaVersion: optionalNumber(json?.['schemaVersion']),
        activeSnapshotExists: activeSnapshot?.['exists'] === true,
        activeSnapshotSource: optionalString(activeSnapshot?.['source']),
        catalogRows: optionalNumber(json?.['catalogRows']),
        routeDecisionRows: optionalNumber(json?.['routeDecisionRows']),
        automationDecisionRows: optionalNumber(json?.['automationDecisionRows']),
        automationPolicySnapshotRows: optionalNumber(json?.['automationPolicySnapshotRows']),
        automationEffectApplicationRows: optionalNumber(json?.['automationEffectApplicationRows']),
        sdkSessionHandoffRows: optionalNumber(json?.['sdkSessionHandoffRows']),
        sdkSessionDeferredHandoffRows: optionalNumber(json?.['sdkSessionDeferredHandoffRows']),
        sdkSessionConfirmationRows: optionalNumber(json?.['sdkSessionConfirmationRows']),
        standbyPlanRows: optionalNumber(json?.['standbyPlanRows']),
        liveScenarioRunRows: optionalNumber(json?.['liveScenarioRunRows']),
        latestDeferredHandoff: {
            handoffId: optionalString(latestDeferredHandoff?.['handoffId']),
            routeProfile: optionalString(latestDeferredHandoff?.['routeProfile']),
            selectedRouteKey: optionalString(latestDeferredHandoff?.['selectedRouteKey']),
            sessionId: optionalString(latestDeferredHandoff?.['sessionId']),
            targetModel: optionalString(latestDeferredHandoff?.['targetModel']),
            providerId: optionalString(latestDeferredHandoff?.['providerId']),
            providerModel: optionalString(latestDeferredHandoff?.['providerModel']),
            promotionAuthorized:
                latestDeferredHandoff?.['promotionAuthorized'] === true
                    ? true
                    : latestDeferredHandoff?.['promotionAuthorized'] === false
                      ? false
                      : null,
            expiresAtMs: optionalNumber(latestDeferredHandoff?.['expiresAtMs']),
            requestedAtMs: optionalNumber(latestDeferredHandoff?.['requestedAtMs']),
        },
        latestStandbyPlan: {
            standbyPlanId: optionalString(latestStandbyPlan?.['standbyPlanId']),
            routeProfile: optionalString(latestStandbyPlan?.['routeProfile']),
            status: optionalString(latestStandbyPlan?.['status']),
            routeCount: optionalNumber(latestStandbyPlan?.['routeCount']),
            providerCount: optionalNumber(latestStandbyPlan?.['providerCount']),
            runtimeProofCount: optionalNumber(latestStandbyPlan?.['runtimeProofCount']),
            selectedRouteKey: optionalString(latestStandbyPlan?.['selectedRouteKey']),
            source: optionalString(latestStandbyPlan?.['source']),
            generatedAtMs: optionalNumber(latestStandbyPlan?.['generatedAtMs']),
        },
        latestLiveScenarioRun: {
            runId: optionalString(latestLiveScenarioRun?.['runId']),
            scenarioKind: optionalString(latestLiveScenarioRun?.['scenarioKind']),
            status: optionalString(latestLiveScenarioRun?.['status']),
            ok:
                latestLiveScenarioRun?.['ok'] === true
                    ? true
                    : latestLiveScenarioRun?.['ok'] === false
                      ? false
                      : null,
            completedAtMs: optionalNumber(latestLiveScenarioRun?.['completedAtMs']),
            summaryPath: optionalString(latestLiveScenarioRun?.['summaryPath']),
        },
        latestAutomationAction: optionalString(latestAutomationDecision?.['action']),
        runtimeHealthObservations: optionalNumber(runtime?.['healthObservations']),
        latestRuntimeHealthObservedAtMs: optionalNumber(runtime?.['latestHealthObservedAtMs']),
    };
}

function readReadinessSummary(readiness) {
    const json = optionalRecord(readiness.json);
    const selection = optionalRecord(json?.['selection']);
    const allowProbe = optionalRecord(selection?.['allowProbe']);
    const strictAccess = optionalRecord(selection?.['strictAccess']);
    const runtimeSelector = optionalRecord(selection?.['runtimeSelectorPlan']);
    const terminalRuntimeSelector = optionalRecord(selection?.['terminalLiveRuntimeSelectorPlan']);
    const livePlan = optionalRecord(json?.['livePlan']);
    const commandRows = Array.isArray(livePlan?.['commands']) ? livePlan['commands'] : [];
    const profileCount =
        optionalNumber(runtimeSelector?.['profiles']) ??
        optionalNumber(strictAccess?.['profiles']) ??
        optionalNumber(allowProbe?.['profiles']) ??
        optionalNumber(runtimeSelector?.['profiles']?.['length']) ??
        (Array.isArray(runtimeSelector?.['profiles']) ? runtimeSelector['profiles'].length : null) ??
        (Array.isArray(strictAccess?.['profiles']) ? strictAccess['profiles'].length : null) ??
        (Array.isArray(allowProbe?.['profiles']) ? allowProbe['profiles'].length : null);
    return {
        ok: readiness.ok && json?.['ok'] !== false,
        warnings: Array.isArray(json?.['warnings']) ? json['warnings'].length : 0,
        errors: Array.isArray(json?.['errors']) ? json['errors'].length : 0,
        profileCount,
        selectedProfileCount:
            optionalNumber(runtimeSelector?.['selected']) ??
            optionalNumber(strictAccess?.['selected']) ??
            optionalNumber(allowProbe?.['selected']),
        blockedProfileCount: optionalNumber(runtimeSelector?.['blocked']),
        terminalSelectedProfileCount: optionalNumber(terminalRuntimeSelector?.['selected']),
        terminalBlockedProfileCount: optionalNumber(terminalRuntimeSelector?.['blocked']),
        livePlanCommandCount: commandRows.length,
        livePlanExecuteNow: livePlan?.['executeNow'] === true,
    };
}

function readAutomationSummary(auto) {
    const json = optionalRecord(auto.json);
    const decision = optionalRecord(json?.['decision']);
    return {
        ok: auto.ok && json?.['ok'] === true,
        action: optionalString(decision?.['action']),
        selectedRouteKey: optionalString(decision?.['selectedRouteKey']),
        blockers: Array.isArray(decision?.['blockers']) ? decision['blockers'].map(optionalString).filter(Boolean) : [],
        nextCommands: Array.isArray(decision?.['nextCommands']) ? decision['nextCommands'].map(optionalString).filter(Boolean) : [],
    };
}

function readCommandsSummary(commands) {
    const json = optionalRecord(commands.json);
    const commandRows = Array.isArray(json?.['commands']) ? json['commands'] : [];
    return {
        ok: commands.ok,
        commandCount: commandRows.length,
        packageCommandCount: commandRows.filter((command) => optionalRecord(command)?.['surface'] === 'package').length,
        makeCommandCount: commandRows.filter((command) => optionalRecord(command)?.['surface'] === 'make').length,
        terminalCommandCount: commandRows.filter((command) => optionalRecord(command)?.['surface'] === 'terminal').length,
    };
}

const json = argSet.has('--json');
const profile = readArg('--profile', 'repo_agent');
const subcommandTimeoutMs = readPositiveInteger('--subcommand-timeout-ms', 20_000);
const diagnostics = runJson('sqliteDiagnostics', ['--json']);
const readiness = runJson('liveReadiness', ['--json']);
const auto = runJson('autoStatus', ['--json', `--profile=${profile}`]);
const commands = runJson('canonicalCommands', ['--json']);

const summary = {
    schema: 'model-gateway-ops',
    ok: diagnostics.ok && readiness.ok && auto.ok && commands.ok,
    profile,
    subcommandTimeoutMs,
    database: readDatabaseSummary(diagnostics),
    readiness: readReadinessSummary(readiness),
    automation: readAutomationSummary(auto),
    commands: readCommandsSummary(commands),
    timings: Object.fromEntries(
        Object.entries({ diagnostics, readiness, auto, commands }).map(([key, result]) => [
            key,
            {
                durationMs: result.durationMs,
                timedOut: result.timedOut === true,
            },
        ]),
    ),
    failures: Object.fromEntries(
        Object.entries({ diagnostics, readiness, auto, commands })
            .filter(([, result]) => !result.ok)
            .map(([key, result]) => [
                key,
                {
                    error: result.error,
                    durationMs: result.durationMs,
                    timedOut: result.timedOut === true,
                },
            ]),
    ),
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway ops: ok=${summary.ok ? 'yes' : 'no'} profile=${profile}\n`);
    process.stdout.write(
        `  db: active=${summary.database.activeSnapshotExists ? 'yes' : 'no'} schema=${summary.database.schemaVersion ?? '-'} rows=${summary.database.catalogRows ?? '-'} routeDecisions=${summary.database.routeDecisionRows ?? '-'} automationDecisions=${summary.database.automationDecisionRows ?? '-'} policySnapshots=${summary.database.automationPolicySnapshotRows ?? '-'} effects=${summary.database.automationEffectApplicationRows ?? '-'} handoffs=${summary.database.sdkSessionHandoffRows ?? '-'} deferredHandoffs=${summary.database.sdkSessionDeferredHandoffRows ?? '-'} confirmations=${summary.database.sdkSessionConfirmationRows ?? '-'} standbyPlans=${summary.database.standbyPlanRows ?? '-'} liveRuns=${summary.database.liveScenarioRunRows ?? '-'}\n`,
    );
    process.stdout.write(
        `  db-standby: latest=${summary.database.latestStandbyPlan.standbyPlanId ?? '-'} profile=${summary.database.latestStandbyPlan.routeProfile ?? '-'} routes=${summary.database.latestStandbyPlan.routeCount ?? '-'} providers=${summary.database.latestStandbyPlan.providerCount ?? '-'}\n`,
    );
    process.stdout.write(`  db-auto: latestAction=${summary.database.latestAutomationAction ?? '-'}\n`);
    process.stdout.write(
        `  db-handoff: deferred=${summary.database.sdkSessionDeferredHandoffRows ?? '-'} latest=${summary.database.latestDeferredHandoff.handoffId ?? '-'} route=${summary.database.latestDeferredHandoff.selectedRouteKey ?? '-'} session=${summary.database.latestDeferredHandoff.sessionId ?? '-'}\n`,
    );
    process.stdout.write(
        `  db-live: latest=${summary.database.latestLiveScenarioRun.scenarioKind ?? '-'} status=${summary.database.latestLiveScenarioRun.status ?? '-'} summary=${summary.database.latestLiveScenarioRun.summaryPath ?? '-'}\n`,
    );
    process.stdout.write(
        `  readiness: ok=${summary.readiness.ok ? 'yes' : 'no'} selected=${summary.readiness.selectedProfileCount ?? '-'}/${summary.readiness.profileCount ?? '-'} blocked=${summary.readiness.blockedProfileCount ?? '-'} terminalSelected=${summary.readiness.terminalSelectedProfileCount ?? '-'} terminalBlocked=${summary.readiness.terminalBlockedProfileCount ?? '-'} livePlanCommands=${summary.readiness.livePlanCommandCount ?? '-'} warnings=${summary.readiness.warnings}\n`,
    );
    process.stdout.write(
        `  auto: ok=${summary.automation.ok ? 'yes' : 'no'} action=${summary.automation.action ?? '-'} route=${summary.automation.selectedRouteKey ?? '-'}\n`,
    );
    process.stdout.write(
        `  commands: total=${summary.commands.commandCount} package=${summary.commands.packageCommandCount} make=${summary.commands.makeCommandCount} terminal=${summary.commands.terminalCommandCount}\n`,
    );
    process.stdout.write(
        `  timings: diagnostics=${summary.timings.diagnostics.durationMs}ms readiness=${summary.timings.readiness.durationMs}ms auto=${summary.timings.auto.durationMs}ms commands=${summary.timings.commands.durationMs}ms timeout=${summary.subcommandTimeoutMs}ms\n`,
    );
    for (const [key, error] of Object.entries(summary.failures)) {
        const failure = optionalRecord(error);
        process.stdout.write(`  ${key} failed: ${String(failure?.['error'] ?? error).slice(0, 500)}\n`);
    }
}

if (!summary.ok && argSet.has('--fail')) process.exit(1);
