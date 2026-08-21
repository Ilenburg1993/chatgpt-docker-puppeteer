// @ts-check
/** L2 cache singleton lifecycle, prune timer and initialization circuit breaker. */
import { cancelTimer, registerInterval, registerShutdownHandler, SHUTDOWN_PRIORITY, toError } from '#copilot/core';
import { getInfraSqliteDatabase } from '#copilot/infra/internal/database';
import { publishIoLifecycleEvent } from '#copilot/infra/internal/telemetry';
import { getIoL2CacheConfiguration, ioL2ConfigurationKey } from './config.js';
import { createIoL2SqliteCache } from './sqlite/index.js';

/** @type {ReturnType<typeof createIoL2SqliteCache>|null} */ let ioL2Cache = null;
/** @type {NodeJS.Timeout|null} */ let pruneTimer = null;
/** @type {string|null} */ let pruneTimerId = null;
/** @type {string|null} */ let lastInitError = null;
/** @type {number|null} */ let lastInitErrorAtMs = null;
/** @type {string|null} */ let lastPruneError = null;
/** @type {number|null} */ let lastPruneErrorAtMs = null;
let initFailCount = 0;
/** @type {number|null} */ let circuitOpenUntilMs = null;
/** @type {string|null} */ let activeConfigurationKey = null;
const MAX_INIT_FAILURES = 3;
const CIRCUIT_BACKOFF_MS = [1000, 5000, 30000];

/** @param {ReturnType<typeof getIoL2CacheConfiguration>} configuration */
function startPruneTimer(configuration) {
    if (pruneTimer) return;
    pruneTimerId = `io-cache-l2.prune:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    pruneTimer = registerInterval(
        pruneTimerId,
        () => {
            try {
                const cache = ioL2Cache;
                if (!cache) return;
                const removed = cache.pruneExpired();
                if (removed > 0 && process.env['DEBUG_IO_L2'] === '1')
                    console.debug(`[io-cache-l2] Pruned ${removed} expired entries.`);
            } catch (err) {
                lastPruneError = toError(err ?? 'unknown-prune-error').message;
                lastPruneErrorAtMs = Date.now();
                if (process.env['DEBUG_IO_L2'] === '1') console.error('[io-cache-l2] Prune error:', err);
            }
        },
        configuration.pruneMs,
    );
    pruneTimer.unref();
}
function stopPruneTimer() {
    if (pruneTimerId) cancelTimer(pruneTimerId);
    pruneTimer = null;
    pruneTimerId = null;
}
function flushActiveL2Cache() {
    try {
        ioL2Cache?.flushPending?.();
    } catch {
        /* best-effort */
    }
}
function ensureL2ShutdownHandler() {
    registerShutdownHandler(
        'copilot-io-l2.flush',
        async () => {
            flushActiveL2Cache();
            stopPruneTimer();
        },
        SHUTDOWN_PRIORITY.CACHE_PERSISTENCE,
    );
}

export function getIoL2Cache() {
    ensureL2ShutdownHandler();
    const configuration = getIoL2CacheConfiguration();
    if (!configuration.enabled) {
        flushActiveL2Cache();
        ioL2Cache = null;
        activeConfigurationKey = null;
        stopPruneTimer();
        return null;
    }
    const configurationKey = ioL2ConfigurationKey(configuration);
    if (ioL2Cache && activeConfigurationKey !== configurationKey) {
        flushActiveL2Cache();
        ioL2Cache = null;
        stopPruneTimer();
    }
    if (circuitOpenUntilMs && Date.now() < circuitOpenUntilMs) return null;
    if (ioL2Cache) return ioL2Cache;
    try {
        ioL2Cache = createIoL2SqliteCache({
            db: getInfraSqliteDatabase(),
            ttlMs: configuration.ttlMs,
            maxEntries: configuration.maxEntries,
            minBytes: configuration.minBytes,
        });
        activeConfigurationKey = configurationKey;
        lastInitError = null;
        lastInitErrorAtMs = null;
        const hadCircuitOpen = circuitOpenUntilMs !== null;
        initFailCount = 0;
        circuitOpenUntilMs = null;
        if (hadCircuitOpen) publishIoLifecycleEvent('cache', 'l2.circuit-closed', { reason: 'init-succeeded' });
        startPruneTimer(configuration);
        return ioL2Cache;
    } catch (err) {
        initFailCount += 1;
        lastInitError = toError(err ?? 'unknown-init-error').message;
        lastInitErrorAtMs = Date.now();
        if (initFailCount >= MAX_INIT_FAILURES) {
            const idx = Math.min(initFailCount - MAX_INIT_FAILURES, CIRCUIT_BACKOFF_MS.length - 1);
            const backoffMs = CIRCUIT_BACKOFF_MS[idx] ?? 30_000;
            circuitOpenUntilMs = Date.now() + backoffMs;
            publishIoLifecycleEvent('cache', 'l2.circuit-open', {
                initFailCount,
                backoffMs,
                circuitOpenUntilMs,
                lastInitError,
            });
        }
        if (process.env['DEBUG_IO_L2'] === '1')
            console.debug('[io-cache-l2] Failed to initialize L2 cache; operating in L1-only mode.');
        return null;
    }
}
export function readIoL2RuntimeState() {
    return { initFailCount, circuitOpenUntilMs, lastInitError, lastInitErrorAtMs, lastPruneError, lastPruneErrorAtMs };
}
export function resetIoL2RuntimeForTest() {
    flushActiveL2Cache();
    ioL2Cache = null;
    activeConfigurationKey = null;
    lastInitError = null;
    lastInitErrorAtMs = null;
    lastPruneError = null;
    lastPruneErrorAtMs = null;
    initFailCount = 0;
    circuitOpenUntilMs = null;
    stopPruneTimer();
}
