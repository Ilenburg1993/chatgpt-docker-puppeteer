#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from './index.mjs';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/model-gateway-ops.mjs [--json] [--fail] [--profile ID]

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

function runJson(scriptId, scriptArgs = []) {
    const result = spawnSync(process.execPath, [MODEL_GATEWAY_SCRIPT_PATHS[scriptId], ...scriptArgs], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
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
        return {
            ok: true,
            status: result.status,
            error: null,
            json: JSON.parse(result.stdout),
        };
    } catch (error) {
        return {
            ok: false,
            status: result.status,
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
    return {
        ok: diagnostics.ok && activeSnapshot?.['exists'] === true,
        schemaVersion: optionalNumber(json?.['schemaVersion']),
        activeSnapshotExists: activeSnapshot?.['exists'] === true,
        activeSnapshotSource: optionalString(activeSnapshot?.['source']),
        catalogRows: optionalNumber(json?.['catalogRows']),
        routeDecisionRows: optionalNumber(json?.['routeDecisionRows']),
        automationDecisionRows: optionalNumber(json?.['automationDecisionRows']),
        latestAutomationAction: optionalString(latestAutomationDecision?.['action']),
        runtimeHealthObservations: optionalNumber(runtime?.['healthObservations']),
        latestRuntimeHealthObservedAtMs: optionalNumber(runtime?.['latestHealthObservedAtMs']),
    };
}

function readReadinessSummary(readiness) {
    const json = optionalRecord(readiness.json);
    const summary = optionalRecord(json?.['summary']);
    const selection = optionalRecord(json?.['selection']);
    const runtimeSelector = optionalRecord(json?.['runtimeSelectorPlan']);
    return {
        ok: readiness.ok && json?.['ok'] !== false,
        warnings: Array.isArray(json?.['warnings']) ? json['warnings'].length : 0,
        errors: Array.isArray(json?.['errors']) ? json['errors'].length : 0,
        profileCount: optionalNumber(summary?.['profileCount']) ?? optionalNumber(selection?.['summary']?.['profileCount']),
        selectedProfileCount:
            optionalNumber(summary?.['selectedProfileCount']) ?? optionalNumber(runtimeSelector?.['summary']?.['selectedProfileCount']),
        blockedProfileCount:
            optionalNumber(summary?.['blockedProfileCount']) ?? optionalNumber(runtimeSelector?.['summary']?.['blockedProfileCount']),
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
const diagnostics = runJson('sqliteDiagnostics', ['--json']);
const readiness = runJson('liveReadiness', ['--json']);
const auto = runJson('autoStatus', ['--json', `--profile=${profile}`]);
const commands = runJson('canonicalCommands', ['--json']);

const summary = {
    schema: 'model-gateway-ops',
    ok: diagnostics.ok && readiness.ok && auto.ok && commands.ok,
    profile,
    database: readDatabaseSummary(diagnostics),
    readiness: readReadinessSummary(readiness),
    automation: readAutomationSummary(auto),
    commands: readCommandsSummary(commands),
    failures: Object.fromEntries(
        Object.entries({ diagnostics, readiness, auto, commands })
            .filter(([, result]) => !result.ok)
            .map(([key, result]) => [key, result.error]),
    ),
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway ops: ok=${summary.ok ? 'yes' : 'no'} profile=${profile}\n`);
    process.stdout.write(
        `  db: active=${summary.database.activeSnapshotExists ? 'yes' : 'no'} schema=${summary.database.schemaVersion ?? '-'} rows=${summary.database.catalogRows ?? '-'} routeDecisions=${summary.database.routeDecisionRows ?? '-'} automationDecisions=${summary.database.automationDecisionRows ?? '-'}\n`,
    );
    process.stdout.write(`  db-auto: latestAction=${summary.database.latestAutomationAction ?? '-'}\n`);
    process.stdout.write(
        `  readiness: ok=${summary.readiness.ok ? 'yes' : 'no'} selected=${summary.readiness.selectedProfileCount ?? '-'}/${summary.readiness.profileCount ?? '-'} blocked=${summary.readiness.blockedProfileCount ?? '-'} warnings=${summary.readiness.warnings}\n`,
    );
    process.stdout.write(
        `  auto: ok=${summary.automation.ok ? 'yes' : 'no'} action=${summary.automation.action ?? '-'} route=${summary.automation.selectedRouteKey ?? '-'}\n`,
    );
    process.stdout.write(
        `  commands: total=${summary.commands.commandCount} package=${summary.commands.packageCommandCount} make=${summary.commands.makeCommandCount} terminal=${summary.commands.terminalCommandCount}\n`,
    );
    for (const [key, error] of Object.entries(summary.failures)) {
        process.stdout.write(`  ${key} failed: ${String(error).slice(0, 500)}\n`);
    }
}

if (!summary.ok && argSet.has('--fail')) process.exit(1);
