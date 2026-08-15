// @ts-check
/**
 * Fixed child-process worker for representative cold/L1/L2 IO-cache measurements.
 *
 * @module copilot/mcp/scripts/io-cache-benchmark-worker
 */

import { lstat, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../..');
const REQUEST_ID_RE = /^mcp-io-cache-benchmark-[a-z0-9-]{8,80}$/u;
const MODES = Object.freeze(['cold', 'l1', 'l2-prime', 'l2']);
const WORKLOAD = Object.freeze([
    'package.json',
    'src/copilot/mcp/tools/runtime-health.js',
    'src/copilot/mcp/tools/jobs.js',
    'src/copilot/infra/io/fs/read-services.js',
    'src/copilot/docs/WORKSPACE_SRC_COPILOT_DIAGNOSTICO_ESTADO_ALVO_E_ROADMAP_2026-08-14.md',
]);

/** @param {string[]} argv */
function parseArgs(argv) {
    /** @param {string} name */
    const read = (name) => {
        const index = argv.indexOf(name);
        return index >= 0 ? argv[index + 1] ?? '' : '';
    };
    const requestId = read('--request-id');
    const mode = read('--mode');
    if (!REQUEST_ID_RE.test(requestId)) throw new Error('Invalid generated IO cache benchmark request id.');
    if (!MODES.includes(mode)) throw new Error('Invalid IO cache benchmark worker mode.');
    return { requestId, mode };
}

/** @param {{ readText: (filePath: string) => Promise<any> }} io */
async function runPass(io) {
    const files = [];
    let totalBytes = 0;
    const startedAt = performance.now();
    for (const relativePath of WORKLOAD) {
        const absolutePath = path.join(repoRoot, relativePath);
        const result = await io.readText(absolutePath);
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
    };
}

async function main() {
    const { requestId, mode } = parseArgs(process.argv.slice(2));
    const benchmarkRoot = path.join(repoRoot, 'src/copilot/.ai/mcp/io-cache-benchmark');
    await mkdir(benchmarkRoot, { recursive: true });
    const rootStats = await lstat(benchmarkRoot);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new Error('IO cache benchmark root must be a regular directory.');
    }
    const benchmarkDir = path.join(benchmarkRoot, requestId);
    await mkdir(benchmarkDir, { recursive: true });
    const benchmarkStats = await lstat(benchmarkDir);
    if (benchmarkStats.isSymbolicLink() || !benchmarkStats.isDirectory()) {
        throw new Error('IO cache benchmark request directory must be a regular directory.');
    }
    process.env['COPILOT_DB_PATH'] = path.join(benchmarkDir, 'copilot.sqlite');
    process.env['IO_L2_CACHE_PROFILE'] = mode === 'l2' || mode === 'l2-prime' ? 'experimental' : 'off';
    delete process.env['IO_L2_CACHE_ENABLED'];

    const [{ readText }, { getIoL2Cache }, { closeCopilotDb }] = await Promise.all([
        import('../../infra/io/fs/read-services.js'),
        import('../../infra/io-cache-l2-registry.js'),
        import('../../db/index.js'),
    ]);

    try {
        if (mode === 'l1') await runPass({ readText });
        const result = await runPass({ readText });
        const l2 = getIoL2Cache();
        if (l2) l2.flushPending?.();
        process.stdout.write(`${JSON.stringify({ success: true, requestId, mode, workload: WORKLOAD, ...result })}\n`);
    } finally {
        try {
            getIoL2Cache()?.flushPending?.();
        } catch {
            // Best effort: worker DB is isolated and will be removed by the parent runner.
        }
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
