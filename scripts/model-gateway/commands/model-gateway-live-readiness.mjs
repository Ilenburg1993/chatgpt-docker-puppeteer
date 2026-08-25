#!/usr/bin/env node
// @ts-check
/**
 * Thin CLI launcher for the canonical Model Gateway live-readiness application service.
 *
 * Importing this module is intentionally side-effect-free: no SQLite bootstrap, dotenv loading, model-gateway graph or
 * filesystem capability is materialized until this file is the direct CLI entrypoint.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SQLITE_REDACTION_MAX_ROWS_PER_TABLE = 25;
const DEEP_SQLITE_REDACTION_MAX_ROWS_PER_TABLE = 100_000;

function isDirectCliInvocation() {
    const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
    return import.meta.url === entrypoint;
}

async function main() {
    // Bootstrap must precede application imports that may construct SQLite-backed runtime capabilities.
    await import('../bootstrap-sqlite.mjs');
    const [modelGateway, readiness, pathModule, cliArgs, scriptIndex, envModule] = await Promise.all([
        import('#copilot/model-gateway'),
        import('#copilot/model-gateway/readiness'),
        import('node:path'),
        import('../cli-args.mjs'),
        import('../index.mjs'),
        import('../lib/env.mjs'),
    ]);
    const { renderModelGatewayLocalProviderOptInGuidance } = modelGateway;
    const { buildModelGatewayLiveReadiness } = readiness;
    const { createArgReader } = cliArgs;
    const { COPILOT_TERMINAL_LLM_B_LIVE_TEST_PATH, REPO_ROOT } = scriptIndex;
    const { loadModelGatewayDotenv } = envModule;

    const args = process.argv.slice(2);
    const readArg = createArgReader(args);
    const argSet = new Set(args);
    /** @param {string[]} names @param {number} fallback */
    const readPositiveInteger = (names, fallback) => {
        for (const name of names) {
            const raw = readArg(name);
            if (!raw) continue;
            const parsed = Number.parseInt(raw, 10);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return fallback;
    };

    if (argSet.has('--help') || argSet.has('-h')) {
        process.stdout.write(
            `Usage: node scripts/model-gateway/commands/model-gateway-live-readiness.mjs [--json] [--fail] [--fail-on-supply-warning] [--sqlite-runtime-health] [--redaction-max-rows-per-table N] [--deep-redaction]\n\nCheck whether the model-gateway metadata database is ready for terminal llm-b live tests.\nThis does not start the terminal, execute providers, run models or run runtime probes.\n`,
        );
        return;
    }

    loadModelGatewayDotenv();
    const json = argSet.has('--json');
    const fail = argSet.has('--fail');
    const sqliteRedactionMaxRowsPerTable =
        argSet.has('--deep-redaction') || argSet.has('--full-redaction')
            ? DEEP_SQLITE_REDACTION_MAX_ROWS_PER_TABLE
            : readPositiveInteger(
                  ['--redaction-max-rows-per-table', '--sqlite-redaction-max-rows-per-table'],
                  DEFAULT_SQLITE_REDACTION_MAX_ROWS_PER_TABLE,
              );
    const summary = await buildModelGatewayLiveReadiness({
        workspaceRoot: REPO_ROOT,
        liveRunnerPath: COPILOT_TERMINAL_LLM_B_LIVE_TEST_PATH,
        redactionWorkerPath: pathModule.join(
            REPO_ROOT,
            'scripts/model-gateway/commands/model-gateway-live-redaction-worker.mjs',
        ),
        env: process.env,
        includeSqliteRuntimeHealth: argSet.has('--sqlite-runtime-health'),
        failOnSupplyWarning: argSet.has('--fail-on-supply-warning'),
        sqliteRedactionMaxRowsPerTable,
    });
    if (json) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
        process.stdout.write(`model-gateway live readiness: ok=${summary['ok'] ? 'yes' : 'no'}\n`);
        for (const check of summary['checks']) {
            process.stdout.write(`  ${check.ok ? 'OK' : 'FAIL'} ${check.id}: ${check.detail}\n`);
        }
        const localProviderOptIn = summary['selection'].effectiveStrict.localProviderOptIn;
        if (localProviderOptIn.hasBlocks) {
            process.stdout.write(
                `\n${renderModelGatewayLocalProviderOptInGuidance({ profileIds: localProviderOptIn.blockedProfileIds })}\n`,
            );
        }
        process.stdout.write('\nrecommended live order:\n');
        summary['livePlan'].commands.forEach((command, index) => process.stdout.write(`  ${index + 1}. ${command}\n`));
    }
    if (fail && !summary['ok']) process.exitCode = 1;
}

if (isDirectCliInvocation()) await main();
