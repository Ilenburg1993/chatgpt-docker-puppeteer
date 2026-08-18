// @ts-check
/**
 * Testes unitários para io-session-scope.js
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { invalidateIoCacheSubtree, resetIoL1CacheForTest } from '../../../../src/copilot/infra/io-cache.js';
import { writeFileAtomic } from '../../../../src/copilot/infra/io-engine.js';
import { readIoRuntimeHealthSnapshot } from '../../../../src/copilot/infra/io-health.js';
import {
    closeScope,
    declareScope,
    findSymbol,
    getScopeContext,
    getScopeStats,
    invalidateScopePath,
    listScopes,
    refreshScope,
} from '../../../../src/copilot/infra/io-session-scope.js';

let tmpDir = '';
const JS_A = `
// Módulo A
export function helperA() { return 'a'; }
export const CONST_A = 100;
`;

const JS_B = `
// Módulo B
import { helperA } from './a.js';
export class ServiceB {
    run() { return helperA(); }
}
export function utilB(x) { return x * 2; }
`;

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'io-session-scope-test-'));
    await fs.writeFile(path.join(tmpDir, 'a.js'), JS_A);
    await fs.writeFile(path.join(tmpDir, 'b.js'), JS_B);
    await fs.writeFile(path.join(tmpDir, 'c.json'), '{"env":"test","port":3000}');
    resetIoL1CacheForTest();
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('declareScope + getScopeStats', () => {
    it('cria escopo com paths e aguarda ready', async () => {
        const sessionId = 'test-scope-basic-1';
        const paths = [path.join(tmpDir, 'a.js'), path.join(tmpDir, 'b.js')];

        const handle = declareScope({ sessionId, paths, parseSymbols: true });
        assert.strictEqual(handle.sessionId, sessionId);
        assert.strictEqual(handle.ready, false);

        // Aguarda warm + parse
        const stats = await handle.awaitReady();
        assert.ok(stats.ready === true, `stats.ready=${stats.ready}`);
        assert.strictEqual(stats.status, 'ready');
        assert.strictEqual(stats.degraded, false);
        assert.strictEqual(stats.lastError, null);
        assert.ok(stats.pathCount === 2, `pathCount=${stats.pathCount}`);
        assert.ok(stats.preloaded >= 0);
        assert.ok(stats.parsed >= 0);

        closeScope(sessionId);
    });

    it('aplica maxFiles como hard cap no working set de diretório', async () => {
        const sessionId = 'test-scope-directory-cap';
        const stats = await declareScope({
            sessionId,
            directory: tmpDir,
            workspaceRoot: tmpDir,
            maxFiles: 1,
            parseSymbols: false,
            indexMode: 'off',
        }).awaitReady();

        assert.strictEqual(stats.selectedFiles, 1);
        assert.strictEqual(stats.pathCount, 1);
        assert.ok(stats.candidateFiles > stats.selectedFiles);
        assert.strictEqual(stats.hardLimitReached, true);
        closeScope(sessionId);
    });

    it('getScopeStats retorna null para escopo inexistente', () => {
        const result = getScopeStats('nao-existe-xxxxxxxxxxx');
        assert.strictEqual(result, null);
    });

    it('getScopeStats retorna estado do escopo ativo', async () => {
        const sessionId = 'test-scope-stats-2';
        const paths = [path.join(tmpDir, 'a.js')];
        const handle = declareScope({ sessionId, paths, parseSymbols: false });
        await handle.awaitReady();

        const stats = getScopeStats(sessionId);
        assert.ok(stats !== null);
        assert.strictEqual(stats.sessionId, sessionId);
        assert.ok(stats.ready === true);

        closeScope(sessionId);
    });

    it('resolve awaitReady como degraded, sem falso ready nem path no erro resumido', async () => {
        const sessionId = 'test-scope-degraded-warm';
        const missingPath = path.join(tmpDir, 'missing-secret-name.js');

        const stats = await declareScope({
            sessionId,
            paths: [missingPath],
            parseSymbols: false,
            silent: true,
        }).awaitReady();

        assert.strictEqual(stats.ready, false);
        assert.strictEqual(stats.degraded, true);
        assert.strictEqual(stats.status, 'degraded');
        assert.strictEqual(stats.lastError?.phase, 'warm');
        assert.ok(!JSON.stringify(stats.lastError).includes(missingPath));
        assert.ok(
            readIoRuntimeHealthSnapshot().alerts.some((alert) => alert.code === 'IO_SCOPE_DEGRADED'),
            'health deve projetar escopo degradado',
        );

        closeScope(sessionId);
    });
});

describe('getScopeContext', () => {
    it('retorna contexto com contagem de files e símbolos', async () => {
        const sessionId = 'test-scope-context-1';
        const paths = [path.join(tmpDir, 'a.js'), path.join(tmpDir, 'b.js')];
        const handle = declareScope({
            sessionId,
            paths,
            workspaceRoot: tmpDir,
            parseSymbols: true,
            indexMode: 'off',
        });
        await handle.awaitReady();

        const ctx = getScopeContext(sessionId, { maxFiles: 10, maxBytes: 16 * 1024 });
        assert.ok(ctx !== null, 'getScopeContext deve retornar dados');
        assert.ok(typeof ctx.files === 'number', `files deve ser number, got ${typeof ctx.files}`);
        assert.ok(ctx.files >= 1, `files count=${ctx.files}`);
        assert.ok(Array.isArray(ctx.topExports), 'topExports deve ser array');
        assert.ok(ctx.symbolBytes > 0);
        assert.ok(ctx.contextBytes <= 16 * 1024);
        assert.ok(Buffer.byteLength(JSON.stringify(ctx), 'utf8') <= 16 * 1024);
        assert.strictEqual(ctx.manifest.length, 2);
        assert.ok(ctx.manifest.some((entry) => entry.path === 'b.js' && entry.imports.includes('./a.js')));

        closeScope(sessionId);
    });

    it('retorna null para escopo inexistente', () => {
        const ctx = getScopeContext('scope-nao-existe-123');
        assert.strictEqual(ctx, null);
    });
});

describe('findSymbol', () => {
    it('encontra símbolo por nome exato', async () => {
        const sessionId = 'test-scope-find-1';
        const paths = [path.join(tmpDir, 'a.js'), path.join(tmpDir, 'b.js')];
        const handle = declareScope({ sessionId, paths, parseSymbols: true });
        await handle.awaitReady();

        const results = findSymbol(sessionId, 'helperA', { exactMatch: true });
        assert.ok(Array.isArray(results));
        assert.ok(results.length >= 1, `deve encontrar helperA — results.length=${results.length}`);

        const found = results[0];
        assert.ok(found !== undefined);
        /** @type {any} */
        const foundAny = found;
        assert.ok(foundAny.symbol.name === 'helperA', `symbol.name=${foundAny.symbol?.name}`);
        assert.ok(foundAny.filePath.includes('a.js'));

        closeScope(sessionId);
    });

    it('encontra símbolo por substring (exactMatch=false)', async () => {
        const sessionId = 'test-scope-find-2';
        const paths = [path.join(tmpDir, 'a.js'), path.join(tmpDir, 'b.js')];
        const handle = declareScope({ sessionId, paths, parseSymbols: true });
        await handle.awaitReady();

        const results = findSymbol(sessionId, 'Service', { exactMatch: false });
        assert.ok(Array.isArray(results));
        assert.ok(results.length >= 1, `deve encontrar ServiceB — results.length=${results.length}`);

        closeScope(sessionId);
    });

    it('retorna [] para escopo inexistente', () => {
        const results = findSymbol('scope-nao-existe-xyz', 'qualquer');
        assert.deepEqual(results, []);
    });
});

describe('invalidateScopePath', () => {
    it('remove arquivo do índice simbólico', async () => {
        const sessionId = 'test-scope-invalidate-1';
        const pathA = path.join(tmpDir, 'a.js');
        const handle = declareScope({ sessionId, paths: [pathA, path.join(tmpDir, 'b.js')], parseSymbols: true });
        await handle.awaitReady();

        // Antes: deve encontrar helperA
        const before = findSymbol(sessionId, 'helperA', { exactMatch: true });
        assert.ok(before.length >= 1, 'helperA deve existir antes de invalidar');

        // Invalida pathA
        invalidateScopePath(sessionId, pathA);

        // Depois: não deve encontrar helperA (foi removido do índice)
        const after = findSymbol(sessionId, 'helperA', { exactMatch: true });
        assert.strictEqual(after.length, 0, `helperA deve sumir após invalidação — got ${JSON.stringify(after)}`);

        closeScope(sessionId);
    });
});

describe('refreshScope', () => {
    it('re-parseia arquivo modificado', async () => {
        const sessionId = 'test-scope-refresh-1';
        const pathA = path.join(tmpDir, 'a.js');
        const handle = declareScope({ sessionId, paths: [pathA], parseSymbols: true });
        await handle.awaitReady();

        // Invalida e então faz refresh
        invalidateScopePath(sessionId, pathA);
        await refreshScope(sessionId, [pathA]);

        // Símbolo deve estar disponível novamente
        const results = findSymbol(sessionId, 'helperA', { exactMatch: true });
        assert.ok(results.length >= 1, `helperA deve retornar após refresh — got ${results.length}`);

        closeScope(sessionId);
    });

    it('refresh sem delta conhecido é no-op e não reparseia o working set inteiro', async () => {
        const sessionId = 'test-scope-refresh-no-delta';
        const pathA = path.join(tmpDir, 'a.js');
        await declareScope({ sessionId, paths: [pathA], parseSymbols: true, indexMode: 'off' }).awaitReady();

        const result = await refreshScope(sessionId);

        assert.deepEqual(result, { refreshed: 0, failed: 0, skipped: 0 });
        assert.strictEqual(getScopeStats(sessionId)?.ready, true);
        closeScope(sessionId);
    });

    it('deduplica refresh concorrente do mesmo path sem anunciar ready cedo', async () => {
        const sessionId = 'test-scope-refresh-dedup';
        const pathA = path.join(tmpDir, 'a.js');
        await declareScope({ sessionId, paths: [pathA], parseSymbols: true }).awaitReady();
        invalidateScopePath(sessionId, pathA);

        const [first, second] = await Promise.all([
            refreshScope(sessionId, [pathA]),
            refreshScope(sessionId, [pathA]),
        ]);
        const stats = getScopeStats(sessionId);

        assert.strictEqual(first.refreshed + second.refreshed, 1);
        assert.strictEqual(first.failed + second.failed, 0);
        assert.strictEqual(stats?.status, 'ready');
        assert.ok(findSymbol(sessionId, 'helperA', { exactMatch: true }).length >= 1);

        closeScope(sessionId);
    });

    it('marca escopo como invalidado quando io-engine escreve arquivo e reindexa no refresh', async () => {
        const sessionId = 'test-scope-refresh-write-hook';
        const watchedPath = path.join(tmpDir, 'watched.js');
        await fs.writeFile(watchedPath, "export function beforeWrite() { return 'before'; }\n", 'utf8');

        const handle = declareScope({ sessionId, paths: [watchedPath], parseSymbols: true });
        await handle.awaitReady();
        assert.ok(findSymbol(sessionId, 'beforeWrite', { exactMatch: true }).length >= 1);

        await writeFileAtomic(watchedPath, "export function afterWrite() { return 'after'; }\n", { encoding: 'utf8' });

        const invalidatedStats = getScopeStats(sessionId);
        assert.ok(invalidatedStats !== null);
        assert.strictEqual(invalidatedStats.ready, false);
        assert.strictEqual(invalidatedStats.status, 'stale');
        assert.strictEqual(invalidatedStats.degraded, false);
        assert.strictEqual(invalidatedStats.invalidated, 1);
        assert.strictEqual(findSymbol(sessionId, 'beforeWrite', { exactMatch: true }).length, 0);

        const refreshed = await refreshScope(sessionId);
        assert.strictEqual(refreshed.refreshed, 1);
        assert.ok(findSymbol(sessionId, 'afterWrite', { exactMatch: true }).length >= 1);

        const freshStats = getScopeStats(sessionId);
        assert.ok(freshStats !== null);
        assert.strictEqual(freshStats.ready, true);
        assert.strictEqual(freshStats.status, 'ready');
        assert.strictEqual(freshStats.invalidated, 0);

        closeScope(sessionId);
    });

    it('mantém refresh com falha em degraded quando arquivo pertencente ao scope desaparece', async () => {
        const sessionId = 'test-scope-refresh-degraded';
        const vanishingPath = path.join(tmpDir, 'vanishing-refresh.js');
        await fs.writeFile(vanishingPath, "export function vanishing() { return true; }\n", 'utf8');
        await declareScope({ sessionId, paths: [vanishingPath], parseSymbols: true }).awaitReady();
        await fs.rm(vanishingPath, { force: true });

        const result = await refreshScope(sessionId, [vanishingPath]);
        const stats = getScopeStats(sessionId);

        assert.strictEqual(result.failed, 1);
        assert.strictEqual(result.skipped, 0);
        assert.ok(stats !== null);
        assert.strictEqual(stats.ready, false);
        assert.strictEqual(stats.degraded, true);
        assert.strictEqual(stats.status, 'degraded');
        assert.strictEqual(stats.lastError?.phase, 'refresh');
        assert.ok(!JSON.stringify(stats.lastError).includes(vanishingPath));

        closeScope(sessionId);
    });

    it('não expande o working set ao receber refresh de path externo ao scope', async () => {
        const sessionId = 'test-scope-refresh-outside';
        const pathA = path.join(tmpDir, 'a.js');
        const pathB = path.join(tmpDir, 'b.js');
        await declareScope({ sessionId, paths: [pathA], parseSymbols: true }).awaitReady();

        const result = await refreshScope(sessionId, [pathB]);
        const stats = getScopeStats(sessionId);

        assert.deepEqual(result, { refreshed: 0, failed: 0, skipped: 1 });
        assert.strictEqual(stats?.pathCount, 1);
        assert.strictEqual(stats?.ready, true);
        closeScope(sessionId);
    });

    it('invalidação recursiva remove símbolos de filhos no escopo', async () => {
        const sessionId = 'test-scope-recursive-invalidation';
        const nestedDir = path.join(tmpDir, 'nested-recursive');
        const childPath = path.join(nestedDir, 'child.js');
        await fs.mkdir(nestedDir, { recursive: true });
        await fs.writeFile(childPath, "export function nestedChild() { return 'ok'; }\n", 'utf8');

        const handle = declareScope({ sessionId, paths: [childPath], parseSymbols: true });
        await handle.awaitReady();
        assert.ok(findSymbol(sessionId, 'nestedChild', { exactMatch: true }).length >= 1);

        invalidateIoCacheSubtree(nestedDir);

        const stats = getScopeStats(sessionId);
        assert.ok(stats !== null);
        assert.strictEqual(stats.ready, false);
        assert.strictEqual(stats.status, 'stale');
        assert.strictEqual(stats.invalidated, 1);
        assert.strictEqual(findSymbol(sessionId, 'nestedChild', { exactMatch: true }).length, 0);

        closeScope(sessionId);
    });
});

describe('listScopes / closeScope', () => {
    it('lista escopos ativos', async () => {
        const id1 = 'scope-list-a';
        const id2 = 'scope-list-b';

        const h1 = declareScope({ sessionId: id1, paths: [path.join(tmpDir, 'a.js')] });
        const h2 = declareScope({ sessionId: id2, paths: [path.join(tmpDir, 'b.js')] });
        await Promise.all([h1.awaitReady(), h2.awaitReady()]);

        const active = listScopes();
        assert.ok(active.includes(id1));
        assert.ok(active.includes(id2));

        closeScope(id1);
        closeScope(id2);

        const afterClose = listScopes();
        assert.ok(!afterClose.includes(id1));
        assert.ok(!afterClose.includes(id2));
    });
});
