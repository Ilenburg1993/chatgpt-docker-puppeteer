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

import { resolveBootWorkspaceRoot } from '#copilot/boot';
import { toError } from '#copilot/core/error-handlers';
import {
    deleteFileTrusted,
    readTextFreshTrusted,
    statPathTrusted,
    writeFileAtomicTrusted,
} from '#copilot/infra/public/filesystem/trusted';
import { isAbsolute, resolve } from 'node:path';
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
const CACHE_DEFAULT_RELATIVE_PATH = `data/copilot/sdk/models/${CACHE_FILE_NAME}`;
const CACHE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

/** @type {Promise<void>} */
let _persistentModelCacheMutationQueue = Promise.resolve();

/**
 * @param {() => Promise<void>} mutation
 * @returns {Promise<void>}
 */
function enqueuePersistentModelCacheMutation(mutation) {
    const queued = _persistentModelCacheMutationQueue.then(mutation);
    _persistentModelCacheMutationQueue = queued.catch(() => undefined);
    return queued;
}

/**
 * @returns {string}
 */
function resolvePersistentModelCacheFile() {
    const override = String(process.env['COPILOT_MODEL_PERSISTENT_CACHE_FILE'] ?? '').trim();
    const workspaceRoot = resolveBootWorkspaceRoot();
    if (override) return isAbsolute(override) ? override : resolve(workspaceRoot, override);
    return resolve(workspaceRoot, CACHE_DEFAULT_RELATIVE_PATH);
}

/**
 * @returns {string[]}
 */
function resolvePersistentModelCacheReadPaths() {
    const primary = resolvePersistentModelCacheFile();
    const legacy = resolvePersistentConfigFile(CACHE_FILE_NAME);
    return primary === legacy ? [primary] : [primary, legacy];
}

/**
 * @param {unknown} data
 * @returns {PersistentModelListCache | null}
 */
function parsePersistentModelCachePayload(data) {
    if (typeof data !== 'object' || data === null) {
        log('WARN', '[model-cache] Cache não é object');
        return null;
    }
    const payload = /** @type {Record<string, unknown>} */ (data);

    if (payload['version'] !== CACHE_SCHEMA_VERSION) {
        log('WARN', `[model-cache] Schema version mismatch: ${payload['version']} !== ${CACHE_SCHEMA_VERSION}`);
        return null;
    }

    if (!Array.isArray(payload['models'])) {
        log('WARN', '[model-cache] Cache models não é array');
        return null;
    }

    if (typeof payload['fetchedAt'] !== 'number' || !Number.isFinite(payload['fetchedAt'])) {
        log('WARN', '[model-cache] Cache fetchedAt inválido');
        return null;
    }

    if (typeof payload['schema'] !== 'string' || payload['schema'] !== 'ModelInfo[]') {
        log('WARN', '[model-cache] Cache schema inválido');
        return null;
    }

    return /** @type {PersistentModelListCache} */ (data);
}

/**
 * @param {string} cachePath
 * @returns {Promise<PersistentModelListCache | null | undefined>} `undefined` means cache miss.
 */
async function readPersistentModelCachePath(cachePath) {
    try {
        const content = (await readTextFreshTrusted(cachePath, { caller: 'sdk.models.persistent-cache' })).content;
        let data;
        try {
            data = JSON.parse(content);
        } catch {
            log('WARN', `[model-cache] Cache JSON invalido em ${cachePath}`);
            return null;
        }
        const parsed = parsePersistentModelCachePayload(data);
        if (parsed) log('DEBUG', `[model-cache] Cache lido: ${parsed.models.length} modelos`);
        return parsed;
    } catch (error) {
        const err = /** @type {NodeJS.ErrnoException} */ (error);
        if (err && typeof err === 'object' && err.code === 'ENOENT') return undefined;

        const errMsg = toError(error);
        log('DEBUG', `[model-cache] Leitura falhou: ${errMsg.message}`);
        return null;
    }
}

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
    for (const cachePath of resolvePersistentModelCacheReadPaths()) {
        const result = await readPersistentModelCachePath(cachePath);
        if (result !== undefined) return result;
    }
    return null;
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

    const modelsSnapshot = [...models];
    const writePromise = enqueuePersistentModelCacheMutation(async () => {
        try {
            const cachePath = resolvePersistentModelCacheFile();
            const now = Date.now();

            const data = /** @type {PersistentModelListCache} */ ({
                schema: 'ModelInfo[]',
                version: CACHE_SCHEMA_VERSION,
                fetchedAt: now,
                models: modelsSnapshot,
            });

            const json = JSON.stringify(data, null, 2);
            await writeFileAtomicTrusted(cachePath, json, { caller: 'sdk.models.persistent-cache', mode: 0o600 });
            log('DEBUG', `[model-cache] Cache persistido: ${modelsSnapshot.length} modelos`);
        } catch (error) {
            // Não re-lançar — graceful degrade para L1-only cache
            const err = toError(error);
            log('WARN', `[model-cache] Persistência falhou: ${err.message}`);
        }
    });
    void writePromise;
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
    await enqueuePersistentModelCacheMutation(async () => {
        for (const cachePath of resolvePersistentModelCacheReadPaths()) {
            try {
                const removed = await deleteFileTrusted(cachePath, {
                    caller: 'sdk.models.persistent-cache',
                    ignoreMissing: true,
                });
                if (removed) log('DEBUG', '[model-cache] Cache persistido deletado');
            } catch (error) {
                const err = /** @type {NodeJS.ErrnoException} */ (error);
                if (!(err && typeof err === 'object' && err.code === 'ENOENT')) {
                    const errMsg = toError(error);
                    log('DEBUG', `[model-cache] Clear persistência: ${errMsg.message}`);
                }
            }
        }
    });
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
        const cachePath = resolvePersistentModelCacheFile();
        const stat = (await statPathTrusted(cachePath, { caller: 'sdk.models.persistent-cache' })).stats;
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
