// @ts-check
/**
 * Detached representative cold/L1/L2 IO-cache benchmark runner.
 *
 * @module copilot/mcp/scripts/scheduled-io-cache-benchmark-runner
 */

import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import { getIoCacheBenchmarkStateFile } from '#copilot/mcp/control-plane';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../..');
const workspaceIo = createWorkspaceIo({ workspaceRoot: repoRoot });
const STATE_FILE = getIoCacheBenchmarkStateFile();
const WORKER = 'src/copilot/mcp/scripts/io-cache-benchmark-worker.js';
const REQUEST_ID_RE = /^mcp-io-cache-benchmark-[a-z0-9-]{8,80}$/u;
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
    const requestId = index >= 0 ? argv[index + 1] ?? '' : '';
    if (!REQUEST_ID_RE.test(requestId)) throw new Error('Invalid generated IO cache benchmark request id.');
    return { requestId };
}

/** @param {'cold' | 'l1' | 'l2-prime' | 'l2'} mode @param {string} requestId */
function runWorker(mode, requestId) {
    return new Promise((resolvePromise) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        /** @type {NodeJS.Timeout | null} */
        let hardKillTimer = null;
        const child = spawn(process.execPath, [WORKER, '--request-id', requestId, '--mode', mode], {
            cwd: repoRoot,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        /** @param {string} current @param {string | Buffer} chunk */
        const appendBounded = (current, chunk) => (current + String(chunk)).slice(-MAX_OUTPUT_BYTES);
        child.stdout.on('data', (chunk) => {
            stdout = appendBounded(stdout, chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr = appendBounded(stderr, chunk);
        });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            hardKillTimer = setTimeout(() => {
                if (!settled) child.kill('SIGKILL');
            }, 3000);
            hardKillTimer.unref?.();
        }, WORKER_TIMEOUT_MS);
        timer.unref?.();
        /** @param {number} exitCode @param {string | null} error */
        const finish = (exitCode, error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (hardKillTimer) clearTimeout(hardKillTimer);
            let parsed = null;
            try {
                const line = stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
                parsed = line ? JSON.parse(line) : null;
            } catch {
                // Malformed worker output remains represented as a null result.
            }
            resolvePromise({
                exitCode,
                timedOut,
                error: error ?? (timedOut ? `worker timed out after ${String(WORKER_TIMEOUT_MS)}ms` : null),
                stderr: stderr || null,
                result: parsed,
            });
        };
        child.once('error', (error) => finish(1, error.message));
        child.once('exit', (code, signal) => finish(Number(code ?? (signal ? 1 : 0)), signal ? `worker terminated by ${signal}` : null));
    });
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
        averageMs: sorted.length ? Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(3)) : null,
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
    const workloadFiles = successful.length > 0 && Array.isArray(successful[0]?.['files']) ? successful[0]['files'].length : 0;
    const expectedHitsRequired = successful.length * workloadFiles;
    return {
        expectedCacheState,
        sampleCount: samples.length,
        successfulSamples: successful.length,
        expectedHits,
        expectedHitsRequired,
        allExpectedCacheHits: successful.length === SAMPLE_COUNT && expectedHitsRequired > 0 && expectedHits === expectedHitsRequired,
        latency: summarizeDurations(durations),
        samples: samples.map((sample) => ({
            success: sample['success'] === true,
            durationMs: sample['durationMs'] ?? null,
            totalBytes: sample['totalBytes'] ?? null,
            cacheStates: sample['cacheStates'] ?? null,
            error: sample['error'] ?? null,
        })),
    };
}

/** @param {Record<string, unknown>} cold @param {Record<string, unknown>} l1 @param {Record<string, unknown>} l2 */
function buildDecision(cold, l1, l2) {
    const coldP95 = Number(/** @type {Record<string, unknown>} */ (cold['latency'])?.['p95Ms']);
    const l2P95 = Number(/** @type {Record<string, unknown>} */ (l2['latency'])?.['p95Ms']);
    const improvementPercent = Number.isFinite(coldP95) && coldP95 > 0 && Number.isFinite(l2P95)
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

/** @param {'cold' | 'l1' | 'l2'} mode @param {string} requestId */
async function collectPhase(mode, requestId) {
    const samples = [];
    for (let sample = 1; sample <= SAMPLE_COUNT; sample += 1) {
        const worker = await runWorker(mode, requestId);
        const result = worker.result && typeof worker.result === 'object' && !Array.isArray(worker.result)
            ? /** @type {Record<string, unknown>} */ (worker.result)
            : {};
        samples.push({
            sample,
            success: worker.exitCode === 0 && result['success'] === true,
            durationMs: result['durationMs'] ?? null,
            totalBytes: result['totalBytes'] ?? null,
            cacheStates: result['cacheStates'] ?? null,
            files: result['files'] ?? null,
            error: worker.error ?? result['error'] ?? worker.stderr,
        });
        if (worker.exitCode !== 0 || result['success'] !== true) break;
    }
    return samples;
}

async function main() {
    const { requestId } = parseArgs(process.argv.slice(2));
    const benchmarkRoot = path.join(repoRoot, 'src/copilot/.ai/mcp/io-cache-benchmark');
    await workspaceIo.mkdirPathLocked(benchmarkRoot, { recursive: true });
    const rootStats = await lstat(benchmarkRoot);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new Error('IO cache benchmark root must be a regular directory.');
    }
    const benchmarkDir = path.join(benchmarkRoot, requestId);
    const startedAt = Date.now();
    await workspaceIo.removePathLocked(benchmarkDir, { recursive: true, force: true });
    await workspaceIo.mkdirPathLocked(benchmarkDir, { recursive: true });
    await writeState({ schemaVersion: 1, status: 'running', requestId, startedAt, sampleCountPerPhase: SAMPLE_COUNT, autoEnable: false });

    /** @type {Record<string, any>} */
    let finalState = { status: 'failed' };
    try {
        const coldSamples = await collectPhase('cold', requestId);
        const cold = summarizePhase(coldSamples, 'l1-miss');
        await writeState({ schemaVersion: 1, status: 'running', requestId, startedAt, stage: 'cold-complete', phases: { cold }, autoEnable: false });

        const l1Samples = await collectPhase('l1', requestId);
        const l1 = summarizePhase(l1Samples, 'l1-hit');
        await writeState({ schemaVersion: 1, status: 'running', requestId, startedAt, stage: 'l1-complete', phases: { cold, l1 }, autoEnable: false });

        const prime = await runWorker('l2-prime', requestId);
        if (prime.exitCode !== 0 || !prime.result || prime.result.success !== true) {
            throw new Error(`L2 prime failed: ${prime.error ?? prime.stderr ?? 'unknown worker failure'}`);
        }
        const l2Samples = await collectPhase('l2', requestId);
        const l2 = summarizePhase(l2Samples, 'l2-hit');
        const decision = buildDecision(cold, l1, l2);
        const completedAt = Date.now();
        finalState = {
            schemaVersion: 1,
            status: 'completed',
            requestId,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            sampleCountPerPhase: SAMPLE_COUNT,
            workloadKind: 'fixed-representative-repo-text-read',
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
            schemaVersion: 1,
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
            await workspaceIo.removePathLocked(benchmarkDir, { recursive: true, force: true });
            finalState['cleanedTemporaryDb'] = true;
        } catch (error) {
            finalState['cleanedTemporaryDb'] = false;
            finalState['cleanupError'] = error instanceof Error ? error.message : String(error);
        }
        await writeState(finalState);
        process.exitCode = finalState['status'] === 'completed' ? 0 : 1;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch(async (error) => {
        try {
            await writeState({ schemaVersion: 1, status: 'failed', completedAt: Date.now(), autoEnable: false, error: error instanceof Error ? error.message : String(error) });
        } catch {
            // Best effort only.
        }
        process.exitCode = 1;
    });
}
