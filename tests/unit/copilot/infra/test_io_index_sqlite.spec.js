// @ts-check

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
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
});
