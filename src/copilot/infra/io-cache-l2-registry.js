// @ts-check

import { cancelTimer, registerInterval, registerShutdownHandler, SHUTDOWN_PRIORITY, toError } from '#copilot/core';
import { getCopilotDb } from '#copilot/db';
import { publishIoLifecycleEvent } from './io-observability.js';

import { createIoL2SqliteCache } from './io-cache-l2-sqlite.js';
import { readEnvNonNegativeInt, readEnvPositiveInt } from './shared/env.js';

/** @type {ReturnType<typeof createIoL2SqliteCache> | null} */
let _ioL2Cache = null;
/** @type {NodeJS.Timeout | null} */
let _pruneTimer = null;
/** @type {string | null} */
let _pruneTimerId = null;
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
/** @type {string | null} */
let _activeConfigurationKey = null;

const MAX_INIT_FAILURES = 3;
const CIRCUIT_BACKOFF_MS = [1000, 5000, 30000];
const PROFILE_DEFAULTS = {
    experimental: {
        ttlMs: 60 * 1000,
        maxEntries: 10_000,
        pruneMs: 60 * 1000,
        minBytes: 0,
    },
    on: {
        ttlMs: 5 * 60 * 1000,
        maxEntries: 100_000,
        pruneMs: 5 * 60 * 1000,
        minBytes: 0,
    },
};

/**
 * @typedef {'off' | 'experimental' | 'on' | 'invalid'} IoL2CacheProfile
 */

/**
 * @returns {{
 *     enabled: boolean;
 *     profile: IoL2CacheProfile;
 *     profileSource: 'default' | 'IO_L2_CACHE_PROFILE' | 'IO_L2_CACHE_ENABLED';
 *     configurationValid: boolean;
 *     ttlMs: number;
 *     maxEntries: number;
 *     pruneMs: number;
 *     minBytes: number;
 *     rawProfile?: string;
 * }}
 */
export function getIoL2CacheConfiguration() {
    const rawProfile = String(process.env['IO_L2_CACHE_PROFILE'] ?? '')
        .trim()
        .toLowerCase();
    if (rawProfile) {
        if (rawProfile !== 'off' && rawProfile !== 'experimental' && rawProfile !== 'on') {
            return {
                enabled: false,
                profile: 'invalid',
                profileSource: 'IO_L2_CACHE_PROFILE',
                configurationValid: false,
                ttlMs: PROFILE_DEFAULTS.on.ttlMs,
                maxEntries: PROFILE_DEFAULTS.on.maxEntries,
                pruneMs: PROFILE_DEFAULTS.on.pruneMs,
                minBytes: PROFILE_DEFAULTS.on.minBytes,
                rawProfile,
            };
        }
        const defaults = rawProfile === 'experimental' ? PROFILE_DEFAULTS.experimental : PROFILE_DEFAULTS.on;
        return {
            enabled: rawProfile !== 'off',
            profile: rawProfile,
            profileSource: 'IO_L2_CACHE_PROFILE',
            configurationValid: true,
            ttlMs: readEnvPositiveInt('IO_L2_CACHE_TTL_MS', defaults.ttlMs),
            maxEntries: readEnvPositiveInt('IO_L2_CACHE_MAX_ENTRIES', defaults.maxEntries),
            pruneMs: readEnvPositiveInt('IO_L2_CACHE_PRUNE_MS', defaults.pruneMs),
            minBytes: readEnvNonNegativeInt('IO_L2_CACHE_MIN_BYTES', defaults.minBytes),
        };
    }

    const legacyConfigured = String(process.env['IO_L2_CACHE_ENABLED'] ?? '').trim() !== '';
    const enabled = readBooleanEnv('IO_L2_CACHE_ENABLED', false);
    return {
        enabled,
        profile: enabled ? 'on' : 'off',
        profileSource: legacyConfigured ? 'IO_L2_CACHE_ENABLED' : 'default',
        configurationValid: true,
        ttlMs: readEnvPositiveInt('IO_L2_CACHE_TTL_MS', PROFILE_DEFAULTS.on.ttlMs),
        maxEntries: readEnvPositiveInt('IO_L2_CACHE_MAX_ENTRIES', PROFILE_DEFAULTS.on.maxEntries),
        pruneMs: readEnvPositiveInt('IO_L2_CACHE_PRUNE_MS', PROFILE_DEFAULTS.on.pruneMs),
        minBytes: readEnvNonNegativeInt('IO_L2_CACHE_MIN_BYTES', PROFILE_DEFAULTS.on.minBytes),
    };
}

/**
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanEnv(name, fallback) {
    const raw = String(process.env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {ReturnType<typeof getIoL2CacheConfiguration>} configuration
 */
function startPruneTimer(configuration) {
    if (_pruneTimer) return;
    const pruneCycleMs = configuration.pruneMs;
    _pruneTimerId = `io-cache-l2.prune:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    _pruneTimer = registerInterval(
        _pruneTimerId,
        () => {
            try {
                const cache = _ioL2Cache;
                if (!cache) return;
                const removed = cache.pruneExpired();
                if (removed > 0 && process.env['DEBUG_IO_L2'] === '1') {
                    console.debug(`[io-cache-l2] Pruned ${removed} expired entries.`);
                }
            } catch (err) {
                _lastPruneError = toError(err ?? 'unknown-prune-error').message;
                _lastPruneErrorAtMs = Date.now();
                if (process.env['DEBUG_IO_L2'] === '1') {
                    console.error('[io-cache-l2] Prune error:', err);
                }
            }
        },
        pruneCycleMs,
    );
    _pruneTimer.unref();
}

function stopPruneTimer() {
    if (_pruneTimerId) cancelTimer(_pruneTimerId);
    _pruneTimer = null;
    _pruneTimerId = null;
}

function flushActiveL2Cache() {
    try {
        _ioL2Cache?.flushPending?.();
    } catch {
        // Cache L2 é best-effort; reconfiguração não deve bloquear o runtime.
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

/**
 * @param {ReturnType<typeof getIoL2CacheConfiguration>} configuration
 */
function getConfigurationKey(configuration) {
    return [
        configuration.profile,
        configuration.ttlMs,
        configuration.maxEntries,
        configuration.pruneMs,
        configuration.minBytes,
    ].join(':');
}

export function getIoL2Cache() {
    ensureL2ShutdownHandler();
    const configuration = getIoL2CacheConfiguration();
    if (!configuration.enabled) {
        flushActiveL2Cache();
        _ioL2Cache = null;
        _activeConfigurationKey = null;
        stopPruneTimer();
        return null;
    }
    const configurationKey = getConfigurationKey(configuration);
    if (_ioL2Cache && _activeConfigurationKey !== configurationKey) {
        flushActiveL2Cache();
        _ioL2Cache = null;
        stopPruneTimer();
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
            ttlMs: configuration.ttlMs,
            maxEntries: configuration.maxEntries,
            minBytes: configuration.minBytes,
        });
        _activeConfigurationKey = configurationKey;
        _lastInitError = null;
        _lastInitErrorAtMs = null;
        const hadCircuitOpen = _circuitOpenUntilMs !== null;
        _initFailCount = 0;
        _circuitOpenUntilMs = null;
        if (hadCircuitOpen) {
            publishIoLifecycleEvent('cache', 'l2.circuit-closed', {
                reason: 'init-succeeded',
            });
        }
        startPruneTimer(configuration);
        return _ioL2Cache;
    } catch (err) {
        _initFailCount += 1;
        _lastInitError = toError(err ?? 'unknown-init-error').message;
        _lastInitErrorAtMs = Date.now();
        if (_initFailCount >= MAX_INIT_FAILURES) {
            const idx = Math.min(_initFailCount - MAX_INIT_FAILURES, CIRCUIT_BACKOFF_MS.length - 1);
            const backoffMs = CIRCUIT_BACKOFF_MS[idx] ?? CIRCUIT_BACKOFF_MS[CIRCUIT_BACKOFF_MS.length - 1] ?? 30_000;
            _circuitOpenUntilMs = Date.now() + backoffMs;
            publishIoLifecycleEvent('cache', 'l2.circuit-open', {
                initFailCount: _initFailCount,
                backoffMs,
                circuitOpenUntilMs: _circuitOpenUntilMs,
                lastInitError: _lastInitError,
            });
        }
        if (process.env['DEBUG_IO_L2'] === '1') {
            console.debug('[io-cache-l2] Failed to initialize L2 cache; operating in L1-only mode.');
        }
        return null;
    }
}

export function getIoL2CacheStats() {
    const configuration = getIoL2CacheConfiguration();
    const health = getIoL2CacheHealth();
    if (!health.available) {
        return {
            enabled: false,
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: configuration.configurationValid,
            reason: health.reason,
            ...(configuration.rawProfile ? { rawProfile: configuration.rawProfile } : {}),
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
        profile: configuration.profile,
        profileSource: configuration.profileSource,
        configurationValid: configuration.configurationValid,
        ...cache.getStats(),
        ...(_lastPruneError ? { lastPruneError: _lastPruneError } : {}),
        ...(_lastPruneErrorAtMs ? { lastPruneErrorAtMs: _lastPruneErrorAtMs } : {}),
    };
}

export function getIoL2CacheHealth() {
    const configuration = getIoL2CacheConfiguration();
    if (!configuration.configurationValid) {
        return {
            available: false,
            reason: 'invalid-profile',
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: false,
            ...(configuration.rawProfile ? { rawProfile: configuration.rawProfile } : {}),
        };
    }
    if (!configuration.enabled) {
        return {
            available: false,
            reason: 'disabled',
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: true,
        };
    }
    const cache = getIoL2Cache();
    if (!cache) {
        return {
            available: false,
            reason: _circuitOpenUntilMs && Date.now() < _circuitOpenUntilMs ? 'circuit-open' : 'init-failed',
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: configuration.configurationValid,
            ...(_initFailCount > 0 ? { initFailCount: _initFailCount } : {}),
            ...(_circuitOpenUntilMs ? { circuitOpenUntilMs: _circuitOpenUntilMs } : {}),
            ...(_lastInitError ? { lastInitError: _lastInitError } : {}),
            ...(_lastInitErrorAtMs ? { lastInitErrorAtMs: _lastInitErrorAtMs } : {}),
        };
    }
    if (typeof cache.get !== 'function' || typeof cache.set !== 'function') {
        return {
            available: false,
            reason: 'corrupted-instance',
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: configuration.configurationValid,
        };
    }
    return {
        available: true,
        reason: 'ready',
        profile: configuration.profile,
        profileSource: configuration.profileSource,
        configurationValid: configuration.configurationValid,
        ...(_lastPruneError ? { lastPruneError: _lastPruneError } : {}),
        ...(_lastPruneErrorAtMs ? { lastPruneErrorAtMs: _lastPruneErrorAtMs } : {}),
    };
}

export function resetIoL2CacheForTest() {
    flushActiveL2Cache();
    _ioL2Cache = null;
    _activeConfigurationKey = null;
    _lastInitError = null;
    _lastInitErrorAtMs = null;
    _lastPruneError = null;
    _lastPruneErrorAtMs = null;
    _initFailCount = 0;
    _circuitOpenUntilMs = null;
    stopPruneTimer();
}
