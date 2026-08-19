// @ts-check
/**
 * Low-frequency non-blocking refresher for the rebuildable MCP round-trip analytics index.
 *
 * @module copilot/mcp/control-plane/round-trip-analytics-monitor
 */

import { logMcp } from './audit.js';
import { getMcpRoundTripAnalytics } from './round-trip-analytics.js';

const DEFAULT_INITIAL_DELAY_MS = 20_000;
const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 30 * 60 * 1000;

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
        firstRunProcessedBytes: /** @type {number | null} */ (null),
        firstRunIndexedEvents: /** @type {number | null} */ (null),
        totalProcessedBytes: 0,
        totalIndexedEvents: 0,
        lastProcessedBytes: 0,
        lastIndexedEvents: 0,
        lastLagBytes: /** @type {number | null} */ (null),
        lastComplete: /** @type {boolean | null} */ (null),
        lastReset: false,
    };
}

/**
 * @param {{
 *   enabled?: boolean;
 *   initialDelayMs?: number;
 *   intervalMs?: number;
 *   setTimeoutFn?: typeof setTimeout;
 *   syncFn?: () => Promise<Record<string, unknown>>;
 * }} [options]
 */
export function scheduleMcpRoundTripAnalyticsMonitor(options = {}) {
    if (monitorTimer || monitorState.scheduled || monitorState.running) return false;
    const defaultEnabled = process.env['NODE_ENV'] !== 'test' && !process.env['VITEST'];
    const enabled = options.enabled ?? readBooleanEnv('COPILOT_MCP_ROUND_TRIP_ANALYTICS_MONITOR_ENABLED', defaultEnabled);
    if (!enabled) {
        monitorState = { ...monitorState, enabled: false, scheduled: false, nextRunAt: null };
        return false;
    }
    const initialDelayMs = boundedDelay(
        options.initialDelayMs ?? Number(process.env['COPILOT_MCP_ROUND_TRIP_ANALYTICS_INITIAL_DELAY_MS']),
        DEFAULT_INITIAL_DELAY_MS,
        0,
        10 * 60 * 1000,
    );
    const intervalMs = boundedDelay(
        options.intervalMs ?? Number(process.env['COPILOT_MCP_ROUND_TRIP_ANALYTICS_INTERVAL_MS']),
        DEFAULT_INTERVAL_MS,
        MIN_INTERVAL_MS,
        MAX_INTERVAL_MS,
    );
    const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    const syncFn = options.syncFn ?? (() => getMcpRoundTripAnalytics().sync());
    monitorState = {
        ...monitorState,
        enabled: true,
        scheduled: true,
        initialDelayMs,
        intervalMs,
        startedAt: monitorState.startedAt ?? new Date().toISOString(),
        nextRunAt: new Date(Date.now() + initialDelayMs).toISOString(),
    };
    scheduleNext(initialDelayMs, intervalMs, setTimeoutFn, syncFn);
    return true;
}

export function readMcpRoundTripAnalyticsMonitorState() {
    return { ...monitorState };
}

export function stopMcpRoundTripAnalyticsMonitor() {
    if (monitorTimer) clearTimeout(monitorTimer);
    monitorTimer = null;
    monitorState = { ...monitorState, scheduled: false, running: false, nextRunAt: null };
}

export function resetMcpRoundTripAnalyticsMonitorForTests() {
    if (monitorTimer) clearTimeout(monitorTimer);
    monitorTimer = null;
    monitorState = createInitialState();
}

/**
 * @param {number} delayMs
 * @param {number} intervalMs
 * @param {typeof setTimeout} setTimeoutFn
 * @param {() => Promise<Record<string, unknown>>} syncFn
 */
function scheduleNext(delayMs, intervalMs, setTimeoutFn, syncFn) {
    monitorTimer = setTimeoutFn(() => {
        monitorTimer = null;
        void runMonitorCycle(intervalMs, setTimeoutFn, syncFn);
    }, delayMs);
    monitorState = { ...monitorState, scheduled: true, nextRunAt: new Date(Date.now() + delayMs).toISOString() };
    if (typeof monitorTimer?.unref === 'function') monitorTimer.unref();
}

/**
 * @param {number} intervalMs
 * @param {typeof setTimeout} setTimeoutFn
 * @param {() => Promise<Record<string, unknown>>} syncFn
 */
async function runMonitorCycle(intervalMs, setTimeoutFn, syncFn) {
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
        const result = await syncFn();
        const success = result['ok'] !== false;
        const processedBytes = nonNegativeInteger(result['processedBytes']);
        const indexedEvents = nonNegativeInteger(result['indexedEvents']);
        const nextRunCount = monitorState.runs + 1;
        monitorState = {
            ...monitorState,
            running: false,
            runs: nextRunCount,
            failures: monitorState.failures + (success ? 0 : 1),
            lastSuccessAt: success ? new Date().toISOString() : monitorState.lastSuccessAt,
            lastDurationMs: Date.now() - started,
            lastError: success ? null : String(result['error'] ?? 'round-trip-analytics-sync-failed').slice(0, 240),
            firstRunProcessedBytes: monitorState.firstRunProcessedBytes ?? processedBytes,
            firstRunIndexedEvents: monitorState.firstRunIndexedEvents ?? indexedEvents,
            totalProcessedBytes: monitorState.totalProcessedBytes + processedBytes,
            totalIndexedEvents: monitorState.totalIndexedEvents + indexedEvents,
            lastProcessedBytes: processedBytes,
            lastIndexedEvents: indexedEvents,
            lastLagBytes: nullableNonNegativeInteger(result['lagBytes']),
            lastComplete: typeof result['complete'] === 'boolean' ? result['complete'] : null,
            lastReset: result['reset'] === true,
        };
        logMcp(success ? 'DEBUG' : 'WARN', 'MCP round-trip analytics monitor cycle completed.', {
            success,
            durationMs: monitorState.lastDurationMs,
            processedBytes: monitorState.lastProcessedBytes,
            indexedEvents: monitorState.lastIndexedEvents,
            lagBytes: monitorState.lastLagBytes,
            complete: monitorState.lastComplete,
            reset: monitorState.lastReset,
        });
    } catch (error) {
        monitorState = {
            ...monitorState,
            running: false,
            runs: monitorState.runs + 1,
            failures: monitorState.failures + 1,
            lastDurationMs: Date.now() - started,
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 240),
        };
        logMcp('WARN', 'MCP round-trip analytics monitor failed without blocking readiness.', {
            error: monitorState.lastError,
        });
    } finally {
        if (monitorState.enabled) scheduleNext(intervalMs, intervalMs, setTimeoutFn, syncFn);
    }
}

/** @param {unknown} value */
function nonNegativeInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** @param {unknown} value */
function nullableNonNegativeInteger(value) {
    if (value === null || value === undefined) return null;
    return nonNegativeInteger(value);
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedDelay(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** @param {string} name @param {boolean} fallback */
function readBooleanEnv(name, fallback) {
    const value = String(process.env[name] ?? '').trim().toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
}
