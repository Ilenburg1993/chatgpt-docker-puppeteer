// @ts-check
/**
 * Low-frequency, non-blocking OpenAI/ChatGPT fixed-endpoint latency monitor.
 *
 * The monitor samples one fresh HTTPS request per fixed endpoint each cycle and persists only the sanitized aggregate
 * snapshot. It never blocks MCP startup or readiness and never accepts arbitrary destinations.
 *
 * @module copilot/mcp/control-plane/openai-endpoint-monitor
 */

import { logMcp } from './audit.js';
import { appendOpenAiEndpointLatencySnapshot, measureOpenAiEndpointLatency } from './openai-endpoint-latency.js';

const DEFAULT_INITIAL_DELAY_MS = 30_000;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 2_500;

/** @type {NodeJS.Timeout | null} */
let monitorTimer = null;
let monitorState = createInitialState();

function createInitialState() {
    return {
        enabled: false,
        scheduled: false,
        running: false,
        initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
        intervalMs: DEFAULT_INTERVAL_MS,
        nextRunAt: /** @type {string | null} */ (null),
        startedAt: /** @type {string | null} */ (null),
        lastRunAt: /** @type {string | null} */ (null),
        lastSuccessAt: /** @type {string | null} */ (null),
        lastDurationMs: /** @type {number | null} */ (null),
        runs: 0,
        failures: 0,
        lastError: /** @type {string | null} */ (null),
        lastSnapshot: /** @type {ReturnType<typeof compactSnapshot> | null} */ (null),
    };
}

/**
 * @param {{
 *     enabled?: boolean;
 *     initialDelayMs?: number;
 *     intervalMs?: number;
 *     timeoutMs?: number;
 *     setTimeoutFn?: typeof setTimeout;
 *     measureFn?: typeof measureOpenAiEndpointLatency;
 *     persistFn?: typeof appendOpenAiEndpointLatencySnapshot;
 * }} [options]
 */
export function scheduleOpenAiEndpointLatencyMonitor(options = {}) {
    if (monitorTimer || monitorState.scheduled || monitorState.running) return false;
    const defaultEnabled = process.env['NODE_ENV'] !== 'test' && !process.env['VITEST'];
    const enabled = options.enabled ?? readBooleanEnv('COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_ENABLED', defaultEnabled);
    if (!enabled) {
        monitorState = { ...monitorState, enabled: false, scheduled: false, nextRunAt: null };
        return false;
    }
    const initialDelayMs = boundedDelay(
        options.initialDelayMs ?? Number(process.env['COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_INITIAL_DELAY_MS']),
        DEFAULT_INITIAL_DELAY_MS,
        0,
        10 * 60 * 1000,
    );
    const intervalMs = boundedDelay(
        options.intervalMs ?? Number(process.env['COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_INTERVAL_MS']),
        DEFAULT_INTERVAL_MS,
        MIN_INTERVAL_MS,
        MAX_INTERVAL_MS,
    );
    const timeoutMs = boundedDelay(
        options.timeoutMs ?? Number(process.env['COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_TIMEOUT_MS']),
        DEFAULT_TIMEOUT_MS,
        500,
        10_000,
    );
    const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    const measureFn = options.measureFn ?? measureOpenAiEndpointLatency;
    const persistFn = options.persistFn ?? appendOpenAiEndpointLatencySnapshot;

    monitorState = {
        ...monitorState,
        enabled: true,
        scheduled: true,
        initialDelayMs,
        intervalMs,
        startedAt: monitorState.startedAt ?? new Date().toISOString(),
        nextRunAt: new Date(Date.now() + initialDelayMs).toISOString(),
    };
    scheduleNext(initialDelayMs, intervalMs, timeoutMs, setTimeoutFn, measureFn, persistFn);
    return true;
}

/** @returns {typeof monitorState} */
export function readOpenAiEndpointLatencyMonitorState() {
    return {
        ...monitorState,
        lastSnapshot: monitorState.lastSnapshot ? structuredClone(monitorState.lastSnapshot) : null,
    };
}

/** @returns {void} */
export function stopOpenAiEndpointLatencyMonitor() {
    if (monitorTimer) clearTimeout(monitorTimer);
    monitorTimer = null;
    monitorState = { ...monitorState, scheduled: false, running: false, nextRunAt: null };
}

/** @returns {void} */
export function resetOpenAiEndpointLatencyMonitorForTests() {
    if (monitorTimer) clearTimeout(monitorTimer);
    monitorTimer = null;
    monitorState = createInitialState();
}

/**
 * @param {number} delayMs
 * @param {number} intervalMs
 * @param {number} timeoutMs
 * @param {typeof setTimeout} setTimeoutFn
 * @param {typeof measureOpenAiEndpointLatency} measureFn
 * @param {typeof appendOpenAiEndpointLatencySnapshot} persistFn
 */
function scheduleNext(delayMs, intervalMs, timeoutMs, setTimeoutFn, measureFn, persistFn) {
    monitorTimer = setTimeoutFn(() => {
        monitorTimer = null;
        void runMonitorCycle(intervalMs, timeoutMs, setTimeoutFn, measureFn, persistFn);
    }, delayMs);
    monitorState = {
        ...monitorState,
        scheduled: true,
        nextRunAt: new Date(Date.now() + delayMs).toISOString(),
    };
    if (typeof monitorTimer?.unref === 'function') monitorTimer.unref();
}

/**
 * @param {number} intervalMs
 * @param {number} timeoutMs
 * @param {typeof setTimeout} setTimeoutFn
 * @param {typeof measureOpenAiEndpointLatency} measureFn
 * @param {typeof appendOpenAiEndpointLatencySnapshot} persistFn
 */
async function runMonitorCycle(intervalMs, timeoutMs, setTimeoutFn, measureFn, persistFn) {
    if (monitorState.running) return;
    const started = Date.now();
    monitorState = {
        ...monitorState,
        scheduled: false,
        running: true,
        nextRunAt: null,
        lastRunAt: new Date(started).toISOString(),
    };
    try {
        const measurement = await measureFn({ sampleCount: 1, timeoutMs });
        const persistence = await persistFn(measurement.snapshot);
        const failedTargets = measurement.snapshot.targets
            .filter((target) => target.successRate < 1)
            .map((target) => target.id);
        const success = persistence.persisted === true && failedTargets.length === 0;
        monitorState = {
            ...monitorState,
            running: false,
            runs: monitorState.runs + 1,
            failures: monitorState.failures + (success ? 0 : 1),
            lastSuccessAt: success ? new Date().toISOString() : monitorState.lastSuccessAt,
            lastDurationMs: Date.now() - started,
            lastError: success
                ? null
                : persistence.persisted !== true
                  ? String('error' in persistence ? persistence.error : 'snapshot-persistence-failed')
                  : `endpoint-failures:${failedTargets.join(',')}`,
            lastSnapshot: compactSnapshot(measurement.snapshot),
        };
        logMcp(success ? 'DEBUG' : 'WARN', 'OpenAI endpoint latency monitor cycle completed.', {
            success,
            durationMs: monitorState.lastDurationMs,
            failedTargets,
            targets: monitorState.lastSnapshot?.targets ?? [],
        });
    } catch (error) {
        monitorState = {
            ...monitorState,
            running: false,
            runs: monitorState.runs + 1,
            failures: monitorState.failures + 1,
            lastDurationMs: Date.now() - started,
            lastError: error instanceof Error ? error.message : String(error),
        };
        logMcp('WARN', 'OpenAI endpoint latency monitor cycle failed without blocking MCP.', {
            error: monitorState.lastError,
        });
    } finally {
        if (monitorState.enabled) {
            scheduleNext(intervalMs, intervalMs, timeoutMs, setTimeoutFn, measureFn, persistFn);
        }
    }
}

/** @param {import('./openai-endpoint-latency.js').OpenAiEndpointLatencySnapshot} snapshot */
function compactSnapshot(snapshot) {
    return {
        observedAt: snapshot.observedAt,
        authority: snapshot.authority,
        targets: snapshot.targets.map((target) => ({
            id: target.id,
            successRate: target.successRate,
            ttfbP50Ms: target.timings.ttfb.p50Ms,
            totalP50Ms: target.timings.total.p50Ms,
            edgeColos: target.edgeColos,
        })),
    };
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedDelay(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** @param {string} name @param {boolean} fallback */
function readBooleanEnv(name, fallback) {
    const value = String(process.env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
}
