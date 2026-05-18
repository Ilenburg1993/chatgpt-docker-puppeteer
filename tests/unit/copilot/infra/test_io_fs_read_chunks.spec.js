// @ts-check

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    readBinaryMutationSnapshot,
    readTextLineChunks,
    readTextLineChunksStream,
    readTextLinesSnapshot,
} from '../../../../src/copilot/infra/io/fs/index.js';
import { sha256 } from '../../../../src/copilot/infra/shared/hash.js';

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
    it('readTextLineChunks aborta quando signal já está cancelado', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'abort.txt');
        await writeFile(file, 'x\ny\nz', 'utf8');

        const controller = new AbortController();
        controller.abort();

        await expect(readTextLineChunks(file, { signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError',
        });
    });

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

    it('readTextLineChunks conta bytes reais do stream e respeita highWaterMark pequeno', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'stream-bytes.txt');
        const content = 'ação\r\nbeta\ngamma\nomega';
        await writeFile(file, content, 'utf8');

        const result = await readTextLineChunks(file, {
            chunkLines: 1,
            startLine: 2,
            endLine: 3,
            highWaterMark: 5,
        });

        expect(result.chunks).toEqual([
            { index: 0, startLine: 2, endLine: 2, content: 'beta', bytes: Buffer.byteLength('beta', 'utf8') },
            { index: 1, startLine: 3, endLine: 3, content: 'gamma', bytes: Buffer.byteLength('gamma', 'utf8') },
        ]);
        expect(result.bytesRead).toBeGreaterThan(Buffer.byteLength('beta\ngamma', 'utf8'));
        expect(result.bytesRead).toBeLessThanOrEqual(Buffer.byteLength(content, 'utf8'));
    });

    it('readTextLineChunksStream expõe chunks via ReadableStream.from', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'stream.txt');
        await writeFile(file, 'l1\nl2\nl3\nl4', 'utf8');

        const stream = readTextLineChunksStream(file, { chunkLines: 2 });
        const reader = stream.getReader();
        /** @type {Array<Awaited<ReturnType<typeof reader.read>>['value']>} */
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }

        expect(chunks).toEqual([
            { index: 0, startLine: 1, endLine: 2, content: 'l1\nl2', bytes: 5 },
            { index: 1, startLine: 3, endLine: 4, content: 'l3\nl4', bytes: 5 },
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

    it('readBinaryMutationSnapshot calcula hash streamado e trunca snapshot acima do orçamento', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'snapshot.bin');
        const payload = Buffer.concat([Buffer.alloc(8, 'a'), Buffer.alloc(8, 'b')]);
        await writeFile(file, payload);

        const result = await readBinaryMutationSnapshot(file, { snapshotMaxBytes: 10, highWaterMark: 4 });

        expect(result.bytesRead).toBe(payload.byteLength);
        expect(result.contentHash).toBe(sha256(payload));
        expect(result.snapshotBase64).toBeNull();
        expect(result.snapshotTruncated).toBe(true);
    });

    it('readBinaryMutationSnapshot preserva snapshot base64 quando cabe no orçamento', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'snapshot-small.bin');
        const payload = Buffer.from('small payload', 'utf8');
        await writeFile(file, payload);

        const result = await readBinaryMutationSnapshot(file, { snapshotMaxBytes: 64, highWaterMark: 3 });

        expect(result.bytesRead).toBe(payload.byteLength);
        expect(result.contentHash).toBe(sha256(payload));
        expect(result.snapshotBase64).toBe(payload.toString('base64'));
        expect(result.snapshotTruncated).toBe(false);
    });
});
