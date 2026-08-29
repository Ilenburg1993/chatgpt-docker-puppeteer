// @ts-check

import { BABEL_PARSER_POLICY_VERSION } from '#copilot/infra/internal/code-analysis';
import { createInfraSqliteProviderBinding } from '#copilot/infra/internal/database/provider';
import { createBetterSqliteProvider } from '#copilot/infra/internal/database/sqlite/better-sqlite3';
import Database from 'better-sqlite3';
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
    listIndexedFiles: vi.fn(
        /** @returns {{ filePath: string; extension: string; metadataJson: string | null }[]} */ () => [],
    ),
    indexTextFile: vi.fn(),
    statPathSnapshot: vi.fn(),
    readTextFileSnapshot: vi.fn(),
    loadGitignoreMatcher: vi.fn(),
    registerIoInvalidationHook: vi.fn(),
    unregisterIoInvalidationHook: vi.fn(),
}));

vi.mock('#copilot/infra/internal/filesystem/invalidation', () => ({
    registerIoInvalidationHook: mocks.registerIoInvalidationHook,
}));

vi.mock('#copilot/infra/internal/filesystem/read', async (importOriginal) => {
    const actual = /** @type {typeof import('#copilot/infra/internal/filesystem/read')} */ (await importOriginal());
    return {
        ...actual,
        statPathSnapshot: mocks.statPathSnapshot,
        readTextFileSnapshot: mocks.readTextFileSnapshot,
    };
});

vi.mock('#copilot/infra/internal/indexing/scanner', async (importOriginal) => {
    const actual = /** @type {typeof import('#copilot/infra/internal/indexing/scanner')} */ (await importOriginal());
    return {
        ...actual,
        loadGitignoreMatcher: mocks.loadGitignoreMatcher,
    };
});

vi.mock('../../../../src/copilot/infra/indexing/registry/sqlite/index.js', async (importOriginal) => {
    const actual = /** @type {typeof import('../../../../src/copilot/infra/indexing/registry/sqlite/index.js')} */ (
        await importOriginal()
    );
    return {
        ...actual,
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
    };
});

/** @type {import('better-sqlite3').Database | null} */
let testDb = null;
/** @type {ReturnType<typeof createInfraSqliteProviderBinding> | null} */
let databaseBinding = null;
/** @type {ReturnType<typeof createIoIndexRegistryRuntime> | null} */
let indexRuntime = null;

import { createIoIndexRegistryRuntime, readIoIndexRuntimeConfig } from '#copilot/infra/internal/indexing/registry';

function requireIndexRuntime() {
    if (!indexRuntime) throw new Error('test index runtime is not initialized');
    return indexRuntime;
}

async function recreateIndexRuntime() {
    await indexRuntime?.dispose();
    if (!databaseBinding) throw new Error('test database binding is not initialized');
    indexRuntime = createIoIndexRegistryRuntime({
        database: databaseBinding,
        invalidationBus: { registerHook: mocks.registerIoInvalidationHook },
        runtimeId: `test-index-${Date.now()}-${Math.random()}`,
        config: readIoIndexRuntimeConfig(process.env),
    });
    mocks.registerIoInvalidationHook.mockClear();
    return indexRuntime;
}

beforeEach(() => {
    mocks.registerIoInvalidationHook.mockImplementation(() => mocks.unregisterIoInvalidationHook);
    vi.stubEnv('IO_INDEX_AUTO_REFRESH_ENABLED', '1');
    vi.stubEnv('IO_INDEX_AUTO_REFRESH_DEBOUNCE_MS', '10000');
    testDb = new Database(':memory:');
    databaseBinding = createInfraSqliteProviderBinding(
        createBetterSqliteProvider(() => /** @type {import('better-sqlite3').Database} */ (testDb)),
    );
    indexRuntime = createIoIndexRegistryRuntime({
        database: databaseBinding,
        invalidationBus: { registerHook: mocks.registerIoInvalidationHook },
        runtimeId: `test-index-${Date.now()}-${Math.random()}`,
        config: readIoIndexRuntimeConfig(process.env),
    });
    mocks.registerIoInvalidationHook.mockClear();
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
        ignores: (/** @type {string} */ value) => String(value).includes('ignored'),
    });
    mocks.unregisterIoInvalidationHook.mockReset();
});

afterEach(async () => {
    await indexRuntime?.dispose();
    indexRuntime = null;
    databaseBinding = null;
    if (testDb?.open) testDb.close();
    testDb = null;
    vi.unstubAllEnvs();
});

describe('io-index-registry status isolation', () => {
    it('reads status without materializing the index or registering invalidation hooks', () => {
        const status = requireIndexRuntime().status();

        expect(status).toMatchObject({
            enabled: true,
            available: false,
            schemaPrepared: false,
            reason: 'schema-unprepared',
            lifecycle: { materialized: false, materializations: 0 },
        });
        expect(mocks.registerIoInvalidationHook).not.toHaveBeenCalled();
        expect(mocks.indexDirectory).not.toHaveBeenCalled();
    });
});

describe('io-index-registry file inventory projection', () => {
    it('projects indexed file rows through the registry without exposing the store handle', () => {
        const rows = [
            { filePath: '/tmp/ws/a.js', extension: '.js', metadataJson: null },
            { filePath: '/tmp/ws/b.ts', extension: '.ts', metadataJson: null },
        ];
        mocks.listIndexedFiles.mockReturnValue(rows);

        const listed = requireIndexRuntime().listFiles();

        assert.deepEqual(listed, rows);
        expect(mocks.listIndexedFiles).toHaveBeenCalledTimes(1);
        assert.equal(requireIndexRuntime().snapshot().queries, 1);
    });
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
            requireIndexRuntime().buildDirectory('/tmp/ws-a', { recursive: true, extensions: ['.js', '.ts'] }),
            requireIndexRuntime().buildDirectory('/tmp/ws-a', { recursive: true, extensions: ['.ts', '.js'] }),
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
            requireIndexRuntime().buildDirectory('/tmp/ws-b', { recursive: true, maxFiles: 100 }),
            requireIndexRuntime().buildDirectory('/tmp/ws-b', { recursive: true, maxFiles: 200 }),
        ]);

        expect(mocks.indexDirectory).toHaveBeenCalledTimes(2);
    });

    it('desmonta o hook no dispose e registra um novo hook em outra instância', async () => {
        mocks.indexDirectory.mockResolvedValue({
            available: true,
            indexed: 0,
            skipped: 0,
            failed: 0,
            durationMs: 0,
        });

        await requireIndexRuntime().buildDirectory('/tmp/ws-hook');
        expect(mocks.registerIoInvalidationHook).toHaveBeenCalledTimes(1);

        await requireIndexRuntime().dispose();
        expect(mocks.unregisterIoInvalidationHook).toHaveBeenCalledTimes(1);
        if (!databaseBinding) throw new Error('test database binding is not initialized');
        indexRuntime = createIoIndexRegistryRuntime({
            database: databaseBinding,
            invalidationBus: { registerHook: mocks.registerIoInvalidationHook },
            runtimeId: `test-index-recreated-${Date.now()}-${Math.random()}`,
            config: readIoIndexRuntimeConfig(process.env),
        });

        await requireIndexRuntime().buildDirectory('/tmp/ws-hook');
        expect(mocks.registerIoInvalidationHook).toHaveBeenCalledTimes(2);
    });

    it('invalida imediatamente e coalesce refresh derivado fora do writer', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-auto-refresh';
        const filePath = `${workspaceRoot}/changed.js`;
        await requireIndexRuntime().buildDirectory(workspaceRoot, { workspaceRoot, adoptAutoRefreshDomain: true });
        const hook = mocks.registerIoInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(filePath, { recursive: false, source: 'test-write' });
        hook(filePath, { recursive: false, source: 'test-write' });

        expect(mocks.invalidatePath).toHaveBeenCalledTimes(2);
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ pending: 1, queued: 1, coalesced: 1 });

        const refreshed = await requireIndexRuntime().flushAutoRefresh();

        expect(refreshed).toMatchObject({ requested: 1, indexed: 1, failed: 0 });
        expect(mocks.indexTextFile).toHaveBeenCalledTimes(1);
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({
            pending: 0,
            batches: 1,
            requested: 1,
            indexed: 1,
            failed: 0,
        });
    });

    it('classifica pending persistente pelo orçamento temporal derivado e preserva high-water após convergência', async () => {
        const workspaceRoot = '/tmp/ws-auto-refresh-stale-health';
        const filePath = `${workspaceRoot}/aging.js`;
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        mocks.indexTextFile.mockResolvedValue({});

        await requireIndexRuntime().buildDirectory(workspaceRoot, { workspaceRoot, adoptAutoRefreshDomain: true });
        const hook = mocks.registerIoInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');
        hook(filePath, { recursive: false, source: 'stale-health-test' });

        const initial = requireIndexRuntime().stats().autoRefresh;
        expect(initial).toMatchObject({ pending: 1, stalePending: 0 });
        expect(initial.staleAfterMs).toBeGreaterThanOrEqual(10_000);
        const realNow = Date.now();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow + initial.staleAfterMs + 1);
        try {
            const stale = requireIndexRuntime().stats().autoRefresh;
            expect(stale.stalePending).toBe(1);
            expect(stale.oldestPendingAgeMs).toBeGreaterThan(stale.staleAfterMs);

            const result = await requireIndexRuntime().flushAutoRefresh();
            expect(result).toMatchObject({ indexed: 1, failed: 0 });
        } finally {
            clock.mockRestore();
        }

        const converged = requireIndexRuntime().stats().autoRefresh;
        expect(converged).toMatchObject({ pending: 0, stalePending: 0, oldestPendingAgeMs: 0 });
        expect(converged.maxPendingAgeMs).toBeGreaterThan(initial.staleAfterMs);
    });

    it('mantém falha transitória pending e converge no retry seguinte', async () => {
        vi.stubEnv('IO_INDEX_AUTO_REFRESH_RETRY_BASE_MS', '10000');
        vi.stubEnv('IO_INDEX_AUTO_REFRESH_RETRY_MAX_ATTEMPTS', '3');
        await recreateIndexRuntime();
        const workspaceRoot = '/tmp/ws-auto-refresh-retry';
        const filePath = `${workspaceRoot}/retry.js`;
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        mocks.indexTextFile.mockRejectedValueOnce(new Error('transient sqlite contention')).mockResolvedValueOnce({});

        await requireIndexRuntime().buildDirectory(workspaceRoot, { workspaceRoot, adoptAutoRefreshDomain: true });
        const hook = mocks.registerIoInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');
        hook(filePath, { recursive: false, source: 'retry-test' });

        const first = await requireIndexRuntime().flushAutoRefresh();
        expect(first).toMatchObject({ failed: 1, retryPending: 1, exhausted: 0 });
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({
            pending: 1,
            attempted: 1,
            transientFailed: 1,
            retried: 1,
            exhausted: 0,
            succeeded: 0,
            explicitConvergences: 0,
        });

        const second = await requireIndexRuntime().flushAutoRefresh();
        expect(second).toMatchObject({ indexed: 1, failed: 0, retryPending: 0, exhausted: 0 });
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({
            pending: 0,
            attempted: 2,
            transientFailed: 1,
            retried: 1,
            exhausted: 0,
            succeeded: 1,
            explicitConvergences: 0,
        });
        expect(mocks.indexTextFile).toHaveBeenCalledTimes(2);
    });

    it('encerra retry persistente no limite e expõe exhaustion sem loop infinito', async () => {
        vi.stubEnv('IO_INDEX_AUTO_REFRESH_RETRY_BASE_MS', '10000');
        vi.stubEnv('IO_INDEX_AUTO_REFRESH_RETRY_MAX_ATTEMPTS', '2');
        await recreateIndexRuntime();
        const workspaceRoot = '/tmp/ws-auto-refresh-exhausted';
        const filePath = `${workspaceRoot}/never-converges.js`;
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        mocks.indexTextFile.mockRejectedValue(new Error('persistent failure'));

        await requireIndexRuntime().buildDirectory(workspaceRoot, { workspaceRoot, adoptAutoRefreshDomain: true });
        const hook = mocks.registerIoInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');
        hook(filePath, { recursive: false, source: 'exhaustion-test' });

        expect(await requireIndexRuntime().flushAutoRefresh()).toMatchObject({
            failed: 1,
            retryPending: 1,
            exhausted: 0,
        });
        expect(await requireIndexRuntime().flushAutoRefresh()).toMatchObject({
            failed: 1,
            retryPending: 0,
            exhausted: 1,
        });
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({
            pending: 0,
            attempted: 2,
            transientFailed: 2,
            retried: 1,
            exhausted: 1,
            succeeded: 0,
        });
        expect(await requireIndexRuntime().flushAutoRefresh()).toBeNull();
    });

    it('não promove invalidation recursiva a scan implícito', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-recursive-refresh';
        await requireIndexRuntime().buildDirectory(workspaceRoot, { workspaceRoot, adoptAutoRefreshDomain: true });
        const hook = mocks.registerIoInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(workspaceRoot, { recursive: true, source: 'test-rm-r' });

        expect(mocks.invalidatePath).toHaveBeenCalledTimes(1);
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ pending: 0, recursiveSkipped: 1 });
        expect(await requireIndexRuntime().flushAutoRefresh()).toBeNull();
        expect(mocks.indexTextFile).not.toHaveBeenCalled();
    });

    it('não reindexa artefatos hidden como .ai/jobs fora do domínio do full build', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-domain';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        await requireIndexRuntime().buildDirectory(scopeRoot, {
            workspaceRoot,
            respectGitignore: true,
            adoptAutoRefreshDomain: true,
        });
        const hook = mocks.registerIoInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(`${scopeRoot}/.ai/jobs/job.json`, { recursive: false, source: 'validator-artifact' });

        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ pending: 0, domainSkipped: 1 });
        expect(await requireIndexRuntime().flushAutoRefresh()).toBeNull();
        expect(mocks.indexTextFile).not.toHaveBeenCalled();
    });

    it('pré-filtra replay paths com o mesmo domínio de hidden/extensão/gitignore sem mutar scheduler', async () => {
        const workspaceRoot = '/tmp/ws-domain-preflight';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        const result = await requireIndexRuntime().filterRefreshDomainPaths(
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
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ pending: 0, queued: 0, domainSkipped: 0 });
    });

    it('filtra gitignored path antes do derived-state refresh', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-gitignore';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        await requireIndexRuntime().buildDirectory(scopeRoot, {
            workspaceRoot,
            respectGitignore: true,
            adoptAutoRefreshDomain: true,
        });
        const hook = mocks.registerIoInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(`${scopeRoot}/ignored.js`, { recursive: false, source: 'ignored-write' });
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ pending: 1 });

        const result = await requireIndexRuntime().flushAutoRefresh();

        expect(result).toMatchObject({ requested: 0, indexed: 0, failed: 0 });
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({
            pending: 0,
            gitignoredSkipped: 1,
            requested: 0,
        });
        expect(mocks.indexTextFile).not.toHaveBeenCalled();
    });

    it('limita concorrência de stat/read no refresh incremental explícito', async () => {
        const workspaceRoot = '/tmp/ws-refresh-concurrency';
        const paths = Array.from({ length: 6 }, (_, index) => `${workspaceRoot}/src/file-${index}.js`);
        let active = 0;
        let highWater = 0;
        mocks.statPathSnapshot.mockImplementation(async () => {
            active += 1;
            highWater = Math.max(highWater, active);
            await new Promise((resolve) => setTimeout(resolve, 10));
            active -= 1;
            return { isFile: () => true, size: 12, mtimeMs: 10, ctimeMs: 11, dev: 1, ino: 2 };
        });

        const result = await requireIndexRuntime().refreshPaths(paths, { workspaceRoot, concurrency: 2 });

        expect(result).toMatchObject({ requested: 6, indexed: 6, failed: 0, concurrency: 2 });
        expect(highWater).toBe(2);
        expect(mocks.indexTextFile).toHaveBeenCalledTimes(6);
    });

    it('refresh explícito consome pending já coberto e cancela o segundo refresh debounced', async () => {
        const workspaceRoot = '/tmp/ws-explicit-convergence';
        const filePath = `${workspaceRoot}/src/changed.js`;
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        await requireIndexRuntime().buildDirectory(workspaceRoot, { workspaceRoot, adoptAutoRefreshDomain: true });
        const hook = mocks.registerIoInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(filePath, { recursive: false, source: 'canonical-write' });
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ pending: 1 });

        const result = await requireIndexRuntime().refreshPaths([filePath], { workspaceRoot });

        expect(result).toMatchObject({ requested: 1, indexed: 1, failed: 0 });
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ pending: 0, explicitConvergences: 1 });
        expect(await requireIndexRuntime().flushAutoRefresh()).toBeNull();
        expect(mocks.indexTextFile).toHaveBeenCalledTimes(1);
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
        /** @type {import('#copilot/infra/internal/indexing/parser').FileSymbols} */
        const parsedSymbols = {
            filePath,
            ext: '.js',
            parserPolicyVersion: BABEL_PARSER_POLICY_VERSION,
            symbols: [],
            imports: [],
            exports: [],
            parseError: null,
            truncated: false,
            lines: 1,
            bytes: snapshot.bytesRead,
            parsedBytes: snapshot.bytesRead,
            parseDurationMs: 0,
        };

        const result = await requireIndexRuntime().refreshPaths([filePath], {
            workspaceRoot,
            snapshots: new Map([[filePath, snapshot]]),
            parsedSymbols: new Map([[filePath, parsedSymbols]]),
        });

        expect(result).toMatchObject({
            requested: 1,
            indexed: 1,
            snapshotReuses: 1,
            parsedSymbolReuses: 1,
            parsedSymbolPolicyRejects: 0,
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
        const result = await requireIndexRuntime().refreshPaths([`${scopeRoot}/.hidden.js`], {
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
        await requireIndexRuntime().buildDirectory(scopeRoot, {
            workspaceRoot,
            respectGitignore: true,
            adoptAutoRefreshDomain: true,
        });
        await requireIndexRuntime().buildDirectory('/tmp/manual-index-slice', { workspaceRoot: '/tmp' });
        const hook = mocks.registerIoInvalidationHook.mock.calls[0]?.[0];
        assert.equal(typeof hook, 'function');

        hook(`${scopeRoot}/kept.js`, { recursive: false, source: 'canonical-write' });
        hook('/tmp/manual-index-slice/manual.js', { recursive: false, source: 'manual-slice-write' });

        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ pending: 1, queued: 1, domainSkipped: 1 });
    });

    it('aborta domain reconcile durante o sweep sem continuar invalidations tardias', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-domain-reconcile-abort';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        await requireIndexRuntime().buildDirectory(scopeRoot, {
            workspaceRoot,
            respectGitignore: true,
            adoptAutoRefreshDomain: true,
        });
        const controller = new AbortController();
        mocks.listIndexedFiles.mockReturnValue([
            {
                filePath: `${scopeRoot}/.ai/jobs/first.json`,
                extension: '.json',
                metadataJson: JSON.stringify({ refreshMode: 'explicit-path' }),
            },
            {
                filePath: `${scopeRoot}/.ai/jobs/second.json`,
                extension: '.json',
                metadataJson: JSON.stringify({ refreshMode: 'explicit-path' }),
            },
        ]);
        mocks.invalidatePath.mockImplementation((filePath) => {
            if (String(filePath).endsWith('first.json')) controller.abort(new Error('stop-domain-reconcile'));
            return true;
        });

        await assert.rejects(
            requireIndexRuntime().reconcileAutoRefreshDomain({ signal: controller.signal }),
            /stop-domain-reconcile/u,
        );
        expect(mocks.invalidatePath).toHaveBeenCalledTimes(1);
        expect(mocks.invalidatePath).toHaveBeenCalledWith(`${scopeRoot}/.ai/jobs/first.json`);
        expect(mocks.invalidatePath).not.toHaveBeenCalledWith(`${scopeRoot}/.ai/jobs/second.json`);
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ domainReconciliations: 0, domainPruned: 0 });
    });

    it('reconcilia apenas rows explicit-path contaminadas e preserva build manual legítimo', async () => {
        mocks.indexDirectory.mockResolvedValue({ available: true, indexed: 0, skipped: 0, failed: 0, durationMs: 0 });
        const workspaceRoot = '/tmp/ws-domain-reconcile';
        const scopeRoot = `${workspaceRoot}/src/copilot`;
        await requireIndexRuntime().buildDirectory(scopeRoot, {
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

        const result = await requireIndexRuntime().reconcileAutoRefreshDomain();

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
        expect(requireIndexRuntime().stats().autoRefresh).toMatchObject({ domainReconciliations: 1, domainPruned: 3 });
    });
});
