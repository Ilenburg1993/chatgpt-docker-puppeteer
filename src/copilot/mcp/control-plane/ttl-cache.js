// @ts-check
/**
 * Small in-memory TTL cache with in-flight de-duplication for MCP control-plane paths.
 *
 * The cache is intentionally process-local, bounded and dependency-free. It is appropriate for short-lived diagnostics,
 * metadata fetches and other idempotent read paths where repeated calls happen in bursts. It must not be used for
 * authorization decisions that require immediate revocation unless the caller chooses a suitably tiny TTL or
 * force-refreshes.
 *
 * @module copilot/mcp/control-plane/ttl-cache
 */

/** @type {Set<TtlCache<unknown>>} */
const ttlCacheRegistry = new Set();

/**
 * @template T
 * @typedef {object} TtlCacheEntry
 * @property {number} expiresAt
 * @property {T} value
 */

/**
 * @template T
 * @typedef {object} TtlInFlightEntry
 * @property {Promise<T>} promise
 */

/**
 * @typedef {object} TtlCacheOptions
 * @property {string} name
 * @property {number} ttlMs
 * @property {number} [maxEntries]
 * @property {(key: string) => void} [onEvict]
 */

/**
 * @template T
 */
export class TtlCache {
    /**
     * @param {TtlCacheOptions} options
     */
    constructor(options) {
        this.name = options.name;
        this.ttlMs = normalizeTtlMs(options.ttlMs);
        this.maxEntries = normalizeMaxEntries(options.maxEntries);
        this.onEvict = options.onEvict;
        /** @type {Map<string, TtlCacheEntry<T>>} */
        this.entries = new Map();
        /** @type {Map<string, TtlInFlightEntry<T>>} */
        this.inFlight = new Map();
        this.hits = 0;
        this.misses = 0;
        this.inFlightHits = 0;
        this.sets = 0;
        this.evictions = 0;
    }

    /**
     * @param {string} key
     * @param {{ now?: number; forceRefresh?: boolean }} [options]
     * @returns {T | null}
     */
    get(key, options = {}) {
        if (options.forceRefresh === true || this.ttlMs <= 0) {
            this.misses += 1;
            return null;
        }
        const now = options.now ?? Date.now();
        const entry = this.entries.get(key);
        if (!entry) {
            this.misses += 1;
            return null;
        }
        if (entry.expiresAt <= now) {
            this.delete(key);
            this.misses += 1;
            return null;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        this.hits += 1;
        return entry.value;
    }

    /**
     * @param {string} key
     * @param {T} value
     * @param {{ now?: number; ttlMs?: number }} [options]
     * @returns {T}
     */
    set(key, value, options = {}) {
        const ttlMs = normalizeTtlMs(options.ttlMs ?? this.ttlMs);
        if (ttlMs <= 0) return value;
        if (this.entries.has(key)) this.entries.delete(key);
        this.entries.set(key, {
            value,
            expiresAt: (options.now ?? Date.now()) + ttlMs,
        });
        this.sets += 1;
        this.prune(options.now ?? Date.now());
        return value;
    }

    /**
     * @param {string} key
     * @returns {boolean}
     */
    delete(key) {
        const deleted = this.entries.delete(key);
        this.inFlight.delete(key);
        if (deleted) {
            this.evictions += 1;
            this.onEvict?.(key);
        }
        return deleted;
    }

    /** @returns {void} */
    clear() {
        for (const key of this.entries.keys()) this.onEvict?.(key);
        this.evictions += this.entries.size;
        this.entries.clear();
        this.inFlight.clear();
    }

    /**
     * @param {string} key
     * @param {() => Promise<T>} loader
     * @param {{ forceRefresh?: boolean; ttlMs?: number }} [options]
     * @returns {Promise<T>}
     */
    async getOrLoad(key, loader, options = {}) {
        const cached = this.get(key, { forceRefresh: options.forceRefresh === true });
        if (cached !== null) return cached;
        if (options.forceRefresh !== true) {
            const existing = this.inFlight.get(key);
            if (existing) {
                this.inFlightHits += 1;
                return existing.promise;
            }
        }
        const promise = Promise.resolve()
            .then(loader)
            .then(
                (value) => {
                    this.inFlight.delete(key);
                    return this.set(key, value, options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs });
                },
                (error) => {
                    this.inFlight.delete(key);
                    throw error;
                },
            );
        this.inFlight.set(key, { promise });
        return promise;
    }

    /**
     * @param {number} [now]
     * @returns {void}
     */
    prune(now = Date.now()) {
        for (const [key, entry] of this.entries.entries()) {
            if (entry.expiresAt <= now) this.delete(key);
        }
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (typeof oldest !== 'string') break;
            this.delete(oldest);
        }
    }

    /**
     * @returns {{
     *     name: string;
     *     ttlMs: number;
     *     maxEntries: number;
     *     size: number;
     *     inFlight: number;
     *     hits: number;
     *     misses: number;
     *     inFlightHits: number;
     *     sets: number;
     *     evictions: number;
     * }}
     */
    stats() {
        return {
            name: this.name,
            ttlMs: this.ttlMs,
            maxEntries: this.maxEntries,
            size: this.entries.size,
            inFlight: this.inFlight.size,
            hits: this.hits,
            misses: this.misses,
            inFlightHits: this.inFlightHits,
            sets: this.sets,
            evictions: this.evictions,
        };
    }
}

/**
 * @template T
 * @param {TtlCacheOptions} options
 * @returns {TtlCache<T>}
 */
export function createTtlCache(options) {
    const cache = new TtlCache(options);
    ttlCacheRegistry.add(/** @type {TtlCache<unknown>} */ (cache));
    return cache;
}

/**
 * @returns {{
 *     name: string;
 *     ttlMs: number;
 *     maxEntries: number;
 *     size: number;
 *     inFlight: number;
 *     hits: number;
 *     misses: number;
 *     inFlightHits: number;
 *     sets: number;
 *     evictions: number;
 * }[]}
 */
export function getTtlCacheStats() {
    return Array.from(ttlCacheRegistry, (cache) => cache.stats()).sort((left, right) =>
        left.name.localeCompare(right.name),
    );
}

/**
 * @param {number} value
 * @returns {number}
 */
function normalizeTtlMs(value) {
    return Number.isFinite(value) && value >= 0 && value <= 60 * 60 * 1000 ? Math.floor(value) : 0;
}

/**
 * @param {number | undefined} value
 * @returns {number}
 */
function normalizeMaxEntries(value) {
    return Number.isFinite(value) && Number(value) > 0 && Number(value) <= 100_000 ? Math.floor(Number(value)) : 256;
}
