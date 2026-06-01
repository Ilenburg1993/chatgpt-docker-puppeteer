#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from './index.mjs';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/model-gateway-auto-ready.mjs [--json] [--fail] [--profile ID]

Read-only readiness gate for model-gateway terminal auto mode. It does not call providers, run models or mutate terminal
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

function runOps(profile) {
    const result = spawnSync(process.execPath, [MODEL_GATEWAY_SCRIPT_PATHS.ops, '--json', `--profile=${profile}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status !== 0) {
        return {
            ok: false,
            error: result.stderr || result.stdout || `model-gateway ops failed with status ${result.status}`,
            ops: null,
        };
    }
    try {
        return { ok: true, error: null, ops: JSON.parse(result.stdout) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), ops: null };
    }
}

function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function createCheck(id, pass, detail, severity = 'error') {
    return { id, pass: Boolean(pass), severity, detail };
}

const json = argSet.has('--json');
const profile = readArg('--profile', 'repo_agent');
const opsResult = runOps(profile);
const ops = optionalRecord(opsResult.ops);
const database = optionalRecord(ops?.['database']);
const readiness = optionalRecord(ops?.['readiness']);
const automation = optionalRecord(ops?.['automation']);
const commands = optionalRecord(ops?.['commands']);
const checks = [
    createCheck('ops_command_ok', opsResult.ok, opsResult.error ?? 'model-gateway:ops returned JSON'),
    createCheck('catalog_snapshot_active', database?.['activeSnapshotExists'] === true, `source=${database?.['activeSnapshotSource'] ?? '-'}`),
    createCheck(
        'sqlite_operational_layers_visible',
        optionalNumber(database?.['automationDecisionRows']) !== null &&
            optionalNumber(database?.['automationPolicySnapshotRows']) !== null &&
            optionalNumber(database?.['automationEffectApplicationRows']) !== null &&
            optionalNumber(database?.['sdkSessionHandoffRows']) !== null &&
            optionalNumber(database?.['sdkSessionConfirmationRows']) !== null,
        `decisions=${database?.['automationDecisionRows'] ?? '-'} policySnapshots=${database?.['automationPolicySnapshotRows'] ?? '-'} effects=${database?.['automationEffectApplicationRows'] ?? '-'} handoffs=${database?.['sdkSessionHandoffRows'] ?? '-'} confirmations=${database?.['sdkSessionConfirmationRows'] ?? '-'}`,
    ),
    createCheck(
        'readiness_ok',
        readiness?.['ok'] === true,
        `warnings=${readiness?.['warnings'] ?? '-'} errors=${readiness?.['errors'] ?? '-'}`,
    ),
    createCheck(
        'automation_decision_available',
        automation?.['action'] !== null && automation?.['action'] !== undefined,
        `action=${automation?.['action'] ?? '-'} route=${automation?.['selectedRouteKey'] ?? '-'}`,
    ),
    createCheck(
        'automation_has_next_command',
        Array.isArray(automation?.['nextCommands']) && automation['nextCommands'].length > 0,
        `nextCommands=${Array.isArray(automation?.['nextCommands']) ? automation['nextCommands'].length : '-'}`,
        'warn',
    ),
    createCheck('canonical_commands_available', (optionalNumber(commands?.['commandCount']) ?? 0) >= 20, `commands=${commands?.['commandCount'] ?? '-'}`),
    createCheck(
        'canonical_command_surfaces_available',
        (optionalNumber(commands?.['packageCommandCount']) ?? 0) > 0 &&
            (optionalNumber(commands?.['makeCommandCount']) ?? 0) > 0 &&
            (optionalNumber(commands?.['terminalCommandCount']) ?? 0) > 0,
        `package=${commands?.['packageCommandCount'] ?? '-'} make=${commands?.['makeCommandCount'] ?? '-'} terminal=${commands?.['terminalCommandCount'] ?? '-'}`,
    ),
];
const blockers = checks.filter((check) => !check.pass && check.severity === 'error');
const warnings = checks.filter((check) => !check.pass && check.severity !== 'error');
const summary = {
    schema: 'model-gateway-auto-ready',
    ok: blockers.length === 0,
    profile,
    checks,
    blockers,
    warnings,
    ops,
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway auto ready: ok=${summary.ok ? 'yes' : 'no'} profile=${profile}\n`);
    for (const check of checks) {
        process.stdout.write(`  ${check.pass ? 'PASS' : check.severity.toUpperCase()} ${check.id}: ${check.detail}\n`);
    }
}

if (!summary.ok && argSet.has('--fail')) process.exit(1);
