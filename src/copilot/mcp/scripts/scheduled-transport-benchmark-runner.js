// @ts-check
/**
 * Detached, allowlisted Cloudflare transport benchmark runner.
 *
 * It benchmarks the current control plus the remaining canonical transport profiles with a fixed workload,
 * persists compact evidence, and always restores the original control. It never promotes a candidate.
 *
 * @module copilot/mcp/scripts/scheduled-transport-benchmark-runner
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import {
    getTransportBenchmarkStateFile,
    readCloudflaredMetricsSnapshot,
} from '#copilot/mcp/cloudflare';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '../../../..');
const workspaceIo = createWorkspaceIo({ workspaceRoot: repoRoot });
const STATE_FILE = getTransportBenchmarkStateFile();
const CANDIDATES = Object.freeze(['quic', 'auto', 'http2']);
const RELOAD_PROFILES = Object.freeze({
    quic: 'quic',
    auto: 'auto',
    http2: 'h2',
});
const REQUEST_ID_RE = /^mcp-transport-benchmark-[a-z0-9-]{8,80}$/u;
const SAMPLE_COUNT = 5;
const WARMUP_MS = 2500;
const BETWEEN_SAMPLES_MS = 250;
const RESTART_TIMEOUT_MS = 90_000;
const SMOKE_TIMEOUT_MS = 45_000;
const METRICS_TIMEOUT_MS = 5000;
const MAX_P95_REGRESSION_PERCENT = 10;

/** @param {number} ms */
function sleep(ms) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** @param {Record<string, unknown>} state */
async function writeState(state) {
    await workspaceIo.mkdirPathLocked(dirname(STATE_FILE), { recursive: true });
    await workspaceIo.writeFileAtomic(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
        mode: 0o600,
        riskClass: 'medium',
        advisoryLimits: { domain: 'mcp-transport-benchmark-state' },
    });
}

/** @param {string[]} argv */
function parseArgs(argv) {
    /** @param {string} name */
    const read = (name) => {
        const index = argv.indexOf(name);
        return index >= 0 ? argv[index + 1] ?? '' : '';
    };
    const requestId = read('--request-id');
    const controlProfile = read('--control-profile');
    if (!REQUEST_ID_RE.test(requestId)) throw new Error('Invalid generated benchmark request id.');
    if (!CANDIDATES.includes(controlProfile)) throw new Error('Invalid benchmark control profile.');
    return { requestId, controlProfile };
}

/**
 * Reuse the canonical scheduled reload runner so readiness generation correlation remains correct during the benchmark.
 *
 * @param {string} profile
 * @returns {Promise<{ exitCode: number; timedOut: boolean; error: string | null }>}
 */
function runRestart(profile) {
    const reloadProfile = reloadProfileForProtocol(profile);
    return runFixedNode(
        [
            'src/copilot/mcp/scripts/scheduled-restart-runner.js',
            '--profile',
            reloadProfile,
            '--delay-ms',
            '1000',
            '--request-id',
            `mcp-reload-${randomUUID()}`,
        ],
        RESTART_TIMEOUT_MS,
    );
}

/**
 * @returns {Promise<{ exitCode: number; timedOut: boolean; error: string | null; durationMs: number }>}
 */
async function runSmoke() {
    const startedAt = Date.now();
    const result = await runFixedNode(['src/copilot/mcp/cloudflare/cli.js', 'smoke'], SMOKE_TIMEOUT_MS, {
        ...process.env,
        COPILOT_MCP_AUTH_MODE: process.env['COPILOT_MCP_AUTH_MODE'] ?? 'oauth',
        COPILOT_MCP_AUTH_ENFORCEMENT: process.env['COPILOT_MCP_AUTH_ENFORCEMENT'] ?? 'all',
        COPILOT_MCP_SMOKE_COMPACT: '1',
    });
    return { ...result, durationMs: Math.max(0, Date.now() - startedAt) };
}

/**
 * @param {string[]} args
 * @param {number} timeoutMs
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ exitCode: number; timedOut: boolean; error: string | null }>}
 */
function runFixedNode(args, timeoutMs, env = process.env) {
    return new Promise((resolvePromise) => {
        let settled = false;
        let timedOut = false;
        const child = spawn(process.execPath, args, {
            cwd: repoRoot,
            env,
            stdio: 'ignore',
        });
        /** @type {NodeJS.Timeout | null} */
        let hardKillTimer = null;
        /** @param {{ exitCode: number; timedOut: boolean; error: string | null }} result */
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (hardKillTimer) clearTimeout(hardKillTimer);
            resolvePromise(result);
        };
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            hardKillTimer = setTimeout(() => {
                if (!settled) child.kill('SIGKILL');
            }, 3000);
            hardKillTimer.unref?.();
        }, timeoutMs);
        timer.unref?.();
        child.once('error', (error) => finish({ exitCode: 1, timedOut, error: error.message }));
        child.once('exit', (code, signal) =>
            finish({
                exitCode: Number(code ?? (signal ? 1 : 0)),
                timedOut,
                error: timedOut ? `child timed out after ${String(timeoutMs)}ms` : signal ? `child terminated by ${signal}` : null,
            }),
        );
    });
}

/** @returns {Promise<Record<string, unknown> & { ok: boolean }>} */
async function readMetricsWithRetry() {
    /** @type {Record<string, unknown> & { ok: boolean } | null} */
    let latest = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        latest = await readCloudflaredMetricsSnapshot({ timeoutMs: METRICS_TIMEOUT_MS });
        if (latest.ok) return latest;
        await sleep(500);
    }
    return latest ?? { ok: false, error: 'No metrics snapshot returned.' };
}

/**
 * @param {Record<string, unknown> & { ok: boolean }} snapshot
 * @returns {Record<string, unknown>}
 */
function compactMetrics(snapshot) {
    const operational = recordOrEmpty(snapshot['operational']);
    const latency = recordOrEmpty(snapshot['latency']);
    const rpc = recordOrEmpty(latency['rpcClientLatency']);
    const proxy = recordOrEmpty(latency['proxyConnectLatency']);
    const quic = recordOrEmpty(snapshot['quic']);
    return {
        ok: snapshot.ok,
        totalRequests: numberOrNull(operational['totalRequests']),
        requestErrors: numberOrNull(operational['requestErrors']),
        haConnections: numberOrNull(operational['haConnections']),
        rpcClientLatency: {
            count: numberOrNull(rpc['count']),
            averageMs: numberOrNull(rpc['averageMs']),
            p95Ms: numberOrNull(rpc['p95Ms']),
            p99Ms: numberOrNull(rpc['p99Ms']),
        },
        proxyConnectLatency: {
            count: numberOrNull(proxy['count']),
            averageMs: numberOrNull(proxy['averageMs']),
            p95Ms: numberOrNull(proxy['p95Ms']),
            p99Ms: numberOrNull(proxy['p99Ms']),
        },
        quic: {
            present: quic['present'] === true,
            latestRttMs: numberOrNull(quic['latestRttMs']),
            smoothedRttMs: numberOrNull(quic['smoothedRttMs']),
            packetTooBigDropped: numberOrNull(quic['packetTooBigDropped']),
        },
    };
}

/**
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 */
function buildMetricDelta(before, after) {
    return {
        totalRequests: numericDelta(before['totalRequests'], after['totalRequests']),
        requestErrors: numericDelta(before['requestErrors'], after['requestErrors']),
    };
}

/** @param {number[]} values */
function summarizeDurations(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return {
        count: sorted.length,
        minMs: sorted[0] ?? null,
        maxMs: sorted[sorted.length - 1] ?? null,
        averageMs: sorted.length > 0 ? Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length) : null,
        p50Ms: quantile(sorted, 0.5),
        p95Ms: quantile(sorted, 0.95),
        p99Ms: quantile(sorted, 0.99),
    };
}

/** @param {number[]} sorted @param {number} probability */
function quantile(sorted, probability) {
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return sorted[0] ?? null;
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const low = sorted[lower] ?? sorted[0] ?? 0;
    const high = sorted[upper] ?? low;
    return Math.round(low + (high - low) * (position - lower));
}

/** @param {unknown} value */
function recordOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/** @param {unknown} value */
function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @param {unknown} before @param {unknown} after */
function numericDelta(before, after) {
    return typeof before === 'number' && typeof after === 'number' ? after - before : null;
}

/** @param {string} controlProfile */
function buildProfileOrder(controlProfile) {
    return [controlProfile, ...CANDIDATES.filter((candidate) => candidate !== controlProfile)];
}

/** @param {string} profile */
function reloadProfileForProtocol(profile) {
    const reloadProfile = RELOAD_PROFILES[/** @type {keyof typeof RELOAD_PROFILES} */ (profile)];
    if (!reloadProfile) throw new Error(`Unsupported benchmark profile: ${profile}`);
    return reloadProfile;
}

/**
 * @param {Record<string, unknown>[]} windows
 * @param {string} controlProfile
 */
function buildComparison(windows, controlProfile) {
    const control = windows.find((window) => window['profile'] === controlProfile);
    const controlP95 = numberOrNull(recordOrEmpty(control?.['smokeLatency'])['p95Ms']);
    const candidates = windows.map((window) => {
        const p95Ms = numberOrNull(recordOrEmpty(window['smokeLatency'])['p95Ms']);
        const regressionPercent =
            controlP95 && p95Ms !== null ? Number((((p95Ms - controlP95) / controlP95) * 100).toFixed(2)) : null;
        const comparable = window['comparable'] === true;
        const clean = window['clean'] === true;
        return {
            profile: window['profile'],
            p95Ms,
            regressionPercent,
            comparable,
            clean,
            withinP95Budget:
                window['profile'] === controlProfile ||
                (regressionPercent !== null && regressionPercent <= MAX_P95_REGRESSION_PERCENT),
            eligibleForDecision:
                comparable &&
                clean &&
                (window['profile'] === controlProfile ||
                    (regressionPercent !== null && regressionPercent <= MAX_P95_REGRESSION_PERCENT)),
        };
    });
    return {
        controlProfile,
        controlP95Ms: controlP95,
        maxP95RegressionPercent: MAX_P95_REGRESSION_PERCENT,
        autoPromotion: false,
        candidates,
    };
}

async function main() {
    const input = parseArgs(process.argv.slice(2));
    const profileOrder = buildProfileOrder(input.controlProfile);
    const startedAt = Date.now();
    /** @type {Record<string, unknown>[]} */
    const windows = [];
    /** @type {string | null} */
    let fatalError = null;

    await writeState({
        schemaVersion: 1,
        status: 'running',
        requestId: input.requestId,
        startedAt,
        controlProfile: input.controlProfile,
        profileOrder,
        sampleCountPerProfile: SAMPLE_COUNT,
        currentProfile: null,
        windows,
        autoPromotion: false,
    });

    try {
        for (const profile of profileOrder) {
            await writeState({
                schemaVersion: 1,
                status: 'running',
                requestId: input.requestId,
                startedAt,
                controlProfile: input.controlProfile,
                profileOrder,
                sampleCountPerProfile: SAMPLE_COUNT,
                currentProfile: profile,
                stage: 'restart',
                windows,
                autoPromotion: false,
            });
            const restart = await runRestart(profile);
            if (restart.exitCode !== 0) throw new Error(`Restart failed for ${profile}: ${restart.error ?? `exit ${String(restart.exitCode)}`}`);
            await sleep(WARMUP_MS);
            const before = compactMetrics(await readMetricsWithRetry());
            const smokeRuns = [];
            for (let sample = 1; sample <= SAMPLE_COUNT; sample += 1) {
                const smoke = await runSmoke();
                smokeRuns.push({ sample, ...smoke });
                if (smoke.exitCode !== 0) break;
                if (sample < SAMPLE_COUNT) await sleep(BETWEEN_SAMPLES_MS);
            }
            const after = compactMetrics(await readMetricsWithRetry());
            const durations = smokeRuns.filter((run) => run.exitCode === 0).map((run) => run.durationMs);
            const metricDelta = buildMetricDelta(before, after);
            const smokeLatency = summarizeDurations(durations);
            const allSmokesPassed = smokeRuns.length === SAMPLE_COUNT && smokeRuns.every((run) => run.exitCode === 0);
            const comparable =
                allSmokesPassed &&
                smokeLatency.count >= SAMPLE_COUNT &&
                before['ok'] === true &&
                after['ok'] === true &&
                after['haConnections'] === 4;
            const clean = comparable && metricDelta.requestErrors === 0;
            const window = {
                profile,
                restart,
                smokeRuns,
                smokeLatency,
                metricsBefore: before,
                metricsAfter: after,
                metricDelta,
                allSmokesPassed,
                comparable,
                clean,
                reviewRequired: comparable && metricDelta.requestErrors !== 0,
            };
            windows.push(window);
            await writeState({
                schemaVersion: 1,
                status: 'running',
                requestId: input.requestId,
                startedAt,
                controlProfile: input.controlProfile,
                profileOrder,
                sampleCountPerProfile: SAMPLE_COUNT,
                currentProfile: profile,
                stage: 'window-complete',
                windows,
                comparison: buildComparison(windows, input.controlProfile),
                autoPromotion: false,
            });
            if (!allSmokesPassed) {
                throw new Error(`Connector smoke failed for ${profile}; benchmark stopped before the next profile.`);
            }
            if (before['ok'] !== true || after['ok'] !== true) {
                throw new Error(`Cloudflared metrics were unavailable for ${profile}; benchmark stopped before the next profile.`);
            }
            if (after['haConnections'] !== 4) {
                throw new Error(`Cloudflared HA connections were not 4 for ${profile}; benchmark stopped before the next profile.`);
            }
        }
    } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
    } finally {
        try {
            await writeState({
                schemaVersion: 1,
                status: 'restoring-control',
                requestId: input.requestId,
                startedAt,
                controlProfile: input.controlProfile,
                profileOrder,
                sampleCountPerProfile: SAMPLE_COUNT,
                currentProfile: input.controlProfile,
                windows,
                comparison: buildComparison(windows, input.controlProfile),
                error: fatalError,
                autoPromotion: false,
            });
        } catch {
            // State persistence must never prevent the fixed control restore path.
        }
        const restore = await runRestart(input.controlProfile);
        /** @type {{ exitCode: number; timedOut: boolean; error: string | null; durationMs: number }} */
        let restoreSmoke = { exitCode: 1, timedOut: false, error: 'Restore restart did not complete.', durationMs: 0 };
        if (restore.exitCode === 0) {
            await sleep(WARMUP_MS);
            restoreSmoke = await runSmoke();
        }
        const restoredControl = restore.exitCode === 0 && restoreSmoke.exitCode === 0;
        const completedAt = Date.now();
        const success = fatalError === null && restoredControl && windows.length === profileOrder.length;
        try {
            await writeState({
                schemaVersion: 1,
                status: success ? 'completed' : 'failed',
                requestId: input.requestId,
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
                controlProfile: input.controlProfile,
                profileOrder,
                sampleCountPerProfile: SAMPLE_COUNT,
                windows,
                comparison: buildComparison(windows, input.controlProfile),
                restoredControl,
                restore,
                restoreSmoke,
                autoPromotion: false,
                error:
                    fatalError ??
                    (restoredControl
                        ? null
                        : restore.error ?? restoreSmoke.error ?? 'Control restore or reconciliation smoke failed.'),
            });
        } catch {
            process.exitCode = 1;
        }
        if (process.exitCode !== 1) process.exitCode = success ? 0 : 1;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch(async (error) => {
        try {
            await writeState({
                schemaVersion: 1,
                status: 'failed',
                completedAt: Date.now(),
                restoredControl: false,
                autoPromotion: false,
                error: error instanceof Error ? error.message : String(error),
            });
        } catch {
            // Best effort only: the fixed state file is the final diagnostics channel.
        }
        process.exitCode = 1;
    });
}
