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
    listIndexedFiles: vi.fn(() => []),
    indexTextFile: vi.fn(),
    statPathSnapshot: vi.fn(),
    readTextFileSnapshot: vi.fn(),
    loadGitignoreMatcher: vi.fn(),
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

vi.mock('../../../../src/copilot/infra/scan/gitignore.js', () => ({
    loadGitignoreMatcher: mocks.loadGitignoreMatcher,
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
        listIndexedFiles: mocks.listIndexedFiles,
        indexTextFile: mocks.indexTextFile,
    }),
}));

import {
    buildIoIndexForDirectory,
    filterIoIndexRefreshDomainPaths,
    flushIoIndexAutoRefresh,
    getIoIndexStats,
    reconcileIoIndexAutoRefreshDomain,
    refreshIoIndexPaths,
    resetIoIndexForTest,
} from '../../../../src/copilot/infra/io-index-registry.js';

beforeEach(() => {
    mocks.registerInvalidationHook.mockImplementation(() => mocks.unregisterInvalidationHook);
    resetIoIndexForTest();
    mocks.registerInvalidationHook.mockClear();
    mocks.indexDirectory.mockReset();
    mocks.invalidatePath.mockReset().mockReturnValue(true);
    mocks.matchesFileFingerprint.mockReset().mockReturnValue(false);
    mocks.listIndexedFiles.mockReset().mockReturnValue([]);
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
    mocks.loadGitignoreMatcher.mockReset().mockResolvedValue({
        ignores: (value) => String(value).includes('ignored'),
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
        await buildIoIndexForDirectory(workspaceRoot, { workspaceRoot, adoptAutoRefreshDomain: true });
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
        await buildIoIndexForDirectory(workspaceRoot, { workspaceRoot, adoptAutoRefreshDomain: true });
        const hook = mocks.registerInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(workspaceRoot, { recursive: true, source: 'test-rm-r' });

        expect(mocks.invalidatePath).toHaveBeenCalledTimes(1);
        expect(getIoIndexStats().autoRefresh).toMatchObject({ pending: 0, recursiveSkipped: 1 });
        expect(await flushIoIndexAutoRefresh()).toBeNull();
        expect(mocks.indexTextFile).not.toHaveBeenCalled();
    });

    it('não reindexa artefatos hidden como .ai/jobs fora do domínio do full build', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-domain';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        await buildIoIndexForDirectory(scopeRoot, {
            workspaceRoot,
            respectGitignore: true,
            adoptAutoRefreshDomain: true,
        });
        const hook = mocks.registerInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(`${scopeRoot}/.ai/jobs/job.json`, { recursive: false, source: 'validator-artifact' });

        expect(getIoIndexStats().autoRefresh).toMatchObject({ pending: 0, domainSkipped: 1 });
        expect(await flushIoIndexAutoRefresh()).toBeNull();
        expect(mocks.indexTextFile).not.toHaveBeenCalled();
    });

    it('pré-filtra replay paths com o mesmo domínio de hidden/extensão/gitignore sem mutar scheduler', async () => {
        const workspaceRoot = '/tmp/ws-domain-preflight';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        const result = await filterIoIndexRefreshDomainPaths(
            [
                `${scopeRoot}/kept.js`,
                `${scopeRoot}/kept.js`,
                `${scopeRoot}/.ai/jobs/job.json`,
                `${scopeRoot}/notes.log`,
                `${scopeRoot}/ignored.ts`,
                `${workspaceRoot}/outside.js`,
            ],
            { scopeRoot, workspaceRoot, respectGitignore: true },
        );

        expect(result).toEqual({
            paths: [`${scopeRoot}/kept.js`],
            requested: 5,
            domainSkipped: 3,
            gitignoredSkipped: 1,
        });
        expect(getIoIndexStats().autoRefresh).toMatchObject({ pending: 0, queued: 0, domainSkipped: 0 });
    });

    it('filtra gitignored path antes do derived-state refresh', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-gitignore';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        await buildIoIndexForDirectory(scopeRoot, {
            workspaceRoot,
            respectGitignore: true,
            adoptAutoRefreshDomain: true,
        });
        const hook = mocks.registerInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(`${scopeRoot}/ignored.js`, { recursive: false, source: 'ignored-write' });
        expect(getIoIndexStats().autoRefresh).toMatchObject({ pending: 1 });

        const result = await flushIoIndexAutoRefresh();

        expect(result).toMatchObject({ requested: 0, indexed: 0, failed: 0 });
        expect(getIoIndexStats().autoRefresh).toMatchObject({ pending: 0, gitignoredSkipped: 1, requested: 0 });
        expect(mocks.indexTextFile).not.toHaveBeenCalled();
    });

    it('reutiliza snapshot e símbolos fornecidos sem reread/reparse no refresh explícito', async () => {
        const workspaceRoot = '/tmp/ws-snapshot-reuse';
        const filePath = `${workspaceRoot}/src/reused.js`;
        const snapshot = {
            path: filePath,
            content: 'export const reused = true;\n',
            bytesRead: 28,
            sizeBytes: 12,
            mtimeMs: 10,
            ctimeMs: 11,
            dev: 1,
            ino: 2,
            attempts: 1,
            consistent: /** @type {const} */ (true),
        };
        const parsedSymbols = {
            filePath,
            symbols: [],
            imports: [],
            exports: [],
            parseError: null,
        };

        const result = await refreshIoIndexPaths([filePath], {
            workspaceRoot,
            snapshots: new Map([[filePath, snapshot]]),
            parsedSymbols: new Map([[filePath, /** @type {any} */ (parsedSymbols)]]),
        });

        expect(result).toMatchObject({
            requested: 1,
            indexed: 1,
            snapshotReuses: 1,
            parsedSymbolReuses: 1,
            failed: 0,
        });
        expect(mocks.readTextFileSnapshot).not.toHaveBeenCalled();
        expect(mocks.indexTextFile).toHaveBeenCalledWith(
            expect.objectContaining({ filePath, workspaceRoot, content: snapshot.content }),
            expect.objectContaining({ parsedSymbols }),
        );
    });

    it('aplica o mesmo domínio no refresh incremental de startup', async () => {
        const workspaceRoot = '/tmp/ws-incremental-domain';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        const result = await refreshIoIndexPaths([`${scopeRoot}/.hidden.js`], {
            workspaceRoot,
            scopeRoot,
            respectGitignore: true,
        });

        expect(result).toMatchObject({ requested: 1, indexed: 0, skipped: 1, failed: 0 });
        expect(mocks.indexTextFile).not.toHaveBeenCalled();
    });

    it('build manual não redefine o domínio canônico adotado pelo lifecycle', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-canonical-domain';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        await buildIoIndexForDirectory(scopeRoot, {
            workspaceRoot,
            respectGitignore: true,
            adoptAutoRefreshDomain: true,
        });
        await buildIoIndexForDirectory('/tmp/manual-index-slice', { workspaceRoot: '/tmp' });
        const hook = mocks.registerInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(`${scopeRoot}/kept.js`, { recursive: false, source: 'canonical-write' });
        hook('/tmp/manual-index-slice/manual.js', { recursive: false, source: 'manual-slice-write' });

        expect(getIoIndexStats().autoRefresh).toMatchObject({ pending: 1, queued: 1, domainSkipped: 1 });
    });

    it('reconcilia apenas rows explicit-path contaminadas e preserva build manual legítimo', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-domain-reconcile';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        await buildIoIndexForDirectory(scopeRoot, {
            workspaceRoot,
            respectGitignore: true,
            adoptAutoRefreshDomain: true,
        });
        mocks.invalidatePath.mockClear();
        mocks.listIndexedFiles.mockReturnValue([
            {
                filePath: `${scopeRoot}/valid.js`,
                extension: '.js',
                metadataJson: JSON.stringify({ refreshMode: 'explicit-path' }),
            },
            {
                filePath: `${scopeRoot}/.ai/jobs/job.json`,
                extension: '.json',
                metadataJson: JSON.stringify({ refreshMode: 'explicit-path' }),
            },
            {
                filePath: `${scopeRoot}/ignored.js`,
                extension: '.js',
                metadataJson: JSON.stringify({ refreshMode: 'explicit-path' }),
            },
            {
                filePath: `${workspaceRoot}/tests/outside.js`,
                extension: '.js',
                metadataJson: JSON.stringify({ refreshMode: 'explicit-path' }),
            },
            {
                filePath: '/tmp/manual-index-slice/manual.js',
                extension: '.js',
                metadataJson: JSON.stringify({ refreshMode: 'directory-scan' }),
            },
        ]);

        const result = await reconcileIoIndexAutoRefreshDomain();

        expect(result).toEqual({
            available: true,
            domainKnown: true,
            inspected: 5,
            explicitRefreshRows: 4,
            pruned: 3,
        });
        expect(mocks.invalidatePath).toHaveBeenCalledTimes(3);
        expect(mocks.invalidatePath).toHaveBeenCalledWith(`${scopeRoot}/.ai/jobs/job.json`);
        expect(mocks.invalidatePath).toHaveBeenCalledWith(`${scopeRoot}/ignored.js`);
        expect(mocks.invalidatePath).toHaveBeenCalledWith(`${workspaceRoot}/tests/outside.js`);
        expect(mocks.invalidatePath).not.toHaveBeenCalledWith('/tmp/manual-index-slice/manual.js');
        expect(getIoIndexStats().autoRefresh).toMatchObject({ domainReconciliations: 1, domainPruned: 3 });
    });
});
