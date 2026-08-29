// @ts-check
/**
 * Detached representative cold/L1/L2 IO-cache benchmark runner.
 *
 * @module copilot/mcp/diagnostics/io-cache/runner
 */

import { createWorkspaceIo } from '#copilot/infra/public/composition/workspace/io';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { createAttachedChildProcessSupervisor } from '#copilot/infra/public/process/supervision';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getIoCacheBenchmarkStateFile } from './benchmark-state.js';
import { IO_CACHE_BENCHMARK_WORKER, assertIoCacheBenchmarkRequestId } from './contracts.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../../..');
const workspaceIo = createWorkspaceIo({ workspaceRoot: repoRoot });
const STATE_FILE = getIoCacheBenchmarkStateFile();
const SAMPLE_COUNT = 5;
const WORKER_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MIN_L2_COLD_P95_IMPROVEMENT_PERCENT = 10;

/** @param {Record<string, unknown>} state */
async function writeState(state) {
    await workspaceIo.mkdirPathLocked(path.dirname(STATE_FILE), { recursive: true });
    await workspaceIo.writeFileAtomic(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
        mode: 0o600,
        riskClass: 'medium',
        advisoryLimits: { domain: 'mcp-io-cache-benchmark-state' },
    });
}

/** @param {string[]} argv */
function parseArgs(argv) {
    const index = argv.indexOf('--request-id');
    const requestId = index >= 0 ? (argv[index + 1] ?? '') : '';
    return { requestId: assertIoCacheBenchmarkRequestId(requestId) };
}

/**
 * Run one private benchmark worker and resolve only after child `close`, which also proves stdio closure.
 *
 * @param {'cold' | 'l1' | 'l2-prime' | 'l2'} mode
 * @param {string} requestId
 * @param {NodeJS.ProcessEnv} parentEnv
 */
async function runWorker(mode, requestId, parentEnv) {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    /** @type {string | null} */
    let spawnError = null;
    const { env } = buildMcpChildEnvironment({ parentEnv });
    const child = spawn(process.execPath, [IO_CACHE_BENCHMARK_WORKER, '--request-id', requestId, '--mode', mode], {
        cwd: repoRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
    });
    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
    /** @param {string} current @param {string | Buffer} chunk */
    const appendBounded = (current, chunk) => (current + String(chunk)).slice(-MAX_OUTPUT_BYTES);
    child.stdout?.on('data', (chunk) => {
        stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
        stderr = appendBounded(stderr, chunk);
    });
    child.once('error', (error) => {
        spawnError = error.message;
    });
    const timer = setTimeout(() => {
        timedOut = true;
        supervisor.requestTermination({ graceMs: 3000, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
    }, WORKER_TIMEOUT_MS);
    timer.unref();
    const closed = await supervisor.closed;
    clearTimeout(timer);

    let parsed = null;
    try {
        const line = stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
        parsed = line ? JSON.parse(line) : null;
    } catch {
        // Malformed worker output remains represented as a null result.
    }
    const exitCode = Number(closed.exitCode ?? (closed.signal ? 1 : 0));
    const terminationError = closed.signal ? `worker terminated by ${closed.signal}` : null;
    return {
        exitCode,
        timedOut,
        error: spawnError ?? (timedOut ? `worker timed out after ${String(WORKER_TIMEOUT_MS)}ms` : terminationError),
        stderr: stderr || null,
        result: parsed,
    };
}

/** @param {number[]} values */
function summarizeDurations(values) {
    const sorted = [...values].sort((left, right) => left - right);
    /** @param {number} probability */
    const quantile = (probability) => {
        if (sorted.length === 0) return null;
        if (sorted.length === 1) return sorted[0] ?? null;
        const position = (sorted.length - 1) * probability;
        const lower = Math.floor(position);
        const upper = Math.ceil(position);
        const low = sorted[lower] ?? 0;
        const high = sorted[upper] ?? low;
        return Number((low + (high - low) * (position - lower)).toFixed(3));
    };
    return {
        count: sorted.length,
        averageMs: sorted.length
            ? Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(3))
            : null,
        p50Ms: quantile(0.5),
        p95Ms: quantile(0.95),
        p99Ms: quantile(0.99),
        minMs: sorted[0] ?? null,
        maxMs: sorted.at(-1) ?? null,
    };
}

/** @param {Record<string, unknown>[]} samples @param {string} expectedCacheState */
function summarizePhase(samples, expectedCacheState) {
    const successful = samples.filter((sample) => sample['success'] === true);
    const durations = successful.map((sample) => Number(sample['durationMs'])).filter(Number.isFinite);
    const expectedHits = successful.reduce((sum, sample) => {
        const states = sample['cacheStates'];
        if (!states || typeof states !== 'object' || Array.isArray(states)) return sum;
        return sum + Number(/** @type {Record<string, unknown>} */ (states)[expectedCacheState] ?? 0);
    }, 0);
    const workloadFiles =
        successful.length > 0 && Array.isArray(successful[0]?.['files']) ? successful[0]['files'].length : 0;
    const expectedHitsRequired = successful.length * workloadFiles;
    /** @param {string} field */
    const aggregateCounters = (field) => {
        const totals = /** @type {Record<string, number>} */ ({});
        for (const sample of successful) {
            const record = sample[field];
            if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
            for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (record))) {
                const numeric = Number(value);
                if (Number.isFinite(numeric)) totals[key] = Number(totals[key] ?? 0) + numeric;
            }
        }
        return totals;
    };
    return {
        expectedCacheState,
        sampleCount: samples.length,
        successfulSamples: successful.length,
        expectedHits,
        expectedHitsRequired,
        allExpectedCacheHits:
            successful.length === SAMPLE_COUNT && expectedHitsRequired > 0 && expectedHits === expectedHitsRequired,
        latency: summarizeDurations(durations),
        pathPolicy: aggregateCounters('pathPolicy'),
        readHashes: aggregateCounters('readHashes'),
        samples: samples.map((sample) => ({
            success: sample['success'] === true,
            durationMs: sample['durationMs'] ?? null,
            totalBytes: sample['totalBytes'] ?? null,
            cacheStates: sample['cacheStates'] ?? null,
            pathPolicy: sample['pathPolicy'] ?? null,
            readHashes: sample['readHashes'] ?? null,
            error: sample['error'] ?? null,
        })),
    };
}

/** @param {Record<string, unknown>} cold @param {Record<string, unknown>} l1 @param {Record<string, unknown>} l2 */
function buildDecision(cold, l1, l2) {
    const coldP95 = Number(/** @type {Record<string, unknown>} */ (cold['latency'])?.['p95Ms']);
    const l2P95 = Number(/** @type {Record<string, unknown>} */ (l2['latency'])?.['p95Ms']);
    const improvementPercent =
        Number.isFinite(coldP95) && coldP95 > 0 && Number.isFinite(l2P95)
            ? Number((((coldP95 - l2P95) / coldP95) * 100).toFixed(2))
            : null;
    const representativeBenchmarkPassed =
        cold['allExpectedCacheHits'] === true &&
        l1['allExpectedCacheHits'] === true &&
        l2['allExpectedCacheHits'] === true &&
        improvementPercent !== null &&
        improvementPercent >= MIN_L2_COLD_P95_IMPROVEMENT_PERCENT;
    return {
        representativeBenchmarkPassed,
        autoEnable: false,
        minL2ColdP95ImprovementPercent: MIN_L2_COLD_P95_IMPROVEMENT_PERCENT,
        l2ColdP95ImprovementPercent: improvementPercent,
        recommendation: representativeBenchmarkPassed
            ? 'L2 shows representative restart-style benefit; experimental enablement may be evaluated separately.'
            : 'Keep L2 off by default; representative evidence does not justify promotion.',
    };
}

/** @param {'cold' | 'l1' | 'l2'} mode @param {string} requestId @param {NodeJS.ProcessEnv} parentEnv */
async function collectPhase(mode, requestId, parentEnv) {
    const samples = [];
    for (let sample = 1; sample <= SAMPLE_COUNT; sample += 1) {
        const worker = await runWorker(mode, requestId, parentEnv);
        const result =
            worker.result && typeof worker.result === 'object' && !Array.isArray(worker.result)
                ? /** @type {Record<string, unknown>} */ (worker.result)
                : {};
        samples.push({
            sample,
            success: worker.exitCode === 0 && result['success'] === true,
            durationMs: result['durationMs'] ?? null,
            totalBytes: result['totalBytes'] ?? null,
            cacheStates: result['cacheStates'] ?? null,
            pathPolicy: result['pathPolicy'] ?? null,
            readHashes: result['readHashes'] ?? null,
            files: result['files'] ?? null,
            error: worker.error ?? result['error'] ?? worker.stderr,
        });
        if (worker.exitCode !== 0 || result['success'] !== true) break;
    }
    return samples;
}

/** @param {string[]} argv @param {NodeJS.ProcessEnv} parentEnv */
async function runScheduledIoCacheBenchmarkUnsafe(argv, parentEnv) {
    const { requestId } = parseArgs(argv);
    const benchmarkRoot = path.join(repoRoot, 'src/copilot/.ai/mcp/io-cache-benchmark');
    await workspaceIo.mkdirPathLocked(benchmarkRoot, { recursive: true });
    const rootStats = (await workspaceIo.lstatPath(benchmarkRoot)).stats;
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new Error('IO cache benchmark root must be a regular directory.');
    }
    const benchmarkDir = path.join(benchmarkRoot, requestId);
    const startedAt = Date.now();
    await workspaceIo.removePathLocked(benchmarkDir, {
        recursive: true,
        force: true,
        recursiveConfirmation: benchmarkDir,
    });
    await workspaceIo.mkdirPathLocked(benchmarkDir, { recursive: true });
    await writeState({
        schemaVersion: 2,
        status: 'running',
        requestId,
        startedAt,
        sampleCountPerPhase: SAMPLE_COUNT,
        autoEnable: false,
    });

    /** @type {Record<string, any>} */
    let finalState = { status: 'failed' };
    try {
        const coldSamples = await collectPhase('cold', requestId, parentEnv);
        const cold = summarizePhase(coldSamples, 'l1-miss');
        await writeState({
            schemaVersion: 2,
            status: 'running',
            requestId,
            startedAt,
            stage: 'cold-complete',
            phases: { cold },
            autoEnable: false,
        });

        const l1Samples = await collectPhase('l1', requestId, parentEnv);
        const l1 = summarizePhase(l1Samples, 'l1-hit');
        await writeState({
            schemaVersion: 2,
            status: 'running',
            requestId,
            startedAt,
            stage: 'l1-complete',
            phases: { cold, l1 },
            autoEnable: false,
        });

        const prime = await runWorker('l2-prime', requestId, parentEnv);
        if (prime.exitCode !== 0 || !prime.result || prime.result.success !== true) {
            throw new Error(`L2 prime failed: ${prime.error ?? prime.stderr ?? 'unknown worker failure'}`);
        }
        const l2Samples = await collectPhase('l2', requestId, parentEnv);
        const l2 = summarizePhase(l2Samples, 'l2-hit');
        const decision = buildDecision(cold, l1, l2);
        const completedAt = Date.now();
        finalState = {
            schemaVersion: 2,
            status: 'completed',
            requestId,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            sampleCountPerPhase: SAMPLE_COUNT,
            workloadKind: 'fixed-representative-workspace-io-text-read',
            phases: { cold, l1, l2 },
            decision,
            autoEnable: false,
            isolatedDb: true,
            cleanedTemporaryDb: false,
            error: null,
        };
    } catch (error) {
        const completedAt = Date.now();
        finalState = {
            schemaVersion: 2,
            status: 'failed',
            requestId,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            autoEnable: false,
            isolatedDb: true,
            cleanedTemporaryDb: false,
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        try {
            await workspaceIo.removePathLocked(benchmarkDir, {
                recursive: true,
                force: true,
                recursiveConfirmation: benchmarkDir,
            });
            finalState['cleanedTemporaryDb'] = true;
        } catch (error) {
            finalState['cleanedTemporaryDb'] = false;
            finalState['cleanupError'] = error instanceof Error ? error.message : String(error);
        }
        await writeState(finalState);
    }
    return finalState;
}

/**
 * Run the fixed representative IO-cache benchmark. Setup/argument failures are converted into the same persisted
 * terminal state as measurement failures so the thin launcher never owns diagnostic state semantics.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} parentEnv
 * @returns {Promise<Record<string, any>>}
 */
export async function runScheduledIoCacheBenchmark(argv, parentEnv) {
    if (!parentEnv) throw new TypeError('Scheduled IO-cache benchmark requires an explicit process environment.');
    try {
        return await runScheduledIoCacheBenchmarkUnsafe(argv, parentEnv);
    } catch (error) {
        /** @type {Record<string, any>} */
        const failed = {
            schemaVersion: 2,
            status: 'failed',
            completedAt: Date.now(),
            autoEnable: false,
            error: error instanceof Error ? error.message : String(error),
        };
        try {
            await writeState(failed);
        } catch (stateError) {
            failed['stateWriteError'] = stateError instanceof Error ? stateError.message : String(stateError);
        }
        return failed;
    }
}
