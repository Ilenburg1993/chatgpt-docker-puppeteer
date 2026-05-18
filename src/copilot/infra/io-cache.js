// @ts-check
/**
 * src/copilot/infra/io-cache.js
 *
 * Cache L1 em memória para operações de leitura do io-engine.
 *
 * Design:
 *
 * - Singleton via `getIoL1Cache()` — uma instância compartilhada por processo.
 * - Motor: `lru-cache` (LRUCache) com TTL nativo, LRU por size em bytes e dispose callback.
 * - Chave: `{normalizedPath}::{operationTag}` — distingue bytes vs text vs range.
 * - TTL padrão: 60s. Ajustável via `IO_L1_CACHE_TTL_MS` (env).
 * - Limite de memória: 128 MiB por padrão. Ajustável via `IO_L1_CACHE_MAX_BYTES` (env).
 * - Invalidação ativa por prefixo: toda escrita, delete, move ou patch invalida TODAS as entradas do path (bytes + text +
 *   ranges).
 * - Stats: hits, misses, evictions, invalidations, bytesStored (via `cache.calculatedSize`).
 * - Fingerprint (mtime+size): detecta arquivos modificados externamente sem depender só do TTL.
 * - Stale-probe: a cada `IO_L1_STALE_PROBE_INTERVAL_MS` (padrão 2s) re-valida a entrada com stat() leve.
 *
 * @module copilot/infra/io-cache
 */

import { LRUCache } from 'lru-cache';
import * as fsPromises from 'node:fs/promises';
import * as nodePath from 'node:path';
import { normalizeIoCacheKey } from './cache/l1/index.js';
import { publishIoInvalidation, registerIoInvalidationHook } from './io/invalidation/bus.js';
import { fingerprintMatches } from './shared/fingerprint-match.js';
import { sha256 } from './shared/hash.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** TTL padrão do cache L1 (ms). Pode ser sobrescrito via env `IO_L1_CACHE_TTL_MS`. */
const DEFAULT_TTL_MS = Number(process.env['IO_L1_CACHE_TTL_MS'] ?? 60_000);

/** Tamanho máximo do cache L1 (entradas). */
const DEFAULT_MAX_ENTRIES = Number(process.env['IO_L1_CACHE_MAX_ENTRIES'] ?? 2_000);

/** Limite de memória do cache L1 (bytes). Padrão: 128 MiB. */
const DEFAULT_MAX_BYTES = Number(process.env['IO_L1_CACHE_MAX_BYTES'] ?? 128 * 1024 * 1024);

/** Limite para revalidação por hash quando mtime diverge mas size segue igual. */
const DEFAULT_HASH_REVALIDATE_MAX_BYTES = Number(process.env['IO_L1_HASH_REVALIDATE_MAX_BYTES'] ?? 1024 * 1024);

/**
 * Intervalo mínimo entre validações de fingerprint (stat) para o mesmo arquivo. Padrão: 2000ms. Ajustável via
 * `IO_L1_STALE_PROBE_INTERVAL_MS`. 0 = sempre valida (modo paranoico). -1 = nunca valida (desativa fingerprint).
 */
const STALE_PROBE_INTERVAL_MS = Number(process.env['IO_L1_STALE_PROBE_INTERVAL_MS'] ?? 2_000);

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {object} IoCacheEntry
 * @property {Buffer | string} content - Conteúdo armazenado (Buffer para bytes, string para text).
 * @property {number} bytes - Tamanho em bytes do conteúdo.
 * @property {number} cachedAt - Timestamp (ms) de quando foi armazenado.
 * @property {number} [mtime] - Mtime do arquivo no momento do cache (ms). Usado para stale detection.
 * @property {number} [size] - Tamanho do arquivo no momento do cache (bytes). Complemento do mtime.
 * @property {number} [lastValidatedAt] - Última vez que o fingerprint foi validado (ms).
 * @property {number} [accessCount] - Contagem de acessos para TTL adaptativo.
 * @property {string} [contentHash] - SHA-256 do conteúdo completo cacheado, quando conhecido.
 * @property {string} [fingerprintStrategy] - Estratégia usada na última validação relevante.
 */

/**
 * @typedef {object} IoCacheStats
 * @property {number} hits - Cache hits desde criação ou último clear.
 * @property {number} misses - Cache misses desde criação ou último clear.
 * @property {number} evictions - Evicções (LRU ou TTL expirado).
 * @property {number} invalidations - Invalidações ativas por escrita/delete/move/patch.
 * @property {number} staleHits - Entradas invalidadas por fingerprint divergente (stale detection).
 * @property {number} hashRevalidations - Revalidações por hash após divergência de fingerprint leve.
 * @property {number} hashRevalidationHits - Entradas preservadas após revalidação por hash.
 * @property {number} size - Entradas atuais no cache.
 * @property {number} bytesStored - Total estimado de bytes armazenados no L1.
 * @property {number} ttlMs - TTL configurado.
 * @property {number} staleProbeIntervalMs - Intervalo de validação de fingerprint.
 * @property {number} hashRevalidateMaxBytes - Maior arquivo elegível para revalidação por hash.
 */

/**
 * @typedef {object} IoL1Cache
 * @property {(key: string) => IoCacheEntry | null} get
 * @property {(key: string, filePath: string) => Promise<IoCacheEntry | null>} getVerified
 * @property {(key: string, entry: IoCacheEntry) => void} set
 * @property {(filePath: string, options?: { recursive?: boolean }) => void} invalidate
 * @property {() => IoCacheStats} stats
 * @property {() => void} clear
 */

export { makeBytesKey, makeTextKey, normalizeIoCacheKey } from './cache/l1/index.js';

// ---------------------------------------------------------------------------
// Cache singleton — usa LRUCache (lru-cache) com TTL nativo e byte-accounting
// ---------------------------------------------------------------------------

/** @type {IoL1Cache | null} */
let _instance = null;

/**
 * Retorna o singleton L1 do io-cache. Cria na primeira chamada usando LRUCache como motor interno.
 *
 * @returns {IoL1Cache}
 */
export function getIoL1Cache() {
    if (_instance) return _instance;

    let _hits = 0;
    let _misses = 0;
    let _evictions = 0;
    let _invalidations = 0;
    let _staleHits = 0;
    let _hashRevalidations = 0;
    let _hashRevalidationHits = 0;

    /** @type {import('lru-cache').LRUCache<string, IoCacheEntry>} */
    const _lru = new LRUCache(
        Object.assign(
            {
                max: DEFAULT_MAX_ENTRIES,
                maxSize: DEFAULT_MAX_BYTES,
                sizeCalculation: /** @param {IoCacheEntry} e */ (e) => e.bytes || 1,
                dispose: /** @param {IoCacheEntry} _e @param {string} _k @param {string} reason */ (_e, _k, reason) => {
                    if (reason === 'evict' || reason === 'expire') _evictions++;
                },
                allowStale: false,
                updateAgeOnGet: true,
            },
            DEFAULT_TTL_MS > 0 ? { ttl: DEFAULT_TTL_MS, ttlAutopurge: false } : {},
        ),
    );

    /** @type {IoL1Cache} */
    const instance = {
        get(key) {
            const entry = _lru.get(key);
            if (entry === undefined) {
                _misses++;
                return null;
            }
            _hits++;
            if (entry.accessCount !== undefined) entry.accessCount++;
            else entry.accessCount = 1;
            return entry;
        },

        async getVerified(key, filePath) {
            const entry = _lru.get(key);
            if (entry === undefined) {
                _misses++;
                return null;
            }

            // Se fingerprint desativado ou sem mtime armazenado, comportamento legado
            if (STALE_PROBE_INTERVAL_MS < 0 || entry.mtime === undefined || entry.size === undefined) {
                _hits++;
                if (entry.accessCount !== undefined) entry.accessCount++;
                else entry.accessCount = 1;
                return entry;
            }

            const now = Date.now();
            const timeSinceValidation = now - (entry.lastValidatedAt ?? entry.cachedAt);

            // Dentro do intervalo de probe: retorna sem re-validar (fast path)
            if (timeSinceValidation < STALE_PROBE_INTERVAL_MS) {
                _hits++;
                if (entry.accessCount !== undefined) entry.accessCount++;
                else entry.accessCount = 1;
                return entry;
            }

            // Fora do intervalo: re-valida com stat() leve
            try {
                const stat = await fsPromises.stat(filePath);
                const currentMtime = stat.mtimeMs;
                const currentSize = stat.size;

                const isFresh = fingerprintMatches(
                    { mtimeMs: entry.mtime, sizeBytes: entry.size },
                    { mtimeMs: currentMtime, sizeBytes: currentSize },
                );

                if (!isFresh) {
                    const hashRevalidationEligible =
                        typeof entry.contentHash === 'string' &&
                        currentSize === entry.size &&
                        currentSize <= DEFAULT_HASH_REVALIDATE_MAX_BYTES;
                    if (hashRevalidationEligible) {
                        _hashRevalidations++;
                        try {
                            const actual = await fsPromises.readFile(filePath);
                            const actualHash = sha256(actual);
                            if (actualHash === entry.contentHash) {
                                entry.mtime = currentMtime;
                                entry.size = currentSize;
                                entry.lastValidatedAt = now;
                                entry.fingerprintStrategy = 'mtime-size-hash';
                                _hits++;
                                _hashRevalidationHits++;
                                if (entry.accessCount !== undefined) entry.accessCount++;
                                else entry.accessCount = 1;
                                return entry;
                            }
                        } catch {
                            // Mantém o caminho de stale abaixo.
                        }
                    }

                    // Arquivo modificado externamente → invalida a entrada
                    _lru.delete(key);
                    _staleHits++;
                    _misses++;
                    return null;
                }

                // Fingerprint válido: atualiza lastValidatedAt in-place (sem custo de set)
                entry.lastValidatedAt = now;
                entry.fingerprintStrategy = 'mtime-size';
                _hits++;
                if (entry.accessCount !== undefined) entry.accessCount++;
                else entry.accessCount = 1;
                return entry;
            } catch {
                // Arquivo pode ter sido deletado: invalida
                _lru.delete(key);
                _staleHits++;
                _misses++;
                return null;
            }
        },

        set(key, entry) {
            _lru.set(key, entry);
        },

        invalidate(filePath, options = {}) {
            const normalized = normalizeIoCacheKey(filePath);
            const prefix = `${normalized}::`;
            const subtreePrefix = `${normalized}${nodePath.sep}`;
            /** @type {string[]} */
            const keysToDelete = [];
            for (const k of _lru.keys()) {
                if (k.startsWith(prefix) || (options.recursive === true && k.startsWith(subtreePrefix))) {
                    keysToDelete.push(k);
                }
            }
            for (const k of keysToDelete) {
                _lru.delete(k);
                _invalidations++;
            }
        },

        stats() {
            return {
                hits: _hits,
                misses: _misses,
                evictions: _evictions,
                invalidations: _invalidations,
                staleHits: _staleHits,
                hashRevalidations: _hashRevalidations,
                hashRevalidationHits: _hashRevalidationHits,
                size: _lru.size,
                bytesStored: _lru.calculatedSize ?? 0,
                ttlMs: DEFAULT_TTL_MS,
                staleProbeIntervalMs: STALE_PROBE_INTERVAL_MS,
                hashRevalidateMaxBytes: DEFAULT_HASH_REVALIDATE_MAX_BYTES,
            };
        },

        clear() {
            _lru.clear();
            _hits = 0;
            _misses = 0;
            _evictions = 0;
            _invalidations = 0;
            _staleHits = 0;
            _hashRevalidations = 0;
            _hashRevalidationHits = 0;
        },
    };

    _instance = instance;
    return instance;
}

/**
 * Invalida entradas do cache L1 para o path dado. Utilitário de conveniência chamado pelo io-engine após
 * escritas/deletes/moves/patches.
 *
 * @param {string} filePath
 * @returns {void}
 */
export function invalidateIoCachePath(filePath) {
    getIoL1Cache().invalidate(filePath);
    publishIoInvalidation(filePath, { recursive: false, source: 'l1-cache' });
}

/**
 * Invalida entradas do cache L1 para um path e todos os filhos conhecidos. Deve ser usado por operações recursivas,
 * como `rm -r`, para manter L1/L2/índice coordenados mesmo quando o path exato é um diretório.
 *
 * @param {string} filePath
 * @returns {void}
 */
export function invalidateIoCacheSubtree(filePath) {
    getIoL1Cache().invalidate(filePath, { recursive: true });
    publishIoInvalidation(filePath, { recursive: true, source: 'l1-cache' });
}

/**
 * Wrapper de conveniência para `getVerified` — valida fingerprint mtime+size antes de retornar. Deve ser usado em lugar
 * de `getIoL1Cache().get()` em leituras que precisam de consistência forte.
 *
 * @param {string} key - Chave de cache (resultado de `makeBytesKey` ou `makeTextKey`).
 * @param {string} filePath - Path do arquivo (para stat de validação).
 * @returns {Promise<IoCacheEntry | null>}
 */
export function getVerifiedIoL1Entry(key, filePath) {
    return getIoL1Cache().getVerified(key, filePath);
}

/**
 * Registra um callback que será chamado toda vez que `invalidateIoCachePath` é invocado. Ideal para módulos externos
 * (ex: io-parser) invalidarem seus próprios caches sem acoplamento circular.
 *
 * @param {(filePath: string, event?: { recursive?: boolean }) => void} hook
 * @returns {() => void} Função de unregister.
 */
export function registerInvalidationHook(hook) {
    return registerIoInvalidationHook(hook);
}

/**
 * Retorna estatísticas do cache L1, ou null se ainda não inicializado.
 *
 * @returns {IoCacheStats | null}
 */
export function getIoCacheStats() {
    if (!_instance) return null;
    return _instance.stats();
}

/**
 * Limpa o singleton e zera contadores. Útil em testes para isolamento.
 *
 * @returns {void}
 */
export function resetIoL1CacheForTest() {
    if (_instance) _instance.clear();
    _instance = null;
}
