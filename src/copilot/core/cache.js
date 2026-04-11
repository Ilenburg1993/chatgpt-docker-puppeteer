// @ts-check
/**
 * src/copilot/core/cache.js
 *
 * Cache LRU simples e determinístico em memória. Suporta TTL opcional por entrada e tamanho máximo
 * configurável. Substitui os múltiplos `new Map()` inline usados como caches ad-hoc no código.
 *
 * Uso:
 * ```js
 * const cache = createCache({ maxSize: 500, defaultTtlMs: 60_000 });
 * cache.set('key', value);
 * const val = cache.get('key'); // null se expirado ou ausente
 * cache.delete('key');
 * cache.clear();
 * ```
 *
 * @module copilot/core/cache
 */

/**
 * @template V
 * @typedef {object} CacheEntry
 * @property {V} value - Valor armazenado
 * @property {number} expiresAt - Timestamp de expiração (0 = sem TTL)
 */

/**
 * @template V
 * @typedef {object} Cache
 * @property {(key: string, value: V, ttlMs?: number) => void} set
 * @property {(key: string) => V | null} get
 * @property {(key: string) => boolean} has
 * @property {(key: string) => boolean} delete
 * @property {() => void} clear
 * @property {() => number} size
 * @property {() => CacheStats} stats
 */

/**
 * @typedef {object} CacheStats
 * @property {number} size - Entradas atuais no cache
 * @property {number} hits - Cache hits desde criação
 * @property {number} misses - Cache misses desde criação
 * @property {number} evictions - Evicções por LRU ou TTL
 */

/**
 * @typedef {object} CacheOptions
 * @property {number} [maxSize=1000] - Máximo de entradas antes de evicção LRU. Default is `1000`
 * @property {number} [defaultTtlMs=0] - TTL padrão em ms (0 = sem TTL). Default is `0`
 */

/**
 * Cria um cache LRU com TTL opcional.
 *
 * @template V
 * @param {CacheOptions} [options]
 * @returns {Cache<V>}
 */
export function createCache(options = {}) {
    const maxSize = options.maxSize ?? 1000;
    const defaultTtlMs = options.defaultTtlMs ?? 0;

    /** @type {Map<string, CacheEntry<V>>} */
    const _store = new Map();

    let _hits = 0;
    let _misses = 0;
    let _evictions = 0;

    /**
     * Remove a entrada mais antiga (LRU) quando o cache está cheio.
     */
    function _evictLru() {
        const firstKey = _store.keys().next().value;
        if (firstKey !== undefined) {
            _store.delete(firstKey);
            _evictions++;
        }
    }

    return {
        /**
         * Armazena um valor no cache.
         *
         * @param {string} key
         * @param {V} value
         * @param {number} [ttlMs] - TTL em ms para esta entrada (sobreescreve o padrão)
         */
        set(key, value, ttlMs) {
            // Re-inserção move o item para o fim (mais recente) no Map
            if (_store.has(key)) {
                _store.delete(key);
            } else if (_store.size >= maxSize) {
                _evictLru();
            }
            const ttl = ttlMs ?? defaultTtlMs;
            _store.set(key, {
                value,
                expiresAt: ttl > 0 ? Date.now() + ttl : 0,
            });
        },

        /**
         * Retorna o valor associado à chave, ou `null` se ausente ou expirado.
         *
         * @param {string} key
         * @returns {V | null}
         */
        get(key) {
            const entry = _store.get(key);
            if (!entry) {
                _misses++;
                return null;
            }
            if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
                _store.delete(key);
                _evictions++;
                _misses++;
                return null;
            }
            // Move para o fim (mais recente)
            _store.delete(key);
            _store.set(key, entry);
            _hits++;
            return entry.value;
        },

        /**
         * Retorna true se a chave existe e não está expirada.
         *
         * @param {string} key
         * @returns {boolean}
         */
        has(key) {
            const entry = _store.get(key);
            if (!entry) return false;
            if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
                _store.delete(key);
                _evictions++;
                return false;
            }
            return true;
        },

        /**
         * Remove uma entrada do cache.
         *
         * @param {string} key
         * @returns {boolean} true se existia e foi removida
         */
        delete(key) {
            return _store.delete(key);
        },

        /**
         * Limpa todas as entradas do cache.
         */
        clear() {
            _store.clear();
        },

        /**
         * Número de entradas armazenadas.
         *
         * @returns {number}
         */
        size() {
            return _store.size;
        },

        /**
         * Retorna estatísticas de uso do cache.
         *
         * @returns {CacheStats}
         */
        stats() {
            return { size: _store.size, hits: _hits, misses: _misses, evictions: _evictions };
        },
    };
}
