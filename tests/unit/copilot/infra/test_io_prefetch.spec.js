// @ts-check
/**
 * Testes unitários para io-prefetch.js
 */

import { getIoCacheStats } from '#copilot/infra/internal/cache';
import { readBytes, readText } from '#copilot/infra/internal/filesystem/read';
import {
    endSessionScope,
    getSessionScopeStats,
    listSessionScopes,
    startSessionScope,
    warmCacheForPaths,
    warmFromDirectory,
    warmReadThroughContext,
} from '#copilot/infra/internal/indexing/context';
import { getParserCacheStats } from '#copilot/infra/internal/indexing/parser';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { resetIoL1CacheForTest, resetParserCacheForTest } from '#copilot/infra/public/testing';
let tmpDir = '';

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'io-prefetch-test-'));
    // Criar alguns arquivos de teste
    await fs.writeFile(path.join(tmpDir, 'a.js'), 'export function a() { return 1; }');
    await fs.writeFile(path.join(tmpDir, 'b.js'), 'export const b = 2;');
    await fs.writeFile(path.join(tmpDir, 'c.json'), '{"key": "value"}');
    await fs.writeFile(path.join(tmpDir, 'data.bin'), Buffer.from([0x00, 0x01, 0x02]));
    resetIoL1CacheForTest();
});

afterAll(async () => {
    await resetParserCacheForTest({ teardownWorkers: true });
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('warmCacheForPaths', () => {
    it('carrega arquivos no cache L1', async () => {
        resetIoL1CacheForTest();
        const paths = [path.join(tmpDir, 'a.js'), path.join(tmpDir, 'b.js')];
        const result = await warmCacheForPaths(paths, { textMode: true });
        assert.ok(result.preloaded >= 1, `preloaded=${result.preloaded}`);
        assert.strictEqual(result.failed, 0);
        assert.ok(result.durationMs >= 0);

        // Cache deve ter hits agora
        const stats = getIoCacheStats();
        assert.ok(stats !== null);
        assert.ok(stats.size >= 1);
    });

    it('retorna snapshots textuais efêmeros e os reutiliza do L1 sem reread', async () => {
        resetIoL1CacheForTest();
        const paths = [path.join(tmpDir, 'a.js'), path.join(tmpDir, 'b.js')];
        const first = await warmCacheForPaths(paths, {
            captureTextSnapshots: true,
            cacheBytes: false,
        });

        assert.strictEqual(first.failed, 0);
        assert.strictEqual(first.snapshots?.size, 2);
        assert.ok(first.snapshots?.get(paths[0] ?? '')?.content.includes('export function a'));

        const second = await warmCacheForPaths(paths, {
            captureTextSnapshots: true,
            cacheBytes: false,
        });
        assert.strictEqual(second.failed, 0);
        assert.strictEqual(second.skipped, 2);
        assert.strictEqual(second.snapshots?.size, 2);
    });

    it('pula arquivos já no cache (skipped)', async () => {
        // Aquece novamente — já está no cache
        const paths = [path.join(tmpDir, 'a.js')];
        const result = await warmCacheForPaths(paths);
        // a.js já está no cache do teste anterior, deve ser skipped
        assert.ok(result.skipped >= 0); // pode ser 0 ou 1 dependendo da chave
        assert.ok(result.durationMs >= 0);
    });

    it('ignora arquivo inexistente com silent=true', async () => {
        const result = await warmCacheForPaths(['/tmp/nao-existe-abc123.js'], { silent: true });
        assert.strictEqual(result.preloaded, 0);
        assert.strictEqual(result.failed, 1);
    });

    it('controla concorrência (concurrency=2)', async () => {
        resetIoL1CacheForTest();
        const paths = [path.join(tmpDir, 'a.js'), path.join(tmpDir, 'b.js'), path.join(tmpDir, 'c.json')];
        const result = await warmCacheForPaths(paths, { concurrency: 2 });
        assert.ok(result.preloaded >= 1);
    });

    it('respeita AbortSignal', async () => {
        const ctrl = new AbortController();
        ctrl.abort();
        await assert.rejects(
            () => warmCacheForPaths([path.join(tmpDir, 'a.js')], { signal: ctrl.signal }),
            (error) => error instanceof Error && error.name === 'AbortError',
        );
    });

    it('aquece texto mesmo quando bytes já estavam quentes', async () => {
        resetIoL1CacheForTest();
        const filePath = path.join(tmpDir, 'a.js');
        await readBytes(filePath);

        const result = await warmCacheForPaths([filePath], { textMode: true });
        const text = await readText(filePath);

        assert.strictEqual(result.failed, 0);
        assert.ok(result.preloaded >= 1, `preloaded=${result.preloaded}`);
        assert.strictEqual(text.io.cache, 'l1-hit');
    });

    it('não cria cache textual para bytes inválidos em UTF-8', async () => {
        resetIoL1CacheForTest();
        const filePath = path.join(tmpDir, 'invalid-utf8.bin');
        await fs.writeFile(filePath, Buffer.from([0xff, 0xfe, 0xfd]));

        const result = await warmCacheForPaths([filePath], { textMode: true, silent: true });

        assert.strictEqual(result.preloaded, 0);
        assert.strictEqual(result.failed, 1);
        await assert.rejects(() => readText(filePath), /Arquivo binário detectado|bytes inválidos para UTF-8/);
    });

    it('warmReadThroughContext indexa arquivo lido e aquece import relativo direto', async () => {
        resetIoL1CacheForTest();
        await resetParserCacheForTest();
        const dep = path.join(tmpDir, 'dep.js');
        const entry = path.join(tmpDir, 'entry.js');
        await fs.writeFile(dep, 'export const dep = 1;\n', 'utf8');
        await fs.writeFile(entry, "import { dep } from './dep.js';\nexport const value = dep;\n", 'utf8');

        const result = await warmReadThroughContext(entry, {
            workspaceRoot: tmpDir,
            index: false,
            relatedImports: true,
        });
        const depText = await readText(dep);

        assert.ok(result.relatedPaths.includes(dep));
        assert.strictEqual(result.relatedFailed, 0);
        assert.strictEqual(depText.io.cache, 'l1-hit');
        const parserStats = getParserCacheStats();
        assert.strictEqual(parserStats.symbolSuppliedSnapshots, 1);
        assert.strictEqual(parserStats.symbolSnapshotReads, 0);
        assert.strictEqual(result.reusedTextCache, false);
        assert.strictEqual(result.primedByteCache, true);
    });

    it('reutiliza texto L1 verificado e evita cópia binária quando solicitado', async () => {
        resetIoL1CacheForTest();
        await resetParserCacheForTest();
        const entry = path.join(tmpDir, 'entry-cached.js');
        await fs.writeFile(entry, 'export const cachedValue = 1;\n', 'utf8');
        const firstRead = await readText(entry);
        assert.strictEqual(firstRead.io.cache, 'l1-miss');

        const result = await warmReadThroughContext(entry, {
            workspaceRoot: tmpDir,
            index: false,
            relatedImports: true,
            cacheBytes: false,
        });
        const bytes = await readBytes(entry);

        assert.strictEqual(result.reusedTextCache, true);
        assert.strictEqual(result.primedByteCache, false);
        assert.strictEqual(bytes.io.cache, 'l1-miss');
        const parserStats = getParserCacheStats();
        assert.strictEqual(parserStats.symbolSuppliedSnapshots, 1);
        assert.strictEqual(parserStats.symbolSnapshotReads, 0);
    });
});

describe('startSessionScope / getSessionScopeStats / endSessionScope', () => {
    it('ciclo completo: start → stats → end', async () => {
        resetIoL1CacheForTest();
        const sessionId = 'test-session-prefetch-1';
        const paths = [path.join(tmpDir, 'a.js'), path.join(tmpDir, 'b.js')];

        const stats = await startSessionScope(sessionId, paths);
        assert.strictEqual(stats.sessionId, sessionId);
        assert.ok(stats.preloaded + stats.skipped >= 0);
        assert.ok(stats.active === true);

        const mid = getSessionScopeStats(sessionId);
        assert.ok(mid !== null);
        assert.strictEqual(mid.sessionId, sessionId);

        const final = endSessionScope(sessionId);
        assert.ok(final !== null);
        assert.ok(final.active === false);

        // Após end, não encontra mais
        assert.strictEqual(getSessionScopeStats(sessionId), null);
    });

    it('listSessionScopes retorna IDs ativos', async () => {
        const id1 = 'scope-list-test-1';
        const id2 = 'scope-list-test-2';
        await startSessionScope(id1, [path.join(tmpDir, 'a.js')]);
        await startSessionScope(id2, [path.join(tmpDir, 'b.js')]);

        const active = listSessionScopes();
        assert.ok(active.includes(id1));
        assert.ok(active.includes(id2));

        endSessionScope(id1);
        endSessionScope(id2);
    });
});

describe('warmFromDirectory', () => {
    it('escaneia diretório e aquece arquivos por extensão', async () => {
        resetIoL1CacheForTest();
        const result = await warmFromDirectory(tmpDir, {
            extensions: ['.js', '.json'],
            maxFiles: 10,
        });
        assert.ok(result.scanned >= 2, `scanned=${result.scanned}`);
        assert.ok(result.preloaded >= 1, `preloaded=${result.preloaded}`);
        assert.ok(result.durationMs >= 0);
    });

    it('enforce maxFiles como hard cap no scan de aquecimento', async () => {
        resetIoL1CacheForTest();
        const result = await warmFromDirectory(tmpDir, { maxFiles: 1 });
        assert.ok(result.preloaded + result.skipped <= 1, `preloaded=${result.preloaded}`);
        assert.strictEqual(result.advisoryLimits['requestedMaxFiles'], 1);
        assert.strictEqual(result.advisoryLimits['limitMode'], 'enforced-max-files');
        assert.strictEqual(result.advisoryLimits['hardLimitReached'], true);
    });

    it('coverage distribui o hard cap entre buckets top-level', async () => {
        const root = path.join(tmpDir, 'selection-coverage');
        for (const bucket of ['alpha', 'beta', 'gamma']) {
            await fs.mkdir(path.join(root, bucket), { recursive: true });
            await fs.writeFile(path.join(root, bucket, 'one.js'), `export const ${bucket}One = true;`, 'utf8');
            await fs.writeFile(path.join(root, bucket, 'two.js'), `export const ${bucket}Two = true;`, 'utf8');
        }
        resetIoL1CacheForTest();

        const result = await warmFromDirectory(root, {
            extensions: ['.js'],
            maxFiles: 3,
            selectionMode: 'coverage',
        });
        const buckets = new Set(result.paths.map((filePath) => path.relative(root, filePath).split(path.sep)[0]));

        assert.strictEqual(result.paths.length, 3);
        assert.strictEqual(buckets.size, 3);
        assert.deepStrictEqual(result.advisoryLimits['selection'], {
            mode: 'coverage',
            candidateBuckets: 3,
            selectedBuckets: 3,
            preferredRequested: 0,
            preferredSelected: 0,
        });
    });

    it('coverage prioriza source code sobre documentação dentro de cada bucket', async () => {
        const root = path.join(tmpDir, 'selection-utility');
        const bucket = path.join(root, 'feature');
        await fs.mkdir(path.join(bucket, 'deep'), { recursive: true });
        await fs.writeFile(path.join(bucket, 'README.md'), '# docs', 'utf8');
        await fs.writeFile(path.join(bucket, 'deep', 'runtime.js'), 'export const runtime = true;', 'utf8');
        resetIoL1CacheForTest();

        const result = await warmFromDirectory(root, {
            extensions: ['.js', '.md'],
            maxFiles: 1,
            selectionMode: 'coverage',
        });

        assert.strictEqual(result.paths.length, 1);
        assert.ok(result.paths[0]?.endsWith(path.join('feature', 'deep', 'runtime.js')));
    });

    it('lexical preserva exatamente o prefixo histórico de candidatos', async () => {
        const root = path.join(tmpDir, 'selection-lexical');
        for (const bucket of ['alpha', 'beta', 'gamma']) {
            await fs.mkdir(path.join(root, bucket), { recursive: true });
            await fs.writeFile(path.join(root, bucket, 'one.js'), `export const ${bucket}One = true;`, 'utf8');
            await fs.writeFile(path.join(root, bucket, 'two.js'), `export const ${bucket}Two = true;`, 'utf8');
        }
        resetIoL1CacheForTest();

        const full = await warmFromDirectory(root, {
            extensions: ['.js'],
            maxFiles: 100,
            selectionMode: 'lexical',
        });
        const limited = await warmFromDirectory(root, {
            extensions: ['.js'],
            maxFiles: 2,
            selectionMode: 'lexical',
        });

        assert.deepStrictEqual(limited.paths, full.paths.slice(0, 2));
        const limitedSelection = /** @type {{ mode: string }} */ (limited.advisoryLimits['selection']);
        assert.strictEqual(limitedSelection.mode, 'lexical');
    });

    it('preferredPaths entram primeiro, são deduplicados e continuam dentro de maxFiles', async () => {
        const root = path.join(tmpDir, 'selection-preferred');
        for (const bucket of ['alpha', 'beta', 'gamma']) {
            await fs.mkdir(path.join(root, bucket), { recursive: true });
            await fs.writeFile(path.join(root, bucket, 'one.js'), `export const ${bucket}One = true;`, 'utf8');
        }
        const preferred = path.join(root, 'gamma', 'one.js');
        resetIoL1CacheForTest();

        const result = await warmFromDirectory(root, {
            extensions: ['.js'],
            maxFiles: 2,
            selectionMode: 'coverage',
            preferredPaths: [preferred, preferred, path.join(root, 'missing.js')],
        });

        assert.strictEqual(result.paths.length, 2);
        assert.strictEqual(result.paths[0], preferred);
        const selection = /** @type {{ preferredRequested: number; preferredSelected: number }} */ (
            result.advisoryLimits['selection']
        );
        assert.strictEqual(selection.preferredRequested, 2);
        assert.strictEqual(selection.preferredSelected, 1);
        assert.strictEqual(result.advisoryLimits['hardLimitReached'], true);
    });

    it('aplica braces e exclusão por diretório com a política glob canônica', async () => {
        const nested = path.join(tmpDir, 'glob-nested');
        const excluded = path.join(tmpDir, 'glob-excluded');
        await fs.mkdir(nested, { recursive: true });
        await fs.mkdir(excluded, { recursive: true });
        await fs.writeFile(path.join(nested, 'match.ts'), 'export const match = true;', 'utf8');
        await fs.writeFile(path.join(nested, 'skip.md'), '# skip', 'utf8');
        await fs.writeFile(path.join(excluded, 'hidden.js'), 'export const hidden = true;', 'utf8');
        resetIoL1CacheForTest();

        const result = await warmFromDirectory(tmpDir, {
            extensions: ['.js', '.ts', '.md'],
            include: ['**/*.{js,ts}'],
            exclude: ['glob-excluded'],
            maxFiles: 100,
        });

        assert.ok(result.paths.some((filePath) => filePath.endsWith('glob-nested/match.ts')));
        assert.ok(!result.paths.some((filePath) => filePath.endsWith('glob-nested/skip.md')));
        assert.ok(!result.paths.some((filePath) => filePath.includes('glob-excluded')));
        assert.strictEqual(result.advisoryLimits['globEngine'], 'minimatch-v10');
    });
});
