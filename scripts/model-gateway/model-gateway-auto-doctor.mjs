#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from './index.mjs';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/model-gateway-auto-doctor.mjs [--json] [--fail] [--profile ID] [--require-enabled]

Read-only model-gateway automation doctor. It explains whether terminal auto mode is operational, which policy gates are
closed, and which persisted operational ledgers are visible. It does not call providers, run models or mutate terminal
state.
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

function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function createCheck(id, pass, detail, severity = 'error') {
    return { id, pass: Boolean(pass), severity, detail };
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

const json = argSet.has('--json');
const profile = readArg('--profile', 'repo_agent');
const ready = runJson('autoReady', ['--json', `--profile=${profile}`]);
const status = runJson('autoStatus', ['--json', `--profile=${profile}`]);
const diagnostics = runJson('sqliteDiagnostics', ['--json']);
const commands = runJson('canonicalCommands', ['--json']);

const readyJson = optionalRecord(ready.json);
const statusJson = optionalRecord(status.json);
const diagnosticsJson = optionalRecord(diagnostics.json);
const commandRows = Array.isArray(optionalRecord(commands.json)?.['commands']) ? optionalRecord(commands.json)['commands'] : [];
const policy = optionalRecord(statusJson?.['policy']);
const decision = optionalRecord(statusJson?.['decision']);
const activeSnapshot = optionalRecord(diagnosticsJson?.['activeSnapshot']);
const latestAutomationEffectApplication = optionalRecord(diagnosticsJson?.['latestAutomationEffectApplication']);
const latestSdkSessionHandoff = optionalRecord(diagnosticsJson?.['latestSdkSessionHandoff']);
const requireEnabled = argSet.has('--require-enabled');

const checks = [
    createCheck('auto_ready_command_ok', ready.ok, ready.error ?? `ok=${readyJson?.['ok'] === true}`),
    createCheck('auto_ready_gate_ok', readyJson?.['ok'] === true, `blockers=${Array.isArray(readyJson?.['blockers']) ? readyJson['blockers'].length : '-'}`),
    createCheck('auto_status_command_ok', status.ok, status.error ?? `ok=${statusJson?.['ok'] === true}`),
    createCheck('sqlite_diagnostics_command_ok', diagnostics.ok, diagnostics.error ?? `schema=${diagnosticsJson?.['schemaVersion'] ?? '-'}`),
    createCheck('canonical_commands_command_ok', commands.ok, commands.error ?? `commands=${commandRows.length}`),
    createCheck('active_catalog_snapshot', activeSnapshot?.['exists'] === true, `source=${activeSnapshot?.['source'] ?? '-'}`),
    createCheck(
        'automation_effect_ledger_visible',
        optionalNumber(diagnosticsJson?.['automationPolicySnapshotRows']) !== null &&
        optionalNumber(diagnosticsJson?.['automationEffectApplicationRows']) !== null,
        `policySnapshots=${diagnosticsJson?.['automationPolicySnapshotRows'] ?? '-'} effects=${diagnosticsJson?.['automationEffectApplicationRows'] ?? '-'}`,
    ),
    createCheck(
        'sdk_handoff_ledger_visible',
        optionalNumber(diagnosticsJson?.['sdkSessionHandoffRows']) !== null,
        `rows=${diagnosticsJson?.['sdkSessionHandoffRows'] ?? '-'}`,
    ),
    createCheck('policy_loaded', policy !== null, `source=${policy?.['source'] ?? '-'}`),
    createCheck('policy_enabled', policy?.['enabled'] === true, `enabled=${policy?.['enabled'] === true}`, requireEnabled ? 'error' : 'warn'),
    createCheck(
        'policy_can_apply_effects',
        policy?.['allowLiveSetModel'] === true || policy?.['allowNewSession'] === true,
        `allowLiveSetModel=${policy?.['allowLiveSetModel'] === true} allowNewSession=${policy?.['allowNewSession'] === true}`,
        requireEnabled ? 'error' : 'warn',
    ),
    createCheck('automation_decision_has_action', optionalString(decision?.['action']) !== null, `action=${decision?.['action'] ?? '-'}`),
    createCheck(
        'automation_decision_has_route_or_manual_blocker',
        optionalString(decision?.['selectedRouteKey']) !== null || optionalString(decision?.['action']) === 'manual_intervention',
        `route=${decision?.['selectedRouteKey'] ?? '-'} action=${decision?.['action'] ?? '-'}`,
    ),
];
const blockers = checks.filter((check) => !check.pass && check.severity === 'error');
const warnings = checks.filter((check) => !check.pass && check.severity !== 'error');
const summary = {
    schema: 'model-gateway-auto-doctor',
    ok: blockers.length === 0,
    profile,
    checks,
    blockers,
    warnings,
    policy: policy ?? null,
    decision: decision ?? null,
    latestAutomationEffectApplication,
    latestSdkSessionHandoff,
    ledgers: {
        automationDecisionRows: optionalNumber(diagnosticsJson?.['automationDecisionRows']),
        automationPolicySnapshotRows: optionalNumber(diagnosticsJson?.['automationPolicySnapshotRows']),
        automationEffectApplicationRows: optionalNumber(diagnosticsJson?.['automationEffectApplicationRows']),
        sdkSessionHandoffRows: optionalNumber(diagnosticsJson?.['sdkSessionHandoffRows']),
    },
    commands: {
        count: commandRows.length,
        package: commandRows.filter((command) => optionalRecord(command)?.['surface'] === 'package').length,
        make: commandRows.filter((command) => optionalRecord(command)?.['surface'] === 'make').length,
        terminal: commandRows.filter((command) => optionalRecord(command)?.['surface'] === 'terminal').length,
    },
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway auto doctor: ok=${summary.ok ? 'yes' : 'no'} profile=${profile}\n`);
    process.stdout.write(
        `  policy: enabled=${policy?.['enabled'] === true ? 'yes' : 'no'} liveSet=${policy?.['allowLiveSetModel'] === true ? 'yes' : 'no'} newSession=${policy?.['allowNewSession'] === true ? 'yes' : 'no'} source=${policy?.['source'] ?? '-'}\n`,
    );
    process.stdout.write(
        `  decision: action=${decision?.['action'] ?? '-'} route=${decision?.['selectedRouteKey'] ?? '-'} ok=${statusJson?.['ok'] === true ? 'yes' : 'no'}\n`,
    );
    process.stdout.write(
        `  ledgers: decisions=${summary.ledgers.automationDecisionRows ?? '-'} policySnapshots=${summary.ledgers.automationPolicySnapshotRows ?? '-'} effects=${summary.ledgers.automationEffectApplicationRows ?? '-'} handoffs=${summary.ledgers.sdkSessionHandoffRows ?? '-'}\n`,
    );
    for (const check of checks) {
        process.stdout.write(`  ${check.pass ? 'PASS' : check.severity.toUpperCase()} ${check.id}: ${check.detail}\n`);
    }
}

if (!summary.ok && argSet.has('--fail')) process.exit(1);
