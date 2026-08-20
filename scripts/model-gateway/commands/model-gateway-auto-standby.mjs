#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { SqliteModelGatewayCatalogStore, buildModelGatewayRuntimeStandbyPlan } from '#copilot/model-gateway';

import { setDbLogger } from '../../../src/copilot/db/sqlite.js';
import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from '../index.mjs';

import { createArgReader, readPositiveIntArg } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);

if (argSet.has('--json')) {
    setDbLogger((level, msg) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${msg}\n`);
        }
    });
}

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout
        .write(`Usage: node scripts/model-gateway/commands/model-gateway-auto-standby.mjs [--json] [--profile ID] [--fallback-profiles a,b] [--selection-policy metadata_first|prefer_runtime_proved|require_runtime_proof] [--temporary-failure-cooldown-ms N] [--limit N] [--timeout-ms N] [--alternates-only] [--write-sqlite] [--read-sqlite|--persisted]

Build a read-only standby route list for model-gateway auto mode. It defaults to prefer_runtime_proved, does not call
providers, run probes, mutate env or touch the terminal session. It renders ready replacement routes and one recommended
explicit terminal command per route.
Use --write-sqlite to persist the generated standby plan as operational history.
Use --read-sqlite or --persisted to list previously persisted standby plans without recalculating selector state.
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
    let hasSelectionPolicy = false;
    for (const flag of [
        '--fallback-profiles',
        '--selection-policy',
        '--preferred-probes',
        '--block-failed-probes',
        '--temporary-failure-cooldown-ms',
    ]) {
        const value = readArg(flag);
        if (value) {
            forwarded.push(`${flag}=${value}`);
            if (flag === '--selection-policy') hasSelectionPolicy = true;
        }
    }
    if (!hasSelectionPolicy) forwarded.push('--selection-policy=prefer_runtime_proved');
    return forwarded;
}

/** @returns {{ ok?: boolean; runtimeSelectorPlan: ReturnType<typeof import('#copilot/model-gateway').buildModelGatewayRuntimeSelectorPlan> }} */
function readRuntimeSelectorPlan(/** @type {string} */ profile) {
    const result = spawnSync(
        process.execPath,
        [MODEL_GATEWAY_SCRIPT_PATHS.runtimeSelector, ...runtimeSelectorArgs(profile)],
        {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        },
    );
    if (result.status !== 0) {
        throw new Error(`runtime selector failed: ${result.stderr || result.stdout || result.status}`);
    }
    return JSON.parse(result.stdout);
}

const profile = readArg('--profile', 'repo_agent');
const limit = readPositiveInt('--limit', 12);
const timeoutMs = readPositiveInt('--timeout-ms', 20_000);
const includeSelected = !argSet.has('--alternates-only');
if (argSet.has('--read-sqlite') || argSet.has('--persisted')) {
    const plans = await new SqliteModelGatewayCatalogStore().readStandbyPlanRecords({ limit, profileId: profile });
    const latest = plans[0] ?? null;
    const latestSummary =
        latest?.['summary'] && typeof latest['summary'] === 'object' && !Array.isArray(latest['summary'])
            ? Object.fromEntries(Object.entries(latest['summary']))
            : null;
    const latestRoutes = Array.isArray(latest?.['routes']) ? latest['routes'] : [];
    const output = {
        schema: 'model-gateway-auto-standby-persisted',
        ok: plans.length > 0,
        profile,
        generatedAt: new Date().toISOString(),
        summary: {
            planCount: plans.length,
            latestRouteCount: latestSummary?.['routeCount'] ?? latestRoutes.length,
            latestProviderCount: latestSummary?.['providerCount'] ?? 0,
            latestRuntimeProofCount: latestSummary?.['runtimeProofCount'] ?? 0,
        },
        latest,
        plans,
    };
    if (argSet.has('--json')) {
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
        process.stdout.write(
            `model-gateway auto standby persisted: plans=${output.summary.planCount} profile=${profile} latestRoutes=${output.summary.latestRouteCount}\n`,
        );
        for (const [index, plan] of plans.entries()) {
            const planSummary =
                plan['summary'] && typeof plan['summary'] === 'object' && !Array.isArray(plan['summary'])
                    ? Object.fromEntries(Object.entries(plan['summary']))
                    : null;
            const planRoutes = Array.isArray(plan['routes']) ? plan['routes'] : [];
            process.stdout.write(
                `  ${index + 1}. ${plan['standbyPlanId'] ?? '-'} status=${plan['status'] ?? '-'} routes=${planSummary?.['routeCount'] ?? planRoutes.length} providers=${planSummary?.['providerCount'] ?? 0} generated=${plan['generatedAt'] ?? plan['generatedAtMs'] ?? '-'}\n`,
            );
        }
    }
    process.exit(0);
}
const selector = readRuntimeSelectorPlan(profile);
const standbyPlan = buildModelGatewayRuntimeStandbyPlan(selector.runtimeSelectorPlan, {
    limit,
    timeoutMs,
    includeSelected,
    profileId: profile,
});
const persistence = argSet.has('--write-sqlite')
    ? await new SqliteModelGatewayCatalogStore().writeStandbyPlanRecords([
          {
              ...standbyPlan,
              source: 'model-gateway-auto-standby',
              profile,
          },
      ])
    : { standbyPlans: 0 };
const output = {
    schema: 'model-gateway-auto-standby-routes',
    ok: standbyPlan.ok,
    profile,
    selectorOk: selector.ok === true,
    runtimeSelectorReady: selector.runtimeSelectorPlan?.ready === true,
    standbyPlan,
    generatedAt: standbyPlan.generatedAt,
    summary: standbyPlan.summary,
    routes: standbyPlan.routes,
    nextCommands: standbyPlan.nextCommands,
    persistence: {
        requested: argSet.has('--write-sqlite'),
        standbyPlans: persistence.standbyPlans,
    },
};

if (argSet.has('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
    const { summary } = standbyPlan;
    process.stdout.write(
        `model-gateway auto standby: routes=${summary.routeCount} selected=${summary.selectedCount} alternates=${summary.alternateCount} proof=${summary.runtimeProofCount} providers=${summary.providerCount} persisted=${persistence.standbyPlans}\n`,
    );
    for (const row of standbyPlan.routes.slice(0, limit)) {
        process.stdout.write(
            `  ${row.profileId} #${row.rank} ${row.source} ${row.providerId}:${row.providerModel} proof=${row.hasRuntimeProof ? 'yes' : 'no'} env=${row.runtimeEnvStatus ?? '-'} score=${row.score ?? '-'}\n`,
        );
        process.stdout.write(`    recommended: ${row.recommendedAction} -> ${row.recommendedCommand ?? '-'}\n`);
        process.stdout.write(`    prove: ${row.commands.probeAgent ?? '-'}\n`);
        process.stdout.write(`    live:  ${row.commands.liveModel ?? '-'}\n`);
        process.stdout.write(`    next:  ${row.commands.explicitNewSession} && ${row.commands.provider ?? '-'}\n`);
    }
    if (standbyPlan.routes.length === 0) {
        process.stdout.write('  No standby routes are currently derivable from the runtime selector plan.\n');
    }
}
