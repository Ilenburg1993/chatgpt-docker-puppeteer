#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from '../index.mjs';

import { createArgReader } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout
        .write(`Usage: node scripts/model-gateway/commands/model-gateway-auto-explain.mjs [--json] [--profile ID]

Explain the current model-gateway automation decision together with the auto doctor. This command is read-only.
`);
    process.exit(0);
}

/**
 * @param {keyof typeof MODEL_GATEWAY_SCRIPT_PATHS} scriptId
 * @param {string[]} [scriptArgs]
 */
function runJson(scriptId, scriptArgs = []) {
    const result = spawnSync(process.execPath, [MODEL_GATEWAY_SCRIPT_PATHS[scriptId], ...scriptArgs], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status !== 0) {
        return {
            ok: false,
            error: result.stderr || result.stdout || `command failed with status ${result.status}`,
            json: null,
        };
    }
    try {
        return { ok: true, error: null, json: JSON.parse(result.stdout) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), json: null };
    }
}

const profile = readArg('--profile', 'repo_agent');
const status = runJson('autoStatus', ['--json', `--profile=${profile}`]);
const doctor = runJson('autoDoctor', ['--json', `--profile=${profile}`]);
const summary = {
    schema: 'model-gateway-auto-explain',
    ok: status.ok && doctor.ok,
    profile,
    status: status.json,
    doctor: doctor.json,
    failures: Object.fromEntries(
        Object.entries({ status, doctor })
            .filter(([, result]) => !result.ok)
            .map(([key, result]) => [key, result.error]),
    ),
};

if (argSet.has('--json')) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    const decision = status.json?.['decision'] ?? {};
    process.stdout.write(`model-gateway auto explain: ok=${summary.ok ? 'yes' : 'no'} profile=${profile}\n`);
    process.stdout.write(
        `  decision: action=${decision['action'] ?? '-'} route=${decision['selectedRouteKey'] ?? '-'} ok=${decision['ok'] === true ? 'yes' : 'no'}\n`,
    );
    process.stdout.write(
        `  doctor: blockers=${doctor.json?.['blockers']?.length ?? '-'} warnings=${doctor.json?.['warnings']?.length ?? '-'}\n`,
    );
    for (const [key, error] of Object.entries(summary.failures)) {
        process.stdout.write(`  ${key} failed: ${String(error).slice(0, 500)}\n`);
    }
}
