// @ts-check
/** Declarative L2 cache profile/configuration policy. */
import { readEnvBoolean, readEnvNonNegativeInt, readEnvPositiveInt } from '#copilot/infra/internal/platform';

const PROFILE_DEFAULTS = Object.freeze({
    experimental: Object.freeze({ ttlMs: 60_000, maxEntries: 10_000, pruneMs: 60_000, minBytes: 0 }),
    on: Object.freeze({ ttlMs: 5 * 60_000, maxEntries: 100_000, pruneMs: 5 * 60_000, minBytes: 0 }),
});
/** @typedef {'off'|'experimental'|'on'|'invalid'} IoL2CacheProfile */
/**
 * @typedef {{enabled:boolean;profile:IoL2CacheProfile;profileSource:'default'|'IO_L2_CACHE_PROFILE'|'IO_L2_CACHE_ENABLED';configurationValid:boolean;ttlMs:number;maxEntries:number;pruneMs:number;minBytes:number;rawProfile?:string}} IoL2CacheConfiguration
 */
/** @returns {IoL2CacheConfiguration} */
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
    const enabled = readEnvBoolean('IO_L2_CACHE_ENABLED', false);
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
/** @param {IoL2CacheConfiguration} configuration */
export function ioL2ConfigurationKey(configuration) {
    return [
        configuration.profile,
        configuration.ttlMs,
        configuration.maxEntries,
        configuration.pruneMs,
        configuration.minBytes,
    ].join(':');
}
