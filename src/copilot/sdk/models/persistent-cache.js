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
import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { toError } from '#copilot/infra/public/platform/error';
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

/**
 * Resolve an immutable persistence binding from bootstrap configuration. Production calls this once; alternate stores
 * must carry their own already-authorized IO instead of changing process env between operations.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [workspaceRoot]
 */
export function resolvePersistentModelCacheBinding(env = process.env, workspaceRoot = resolveBootWorkspaceRoot()) {
    const override = String(env['COPILOT_MODEL_PERSISTENT_CACHE_FILE'] ?? '').trim();
    const primaryPath = override
        ? isAbsolute(override)
            ? override
            : resolve(workspaceRoot, override)
        : resolve(workspaceRoot, CACHE_DEFAULT_RELATIVE_PATH);
    const legacyPath = resolvePersistentConfigFile(CACHE_FILE_NAME);
    return Object.freeze({
        primaryPath,
        legacyPath,
        readPaths: Object.freeze(primaryPath === legacyPath ? [primaryPath] : [primaryPath, legacyPath]),
    });
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
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 * @returns {Promise<PersistentModelListCache | null | undefined>} `undefined` means cache miss.
 */
async function readPersistentModelCachePath(cachePath, io) {
    try {
        const content = (await io.readTextFresh(cachePath)).content;
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
 * @param {{
 *     primaryPath: string;
 *     legacyPath: string;
 *     primaryIo: ReturnType<typeof createConfiguredFsIo>;
 *     legacyIo: ReturnType<typeof createConfiguredFsIo>;
 * }} binding
 */
export function createPersistentModelCacheStore(binding) {
    const primaryPath = resolve(binding.primaryPath);
    const legacyPath = resolve(binding.legacyPath);
    const readTargets =
        primaryPath === legacyPath
            ? [{ path: primaryPath, io: binding.primaryIo }]
            : [
                  { path: primaryPath, io: binding.primaryIo },
                  { path: legacyPath, io: binding.legacyIo },
              ];
    /** @type {Promise<void>} */
    let mutationQueue = Promise.resolve();

    /** @param {() => Promise<void>} mutation */
    function enqueueMutation(mutation) {
        const queued = mutationQueue.then(mutation);
        mutationQueue = queued.catch(() => undefined);
        return queued;
    }

    return Object.freeze({
        primaryPath,
        legacyPath,
        async read() {
            for (const target of readTargets) {
                const result = await readPersistentModelCachePath(target.path, target.io);
                if (result !== undefined) return result;
            }
            return null;
        },
        /** @param {ModelInfo[]} models */
        writeAsync(models) {
            if (!Array.isArray(models)) {
                log('WARN', '[model-cache] writePersistentModelCacheAsync: models não é array');
                return;
            }
            const modelsSnapshot = [...models];
            const writePromise = enqueueMutation(async () => {
                try {
                    const data = /** @type {PersistentModelListCache} */ ({
                        schema: 'ModelInfo[]',
                        version: CACHE_SCHEMA_VERSION,
                        fetchedAt: Date.now(),
                        models: modelsSnapshot,
                    });
                    await binding.primaryIo.writeFileAtomic(primaryPath, JSON.stringify(data, null, 2), {
                        mode: 0o600,
                    });
                    log('DEBUG', `[model-cache] Cache persistido: ${modelsSnapshot.length} modelos`);
                } catch (error) {
                    const err = toError(error);
                    log('WARN', `[model-cache] Persistência falhou: ${err.message}`);
                }
            });
            void writePromise;
        },
        async clear() {
            await enqueueMutation(async () => {
                for (const target of readTargets) {
                    try {
                        const removed = await target.io.deleteFile(target.path, { ignoreMissing: true });
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
        },
        async diagnostics() {
            try {
                const stat = (await binding.primaryIo.statPath(primaryPath)).stats;
                const ageHours = Math.floor((Date.now() - stat.mtime.getTime()) / (60 * 60 * 1000));
                return { exists: true, size: stat.size, age: `${ageHours}h` };
            } catch {
                return { exists: false };
            }
        },
    });
}

const DEFAULT_PERSISTENT_MODEL_CACHE_BINDING = resolvePersistentModelCacheBinding();
const DEFAULT_PERSISTENT_MODEL_CACHE_PRIMARY_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'sdk.models.persistent-cache.primary',
        exactPaths: [DEFAULT_PERSISTENT_MODEL_CACHE_BINDING.primaryPath],
        operations: ['delete', 'read', 'stat', 'write'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);
const DEFAULT_PERSISTENT_MODEL_CACHE_LEGACY_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'sdk.models.persistent-cache.legacy',
        exactPaths: [DEFAULT_PERSISTENT_MODEL_CACHE_BINDING.legacyPath],
        operations: ['delete', 'read'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);
const DEFAULT_PERSISTENT_MODEL_CACHE_STORE = createPersistentModelCacheStore({
    ...DEFAULT_PERSISTENT_MODEL_CACHE_BINDING,
    primaryIo: DEFAULT_PERSISTENT_MODEL_CACHE_PRIMARY_IO,
    legacyIo: DEFAULT_PERSISTENT_MODEL_CACHE_LEGACY_IO,
});

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
    return DEFAULT_PERSISTENT_MODEL_CACHE_STORE.read();
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
    DEFAULT_PERSISTENT_MODEL_CACHE_STORE.writeAsync(models);
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
    await DEFAULT_PERSISTENT_MODEL_CACHE_STORE.clear();
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
    return DEFAULT_PERSISTENT_MODEL_CACHE_STORE.diagnostics();
}
