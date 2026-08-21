// @ts-check
/** Read-side L2 cache health/stats projection. */
import { getIoL2CacheConfiguration } from './config.js';
import { getIoL2Cache, readIoL2RuntimeState } from './runtime.js';

export function getIoL2CacheHealth() {
    const configuration = getIoL2CacheConfiguration();
    const state = readIoL2RuntimeState();
    if (!configuration.configurationValid)
        return {
            available: false,
            reason: 'invalid-profile',
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: false,
            ...(configuration.rawProfile ? { rawProfile: configuration.rawProfile } : {}),
        };
    if (!configuration.enabled)
        return {
            available: false,
            reason: 'disabled',
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: true,
        };
    const cache = getIoL2Cache();
    if (!cache)
        return {
            available: false,
            reason: state.circuitOpenUntilMs && Date.now() < state.circuitOpenUntilMs ? 'circuit-open' : 'init-failed',
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: configuration.configurationValid,
            ...(state.initFailCount > 0 ? { initFailCount: state.initFailCount } : {}),
            ...(state.circuitOpenUntilMs ? { circuitOpenUntilMs: state.circuitOpenUntilMs } : {}),
            ...(state.lastInitError ? { lastInitError: state.lastInitError } : {}),
            ...(state.lastInitErrorAtMs ? { lastInitErrorAtMs: state.lastInitErrorAtMs } : {}),
        };
    if (typeof cache.get !== 'function' || typeof cache.set !== 'function')
        return {
            available: false,
            reason: 'corrupted-instance',
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: configuration.configurationValid,
        };
    return {
        available: true,
        reason: 'ready',
        profile: configuration.profile,
        profileSource: configuration.profileSource,
        configurationValid: configuration.configurationValid,
        ...(state.lastPruneError ? { lastPruneError: state.lastPruneError } : {}),
        ...(state.lastPruneErrorAtMs ? { lastPruneErrorAtMs: state.lastPruneErrorAtMs } : {}),
    };
}
export function getIoL2CacheStats() {
    const configuration = getIoL2CacheConfiguration();
    const state = readIoL2RuntimeState();
    const health = getIoL2CacheHealth();
    if (!health.available)
        return {
            enabled: false,
            profile: configuration.profile,
            profileSource: configuration.profileSource,
            configurationValid: configuration.configurationValid,
            reason: health.reason,
            ...(configuration.rawProfile ? { rawProfile: configuration.rawProfile } : {}),
            ...(state.initFailCount > 0 ? { initFailCount: state.initFailCount } : {}),
            ...(state.circuitOpenUntilMs ? { circuitOpenUntilMs: state.circuitOpenUntilMs } : {}),
            ...(state.lastInitError ? { lastInitError: state.lastInitError } : {}),
            ...(state.lastInitErrorAtMs ? { lastInitErrorAtMs: state.lastInitErrorAtMs } : {}),
        };
    const cache = getIoL2Cache();
    if (!cache) return { enabled: false, reason: 'unavailable-after-health-check' };
    return {
        enabled: true,
        profile: configuration.profile,
        profileSource: configuration.profileSource,
        configurationValid: configuration.configurationValid,
        ...cache.getStats(),
        ...(state.lastPruneError ? { lastPruneError: state.lastPruneError } : {}),
        ...(state.lastPruneErrorAtMs ? { lastPruneErrorAtMs: state.lastPruneErrorAtMs } : {}),
    };
}
