// @ts-check
/**
 * tests/unit/copilot/sdk/test_persistent_model_cache.spec.js
 *
 * Unit tests para persistent-cache.js e integração em helpers.js
 */

import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearPersistentModelCache,
    evaluatePersistentCache,
    getPersistentCacheDiagnostics,
    readPersistentModelCache,
    writePersistentModelCacheAsync,
} from '../../../../src/copilot/sdk/models/persistent-cache.js';

describe('persistent-model-cache', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(async () => {
        try {
            await clearPersistentModelCache();
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('readPersistentModelCache', () => {
        it('retorna null quando arquivo não existe', async () => {
            const result = await readPersistentModelCache();
            expect(result).toBeNull();
        });

        it('retorna null para JSON invalido', async () => {
            // Mock readFile para retornar JSON inválido
            vi.spyOn(fs, 'readFile').mockResolvedValueOnce('{ invalid json }');

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
            vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify(invalidCache));

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
            vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify(invalidCache));

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
            vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify(validCache));

            const result = await readPersistentModelCache();
            expect(result).not.toBeNull();
            expect(result?.version).toBe(2);
            expect(result?.models).toHaveLength(1);
        });
    });

    describe('writePersistentModelCacheAsync', () => {
        it('ignora modelos não-array', async () => {
            const spyWrite = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

            writePersistentModelCacheAsync(/** @type {any} */ ('not-an-array'));

            // Wait para async operation completar
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(spyWrite).not.toHaveBeenCalled();
        });

        it('escreve models válidos de forma async', async () => {
            const spyWrite = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

            const models = [
                /** @type {any} */ ({
                    modelId: 'gpt-4',
                    name: 'GPT-4',
                    costTier: 'high',
                    speedTier: 'high',
                }),
            ];
            writePersistentModelCacheAsync(models);

            // Wait para async operation completar
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(spyWrite).toHaveBeenCalled();
            const call = spyWrite.mock.calls[0];
            const written = JSON.parse(/** @type {string} */ (call[1]));
            expect(written.version).toBe(2);
            expect(written.models).toHaveLength(1);
        });
    });

    describe('clearPersistentModelCache', () => {
        it('não re-lança erro se arquivo não existe', async () => {
            const spyUnlink = vi.spyOn(fs, 'unlink').mockRejectedValue(new Error('ENOENT'));

            await expect(clearPersistentModelCache()).resolves.toBeUndefined();
            expect(spyUnlink).toHaveBeenCalled();
        });

        it('deleta arquivo se existe', async () => {
            const spyUnlink = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

            await clearPersistentModelCache();

            expect(spyUnlink).toHaveBeenCalled();
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
            vi.spyOn(fs, 'stat').mockResolvedValue(/** @type {any} */ (mockStat));

            const result = await getPersistentCacheDiagnostics();

            expect(result.exists).toBe(true);
            expect(result.size).toBe(5000);
            expect(result.age).toContain('h');
        });
    });
});
