#!/usr/bin/env node
// @ts-check
/**
 * Thin CLI launcher for the canonical Model Gateway live-readiness application service.
 *
 * Importing this module is intentionally side-effect-free: no SQLite bootstrap, dotenv loading, model-gateway graph or
 * filesystem capability is materialized until this file is the direct CLI entrypoint.
 */

import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const DEFAULT_SQLITE_REDACTION_MAX_ROWS_PER_TABLE = 25;
const DEEP_SQLITE_REDACTION_MAX_ROWS_PER_TABLE = 100_000;

function isDirectCliInvocation() {
    const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
    return import.meta.url === entrypoint;
}

function memorySnapshot() {
    const usage = process.memoryUsage();
    return {
        rssBytes: usage.rss,
        heapTotalBytes: usage.heapTotal,
        heapUsedBytes: usage.heapUsed,
        externalBytes: usage.external,
        arrayBuffersBytes: usage.arrayBuffers,
    };
}

async function main() {
    const mainStartedAt = performance.now();
    const diagnosticsRequested = process.argv.includes('--diagnostics');
    const memoryAtStart = diagnosticsRequested ? memorySnapshot() : null;
    // Bootstrap must precede application imports that may construct SQLite-backed runtime capabilities.
    const bootstrapStartedAt = performance.now();
    await import('../bootstrap-sqlite.mjs');
    const bootstrapMs = Number((performance.now() - bootstrapStartedAt).toFixed(3));
    const importsStartedAt = performance.now();
    const [modelGateway, readiness, pathModule, cliArgs, scriptIndex, envModule] = await Promise.all([
        import('#copilot/model-gateway'),
        import('#copilot/model-gateway/readiness'),
        import('node:path'),
        import('../cli-args.mjs'),
        import('../index.mjs'),
        import('../lib/env.mjs'),
    ]);
    const moduleImportsMs = Number((performance.now() - importsStartedAt).toFixed(3));
    const memoryAfterImports = diagnosticsRequested ? memorySnapshot() : null;
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
    /** @returns {Record<string, unknown> | null} */
    const readRedactionProof = () => {
        const encoded = readArg('--redaction-proof-base64');
        if (!encoded) return null;
        if (encoded.length > 128 * 1024)
            throw new RangeError('Encoded redaction proof exceeds the CLI transport budget.');
        let parsed;
        try {
            parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        } catch (error) {
            throw new Error('Invalid Model Gateway redaction proof transport payload.', { cause: error });
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new TypeError('Model Gateway redaction proof transport must decode to a JSON object.');
        }
        return /** @type {Record<string, unknown>} */ (parsed);
    };

    if (argSet.has('--help') || argSet.has('-h')) {
        process.stdout.write(
            `Usage: node scripts/model-gateway/commands/model-gateway-live-readiness.mjs [--json] [--fail] [--fail-on-supply-warning] [--sqlite-runtime-health] [--redaction-max-rows-per-table N] [--deep-redaction]\n\nCheck whether the model-gateway metadata database is ready for terminal llm-b live tests.\nThis does not start the terminal, execute providers, run models or run runtime probes.\nRedaction coverage is explicit: catalog is exhaustive for the normalized catalog snapshot; SQLite is bounded per table. --deep-redaction raises the SQLite bound to 100000 rows/table and is not an exhaustive-history guarantee.\n`,
        );
        return;
    }

    loadModelGatewayDotenv();
    const json = argSet.has('--json');
    const fail = argSet.has('--fail');
    const sqliteRedactionMaxRowsPerTable = argSet.has('--deep-redaction')
        ? DEEP_SQLITE_REDACTION_MAX_ROWS_PER_TABLE
        : readPositiveInteger(
              ['--redaction-max-rows-per-table', '--sqlite-redaction-max-rows-per-table'],
              DEFAULT_SQLITE_REDACTION_MAX_ROWS_PER_TABLE,
          );
    const redactionProofContextId = readArg('--redaction-proof-context-id').trim() || null;
    const redactionProof = readRedactionProof();
    if (redactionProof && !redactionProofContextId) {
        throw new TypeError('Redaction proof transport requires --redaction-proof-context-id.');
    }
    const buildStartedAt = performance.now();
    const preBuildSetupMs = Number((buildStartedAt - mainStartedAt - bootstrapMs - moduleImportsMs).toFixed(3));
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
        redactionProof,
        redactionProofContextId,
        diagnostics: diagnosticsRequested,
    });
    const domainBuildWallMs = Number((performance.now() - buildStartedAt).toFixed(3));
    const memoryAfterBuild = diagnosticsRequested ? memorySnapshot() : null;
    const resourceUsageAfterBuild = diagnosticsRequested ? process.resourceUsage() : null;
    if (json) {
        if (diagnosticsRequested) {
            const serializationStartedAt = performance.now();
            JSON.stringify(summary, null, 2);
            const summarySerializationMs = Number((performance.now() - serializationStartedAt).toFixed(3));
            const processDiagnostics = {
                bootstrapMs,
                moduleImportsMs,
                preBuildSetupMs,
                entryToBuildStartMs: Number((buildStartedAt - mainStartedAt).toFixed(3)),
                domainBuildWallMs,
                summarySerializationMs,
                memory: {
                    start: memoryAtStart,
                    afterImports: memoryAfterImports,
                    afterBuild: memoryAfterBuild,
                    maxRssKb: resourceUsageAfterBuild?.maxRSS ?? null,
                },
                redactionWorkers: summary['diagnostics']?.['redactionWorkers'] ?? null,
            };
            process.stdout.write(`${JSON.stringify({ ...summary, processDiagnostics }, null, 2)}\n`);
        } else {
            process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        }
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
