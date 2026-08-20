// @ts-check
/**
 * tests/unit/copilot/sdk/test_persistent_model_cache.spec.js
 *
 * Unit tests para persistent-cache.js e integração em helpers.js
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ioMocks = vi.hoisted(() => ({
    deleteFileTrusted: vi.fn(),
    readTextFreshTrusted: vi.fn(),
    statPathTrusted: vi.fn(),
    writeFileAtomicTrusted: vi.fn(),
}));

vi.mock('#copilot/infra/public/trusted-io', () => ({
    deleteFileTrusted: ioMocks.deleteFileTrusted,
    readTextFreshTrusted: ioMocks.readTextFreshTrusted,
    statPathTrusted: ioMocks.statPathTrusted,
    writeFileAtomicTrusted: ioMocks.writeFileAtomicTrusted,
}));

import {
    clearPersistentModelCache,
    evaluatePersistentCache,
    getPersistentCacheDiagnostics,
    readPersistentModelCache,
    writePersistentModelCacheAsync,
} from '../../../../src/copilot/sdk/models/persistent-cache.js';

describe('persistent-model-cache', () => {
    /** @type {string | undefined} */
    let originalPersistentCacheFile;

    beforeEach(async () => {
        vi.restoreAllMocks();
        ioMocks.deleteFileTrusted.mockReset();
        ioMocks.deleteFileTrusted.mockResolvedValue(null);
        ioMocks.readTextFreshTrusted.mockReset();
        ioMocks.readTextFreshTrusted.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        ioMocks.statPathTrusted.mockReset();
        ioMocks.statPathTrusted.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        ioMocks.writeFileAtomicTrusted.mockReset();
        ioMocks.writeFileAtomicTrusted.mockResolvedValue(undefined);
        originalPersistentCacheFile = process.env['COPILOT_MODEL_PERSISTENT_CACHE_FILE'];
        process.env['COPILOT_MODEL_PERSISTENT_CACHE_FILE'] =
            `data/copilot/test/persistent-model-cache-${process.pid}-${Date.now()}-${Math.random()
                .toString(16)
                .slice(2)}.json`;
        await clearPersistentModelCache();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        try {
            await clearPersistentModelCache();
        } catch {
            // Ignore cleanup errors
        }
        if (originalPersistentCacheFile === undefined) {
            delete process.env['COPILOT_MODEL_PERSISTENT_CACHE_FILE'];
        } else {
            process.env['COPILOT_MODEL_PERSISTENT_CACHE_FILE'] = originalPersistentCacheFile;
        }
    });

    describe('readPersistentModelCache', () => {
        it('retorna null quando arquivo não existe', async () => {
            const result = await readPersistentModelCache();
            expect(result).toBeNull();
        });

        it('retorna null para JSON invalido', async () => {
            ioMocks.readTextFreshTrusted.mockResolvedValueOnce({ content: '{ invalid json }' });

            const result = await readPersistentModelCache();
            expect(result).toBeNull();
        });

        it('retorna null para schema versão inválida', async () => {
            const invalidCache = {
                schema: 'ModelInfo[]',
                version: 999, // versão inválida
                fetchedAt: Date.now(),
                models: [],
            };
            ioMocks.readTextFreshTrusted.mockResolvedValueOnce({ content: JSON.stringify(invalidCache) });

            const result = await readPersistentModelCache();
            expect(result).toBeNull();
        });

        it('retorna null para models não-array', async () => {
            const invalidCache = {
                schema: 'ModelInfo[]',
                version: 2,
                fetchedAt: Date.now(),
                models: 'not-an-array',
            };
            ioMocks.readTextFreshTrusted.mockResolvedValueOnce({ content: JSON.stringify(invalidCache) });

            const result = await readPersistentModelCache();
            expect(result).toBeNull();
        });

        it('retorna cache válido com estrutura correta', async () => {
            const now = Date.now();
            const validCache = {
                schema: 'ModelInfo[]',
                version: 2,
                fetchedAt: now,
                models: [
                    {
                        modelId: 'gpt-4',
                        name: 'GPT-4',
                        costTier: 'high',
                        speedTier: 'high',
                    },
                ],
            };
            ioMocks.readTextFreshTrusted.mockResolvedValueOnce({ content: JSON.stringify(validCache) });

            const result = await readPersistentModelCache();
            expect(result).not.toBeNull();
            expect(result?.version).toBe(2);
            expect(result?.models).toHaveLength(1);
        });
    });

    describe('writePersistentModelCacheAsync', () => {
        it('ignora modelos não-array', async () => {
            writePersistentModelCacheAsync(/** @type {any} */ ('not-an-array'));
            await clearPersistentModelCache();
            expect(ioMocks.writeFileAtomicTrusted).not.toHaveBeenCalled();
        });

        it('escreve models válidos de forma async', async () => {
            const models = [
                /** @type {any} */ ({
                    modelId: 'gpt-4',
                    name: 'GPT-4',
                    costTier: 'high',
                    speedTier: 'high',
                }),
            ];
            writePersistentModelCacheAsync(models);
            await clearPersistentModelCache();

            expect(ioMocks.writeFileAtomicTrusted).toHaveBeenCalled();
            const call = ioMocks.writeFileAtomicTrusted.mock.calls[0];
            if (!call) {
                throw new Error('writeFileAtomicTrusted deveria ter sido chamado ao persistir models válidos');
            }
            expect(String(call[0])).toContain('data/copilot/test/persistent-model-cache-');
            const payload = call[1];
            const written = JSON.parse(/** @type {string} */ (payload));
            expect(written.version).toBe(2);
            expect(written.models).toHaveLength(1);
            expect(call[2]).toEqual({ caller: 'sdk.models.persistent-cache', mode: 0o600 });
        });

        it('serializa writes concorrentes na ordem de chamada', async () => {
            /** @type {((value?: void | PromiseLike<void>) => void) | undefined} */
            let releaseFirst;
            ioMocks.writeFileAtomicTrusted
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            releaseFirst = resolve;
                        }),
                )
                .mockResolvedValueOnce(undefined);

            writePersistentModelCacheAsync([/** @type {any} */ ({ modelId: 'first' })]);
            writePersistentModelCacheAsync([/** @type {any} */ ({ modelId: 'second' })]);
            await Promise.resolve();

            expect(ioMocks.writeFileAtomicTrusted).toHaveBeenCalledTimes(1);
            releaseFirst?.();
            await clearPersistentModelCache();

            expect(ioMocks.writeFileAtomicTrusted).toHaveBeenCalledTimes(2);
            const secondPayload = JSON.parse(String(ioMocks.writeFileAtomicTrusted.mock.calls[1]?.[1]));
            expect(secondPayload.models[0].modelId).toBe('second');
        });

        it('ordena clear depois de todos os writes já enfileirados', async () => {
            /** @type {((value?: void | PromiseLike<void>) => void) | undefined} */
            let releaseWrite;
            ioMocks.writeFileAtomicTrusted.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        releaseWrite = resolve;
                    }),
            );
            writePersistentModelCacheAsync([/** @type {any} */ ({ modelId: 'pending' })]);
            const clear = clearPersistentModelCache();
            await Promise.resolve();
            expect(ioMocks.deleteFileTrusted).not.toHaveBeenCalled();

            releaseWrite?.();
            await clear;
            expect(ioMocks.deleteFileTrusted).toHaveBeenCalled();
        });
    });

    describe('clearPersistentModelCache', () => {
        it('não re-lança erro se arquivo não existe', async () => {
            ioMocks.deleteFileTrusted.mockResolvedValue(null);

            await expect(clearPersistentModelCache()).resolves.toBeUndefined();
            expect(ioMocks.deleteFileTrusted).toHaveBeenCalled();
        });

        it('deleta arquivo se existe', async () => {
            ioMocks.deleteFileTrusted.mockResolvedValue({ removed: true });

            await clearPersistentModelCache();

            expect(ioMocks.deleteFileTrusted).toHaveBeenCalled();
        });
    });

    describe('evaluatePersistentCache', () => {
        it('marca como fresh se < 24h', () => {
            const now = Date.now();
            const onehourAgo = now - 1000 * 60 * 60; // 1h ago

            const cache = {
                schema: 'ModelInfo[]',
                version: 2,
                fetchedAt: onehourAgo,
                models: [],
            };

            const result = evaluatePersistentCache(cache);

            expect(result.isStale).toBe(false);
            expect(result.ageMs).toBeGreaterThanOrEqual(3600000);
            expect(result.ageMs).toBeLessThan(3610000);
        });

        it('marca como stale se >= 24h', () => {
            const now = Date.now();
            const onedayAgo = now - 1000 * 60 * 60 * 24 - 1000; // 24h + 1s ago

            const cache = {
                schema: 'ModelInfo[]',
                version: 2,
                fetchedAt: onedayAgo,
                models: [],
            };

            const result = evaluatePersistentCache(cache);

            expect(result.isStale).toBe(true);
        });
    });

    describe('getPersistentCacheDiagnostics', () => {
        it('retorna exists=false quando arquivo não existe', async () => {
            const result = await getPersistentCacheDiagnostics();
            expect(result.exists).toBe(false);
        });

        it('retorna diagnostics quando arquivo existe', async () => {
            const mockStat = {
                size: 5000,
                mtime: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
            };
            ioMocks.statPathTrusted.mockResolvedValue({ stats: mockStat });

            const result = await getPersistentCacheDiagnostics();

            expect(result.exists).toBe(true);
            expect(result.size).toBe(5000);
            expect(result.age).toContain('h');
        });
    });
});
