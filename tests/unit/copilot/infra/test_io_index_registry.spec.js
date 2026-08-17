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
    matchesFileFingerprint: vi.fn(() => false),
    indexTextFile: vi.fn(),
    statPathSnapshot: vi.fn(),
    readTextFileSnapshot: vi.fn(),
    getCopilotDb: vi.fn(() => ({})),
    registerInvalidationHook: vi.fn(),
    unregisterInvalidationHook: vi.fn(),
}));

vi.mock('#copilot/db', () => ({
    getCopilotDb: mocks.getCopilotDb,
}));

vi.mock('../../../../src/copilot/infra/io-cache.js', () => ({
    registerInvalidationHook: mocks.registerInvalidationHook,
}));

vi.mock('../../../../src/copilot/infra/io/fs/stat.js', () => ({
    statPathSnapshot: mocks.statPathSnapshot,
}));

vi.mock('../../../../src/copilot/infra/io/fs/read-text.js', () => ({
    readTextFileSnapshot: mocks.readTextFileSnapshot,
}));

vi.mock('../../../../src/copilot/infra/io-index-sqlite.js', () => ({
    createIoIndexSqlite: () => ({
        indexDirectory: mocks.indexDirectory,
        getStats: mocks.getStats,
        invalidatePath: mocks.invalidatePath,
        search: mocks.search,
        findSymbol: mocks.findSymbol,
        findImports: mocks.findImports,
        matchesFileFingerprint: mocks.matchesFileFingerprint,
        indexTextFile: mocks.indexTextFile,
    }),
}));

import {
    buildIoIndexForDirectory,
    flushIoIndexAutoRefresh,
    getIoIndexStats,
    resetIoIndexForTest,
} from '../../../../src/copilot/infra/io-index-registry.js';

beforeEach(() => {
    mocks.registerInvalidationHook.mockImplementation(() => mocks.unregisterInvalidationHook);
    resetIoIndexForTest();
    mocks.registerInvalidationHook.mockClear();
    mocks.indexDirectory.mockReset();
    mocks.invalidatePath.mockClear();
    mocks.matchesFileFingerprint.mockReset().mockReturnValue(false);
    mocks.indexTextFile.mockReset().mockResolvedValue({});
    mocks.statPathSnapshot.mockReset().mockResolvedValue({
        isFile: () => true,
        size: 12,
        mtimeMs: 10,
        ctimeMs: 11,
        dev: 1,
        ino: 2,
    });
    mocks.readTextFileSnapshot.mockReset().mockResolvedValue({
        content: 'export const value = 1;\n',
        sizeBytes: 24,
        mtimeMs: 10,
        ctimeMs: 11,
        dev: 1,
        ino: 2,
    });
    mocks.unregisterInvalidationHook.mockReset();
    vi.stubEnv('IO_INDEX_AUTO_REFRESH_ENABLED', '1');
    vi.stubEnv('IO_INDEX_AUTO_REFRESH_DEBOUNCE_MS', '10000');
});

afterEach(() => {
    resetIoIndexForTest();
    vi.unstubAllEnvs();
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

    it('desmonta e recria o hook de invalidação ao resetar', async () => {
        mocks.indexDirectory.mockResolvedValue({
            available: true,
            indexed: 0,
            skipped: 0,
            failed: 0,
            durationMs: 0,
        });

        await buildIoIndexForDirectory('/tmp/ws-hook');
        expect(mocks.registerInvalidationHook).toHaveBeenCalledTimes(1);

        resetIoIndexForTest();
        expect(mocks.unregisterInvalidationHook).toHaveBeenCalledTimes(1);

        await buildIoIndexForDirectory('/tmp/ws-hook');
        expect(mocks.registerInvalidationHook).toHaveBeenCalledTimes(2);
    });

    it('invalida imediatamente e coalesce refresh derivado fora do writer', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-auto-refresh';
        const filePath = `${workspaceRoot}/changed.js`;
        await buildIoIndexForDirectory(workspaceRoot, { workspaceRoot });
        const hook = mocks.registerInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(filePath, { recursive: false, source: 'test-write' });
        hook(filePath, { recursive: false, source: 'test-write' });

        expect(mocks.invalidatePath).toHaveBeenCalledTimes(2);
        expect(getIoIndexStats().autoRefresh).toMatchObject({ pending: 1, queued: 1, coalesced: 1 });

        const refreshed = await flushIoIndexAutoRefresh();

        expect(refreshed).toMatchObject({ requested: 1, indexed: 1, failed: 0 });
        expect(mocks.indexTextFile).toHaveBeenCalledTimes(1);
        expect(getIoIndexStats().autoRefresh).toMatchObject({
            pending: 0,
            batches: 1,
            requested: 1,
            indexed: 1,
            failed: 0,
        });
    });

    it('não promove invalidation recursiva a scan implícito', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-recursive-refresh';
        await buildIoIndexForDirectory(workspaceRoot, { workspaceRoot });
        const hook = mocks.registerInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(workspaceRoot, { recursive: true, source: 'test-rm-r' });

        expect(mocks.invalidatePath).toHaveBeenCalledTimes(1);
        expect(getIoIndexStats().autoRefresh).toMatchObject({ pending: 0, recursiveSkipped: 1 });
        expect(await flushIoIndexAutoRefresh()).toBeNull();
        expect(mocks.indexTextFile).not.toHaveBeenCalled();
    });
});
