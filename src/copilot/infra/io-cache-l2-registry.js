// @ts-check

import { getCopilotDb } from '#copilot/db';

import { createIoL2SqliteCache } from './io-cache-l2-sqlite.js';

/** @type {ReturnType<typeof createIoL2SqliteCache> | null} */
let _ioL2Cache = null;

function isEnabled() {
    return String(process.env['IO_L2_CACHE_ENABLED'] || '0').trim() === '1';
}

export function getIoL2Cache() {
    if (!isEnabled()) {
        return null;
    }
    if (_ioL2Cache) {
        return _ioL2Cache;
    }
    try {
        _ioL2Cache = createIoL2SqliteCache({
            db: getCopilotDb(),
            ttlMs: Number(process.env['IO_L2_CACHE_TTL_MS'] || 5 * 60 * 1000),
            maxEntries: Number(process.env['IO_L2_CACHE_MAX_ENTRIES'] || 100_000),
        });
        return _ioL2Cache;
    } catch {
        return null;
    }
}

export function getIoL2CacheStats() {
    const cache = getIoL2Cache();
    if (!cache) {
        return {
            enabled: false,
            reason: 'disabled-or-unavailable',
        };
    }
    return {
        enabled: true,
        ...cache.getStats(),
    };
}

export function resetIoL2CacheForTest() {
    _ioL2Cache = null;
}
