// @ts-check
/** L1 LRU state machine: storage, counters and active path/subtree invalidation. */
import { LRUCache } from 'lru-cache';
import * as nodePath from 'node:path';
import { normalizeIoCacheKey } from './keys.js';
import {
    IO_L1_HASH_REVALIDATE_MAX_BYTES,
    IO_L1_MAX_BYTES,
    IO_L1_MAX_ENTRIES,
    IO_L1_STALE_PROBE_INTERVAL_MS,
    IO_L1_TTL_MS,
} from './l1-policy.js';
import { verifyIoL1EntrySnapshot } from './l1-verifier.js';
/** @typedef {import('./cache-types.js').IoCacheEntry} IoCacheEntry */
/** @typedef {import('./cache-types.js').IoCacheStats} IoCacheStats */
/** @typedef {import('./cache-types.js').IoL1Cache} IoL1Cache */

/** @type {IoL1Cache|null} */ let instance = null;
/** Increment access count without creating another cache set/touch operation. @param {IoCacheEntry} entry */
function recordEntryAccess(entry) {
    entry.accessCount = (entry.accessCount ?? 0) + 1;
}

/** @returns {IoL1Cache} */
export function getIoL1Cache() {
    if (instance) return instance;
    let hits = 0,
        misses = 0,
        evictions = 0,
        invalidations = 0,
        staleHits = 0,
        hashRevalidations = 0,
        hashRevalidationHits = 0;
    /** @type {LRUCache<string,IoCacheEntry>} */
    const lru = new LRUCache(
        Object.assign(
            {
                max: IO_L1_MAX_ENTRIES,
                maxSize: IO_L1_MAX_BYTES,
                sizeCalculation: /** @param {IoCacheEntry} e */ (e) => e.bytes || 1,
                dispose: /** @param {IoCacheEntry} _e @param {string} _k @param {string} reason */ (_e, _k, reason) => {
                    if (reason === 'evict' || reason === 'expire') evictions += 1;
                },
                allowStale: false,
                updateAgeOnGet: true,
            },
            IO_L1_TTL_MS > 0 ? { ttl: IO_L1_TTL_MS, ttlAutopurge: false } : {},
        ),
    );
    instance = {
        get(key) {
            const entry = lru.get(key);
            if (entry === undefined) {
                misses += 1;
                return null;
            }
            hits += 1;
            recordEntryAccess(entry);
            return entry;
        },
        async getVerified(key, filePath) {
            const entry = lru.get(key);
            if (entry === undefined) {
                misses += 1;
                return null;
            }
            const verification = await verifyIoL1EntrySnapshot(entry, filePath);
            if (verification.hashRevalidated) hashRevalidations += 1;
            if (verification.hashRevalidationHit) hashRevalidationHits += 1;
            if (!verification.fresh) {
                lru.delete(key);
                staleHits += 1;
                misses += 1;
                return null;
            }
            hits += 1;
            recordEntryAccess(entry);
            return entry;
        },
        set(key, entry) {
            lru.set(key, entry);
        },
        invalidate(filePath, options = {}) {
            const normalized = normalizeIoCacheKey(filePath);
            const prefix = `${normalized}::`;
            const subtreePrefix = `${normalized}${nodePath.sep}`;
            /** @type {string[]} */ const keys = [];
            for (const key of lru.keys())
                if (key.startsWith(prefix) || (options.recursive === true && key.startsWith(subtreePrefix)))
                    keys.push(key);
            for (const key of keys) {
                lru.delete(key);
                invalidations += 1;
            }
        },
        stats() {
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
                ttlMs: IO_L1_TTL_MS,
                staleProbeIntervalMs: IO_L1_STALE_PROBE_INTERVAL_MS,
                hashRevalidateMaxBytes: IO_L1_HASH_REVALIDATE_MAX_BYTES,
            };
        },
        clear() {
            lru.clear();
            hits = 0;
            misses = 0;
            evictions = 0;
            invalidations = 0;
            staleHits = 0;
            hashRevalidations = 0;
            hashRevalidationHits = 0;
        },
    };
    return instance;
}
/** @param {string} filePath */ export function invalidateIoCachePath(filePath) {
    getIoL1Cache().invalidate(filePath);
}
/** @param {string} filePath */ export function invalidateIoCacheSubtree(filePath) {
    getIoL1Cache().invalidate(filePath, { recursive: true });
}
/** @param {string} key @param {string} filePath */ export function getVerifiedIoL1Entry(key, filePath) {
    return getIoL1Cache().getVerified(key, filePath);
}
/** @returns {IoCacheStats|null} */ export function getIoCacheStats() {
    return instance ? instance.stats() : null;
}
/** Test-control leaf target; not exported from the runtime memory barrel. */
export function resetIoL1CacheForTest() {
    if (instance) instance.clear();
    instance = null;
}
