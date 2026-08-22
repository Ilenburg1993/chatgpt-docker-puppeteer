// @ts-check

import {
    adaptBetterSqliteDatabase,
    createBetterSqliteProvider,
} from '#copilot/infra/internal/database/sqlite/better-sqlite3';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { createWorkspaceScopeRuntime } from '#copilot/infra/internal/indexing/context';
import { getParserCacheStats } from '#copilot/infra/internal/indexing/parser';
import { ensureIoIndexSchema } from '#copilot/infra/internal/indexing/registry/sqlite/schema';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';

const WORKSPACE_ROOT = process.cwd();
const TOOLS_DIR = join(WORKSPACE_ROOT, 'src/copilot/mcp/tools');

/** @type {import('better-sqlite3').Database | null} */
let testInfraDb = null;
/** @type {ReturnType<typeof createWorkspaceScopeRuntime>} */
let scopeRuntime;
/** @type {ReturnType<typeof createInfraRuntime>} */
let infraRuntime;
/** @typedef {ReturnType<typeof createWorkspaceScopeRuntime>} ScopeRuntime */
/** @param {string} sessionId */
const closeScope = (sessionId) => scopeRuntime.closeScope(sessionId);
/** @param {Parameters<ScopeRuntime['declareScope']>[0]} options */
const declareScope = (options) => scopeRuntime.declareScope(options);
/** @param {string} sessionId @param {string} name @param {Parameters<ScopeRuntime['findSymbol']>[2]} [options] */
const findSymbol = (sessionId, name, options = {}) => scopeRuntime.findSymbol(sessionId, name, options);
/** @param {string} sessionId @param {Parameters<ScopeRuntime['getScopeContext']>[1]} [options] */
const getScopeContext = (sessionId, options = {}) => scopeRuntime.getScopeContext(sessionId, options);
/** @param {string} sessionId @param {string[]} [paths] */
const refreshScope = (sessionId, paths) => scopeRuntime.refreshScope(sessionId, paths);

beforeEach(() => {
    testInfraDb = new Database(':memory:');
    const db = /** @type {import('better-sqlite3').Database} */ (testInfraDb);
    ensureIoIndexSchema(adaptBetterSqliteDatabase(db));
    infraRuntime = createInfraRuntime({
        runtimeId: `working-set-infra-${Date.now()}-${Math.random()}`,
        sqliteProvider: createBetterSqliteProvider(() => db),
    });
    scopeRuntime = createWorkspaceScopeRuntime({
        runtimeId: `working-set-test-${Date.now()}-${Math.random()}`,
        workspaceRoot: WORKSPACE_ROOT,
        indexRegistry: infraRuntime.indexRegistry,
        cacheRuntime: infraRuntime.coherence,
        invalidationBus: infraRuntime.coherence.invalidation,
        parserCacheRuntime: infraRuntime.parserCache,
    });
});

afterEach(async () => {
    await scopeRuntime.dispose();
    await infraRuntime.dispose();
    if (testInfraDb?.open) testInfraDb.close();
    testInfraDb = null;
});

describe('Working Set V2 integration', () => {
    it('seedSymbols resolve um arquivo profundo pelo índice dentro do mesmo hard cap', async () => {
        const repoWritePath = join(TOOLS_DIR, 'repo-write.js');
        const indexed = await infraRuntime.indexRegistry.refreshPaths([repoWritePath], {
            workspaceRoot: WORKSPACE_ROOT,
        });
        assert.equal(indexed.available, true);

        const sessionId = 'working-set-symbol-seed';
        const stats = await declareScope({
            sessionId,
            directory: join(WORKSPACE_ROOT, 'src/copilot/mcp'),
            workspaceRoot: WORKSPACE_ROOT,
            maxFiles: 1,
            seedSymbols: ['repoWriteTools'],
            parseSymbols: true,
            indexMode: 'off',
            concurrency: 2,
            silent: false,
        }).awaitReady();
        const matches = findSymbol(sessionId, 'repoWriteTools', { exactMatch: true });

        assert.equal(stats.pathCount, 1);
        assert.equal(stats.selection.mode, 'coverage');
        assert.equal(stats.selection.seedSymbolsRequested, 1);
        assert.equal(stats.selection.seedSymbolPathsResolved, 1);
        assert.equal(stats.selection.preferredSelected, 1);
        assert.ok(matches.some((entry) => entry.filePath.endsWith('/repo-write.js')));
        closeScope(sessionId);
    });

    it('encadeia prefetch -> parser e serve context/find/refresh sem reread global', async () => {
        const sessionId = 'working-set-integration';
        const startedAt = performance.now();
        const stats = await declareScope({
            sessionId,
            directory: TOOLS_DIR,
            workspaceRoot: WORKSPACE_ROOT,
            maxFiles: 80,
            parseSymbols: true,
            indexMode: 'off',
            concurrency: 4,
            silent: false,
        }).awaitReady();
        const openMs = performance.now() - startedAt;

        const parserStats = getParserCacheStats(infraRuntime.parserCache);
        const contextStartedAt = performance.now();
        const context = getScopeContext(sessionId, { maxFiles: 40, maxBytes: 16 * 1024 });
        const contextMs = performance.now() - contextStartedAt;
        const findStartedAt = performance.now();
        const matches = findSymbol(sessionId, 'repoWorkingSetTool', { exactMatch: true });
        const findMs = performance.now() - findStartedAt;
        const refreshStartedAt = performance.now();
        const refresh = await refreshScope(sessionId);
        const refreshMs = performance.now() - refreshStartedAt;

        assert.equal(stats.ready, true);
        assert.ok(stats.pathCount > 0);
        assert.ok(stats.parsed > 0);
        assert.ok(parserStats.symbolSuppliedSnapshots > 0);
        assert.equal(parserStats.symbolSnapshotReads, 0);
        assert.ok(context);
        assert.ok(Buffer.byteLength(JSON.stringify(context), 'utf8') <= 16 * 1024);
        assert.ok(matches.some((entry) => entry.filePath.endsWith('/repo-working-set.js')));
        assert.deepEqual(refresh, { refreshed: 0, removed: 0, failed: 0, skipped: 0 });

        console.log(
            `[working-set-benchmark] ${JSON.stringify({
                selectedFiles: stats.selectedFiles,
                candidateFiles: stats.candidateFiles,
                hardLimitReached: stats.hardLimitReached,
                parsed: stats.parsed,
                preloaded: stats.preloaded,
                symbolBytes: stats.symbolBytes,
                suppliedSnapshots: parserStats.symbolSuppliedSnapshots,
                snapshotReads: parserStats.symbolSnapshotReads,
                openMs: Number(openMs.toFixed(3)),
                contextMs: Number(contextMs.toFixed(3)),
                contextBytes: Buffer.byteLength(JSON.stringify(context), 'utf8'),
                manifestFiles: context?.manifest.length ?? 0,
                findMs: Number(findMs.toFixed(3)),
                findMatches: matches.length,
                refreshMs: Number(refreshMs.toFixed(3)),
                refresh,
            })}`,
        );

        closeScope(sessionId);
    });
});
