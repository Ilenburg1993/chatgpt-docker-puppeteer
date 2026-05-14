// @ts-check

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readTextLineChunks, readTextLinesSnapshot } from '../../../../src/copilot/infra/io/fs/index.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-io-fs-read-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('infra/io/fs read line ports', () => {
    it('readTextLineChunks pagina snapshot textual por linhas', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'chunks.txt');
        await writeFile(file, 'l1\nl2\nl3\nl4\nl5', 'utf8');

        const result = await readTextLineChunks(file, { chunkLines: 2, startLine: 2, endLine: 5 });

        expect(result.totalLines).toBe(5);
        expect(result.chunkLines).toBe(2);
        expect(result.chunks).toEqual([
            { index: 0, startLine: 2, endLine: 3, content: 'l2\nl3', bytes: 5 },
            { index: 1, startLine: 4, endLine: 5, content: 'l4\nl5', bytes: 5 },
        ]);
    });

    it('readTextLinesSnapshot retorna linhas de snapshot UTF-8 normalizando quebras', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'lines.txt');
        await writeFile(file, 'a\r\nb\rc', 'utf8');

        const result = await readTextLinesSnapshot(file);

        expect(result.lines).toEqual(['a', 'b', 'c']);
        expect(result.totalLines).toBe(3);
        expect(result.bytesRead).toBe(Buffer.byteLength('a\r\nb\rc', 'utf8'));
    });

    it('readTextLinesSnapshot preserva snapshot vazio como zero linhas', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'empty.txt');
        await writeFile(file, '', 'utf8');

        const result = await readTextLinesSnapshot(file);

        expect(result.lines).toEqual([]);
        expect(result.totalLines).toBe(0);
        expect(result.bytesRead).toBe(0);
    });
});
