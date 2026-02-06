import { sha256HexForString } from '../contract.mjs';

/**
 * LRU cache for query embeddings
 * Avoids re-embedding common queries (saves ~100-300ms per cached hit)
 *
 * @example
 * const cache = new EmbeddingCache(100);
 * const vector = cache.get(query, model);
 * if (!vector) {
 *   vector = await embeddings.embed(query);
 *   cache.set(query, model, vector);
 * }
 */
export class EmbeddingCache {
    constructor(maxSize = 100) {
        this.cache = new Map(); // key: sha256(query+model), value: { vector, model, timestamp }
        this.maxSize = maxSize;
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get cached embedding vector for a query
     * @param {string} query - The query text
     * @param {string} model - The embedding model name
     * @returns {number[]|null} Cached vector or null if not found
     */
    get(query, model) {
        const key = sha256HexForString(`${query}::${model}`);
        if (this.cache.has(key)) {
            this.hits++;
            const entry = this.cache.get(key);
            // Move to end (LRU touch)
            this.cache.delete(key);
            this.cache.set(key, entry);
            return entry.vector;
        }
        this.misses++;
        return null;
    }

    /**
     * Store embedding vector in cache
     * @param {string} query - The query text
     * @param {string} model - The embedding model name
     * @param {number[]} vector - The embedding vector
     */
    set(query, model, vector) {
        const key = sha256HexForString(`${query}::${model}`);
        if (this.cache.size >= this.maxSize) {
            // Remove oldest (first entry)
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, { vector, model, timestamp: Date.now() });
    }

    /**
     * Get cache statistics
     * @returns {Object} Stats object with size, hits, misses, hitRate
     */
    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: this.hits / (this.hits + this.misses) || 0
        };
    }

    /**
     * Clear all cached entries
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
}
