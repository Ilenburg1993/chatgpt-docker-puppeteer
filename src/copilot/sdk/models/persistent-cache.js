// @ts-check
/**
 * src/copilot/sdk/models/persistent-cache.js
 *
 * Core I/O layer para persistent disk cache de model list.
 *
 * **Fase 3.3 Optimization #2**: Armazena modelo list em disk (24h TTL) como fallback para outages de rede. Implementa
 * leitura segura e escrita não-bloqueante.
 *
 * @module copilot/sdk/models/persistent-cache
 */

import { toError } from '#copilot/core/error-handlers';
import { promises as fs } from 'node:fs';
import { log } from '../logger.js';
import { resolvePersistentConfigFile } from '../persistent-paths.js';

/**
 * @typedef {import('@github/copilot-sdk').ModelInfo} ModelInfo
 *
 * @typedef {object} PersistentModelListCache
 * @property {string} schema - "ModelInfo[]" (for validation)
 * @property {number} version - 2 (for schema versioning)
 * @property {number} fetchedAt - timestamp ms when cached
 * @property {ModelInfo[]} models
 *
 * @typedef {object} ModelListFallbackResult
 * @property {ModelInfo[]} models
 * @property {boolean} isStale - true if > 24h old
 * @property {number} ageMs - milliseconds since fetch
 */

const CACHE_SCHEMA_VERSION = 2;
const CACHE_FILE_NAME = 'modellist-cache.json';
const CACHE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Ler cache persistente do disk de forma segura.
 *
 * Nunca re-lança erros — qualquer falha retorna null (cache miss). Valida schema, version, e estrutura de dados antes
 * de usar.
 *
 * @example
 *     const cached = await readPersistentModelCache();
 *     if (cached) {
 *         const { models, fetchedAt } = cached;
 *     }
 *
 * @returns {Promise<PersistentModelListCache | null>}
 */
export async function readPersistentModelCache() {
    try {
        const cachePath = resolvePersistentConfigFile(CACHE_FILE_NAME);
        const content = await fs.readFile(cachePath, 'utf8');

        // Parse defensivo
        let data;
        try {
            data = JSON.parse(content);
        } catch {
            log('WARN', `[model-cache] Cache JSON invalido em ${CACHE_FILE_NAME}`);
            return null;
        }

        // Validar estructura
        if (typeof data !== 'object' || data === null) {
            log('WARN', '[model-cache] Cache não é object');
            return null;
        }

        if (data.version !== CACHE_SCHEMA_VERSION) {
            log('WARN', `[model-cache] Schema version mismatch: ${data.version} !== ${CACHE_SCHEMA_VERSION}`);
            return null;
        }

        if (!Array.isArray(data.models)) {
            log('WARN', '[model-cache] Cache models não é array');
            return null;
        }

        if (typeof data.fetchedAt !== 'number' || !Number.isFinite(data.fetchedAt)) {
            log('WARN', '[model-cache] Cache fetchedAt inválido');
            return null;
        }

        if (typeof data.schema !== 'string' || data.schema !== 'ModelInfo[]') {
            log('WARN', '[model-cache] Cache schema inválido');
            return null;
        }

        log('DEBUG', `[model-cache] Cache lido: ${data.models.length} modelos`);
        return /** @type {PersistentModelListCache} */ (data);
    } catch (error) {
        // ENOENT (file not found) é normal, não logar
        const err = /** @type {NodeJS.ErrnoException} */ (error);
        if (err && typeof err === 'object' && err.code === 'ENOENT') {
            return null;
        }

        // Outras erros (permission, I/O) logar como debug
        const errMsg = toError(error);
        log('DEBUG', `[model-cache] Leitura falhou: ${errMsg.message}`);
        return null;
    }
}

/**
 * Escrever cache persistente para disk de forma não-bloqueante.
 *
 * Fire-and-forget async operation. Erros são logados mas não re-lançados. Não aguarda conclusão — permite execução
 * paralela com outro I/O.
 *
 * @example
 *     writePersistentModelCacheAsync(models); // Fire-and-forget
 *     // Outras operações continuam enquanto escreve em background
 *
 * @param {ModelInfo[]} models
 * @returns {void}
 */
export function writePersistentModelCacheAsync(models) {
    if (!Array.isArray(models)) {
        log('WARN', '[model-cache] writePersistentModelCacheAsync: models não é array');
        return;
    }

    // Fire-and-forget: não await, não bloqueia
    // Use void para indicar Promise ignorada intencionalmente
    void (async () => {
        try {
            const cachePath = resolvePersistentConfigFile(CACHE_FILE_NAME);
            const now = Date.now();

            const data = /** @type {PersistentModelListCache} */ ({
                schema: 'ModelInfo[]',
                version: CACHE_SCHEMA_VERSION,
                fetchedAt: now,
                models,
            });

            const json = JSON.stringify(data, null, 2);
            await fs.writeFile(cachePath, json, 'utf8');
            log('DEBUG', `[model-cache] Cache persistido: ${models.length} modelos`);
        } catch (error) {
            // Não re-lançar — graceful degrade para L1-only cache
            const err = toError(error);
            log('WARN', `[model-cache] Persistência falhou: ${err.message}`);
        }
    })();
}

/**
 * Limpar cache persistente do disk.
 *
 * Usado por `clearModelsCache()` para reset completo (L1 + L2). Erros ao deletar são ignorados gracefully.
 *
 * @example
 *     await clearPersistentModelCache();
 *
 * @returns {Promise<void>}
 */
export async function clearPersistentModelCache() {
    try {
        const cachePath = resolvePersistentConfigFile(CACHE_FILE_NAME);
        await fs.unlink(cachePath);
        log('DEBUG', '[model-cache] Cache persistido deletado');
    } catch (error) {
        // ENOENT = file already gone, ok
        const err = /** @type {NodeJS.ErrnoException} */ (error);
        if (!(err && typeof err === 'object' && err.code === 'ENOENT')) {
            const errMsg = toError(error);
            log('DEBUG', `[model-cache] Clear persistência: ${errMsg.message}`);
        }
    }
}

/**
 * Checar se cache persistente é ainda utilizável (não muito stale).
 *
 * @param {PersistentModelListCache} cache
 * @returns {ModelListFallbackResult}
 */
export function evaluatePersistentCache(cache) {
    const now = Date.now();
    const ageMs = now - cache.fetchedAt;
    const isStale = ageMs > CACHE_STALE_THRESHOLD_MS;

    return {
        models: cache.models,
        isStale,
        ageMs,
    };
}

/**
 * Obter info diagnostico do cache persistente.
 *
 * @returns {Promise<{ exists: boolean; size?: number; age?: string }>}
 */
export async function getPersistentCacheDiagnostics() {
    try {
        const cachePath = resolvePersistentConfigFile(CACHE_FILE_NAME);
        const stat = await fs.stat(cachePath);
        const ageMs = Date.now() - stat.mtime.getTime();
        const ageHours = Math.floor(ageMs / (60 * 60 * 1000));

        return {
            exists: true,
            size: stat.size,
            age: `${ageHours}h`,
        };
    } catch {
        return { exists: false };
    }
}
