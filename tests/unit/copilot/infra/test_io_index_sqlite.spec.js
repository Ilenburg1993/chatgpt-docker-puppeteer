// @ts-check

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createIoIndexSqlite } from '../../../../src/copilot/infra/io-index-sqlite.js';

const WORKSPACE = '/workspaces/chatgpt-docker-puppeteer';

/** @type {string | null} */
let tmpDir = null;

beforeEach(async () => {
    tmpDir = mkdtempSync(join(WORKSPACE, 'tmp', '.io-index-'));
    await mkdir(join(tmpDir, 'nested'), { recursive: true });
    await writeFile(
        join(tmpDir, 'alpha.js'),
        "import { betaValue } from './nested/beta.js';\nexport function alphaHelper() { return betaValue; }\n",
        'utf8',
    );
    await writeFile(join(tmpDir, 'nested', 'beta.js'), 'export const betaValue = 42;\n', 'utf8');
    await writeFile(join(tmpDir, 'notes.md'), '# Alpha Notes\n\nsemantic index token\n', 'utf8');
});

afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
});

describe('createIoIndexSqlite', () => {
    it('migra schema existente adicionando identidade dev/ino', () => {
        const db = new Database(':memory:');
        db.exec(`
            CREATE TABLE copilot_io_index_files (
                file_path TEXT PRIMARY KEY,
                workspace_root TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                extension TEXT NOT NULL,
                content_kind TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                mtime_ms REAL NOT NULL,
                ctime_ms REAL,
                content_hash TEXT,
                line_count INTEGER NOT NULL DEFAULT 0,
                symbol_count INTEGER NOT NULL DEFAULT 0,
                import_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                parse_error TEXT,
                indexed_at_ms INTEGER NOT NULL,
                refreshed_at_ms INTEGER NOT NULL,
                metadata_json TEXT
            ) STRICT;
        `);

        createIoIndexSqlite({ db });

        const columns = db
            .prepare('PRAGMA table_info(copilot_io_index_files)')
            .all()
            .map((column) => /** @type {{ name: string }} */ (column).name);
        expect(columns).toEqual(expect.arrayContaining(['dev', 'ino']));
    });

    it('indexa diretório com metadados, FTS, símbolos e imports', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db });

        const result = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            recursive: true,
        });

        expect(result.available).toBe(true);
        expect(result.indexed).toBe(3);
        expect(result.failed).toBe(0);

        const stats = index.getStats();
        expect(stats.available).toBe(true);
        expect(stats.files).toBe(3);
        expect(stats.symbols).toBeGreaterThanOrEqual(2);
        expect(stats.imports).toBeGreaterThanOrEqual(1);
        expect(stats.chunks).toBe(3);
        expect(stats.bytesIndexed).toBeGreaterThan(0);

        const textResults = index.search('semantic index token');
        expect(textResults.length).toBeGreaterThanOrEqual(1);
        expect(textResults[0]?.relativePath).toContain('notes.md');

        const symbols = index.findSymbol('alphaHelper');
        expect(symbols.length).toBeGreaterThanOrEqual(1);
        expect(symbols[0]?.symbolName).toBe('alphaHelper');
    });

    it('invalida path indexado', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db });
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js'], recursive: true });

        expect(index.findSymbol('alphaHelper').length).toBeGreaterThanOrEqual(1);
        expect(index.invalidatePath(join(/** @type {string} */ (tmpDir), 'alpha.js'))).toBe(true);
        expect(index.findSymbol('alphaHelper')).toEqual([]);
    });

    it('invalida subárvore quando o path é diretório', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db });
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js', '.md'], recursive: true });

        expect(index.getStats().files).toBe(3);
        expect(index.invalidatePath(/** @type {string} */ (tmpDir))).toBe(true);

        expect(index.getStats().files).toBe(0);
        expect(index.search('semantic index token')).toEqual([]);
        expect(index.findSymbol('betaValue')).toEqual([]);
    });

    it('pula reindex quando fingerprint mtime/size continua fresco', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db });

        const first = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            recursive: true,
        });
        const second = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            recursive: true,
        });

        expect(first.indexed).toBe(3);
        expect(second.indexed).toBe(0);
        expect(second.unchanged).toBe(3);
        expect(second.skipped).toBeGreaterThanOrEqual(3);
    });

    it('reindexa mudança externa same-size/same-mtime detectada por ctime e identidade', async () => {
        expect(tmpDir).toBeTruthy();
        const root = join(/** @type {string} */ (tmpDir), 'freshness-ctime');
        const filePath = join(root, 'freshness.md');
        await mkdir(root);
        await writeFile(filePath, 'oldfresh\n', 'utf8');
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db, hashVerifyMaxBytes: 1 });
        await index.indexDirectory(root, { extensions: ['.md'], recursive: false });
        const before = await stat(filePath);

        await new Promise((resolve) => setTimeout(resolve, 10));
        await writeFile(filePath, 'newfresh\n', 'utf8');
        await utimes(filePath, before.atime, before.mtime);
        const after = await stat(filePath);
        expect(after.size).toBe(before.size);
        expect(after.mtimeMs).toBeCloseTo(before.mtimeMs, 0);
        expect(after.ctimeMs).not.toBe(before.ctimeMs);

        const second = await index.indexDirectory(root, { extensions: ['.md'], recursive: false });

        expect(second.indexed).toBe(1);
        expect(index.search('oldfresh')).toEqual([]);
        expect(index.search('newfresh')).toHaveLength(1);
    });

    it('usa hash periódico bounded quando metadata parece indistinguível', async () => {
        expect(tmpDir).toBeTruthy();
        const root = join(/** @type {string} */ (tmpDir), 'freshness-hash');
        const filePath = join(root, 'freshness.md');
        await mkdir(root);
        await writeFile(filePath, 'oldfresh\n', 'utf8');
        let currentTime = 1_000;
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({
            db,
            now: () => currentTime,
            hashVerifyIntervalMs: 100,
            hashVerifyMaxBytes: 1024,
        });
        await index.indexDirectory(root, { extensions: ['.md'], recursive: false });
        const before = await stat(filePath);

        await writeFile(filePath, 'newfresh\n', 'utf8');
        await utimes(filePath, before.atime, before.mtime);
        const after = await stat(filePath);
        db.prepare(`
            UPDATE copilot_io_index_files
            SET mtime_ms = ?, ctime_ms = ?, size_bytes = ?, dev = ?, ino = ?
            WHERE file_path = ?
        `).run(after.mtimeMs, after.ctimeMs, after.size, Number(after.dev), Number(after.ino), filePath);
        currentTime = 1_101;

        const second = await index.indexDirectory(root, { extensions: ['.md'], recursive: false });

        expect(second.indexed).toBe(1);
        expect(second.hashVerifiedUnchanged).toBe(0);
        expect(second).toMatchObject({
            hashVerifications: 1,
            hashVerificationHits: 0,
            hashVerificationMisses: 1,
        });
        expect(index.getStats()).toMatchObject({
            hashVerifications: 1,
            hashVerificationHits: 0,
            hashVerificationMisses: 1,
            freshnessPolicy: {
                strategy: 'mtime-size-ctime-dev-ino-periodic-hash',
                hashVerifyMaxBytes: 1024,
                hashVerifyIntervalMs: 100,
            },
        });
        expect(index.search('newfresh')).toHaveLength(1);
    });

    it('renova fingerprint periódico sem refazer FTS quando hash não mudou', async () => {
        expect(tmpDir).toBeTruthy();
        const root = join(/** @type {string} */ (tmpDir), 'freshness-hash-hit');
        await mkdir(root);
        await writeFile(join(root, 'freshness.md'), 'samefresh\n', 'utf8');
        let currentTime = 2_000;
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({
            db,
            now: () => currentTime,
            hashVerifyIntervalMs: 100,
            hashVerifyMaxBytes: 1024,
        });
        await index.indexDirectory(root, { extensions: ['.md'], recursive: false });
        currentTime = 2_101;

        const second = await index.indexDirectory(root, { extensions: ['.md'], recursive: false });

        expect(second.indexed).toBe(0);
        expect(second.unchanged).toBe(1);
        expect(second.hashVerifiedUnchanged).toBe(1);
        expect(second).toMatchObject({
            hashVerifications: 1,
            hashVerificationHits: 1,
            hashVerificationMisses: 0,
        });
        expect(index.getStats()).toMatchObject({
            hashVerifications: 1,
            hashVerificationHits: 1,
            hashVerificationMisses: 0,
        });
    });

    it('remove do índice arquivos deletados em build completo', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db });
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js', '.md'], recursive: true });

        await rm(join(/** @type {string} */ (tmpDir), 'notes.md'));
        const second = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            recursive: true,
        });

        expect(second.pruned).toBe(1);
        expect(index.getStats().files).toBe(2);
        expect(index.search('semantic index token')).toEqual([]);
    });

    it('filtra busca FTS por pathPrefix no SQL', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db });
        await writeFile(join(/** @type {string} */ (tmpDir), 'nested', 'notes-nested.md'), '# Nested\n\nsemantic index token\n', 'utf8');
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.md'], recursive: true });

        const rootResults = index.search('semantic index token', { pathPrefix: /** @type {string} */ (tmpDir) });
        const nestedResults = index.search('semantic index token', {
            pathPrefix: join(/** @type {string} */ (tmpDir), 'nested'),
        });

        expect(rootResults.length).toBeGreaterThanOrEqual(2);
        expect(nestedResults.length).toBe(1);
        expect(nestedResults[0]?.relativePath).toContain('nested/notes-nested.md');
    });

    it('limita busca FTS e símbolos com janela explícita', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db });
        await writeFile(join(/** @type {string} */ (tmpDir), 'one.md'), 'semantic index token\n', 'utf8');
        await writeFile(join(/** @type {string} */ (tmpDir), 'two.md'), 'semantic index token\n', 'utf8');
        await writeFile(join(/** @type {string} */ (tmpDir), 'gamma-a.js'), 'export const gammaAlpha = 1;\n', 'utf8');
        await writeFile(join(/** @type {string} */ (tmpDir), 'gamma-b.js'), 'export const gammaBeta = 2;\n', 'utf8');
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js', '.md'], recursive: true });

        expect(index.search('semantic index token', { maxResults: 1 })).toHaveLength(1);
        expect(index.findSymbol('gamma', { maxResults: 1 })).toHaveLength(1);
    });

    it('não poda entradas fora de build parcial com include', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db });
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js', '.md'], recursive: true });

        const second = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            include: ['alpha.js'],
            recursive: true,
        });

        expect(second.pruned).toBe(0);
        expect(index.getStats().files).toBe(3);
        expect(index.search('semantic index token').length).toBeGreaterThanOrEqual(1);
    });

    it('persiste status failed quando parser retorna parseError no objeto', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createIoIndexSqlite({ db });

        const result = await index.indexTextFile({
            filePath: join(/** @type {string} */ (tmpDir), 'broken.js'),
            workspaceRoot: /** @type {string} */ (tmpDir),
            content: 'export function {',
            sizeBytes: Buffer.byteLength('export function {', 'utf8'),
            mtimeMs: Date.now(),
            ctimeMs: null,
        });

        expect(result.parseError).toBeTruthy();
        const stats = index.getStats();
        expect(stats.files).toBe(1);
        expect(stats.failedFiles).toBe(1);
        expect(stats.freshFiles).toBe(0);
    });
});
