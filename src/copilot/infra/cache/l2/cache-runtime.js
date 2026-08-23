// @ts-check
/** Instance-owned L2 lifecycle, prune timer and initialization circuit breaker. */
import { toError } from '#copilot/infra/internal/platform/error';
import { publishIoLifecycleEvent } from '#copilot/infra/internal/telemetry';
import { getIoL2CacheConfiguration } from './config.js';
import { createIoL2SqliteCache } from './sqlite/index.js';

const MAX_INIT_FAILURES = 3;
const CIRCUIT_BACKOFF_MS = [1000, 5000, 30000];

/**
 * @param {{
 *   database:import('#copilot/infra/internal/database/port').InfraSqliteProviderReader;
 *   runtimeId?:string;
 *   configuration?:ReturnType<typeof getIoL2CacheConfiguration>;
 *   debug?:boolean;
 * }} options
 */
export function createIoL2CacheRuntime(options) {
    if (!options?.database) throw new TypeError('createIoL2CacheRuntime requires { database }.');
    const runtimeId = options.runtimeId ?? 'io-l2-runtime';
    const configuration = options.configuration ?? getIoL2CacheConfiguration();
    /** @type {ReturnType<typeof createIoL2SqliteCache>|null} */ let cache = null;
    /** @type {NodeJS.Timeout|null} */ let pruneTimer = null;
    /** @type {string|null} */ let lastInitError = null;
    /** @type {number|null} */ let lastInitErrorAtMs = null;
    /** @type {string|null} */ let lastPruneError = null;
    /** @type {number|null} */ let lastPruneErrorAtMs = null;
    /** @type {number|null} */ let circuitOpenUntilMs = null;
    let activeDatabaseRevision = -1;
    let initFailCount = 0;
    let disposed = false;

    function stopPruneTimer() {
        if (pruneTimer) clearInterval(pruneTimer);
        pruneTimer = null;
    }
    function flushActive() {
        try {
            cache?.flushPending?.();
        } catch {
            // Best effort during configuration changes/teardown.
        }
    }
    /** @param {ReturnType<typeof getIoL2CacheConfiguration>} configuration */
    function startPruneTimer(configuration) {
        if (pruneTimer || disposed) return;
        pruneTimer = setInterval(() => {
            try {
                const removed = cache?.pruneExpired() ?? 0;
                if (removed > 0) publishIoLifecycleEvent('cache', 'l2.pruned', { runtimeId, removed });
            } catch (error) {
                lastPruneError = toError(error ?? 'unknown-prune-error').message;
                lastPruneErrorAtMs = Date.now();
            }
        }, configuration.pruneMs);
        pruneTimer.unref?.();
    }
    function releaseMaterialized() {
        flushActive();
        cache = null;
        activeDatabaseRevision = -1;
        stopPruneTimer();
    }
    function get() {
        if (disposed) return null;
        if (!configuration.enabled) {
            releaseMaterialized();
            return null;
        }
        const databaseStatus = options.database.status();
        if (!databaseStatus.configured) {
            releaseMaterialized();
            return null;
        }
        if (cache && activeDatabaseRevision !== databaseStatus.revision) releaseMaterialized();
        if (circuitOpenUntilMs && Date.now() < circuitOpenUntilMs) return null;
        if (cache) return cache;
        try {
            cache = createIoL2SqliteCache({
                db: options.database.get(),
                ttlMs: configuration.ttlMs,
                maxEntries: configuration.maxEntries,
                minBytes: configuration.minBytes,
            });
            activeDatabaseRevision = databaseStatus.revision;
            lastInitError = null;
            lastInitErrorAtMs = null;
            const hadCircuitOpen = circuitOpenUntilMs !== null;
            initFailCount = 0;
            circuitOpenUntilMs = null;
            if (hadCircuitOpen)
                publishIoLifecycleEvent('cache', 'l2.circuit-closed', { runtimeId, reason: 'init-succeeded' });
            startPruneTimer(configuration);
            return cache;
        } catch (error) {
            initFailCount += 1;
            lastInitError = toError(error ?? 'unknown-init-error').message;
            lastInitErrorAtMs = Date.now();
            if (initFailCount >= MAX_INIT_FAILURES) {
                const index = Math.min(initFailCount - MAX_INIT_FAILURES, CIRCUIT_BACKOFF_MS.length - 1);
                const backoffMs = CIRCUIT_BACKOFF_MS[index] ?? 30_000;
                circuitOpenUntilMs = Date.now() + backoffMs;
                publishIoLifecycleEvent('cache', 'l2.circuit-open', {
                    runtimeId,
                    initFailCount,
                    backoffMs,
                    circuitOpenUntilMs,
                    lastInitError,
                });
            }
            return null;
        }
    }
    function state() {
        return Object.freeze({
            initFailCount,
            circuitOpenUntilMs,
            lastInitError,
            lastInitErrorAtMs,
            lastPruneError,
            lastPruneErrorAtMs,
            materialized: cache !== null,
            pruneTimerPending: pruneTimer !== null,
            databaseRevision: activeDatabaseRevision,
            disposed,
        });
    }
    function snapshot() {
        const runtimeState = state();
        const cacheStats = cache?.getStats() ?? null;
        return Object.freeze({
            enabled: configuration.enabled,
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: configuration.configurationValid,
            ...(configuration.rawProfile ? { rawProfile: configuration.rawProfile } : {}),
            materialized: runtimeState.materialized,
            initFailCount: runtimeState.initFailCount,
            circuitOpenUntilMs: runtimeState.circuitOpenUntilMs,
            circuitRemainingMs: Math.max(0, Number(runtimeState.circuitOpenUntilMs ?? 0) - Date.now()),
            lastInitError: runtimeState.lastInitError,
            lastInitErrorAtMs: runtimeState.lastInitErrorAtMs,
            lastPruneError: runtimeState.lastPruneError,
            lastPruneErrorAtMs: runtimeState.lastPruneErrorAtMs,
            ...(cacheStats ?? {}),
        });
    }
    function health() {
        if (!configuration.configurationValid)
            return Object.freeze({
                available: false,
                reason: 'invalid-profile',
                profile: configuration.profile,
                profileSource: configuration.profileSource,
                configurationValid: false,
                ...(configuration.rawProfile ? { rawProfile: configuration.rawProfile } : {}),
            });
        if (!configuration.enabled)
            return Object.freeze({
                available: false,
                reason: 'disabled',
                profile: configuration.profile,
                profileSource: configuration.profileSource,
                configurationValid: true,
            });
        const value = get();
        const snapshot = state();
        if (!value)
            return Object.freeze({
                available: false,
                reason:
                    snapshot.circuitOpenUntilMs && Date.now() < snapshot.circuitOpenUntilMs
                        ? 'circuit-open'
                        : options.database.status().configured
                          ? 'init-failed'
                          : 'db-provider-unconfigured',
                profile: configuration.profile,
                profileSource: configuration.profileSource,
                configurationValid: true,
                ...(snapshot.initFailCount > 0 ? { initFailCount: snapshot.initFailCount } : {}),
                ...(snapshot.lastInitError ? { lastInitError: snapshot.lastInitError } : {}),
            });
        return Object.freeze({
            available: true,
            reason: 'ready',
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: true,
            ...(snapshot.lastPruneError ? { lastPruneError: snapshot.lastPruneError } : {}),
        });
    }
    function stats() {
        const healthSnapshot = health();
        const runtimeState = state();
        if (!healthSnapshot.available)
            return Object.freeze({
                enabled: false,
                profile: configuration.profile,
                profileSource: configuration.profileSource,
                configurationValid: configuration.configurationValid,
                reason: healthSnapshot.reason,
                ...(configuration.rawProfile ? { rawProfile: configuration.rawProfile } : {}),
                ...(runtimeState.initFailCount > 0 ? { initFailCount: runtimeState.initFailCount } : {}),
                ...(runtimeState.circuitOpenUntilMs ? { circuitOpenUntilMs: runtimeState.circuitOpenUntilMs } : {}),
                ...(runtimeState.lastInitError ? { lastInitError: runtimeState.lastInitError } : {}),
            });
        const value = get();
        return value
            ? Object.freeze({
                  enabled: true,
                  profile: configuration.profile,
                  profileSource: configuration.profileSource,
                  configurationValid: true,
                  ...value.getStats(),
                  ...(runtimeState.lastPruneError ? { lastPruneError: runtimeState.lastPruneError } : {}),
              })
            : Object.freeze({ enabled: false, reason: 'unavailable-after-health-check' });
    }
    function reset() {
        releaseMaterialized();
        lastInitError = null;
        lastInitErrorAtMs = null;
        lastPruneError = null;
        lastPruneErrorAtMs = null;
        initFailCount = 0;
        circuitOpenUntilMs = null;
    }
    const api = Object.freeze({
        runtimeId,
        get,
        state,
        snapshot,
        health,
        stats,
        reset,
        flushPending() {
            flushActive();
        },
        stopBackground() {
            stopPruneTimer();
        },
        dispose() {
            if (disposed) return;
            reset();
            disposed = true;
        },
    });
    return api;
}
