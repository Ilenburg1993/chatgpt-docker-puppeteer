// @ts-check
/**
 * Fixed child-process worker for representative cold/L1/L2 IO-cache measurements.
 *
 * @module copilot/mcp/scripts/io-cache-benchmark-worker
 */

import { getIoPathPolicyCacheStats } from '#copilot/core';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../..');
const benchmarkRuntime = createInfraRuntime({ runtimeId: `mcp-io-cache-benchmark:${process.pid}` });
const workspaceIo = benchmarkRuntime.workspace(repoRoot).io;
const REQUEST_ID_RE = /^mcp-io-cache-benchmark-[a-z0-9-]{8,80}$/u;
const MODES = Object.freeze(['cold', 'l1', 'l2-prime', 'l2']);
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
    const requestId = read('--request-id');
    const mode = read('--mode');
    if (!REQUEST_ID_RE.test(requestId)) throw new Error('Invalid generated IO cache benchmark request id.');
    if (!MODES.includes(mode)) throw new Error('Invalid IO cache benchmark worker mode.');
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

/** @param {{ readText: (filePath: string) => Promise<any> }} io */
async function runPass(io) {
    const files = [];
    let totalBytes = 0;
    const pathPolicyBefore = getIoPathPolicyCacheStats();
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
        pathPolicy: counterDelta(getIoPathPolicyCacheStats(), pathPolicyBefore, PATH_POLICY_COUNTERS),
        readHashes: counterDelta(benchmarkRuntime.coherence.read.hashes.stats(), readHashesBefore, READ_HASH_COUNTERS),
    };
}

async function main() {
    const { requestId, mode } = parseArgs(process.argv.slice(2));
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
    process.env['COPILOT_DB_PATH'] = path.join(benchmarkDir, 'copilot.sqlite');
    process.env['IO_L2_CACHE_PROFILE'] = mode === 'l2' || mode === 'l2-prime' ? 'experimental' : 'off';

    const { closeCopilotDb, ensureCopilotDbDir, getCopilotDb } = await import('../../db/index.js');
    await ensureCopilotDbDir();
    benchmarkRuntime.database.configure(getCopilotDb);

    try {
        if (mode === 'l1') await runPass(workspaceIo);
        const result = await runPass(workspaceIo);
        const l2 = benchmarkRuntime.coherence.l2.get();
        l2?.flushPending?.();
        process.stdout.write(`${JSON.stringify({ success: true, requestId, mode, workload: WORKLOAD, ...result })}\n`);
    } finally {
        try {
            benchmarkRuntime.coherence.l2.get()?.flushPending?.();
        } catch {
            // Best effort: worker DB is isolated and will be removed by the parent runner.
        }
        await benchmarkRuntime.dispose();
        closeCopilotDb();
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
