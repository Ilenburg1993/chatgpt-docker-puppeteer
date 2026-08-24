// @ts-check
/**
 * Fixed child-process worker for representative cold/L1/L2 IO-cache measurements.
 *
 * Configuration is resolved before the benchmark runtime is constructed. The worker owns one explicit
 * ProcessInfra → InfraRuntime tree and creates no runtime resources merely by being imported.
 *
 * @module copilot/mcp/diagnostics/io-cache/worker
 */

import { createProcessInfra } from '#copilot/infra/public/composition/process';
import { readIoProcessHealthSnapshot } from '#copilot/infra/public/observability/process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertIoCacheBenchmarkRequestId, assertIoCacheBenchmarkWorkerMode } from './contracts.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../../..');
const WORKLOAD = Object.freeze([
    'package.json',
    'src/copilot/mcp/tools/runtime-health.js',
    'src/copilot/mcp/tools/jobs.js',
    'src/copilot/infra/filesystem/read/cache/text.js',
    'src/copilot/docs/WORKSPACE_SRC_COPILOT_DIAGNOSTICO_ESTADO_ALVO_E_ROADMAP_2026-08-14.md',
]);

/** @param {string[]} argv */
function parseArgs(argv) {
    /** @param {string} name */
    const read = (name) => {
        const index = argv.indexOf(name);
        return index >= 0 ? (argv[index + 1] ?? '') : '';
    };
    const requestId = assertIoCacheBenchmarkRequestId(read('--request-id'));
    const mode = assertIoCacheBenchmarkWorkerMode(read('--mode'));
    return { requestId, mode };
}

const PATH_POLICY_COUNTERS = Object.freeze([
    'hits',
    'misses',
    'sets',
    'expirations',
    'evictions',
    'bypasses',
    'invalidationEvents',
    'invalidatedEntries',
]);
const READ_HASH_COUNTERS = Object.freeze([
    'reads',
    'hashComputations',
    'fullHashComputations',
    'returnedSliceHashComputations',
    'knownFullHashReuses',
    'fullWindowReturnedHashReuses',
    'fullHashOutputSkips',
    'returnedHashOutputSkips',
]);

/** @param {Record<string, unknown>} after @param {Record<string, unknown>} before @param {readonly string[]} keys */
function counterDelta(after, before, keys) {
    return Object.fromEntries(
        keys.map((key) => [key, Math.max(0, Number(after[key] ?? 0) - Number(before[key] ?? 0))]),
    );
}

/**
 * @param {{ readText: (filePath: string) => Promise<any> }} io
 * @param {ReturnType<ReturnType<typeof createProcessInfra>['createRuntime']>} benchmarkRuntime
 * @param {ReturnType<typeof createProcessInfra>} processInfra
 */
async function runPass(io, benchmarkRuntime, processInfra) {
    const files = [];
    let totalBytes = 0;
    const pathPolicyBefore = readIoProcessHealthSnapshot(processInfra).policies.pathPolicy;
    const readHashesBefore = benchmarkRuntime.coherence.read.hashes.stats();
    const startedAt = performance.now();
    for (const relativePath of WORKLOAD) {
        // Deliberately exercise the public workspace facade: benchmark includes canonical path policy/realpath overhead.
        const result = await io.readText(relativePath);
        const cache = String(result?.io?.cache ?? 'none');
        const bytesRead = Number(result?.bytesRead ?? 0);
        totalBytes += Number.isFinite(bytesRead) ? bytesRead : 0;
        files.push({ relativePath, cache, bytesRead });
    }
    return {
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        totalBytes,
        files,
        cacheStates: files.reduce((counts, file) => {
            counts[file.cache] = Number(counts[file.cache] ?? 0) + 1;
            return counts;
        }, /** @type {Record<string, number>} */ ({})),
        pathPolicy: counterDelta(
            readIoProcessHealthSnapshot(processInfra).policies.pathPolicy,
            pathPolicyBefore,
            PATH_POLICY_COUNTERS,
        ),
        readHashes: counterDelta(benchmarkRuntime.coherence.read.hashes.stats(), readHashesBefore, READ_HASH_COUNTERS),
    };
}

async function main() {
    const { requestId, mode } = parseArgs(process.argv.slice(2));
    // InfraRuntime snapshots operational config at construction. Set the benchmark profile first so each child process
    // actually measures the requested mode instead of inheriting whatever profile existed at module import time.
    process.env['IO_L2_CACHE_PROFILE'] = mode === 'l2' || mode === 'l2-prime' ? 'experimental' : 'off';

    const processInfra = createProcessInfra({ processId: `mcp-io-cache-benchmark:${process.pid}` });
    const benchmarkRuntime = processInfra.createRuntime({ runtimeId: `mcp-io-cache-benchmark:${process.pid}:runtime` });
    const workspaceIo = benchmarkRuntime.workspace(repoRoot).io;
    /** @type {null | (() => void)} */
    let closeDatabase = null;

    try {
        const benchmarkRoot = path.join(repoRoot, 'src/copilot/.ai/mcp/io-cache-benchmark');
        await workspaceIo.mkdirPathLocked(benchmarkRoot, { recursive: true });
        const rootStats = (await workspaceIo.lstatPath(benchmarkRoot)).stats;
        if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
            throw new Error('IO cache benchmark root must be a regular directory.');
        }
        const benchmarkDir = path.join(benchmarkRoot, requestId);
        await workspaceIo.mkdirPathLocked(benchmarkDir, { recursive: true });
        const benchmarkStats = (await workspaceIo.lstatPath(benchmarkDir)).stats;
        if (benchmarkStats.isSymbolicLink() || !benchmarkStats.isDirectory()) {
            throw new Error('IO cache benchmark request directory must be a regular directory.');
        }
        const benchmarkDbPath = path.join(benchmarkDir, 'copilot.sqlite');
        const { createApplicationSqliteRuntime } = await import('#copilot/infra/public/composition/database/sqlite');
        const benchmarkDatabase = await createApplicationSqliteRuntime({ dbPath: benchmarkDbPath });
        closeDatabase = benchmarkDatabase.close;
        benchmarkRuntime.database.configure(benchmarkDatabase.getStructuralDatabase);

        if (mode === 'l1') await runPass(workspaceIo, benchmarkRuntime, processInfra);
        const result = await runPass(workspaceIo, benchmarkRuntime, processInfra);
        const l2 = benchmarkRuntime.coherence.l2.get();
        l2?.flushPending?.();
        process.stdout.write(`${JSON.stringify({ success: true, requestId, mode, workload: WORKLOAD, ...result })}\n`);
    } finally {
        try {
            benchmarkRuntime.coherence.l2.get()?.flushPending?.();
        } catch {
            // Best effort: worker DB is isolated and will be removed by the parent runner.
        }
        try {
            await processInfra.dispose();
        } finally {
            closeDatabase?.();
        }
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stdout.write(
            `${JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) })}\n`,
        );
        process.exitCode = 1;
    });
}
