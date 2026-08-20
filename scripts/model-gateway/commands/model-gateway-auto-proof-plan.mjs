#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { buildModelGatewayRuntimeProofCommands, buildModelGatewayRuntimeSelectorPlan } from '#copilot/model-gateway';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from '../index.mjs';

import { createArgReader, readPositiveIntArg } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-auto-proof-plan.mjs [--json] [--profile ID] [--fallback-profiles a,b] [--selection-policy metadata_first|prefer_runtime_proved|require_runtime_proof] [--temporary-failure-cooldown-ms N] [--limit N] [--timeout-ms N]

Build a read-only runtime proof plan for model-gateway auto mode. It does not call providers, run probes or mutate the
terminal. It converts blocked runtime-selector alternatives into explicit /byok probe commands.
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

function runtimeSelectorArgs(/** @type {string} */ profile) {
    const forwarded = ['--json', `--profile=${profile}`];
    for (const flag of [
        '--fallback-profiles',
        '--selection-policy',
        '--preferred-probes',
        '--block-failed-probes',
        '--temporary-failure-cooldown-ms',
    ]) {
        const value = readArg(flag);
        if (value) forwarded.push(`${flag}=${value}`);
    }
    return forwarded;
}

/** @returns {{ ok?: boolean; runtimeSelectorPlan?: ReturnType<typeof buildModelGatewayRuntimeSelectorPlan> }} */
function readRuntimeSelectorPlan(/** @type {string} */ profile) {
    const result = spawnSync(process.execPath, [MODEL_GATEWAY_SCRIPT_PATHS.runtimeSelector, ...runtimeSelectorArgs(profile)], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`runtime selector failed: ${result.stderr || result.stdout || result.status}`);
    }
    return JSON.parse(result.stdout);
}

const profile = readArg('--profile', 'repo_agent');
const limit = readPositiveInt('--limit', 12);
const timeoutMs = readPositiveInt('--timeout-ms', 20_000);
const selector = readRuntimeSelectorPlan(profile);
const routes = Array.isArray(selector.runtimeSelectorPlan?.routes) ? selector.runtimeSelectorPlan.routes : [];
const proofPlans = routes.map((route) => {
    const commands = buildModelGatewayRuntimeProofCommands(route.alternativeSummary, { limit, timeoutMs });
    return {
        profileId: route.profileId ?? profile,
        status: route.status ?? 'unknown',
        selectedRouteKey: route.selectedRouteKey ?? null,
        alternativeSummary: route.alternativeSummary ?? null,
        commands,
    };
});
const commandRows = proofPlans.flatMap((row) =>
    row.commands.map((command) => ({
        profileId: row.profileId,
        status: row.status,
        selectedRouteKey: row.selectedRouteKey,
        ...command,
    })),
);
const summary = {
    profileCount: proofPlans.length,
    commandCount: commandRows.length,
    blockedProfileCount: proofPlans.filter((row) => row.status === 'blocked').length,
    usableAlternativeCount: proofPlans.reduce((sum, row) => sum + (row.alternativeSummary?.usableCount ?? 0), 0),
    evaluatedAlternativeCount: proofPlans.reduce((sum, row) => sum + (row.alternativeSummary?.evaluatedCount ?? 0), 0),
};
const output = {
    schema: 'model-gateway-auto-runtime-proof-plan',
    ok: true,
    profile,
    selectorOk: selector.ok === true,
    runtimeSelectorReady: selector.runtimeSelectorPlan?.ready === true,
    generatedAt: new Date().toISOString(),
    summary,
    proofPlans,
    commands: commandRows,
    nextCommands: commandRows.slice(0, Math.min(commandRows.length, 5)).map((row) => row.command),
};

if (argSet.has('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway auto proof plan: commands=${summary.commandCount} profiles=${summary.profileCount} alternatives=${summary.usableAlternativeCount}/${summary.evaluatedAlternativeCount}\n`,
    );
    for (const row of commandRows.slice(0, limit)) {
        process.stdout.write(`  ${row.command}  # profile=${row.profileId} reasons=${row.reasons.slice(0, 3).join('+') || '-'}\n`);
    }
    if (commandRows.length === 0) {
        process.stdout.write('  No runtime proof commands are currently needed or derivable from top blocked alternatives.\n');
    }
}
