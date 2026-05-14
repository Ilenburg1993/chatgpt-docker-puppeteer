// @ts-check

import { getCopilotDb } from '#copilot/db';

import { createIoL2SqliteCache } from './io-cache-l2-sqlite.js';
import { readEnvPositiveInt } from './shared/env.js';

/** @type {ReturnType<typeof createIoL2SqliteCache> | null} */
let _ioL2Cache = null;
/** @type {NodeJS.Timeout | null} */
let _pruneTimer = null;
/** @type {string | null} */
let _lastInitError = null;
/** @type {number | null} */
let _lastInitErrorAtMs = null;
/** @type {string | null} */
let _lastPruneError = null;
/** @type {number | null} */
let _lastPruneErrorAtMs = null;
/** @type {number} */
let _initFailCount = 0;
/** @type {number | null} */
let _circuitOpenUntilMs = null;

const MAX_INIT_FAILURES = 3;
const CIRCUIT_BACKOFF_MS = [1000, 5000, 30000];

function isEnabled() {
    return String(process.env['IO_L2_CACHE_ENABLED'] || '0').trim() === '1';
}

function startPruneTimer() {
    if (_pruneTimer) return;
    const pruneCycleMs = readEnvPositiveInt('IO_L2_CACHE_PRUNE_MS', 5 * 60 * 1000);
    _pruneTimer = setInterval(() => {
        try {
            const cache = _ioL2Cache;
            if (!cache) return;
            const removed = cache.pruneExpired();
            if (removed > 0 && process.env['DEBUG_IO_L2'] === '1') {
                console.debug(`[io-cache-l2] Pruned ${removed} expired entries.`);
            }
        } catch (err) {
            _lastPruneError = err instanceof Error ? err.message : String(err ?? 'unknown-prune-error');
            _lastPruneErrorAtMs = Date.now();
            if (process.env['DEBUG_IO_L2'] === '1') {
                console.error('[io-cache-l2] Prune error:', err);
            }
        }
    }, pruneCycleMs);
    _pruneTimer.unref();
}

export function getIoL2Cache() {
    if (!isEnabled()) {
        return null;
    }
    if (_circuitOpenUntilMs && Date.now() < _circuitOpenUntilMs) {
        return null;
    }
    if (_ioL2Cache) {
        return _ioL2Cache;
    }
    try {
        _ioL2Cache = createIoL2SqliteCache({
            db: getCopilotDb(),
            ttlMs: readEnvPositiveInt('IO_L2_CACHE_TTL_MS', 5 * 60 * 1000),
            maxEntries: readEnvPositiveInt('IO_L2_CACHE_MAX_ENTRIES', 100_000),
        });
        _lastInitError = null;
        _lastInitErrorAtMs = null;
        _initFailCount = 0;
        _circuitOpenUntilMs = null;
        startPruneTimer();
        return _ioL2Cache;
    } catch (err) {
        _initFailCount += 1;
        _lastInitError = err instanceof Error ? err.message : String(err ?? 'unknown-init-error');
        _lastInitErrorAtMs = Date.now();
        if (_initFailCount >= MAX_INIT_FAILURES) {
            const idx = Math.min(_initFailCount - MAX_INIT_FAILURES, CIRCUIT_BACKOFF_MS.length - 1);
            const backoffMs = CIRCUIT_BACKOFF_MS[idx] ?? CIRCUIT_BACKOFF_MS[CIRCUIT_BACKOFF_MS.length - 1] ?? 30_000;
            _circuitOpenUntilMs = Date.now() + backoffMs;
        }
        if (process.env['DEBUG_IO_L2'] === '1') {
            console.debug('[io-cache-l2] Failed to initialize L2 cache; operating in L1-only mode.');
        }
        return null;
    }
}

export function getIoL2CacheStats() {
    const health = getIoL2CacheHealth();
    if (!health.available) {
        return {
            enabled: false,
            reason: health.reason,
            ...(_initFailCount > 0 ? { initFailCount: _initFailCount } : {}),
            ...(_circuitOpenUntilMs ? { circuitOpenUntilMs: _circuitOpenUntilMs } : {}),
            ...(_lastInitError ? { lastInitError: _lastInitError } : {}),
            ...(_lastInitErrorAtMs ? { lastInitErrorAtMs: _lastInitErrorAtMs } : {}),
        };
    }
    const cache = getIoL2Cache();
    if (!cache) {
        return {
            enabled: false,
            reason: 'unavailable-after-health-check',
        };
    }
    return {
        enabled: true,
        ...cache.getStats(),
        ...(_lastPruneError ? { lastPruneError: _lastPruneError } : {}),
        ...(_lastPruneErrorAtMs ? { lastPruneErrorAtMs: _lastPruneErrorAtMs } : {}),
    };
}

export function getIoL2CacheHealth() {
    const enabled = String(process.env['IO_L2_CACHE_ENABLED'] || '0').trim() === '1';
    if (!enabled) {
        return { available: false, reason: 'disabled' };
    }
    const cache = getIoL2Cache();
    if (!cache) {
        return {
            available: false,
            reason: _circuitOpenUntilMs && Date.now() < _circuitOpenUntilMs ? 'circuit-open' : 'init-failed',
            ...(_initFailCount > 0 ? { initFailCount: _initFailCount } : {}),
            ...(_circuitOpenUntilMs ? { circuitOpenUntilMs: _circuitOpenUntilMs } : {}),
            ...(_lastInitError ? { lastInitError: _lastInitError } : {}),
            ...(_lastInitErrorAtMs ? { lastInitErrorAtMs: _lastInitErrorAtMs } : {}),
        };
    }
    if (typeof cache.get !== 'function' || typeof cache.set !== 'function') {
        return { available: false, reason: 'corrupted-instance' };
    }
    return {
        available: true,
        reason: 'ready',
        ...(_lastPruneError ? { lastPruneError: _lastPruneError } : {}),
        ...(_lastPruneErrorAtMs ? { lastPruneErrorAtMs: _lastPruneErrorAtMs } : {}),
    };
}

export function resetIoL2CacheForTest() {
    _ioL2Cache = null;
    _lastInitError = null;
    _lastInitErrorAtMs = null;
    _lastPruneError = null;
    _lastPruneErrorAtMs = null;
    _initFailCount = 0;
    _circuitOpenUntilMs = null;
    if (_pruneTimer) {
        clearInterval(_pruneTimer);
        _pruneTimer = null;
    }
}
