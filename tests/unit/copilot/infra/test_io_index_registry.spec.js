// @ts-check

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    indexDirectory: vi.fn(),
    getStats: vi.fn(() => ({ available: true })),
    invalidatePath: vi.fn(() => true),
    search: vi.fn(() => []),
    findSymbol: vi.fn(() => []),
    findImports: vi.fn(() => []),
    getCopilotDb: vi.fn(() => ({})),
    registerInvalidationHook: vi.fn(),
}));

vi.mock('#copilot/db', () => ({
    getCopilotDb: mocks.getCopilotDb,
}));

vi.mock('../../../../src/copilot/infra/io-cache.js', () => ({
    registerInvalidationHook: mocks.registerInvalidationHook,
}));

vi.mock('../../../../src/copilot/infra/io-index-sqlite.js', () => ({
    createIoIndexSqlite: () => ({
        indexDirectory: mocks.indexDirectory,
        getStats: mocks.getStats,
        invalidatePath: mocks.invalidatePath,
        search: mocks.search,
        findSymbol: mocks.findSymbol,
        findImports: mocks.findImports,
    }),
}));

import { buildIoIndexForDirectory, resetIoIndexForTest } from '../../../../src/copilot/infra/io-index-registry.js';

beforeEach(() => {
    resetIoIndexForTest();
    mocks.indexDirectory.mockReset();
});

afterEach(() => {
    resetIoIndexForTest();
});

describe('io-index-registry build coalescing', () => {
    it('coalesce builds concorrentes com mesma assinatura de diretório/opções', async () => {
        mocks.indexDirectory.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
            return {
                available: true,
                indexed: 2,
                skipped: 0,
                failed: 0,
                durationMs: 15,
            };
        });

        const [a, b] = await Promise.all([
            buildIoIndexForDirectory('/tmp/ws-a', { recursive: true, extensions: ['.js', '.ts'] }),
            buildIoIndexForDirectory('/tmp/ws-a', { recursive: true, extensions: ['.ts', '.js'] }),
        ]);

        expect(mocks.indexDirectory).toHaveBeenCalledTimes(1);
        assert.deepEqual(a, b);
    });

    it('não coalesce builds com assinaturas diferentes', async () => {
        mocks.indexDirectory.mockResolvedValue({
            available: true,
            indexed: 1,
            skipped: 0,
            failed: 0,
            durationMs: 1,
        });

        await Promise.all([
            buildIoIndexForDirectory('/tmp/ws-b', { recursive: true, maxFiles: 100 }),
            buildIoIndexForDirectory('/tmp/ws-b', { recursive: true, maxFiles: 200 }),
        ]);

        expect(mocks.indexDirectory).toHaveBeenCalledTimes(2);
    });
});
