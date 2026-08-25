// @ts-check
/**
 * Detached, allowlisted Cloudflare transport benchmark runner.
 *
 * It benchmarks the current control plus the remaining canonical transport profiles with a fixed workload, persists
 * compact evidence, and always restores the original control. It never promotes a candidate.
 *
 * @module copilot/mcp/scripts/scheduled-transport-benchmark-runner
 */

import { createWorkspaceMutationIo } from '#copilot/infra/public/composition/workspace/mutation-io';
import { buildCloudflareConnectorSmokeEnvironment } from '#copilot/mcp/public/cloudflare/environment';
import { readCloudflaredMetricsSnapshot } from '#copilot/mcp/public/cloudflare/observability';
import { createAttachedChildProcessSupervisor } from '#copilot/mcp/public/process/supervision';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import process from 'node:process';
import { readCloudflareTunnelConfig } from '../config.js';
import { resolveCloudflareEnvironment } from '../environment-authority.js';
import { getTransportBenchmarkStateFile } from './state.js';

const workspaceIo = createWorkspaceMutationIo({ workspaceRoot: MCP_WORKSPACE_ROOT });
const STATE_FILE = getTransportBenchmarkStateFile();
const CANDIDATES = Object.freeze(['quic', 'auto', 'http2']);
const RELOAD_PROFILES = Object.freeze({
    quic: 'quic',
    auto: 'auto',
    http2: 'h2',
});
const REQUEST_ID_RE = /^mcp-transport-benchmark-[a-z0-9-]{8,80}$/u;
const TRANSPORT_BENCHMARK_LAUNCHER = 'src/copilot/mcp/scripts/scheduled-transport-benchmark-runner.js';
const SAMPLE_COUNT = 5;
const WARMUP_MS = 2500;
const BETWEEN_SAMPLES_MS = 250;
const RESTART_TIMEOUT_MS = 135_000;
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
        return index >= 0 ? (argv[index + 1] ?? '') : '';
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
 * @param {NodeJS.ProcessEnv} parentEnv
 * @returns {Promise<{ exitCode: number; timedOut: boolean; error: string | null }>}
 */
function runRestart(profile, parentEnv) {
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
        buildTransportBenchmarkLaunchEnvironment(parentEnv),
    );
}

/**
 * Build the bounded environment for the connector smoke child. Unknown parent variables are excluded by construction;
 * in particular static bearer tokens and Cloudflare tunnel tokens are not ambient benchmark authority.
 *
 * @param {NodeJS.ProcessEnv} parentEnv
 * @param {boolean} compactSmoke
 * @returns {NodeJS.ProcessEnv}
 */
function buildTransportBenchmarkEnvironment(parentEnv, compactSmoke) {
    return buildCloudflareConnectorSmokeEnvironment(parentEnv, { compact: compactSmoke });
}

/** @param {NodeJS.ProcessEnv} parentEnv */
export function buildTransportBenchmarkLaunchEnvironment(parentEnv) {
    if (!parentEnv) throw new TypeError('Transport benchmark launch environment requires explicit parentEnv.');
    return buildTransportBenchmarkEnvironment(parentEnv, false);
}

/** @param {NodeJS.ProcessEnv} parentEnv */
export function buildTransportBenchmarkSmokeEnvironment(parentEnv) {
    if (!parentEnv) throw new TypeError('Transport benchmark smoke environment requires explicit parentEnv.');
    return buildTransportBenchmarkEnvironment(parentEnv, true);
}

/**
 * Start the detached stable launcher only after validating the fixed benchmark identity and control profile. Resolving
 * the promise means Node observed the child `spawn` event and the caller did not cancel before acceptance; it does not
 * mean the benchmark itself has completed. After acceptance the detached runner intentionally owns its own lifecycle.
 *
 * @param {{ requestId: string; controlProfile: string; authority?: import('../environment-authority.js').CloudflareEnvironmentAuthority; parentEnv?: NodeJS.ProcessEnv; signal?: AbortSignal }} input
 * @returns {Promise<{ runnerPid: number | null }>}
 */
export async function spawnCloudflareTransportBenchmark(input) {
    return spawnCloudflareTransportBenchmarkWithDependencies(input, {});
}

/**
 * White-box dependency seam for proving cancellation-before-acceptance without starting the real benchmark runner.
 *
 * @param {{ requestId: string; controlProfile: string; authority?: import('../environment-authority.js').CloudflareEnvironmentAuthority; parentEnv?: NodeJS.ProcessEnv; signal?: AbortSignal }} input
 * @param {{ spawnChild?: typeof spawn }} dependencies
 * @returns {Promise<{ runnerPid: number | null }>}
 */
export async function spawnCloudflareTransportBenchmarkWithDependencies(input, dependencies) {
    if (!REQUEST_ID_RE.test(input.requestId)) throw new Error('Invalid generated benchmark request id.');
    if (!CANDIDATES.includes(input.controlProfile)) throw new Error('Invalid benchmark control profile.');
    if (input.signal?.aborted) {
        throw input.signal.reason ?? new Error('Cloudflare transport benchmark scheduling aborted before acceptance.');
    }
    const parentEnv = resolveCloudflareEnvironment(
        input.authority ? { authority: input.authority } : input.parentEnv ? { env: input.parentEnv } : null,
    );
    const env = buildTransportBenchmarkLaunchEnvironment(parentEnv);
    const spawnChild = dependencies.spawnChild ?? spawn;
    const child = spawnChild(
        process.execPath,
        [TRANSPORT_BENCHMARK_LAUNCHER, '--request-id', input.requestId, '--control-profile', input.controlProfile],
        {
            cwd: MCP_WORKSPACE_ROOT,
            env,
            detached: true,
            stdio: 'ignore',
        },
    );
    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
    let accepted = false;
    const terminateBeforeAcceptance = () => {
        if (accepted) return;
        supervisor.requestTermination({ graceMs: 1_000, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
    };
    input.signal?.addEventListener('abort', terminateBeforeAcceptance, { once: true });
    try {
        await new Promise((resolvePromise, rejectPromise) => {
            /** @param {Error} error */
            const onError = (error) => rejectPromise(error);
            child.once('error', onError);
            child.once('spawn', () => {
                child.off('error', onError);
                child.on('error', () => {});
                resolvePromise(undefined);
            });
        });
        if (input.signal?.aborted) {
            terminateBeforeAcceptance();
            throw (
                input.signal.reason ?? new Error('Cloudflare transport benchmark scheduling aborted before acceptance.')
            );
        }
        accepted = true;
        child.unref();
        return { runnerPid: child.pid ?? null };
    } finally {
        input.signal?.removeEventListener('abort', terminateBeforeAcceptance);
        if (!accepted) terminateBeforeAcceptance();
    }
}

/**
 * @param {NodeJS.ProcessEnv} parentEnv
 * @returns {Promise<{ exitCode: number; timedOut: boolean; error: string | null; durationMs: number }>}
 */
async function runSmoke(parentEnv) {
    const startedAt = Date.now();
    const result = await runFixedNode(
        ['src/copilot/mcp/composition/cloudflare-cli/cli.js', 'smoke'],
        SMOKE_TIMEOUT_MS,
        buildTransportBenchmarkSmokeEnvironment(parentEnv),
    );
    return { ...result, durationMs: Math.max(0, Date.now() - startedAt) };
}

/**
 * @param {string[]} args
 * @param {number} timeoutMs
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ exitCode: number; timedOut: boolean; error: string | null }>}
 */
async function runFixedNode(args, timeoutMs, env) {
    if (!env) throw new TypeError('Transport benchmark child execution requires explicit env.');
    let child;
    try {
        child = spawn(process.execPath, args, {
            cwd: MCP_WORKSPACE_ROOT,
            env,
            stdio: 'ignore',
            detached: process.platform !== 'win32',
        });
    } catch (error) {
        return {
            exitCode: 1,
            timedOut: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }

    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
    let timedOut = false;
    /** @type {string | null} */
    let spawnError = null;
    child.once('error', (error) => {
        spawnError = error.message;
    });
    const timer = setTimeout(() => {
        timedOut = true;
        supervisor.requestTermination({ graceMs: 3000, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
    }, timeoutMs);
    timer.unref();
    const closed = await supervisor.closed;
    clearTimeout(timer);
    const exitCode = Number(closed.exitCode ?? (closed.signal || spawnError ? 1 : 0));
    return {
        exitCode,
        timedOut,
        error: timedOut
            ? `child timed out after ${String(timeoutMs)}ms`
            : (spawnError ?? (closed.signal ? `child terminated by ${closed.signal}` : null)),
    };
}

/** @param {import('../config.js').CloudflareTunnelConfig} config @returns {Promise<Record<string, unknown> & { ok: boolean }>} */
async function readMetricsWithRetry(config) {
    /** @type {(Record<string, unknown> & { ok: boolean }) | null} */
    let latest = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        latest = await readCloudflaredMetricsSnapshot({ timeoutMs: METRICS_TIMEOUT_MS }, config);
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
        responseCodes: numericRecord(operational['responseCodes']),
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
export function buildTransportMetricDelta(before, after) {
    return {
        totalRequests: numericDelta(before['totalRequests'], after['totalRequests']),
        requestErrors: numericDelta(before['requestErrors'], after['requestErrors']),
        responseCodes: numericRecordDelta(before['responseCodes'], after['responseCodes']),
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

/** @param {unknown} value */
function numericRecord(value) {
    const record = recordOrEmpty(value);
    /** @type {Record<string, number>} */
    const output = {};
    for (const [key, candidate] of Object.entries(record)) {
        if (typeof candidate === 'number' && Number.isFinite(candidate)) output[key] = candidate;
    }
    return output;
}

/** @param {unknown} before @param {unknown} after */
function numericRecordDelta(before, after) {
    const beforeRecord = numericRecord(before);
    const afterRecord = numericRecord(after);
    const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].sort();
    /** @type {Record<string, number>} */
    const output = {};
    for (const key of keys) {
        const delta = (afterRecord[key] ?? 0) - (beforeRecord[key] ?? 0);
        if (delta !== 0) output[key] = delta;
    }
    return output;
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
export function buildComparison(windows, controlProfile) {
    const control = windows.find((window) => window['profile'] === controlProfile);
    const controlP95 = numberOrNull(recordOrEmpty(control?.['smokeLatency'])['p95Ms']);
    const candidates = windows.map((window) => {
        const p95Ms = numberOrNull(recordOrEmpty(window['smokeLatency'])['p95Ms']);
        const regressionPercent =
            controlP95 && p95Ms !== null ? Number((((p95Ms - controlP95) / controlP95) * 100).toFixed(2)) : null;
        const comparable = window['comparable'] === true;
        const clean = window['clean'] === true;
        const requestErrorReview = window['reviewRequired'] === true;
        const withinP95Budget =
            window['profile'] === controlProfile ||
            (regressionPercent !== null && regressionPercent <= MAX_P95_REGRESSION_PERCENT);
        return {
            profile: window['profile'],
            p95Ms,
            regressionPercent,
            comparable,
            hardGatesPassed: comparable,
            clean,
            requestErrorReview,
            withinP95Budget,
            eligibleForDecision: comparable && withinP95Budget,
        };
    });
    return {
        controlProfile,
        controlP95Ms: controlP95,
        maxP95RegressionPercent: MAX_P95_REGRESSION_PERCENT,
        requestErrorPolicy:
            'advisory: raw cloudflared origin-proxy error deltas require review alongside response-code deltas and fresh smoke/origin diagnostics; they do not veto an otherwise green comparable window',
        autoPromotion: false,
        candidates,
    };
}

/**
 * @param {{
 *     allSmokesPassed: boolean;
 *     smokeSampleCount: number;
 *     requiredSampleCount: number;
 *     beforeOk: boolean;
 *     afterOk: boolean;
 *     haConnections: number | null;
 *     requestErrorsDelta: number | null;
 * }} input
 */
export function classifyTransportWindow(input) {
    const comparable =
        input.allSmokesPassed &&
        input.smokeSampleCount >= input.requiredSampleCount &&
        input.beforeOk &&
        input.afterOk &&
        input.haConnections === 4;
    const requestErrorsChanged = comparable && input.requestErrorsDelta !== null && input.requestErrorsDelta !== 0;
    return {
        comparable,
        hardGatesPassed: comparable,
        clean: comparable && !requestErrorsChanged,
        reviewRequired: requestErrorsChanged,
        requestErrorSignal: requestErrorsChanged ? 'changed-advisory' : comparable ? 'unchanged' : 'not-comparable',
        requestErrorPolicy: 'advisory-not-eligibility-gate',
    };
}

/** @param {{ requestId: string; controlProfile: string }} input @param {NodeJS.ProcessEnv} parentEnv */
async function executeTransportBenchmark(input, parentEnv) {
    if (!parentEnv) throw new TypeError('Transport benchmark execution requires explicit parentEnv.');
    const profileOrder = buildProfileOrder(input.controlProfile);
    const cloudflareConfig = readCloudflareTunnelConfig(parentEnv);
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
            const restart = await runRestart(profile, parentEnv);
            if (restart.exitCode !== 0)
                throw new Error(
                    `Restart failed for ${profile}: ${restart.error ?? `exit ${String(restart.exitCode)}`}`,
                );
            await sleep(WARMUP_MS);
            const before = compactMetrics(await readMetricsWithRetry(cloudflareConfig));
            const smokeRuns = [];
            for (let sample = 1; sample <= SAMPLE_COUNT; sample += 1) {
                const smoke = await runSmoke(parentEnv);
                smokeRuns.push({ sample, ...smoke });
                if (smoke.exitCode !== 0) break;
                if (sample < SAMPLE_COUNT) await sleep(BETWEEN_SAMPLES_MS);
            }
            const after = compactMetrics(await readMetricsWithRetry(cloudflareConfig));
            const durations = smokeRuns.filter((run) => run.exitCode === 0).map((run) => run.durationMs);
            const metricDelta = buildTransportMetricDelta(before, after);
            const smokeLatency = summarizeDurations(durations);
            const allSmokesPassed = smokeRuns.length === SAMPLE_COUNT && smokeRuns.every((run) => run.exitCode === 0);
            const windowHealth = classifyTransportWindow({
                allSmokesPassed,
                smokeSampleCount: smokeLatency.count,
                requiredSampleCount: SAMPLE_COUNT,
                beforeOk: before['ok'] === true,
                afterOk: after['ok'] === true,
                haConnections: numberOrNull(after['haConnections']),
                requestErrorsDelta: metricDelta.requestErrors,
            });
            const window = {
                profile,
                restart,
                smokeRuns,
                smokeLatency,
                metricsBefore: before,
                metricsAfter: after,
                metricDelta,
                allSmokesPassed,
                ...windowHealth,
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
                throw new Error(
                    `Cloudflared metrics were unavailable for ${profile}; benchmark stopped before the next profile.`,
                );
            }
            if (after['haConnections'] !== 4) {
                throw new Error(
                    `Cloudflared HA connections were not 4 for ${profile}; benchmark stopped before the next profile.`,
                );
            }
        }
    } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
    }
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
    const restore = await runRestart(input.controlProfile, parentEnv);
    /** @type {{ exitCode: number; timedOut: boolean; error: string | null; durationMs: number }} */
    let restoreSmoke = { exitCode: 1, timedOut: false, error: 'Restore restart did not complete.', durationMs: 0 };
    if (restore.exitCode === 0) {
        await sleep(WARMUP_MS);
        restoreSmoke = await runSmoke(parentEnv);
    }
    const restoredControl = restore.exitCode === 0 && restoreSmoke.exitCode === 0;
    const completedAt = Date.now();
    const success = fatalError === null && restoredControl && windows.length === profileOrder.length;
    let finalStatePersisted = true;
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
                    : (restore.error ?? restoreSmoke.error ?? 'Control restore or reconciliation smoke failed.')),
        });
    } catch {
        finalStatePersisted = false;
    }
    return success && finalStatePersisted ? 0 : 1;
}

/**
 * Stable launcher-facing entrypoint. Parse/setup failures are converted into persisted evidence and a numeric exit code;
 * domain code never mutates process.exitCode directly.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} parentEnv
 * @returns {Promise<number>}
 */
export async function runCloudflareTransportBenchmarkCli(argv, parentEnv) {
    if (!parentEnv) throw new TypeError('Transport benchmark CLI requires explicit parentEnv.');
    try {
        return await executeTransportBenchmark(parseArgs(argv), parentEnv);
    } catch (error) {
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
        return 1;
    }
}
