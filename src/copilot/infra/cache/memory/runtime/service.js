// @ts-check
/** Instance-owned L1 LRU cache. No operational state exists at module scope. */
import { normalizeIoCacheKey } from '#copilot/infra/internal/cache/keys';
import { readEnvIntAtLeast, readEnvPositiveInt } from '#copilot/infra/internal/platform';
import { LRUCache } from 'lru-cache';
import * as nodePath from 'node:path';
import { verifyIoL1EntrySnapshot } from './verifier.js';
/** @typedef {import('../contracts/index.js').IoCacheEntry} IoCacheEntry */
/** @typedef {import('../contracts/index.js').IoCacheStats} IoCacheStats */
/** @typedef {import('../contracts/index.js').IoL1Cache} IoL1Cache */

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env] */
export function readIoL1CacheConfig(env = {}) {
    return Object.freeze({
        ttlMs: readEnvPositiveInt('IO_L1_CACHE_TTL_MS', 60_000, env),
        maxEntries: readEnvPositiveInt('IO_L1_CACHE_MAX_ENTRIES', 2_000, env),
        maxBytes: readEnvPositiveInt('IO_L1_CACHE_MAX_BYTES', 128 * 1024 * 1024, env),
        hashRevalidateMaxBytes: readEnvPositiveInt('IO_L1_HASH_REVALIDATE_MAX_BYTES', 1024 * 1024, env),
        staleProbeIntervalMs: readEnvIntAtLeast('IO_L1_STALE_PROBE_INTERVAL_MS', 2_000, -1, env),
    });
}

/** @param {{ maxEntries?:number; maxBytes?:number; ttlMs?:number; staleProbeIntervalMs?:number; hashRevalidateMaxBytes?:number; config?:ReturnType<typeof readIoL1CacheConfig> }} [options] */
export function createIoL1CacheRuntime(options = {}) {
    const defaults = options.config ?? readIoL1CacheConfig({});
    const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? defaults.maxEntries));
    const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? defaults.maxBytes));
    const ttlMs = Math.max(0, Math.floor(options.ttlMs ?? defaults.ttlMs));
    const staleProbeIntervalMs = Math.floor(options.staleProbeIntervalMs ?? defaults.staleProbeIntervalMs);
    const hashRevalidateMaxBytes = Math.max(
        1,
        Math.floor(options.hashRevalidateMaxBytes ?? defaults.hashRevalidateMaxBytes),
    );
    /** @type {LRUCache<string,IoCacheEntry> | null} */
    let lru = null;
    let hits = 0;
    let misses = 0;
    let evictions = 0;
    let invalidations = 0;
    let staleHits = 0;
    let hashRevalidations = 0;
    let hashRevalidationHits = 0;
    let disposed = false;

    function ensureCache() {
        if (disposed) throw new Error('IoL1CacheRuntime is disposed.');
        if (lru) return lru;
        lru = new LRUCache(
            Object.assign(
                {
                    max: maxEntries,
                    maxSize: maxBytes,
                    sizeCalculation: /** @param {IoCacheEntry} entry */ (entry) => entry.bytes || 1,
                    dispose: /** @param {IoCacheEntry} _entry @param {string} _key @param {string} reason */ (
                        _entry,
                        _key,
                        reason,
                    ) => {
                        if (reason === 'evict' || reason === 'expire') evictions += 1;
                    },
                    allowStale: false,
                    updateAgeOnGet: true,
                },
                ttlMs > 0 ? { ttl: ttlMs, ttlAutopurge: false } : {},
            ),
        );
        return lru;
    }

    /** @returns {IoCacheStats | null} */
    function stats() {
        if (!lru) return null;
        return {
            hits,
            misses,
            evictions,
            invalidations,
            staleHits,
            hashRevalidations,
            hashRevalidationHits,
            size: lru.size,
            bytesStored: lru.calculatedSize ?? 0,
            ttlMs,
            staleProbeIntervalMs,
            hashRevalidateMaxBytes,
        };
    }

    const api = Object.freeze({
        /** @param {string} key */
        get(key) {
            const entry = ensureCache().get(key);
            if (entry === undefined) {
                misses += 1;
                return null;
            }
            hits += 1;
            entry.accessCount = (entry.accessCount ?? 0) + 1;
            return entry;
        },
        /** @param {string} key @param {string} filePath */
        async getVerified(key, filePath) {
            const cache = ensureCache();
            const entry = cache.get(key);
            if (entry === undefined) {
                misses += 1;
                return null;
            }
            const verification = await verifyIoL1EntrySnapshot(entry, filePath, {
                staleProbeIntervalMs,
                hashRevalidateMaxBytes,
            });
            if (verification.hashRevalidated) hashRevalidations += 1;
            if (verification.hashRevalidationHit) hashRevalidationHits += 1;
            if (!verification.fresh) {
                cache.delete(key);
                staleHits += 1;
                misses += 1;
                return null;
            }
            hits += 1;
            entry.accessCount = (entry.accessCount ?? 0) + 1;
            return entry;
        },
        /** @param {string} key @param {IoCacheEntry} entry */
        set(key, entry) {
            ensureCache().set(key, entry);
        },
        /** @param {string} filePath @param {{recursive?:boolean}} [invalidateOptions] */
        invalidate(filePath, invalidateOptions = {}) {
            const cache = ensureCache();
            const normalized = normalizeIoCacheKey(filePath);
            const prefix = `${normalized}::`;
            const subtreePrefix = `${normalized}${nodePath.sep}`;
            const keys = [];
            for (const key of cache.keys()) {
                if (key.startsWith(prefix) || (invalidateOptions.recursive === true && key.startsWith(subtreePrefix)))
                    keys.push(key);
            }
            for (const key of keys) {
                cache.delete(key);
                invalidations += 1;
            }
        },
        stats,
        clear() {
            lru?.clear();
            hits = 0;
            misses = 0;
            evictions = 0;
            invalidations = 0;
            staleHits = 0;
            hashRevalidations = 0;
            hashRevalidationHits = 0;
        },
        reset() {
            api.clear();
            lru = null;
        },
        dispose() {
            if (disposed) return;
            api.reset();
            disposed = true;
        },
        get materialized() {
            return lru !== null;
        },
    });
    return api;
}
