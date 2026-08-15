// @ts-check

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    cleanupExpiredRollbackSidecars,
    cleanupRollbackSidecars,
    getIoRollbackPolicy,
    persistRollbackSidecar,
    readBinaryMutationSnapshot,
    readBytesFileSnapshot,
    readTextLineChunks,
    readTextLineChunksStream,
    readTextLinesSnapshot,
} from '../../../../src/copilot/infra/io/fs/index.js';
import { sha256 } from '../../../../src/copilot/infra/shared/hash.js';

/** @type {string[]} */
const TEMP_DIRS = [];

const REPLACE_FILE_CHILD = `
import { rename, writeFile } from 'node:fs/promises';
process.on('message', async (message) => {
    try {
        const tempPath = message.filePath + '.external-replacement';
        const payload = message.contentBase64
            ? Buffer.from(message.contentBase64, 'base64')
            : Buffer.alloc(message.size, message.fill);
        await writeFile(tempPath, payload);
        await rename(tempPath, message.filePath);
        process.send?.({ ok: true });
        process.exit(0);
    } catch (error) {
        process.send?.({ ok: false, message: error instanceof Error ? error.message : String(error) });
        process.exit(1);
    }
});
`;

afterEach(async () => {
    vi.unstubAllEnvs();
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

/**
 * @param {string} filePath
 * @param {number} size
 * @param {string} fill
 */
async function replaceFileFromChild(filePath, size, fill) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', REPLACE_FILE_CHILD], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('message', (message) => {
            const result = /** @type {{ ok?: boolean; message?: string }} */ (message);
            if (result.ok) resolve(undefined);
            else reject(new Error(result.message ?? 'external replacement failed'));
        });
        child.send({ filePath, size, fill });
    });
}

/**
 * @param {string} filePath
 * @param {string} content
 */
async function replaceTextFileFromChild(filePath, content) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', REPLACE_FILE_CHILD], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('message', (message) => {
            const result = /** @type {{ ok?: boolean; message?: string }} */ (message);
            if (result.ok) resolve(undefined);
            else reject(new Error(result.message ?? 'external replacement failed'));
        });
        child.send({ filePath, contentBase64: Buffer.from(content, 'utf8').toString('base64') });
    });
}

describe('infra/io/fs read line ports', () => {
    it('readBytesFileSnapshot retorna conteúdo e metadata do mesmo inode', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'stable-snapshot.txt');
        await writeFile(file, 'stable', 'utf8');

        const result = await readBytesFileSnapshot(file);

        expect(result.content.toString('utf8')).toBe('stable');
        expect(result.bytesRead).toBe(6);
        expect(result.sizeBytes).toBe(6);
        expect(result.consistent).toBe(true);
        expect(result.attempts).toBe(1);
        expect(Number.isFinite(result.dev)).toBe(true);
        expect(Number.isFinite(result.ino)).toBe(true);
        expect(Number.isFinite(result.ctimeMs)).toBe(true);
    });

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

    it('readTextLineChunks preserva CRLF quando o CR termina um chunk físico', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'stream-crlf-boundary.txt');
        const lines = ['fim alpha', 'ação βeta', '東京 zero', '🚀', 'fim'];
        await writeFile(file, lines.join('\r\n'), 'utf8');

        const result = await readTextLineChunks(file, {
            chunkLines: 1,
            startLine: 1,
            endLine: lines.length,
            highWaterMark: 3,
        });

        expect(result.chunks.map((chunk) => chunk.content)).toEqual(lines);
    });

    it('readTextLineChunks recusa UTF-8 inválido mesmo quando a sequência cruza chunks físicos', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'stream-invalid-utf8.bin');
        await writeFile(file, Buffer.from([0x61, 0x0a, 0xf0, 0x9f, 0x92, 0x0a, 0x62]));

        await expect(readTextLineChunks(file, { highWaterMark: 2 })).rejects.toMatchObject({
            name: 'BinaryFileError',
            code: 'ERR_INVALID_UTF8',
        });
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

        const snapshotVersion = chunks[0]?.snapshotVersion;
        expect(snapshotVersion).toMatch(/^[a-f0-9]{24}$/);
        expect(chunks).toEqual([
            { index: 0, startLine: 1, endLine: 2, content: 'l1\nl2', bytes: 5, snapshotVersion },
            { index: 1, startLine: 3, endLine: 4, content: 'l3\nl4', bytes: 5, snapshotVersion },
        ]);
    });

    it('readTextLineChunks repete quando inode muda entre byte-line index e byte seek', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'byte-index-external.txt');
        const oldContent = Array.from({ length: 20 }, (_, index) => `old-${String(index + 1).padStart(2, '0')}`).join(
            '\n',
        );
        const newContent = Array.from({ length: 20 }, (_, index) => `new-${String(index + 1).padStart(2, '0')}`).join(
            '\n',
        );
        await writeFile(file, oldContent, 'utf8');
        let replaced = false;

        const result = await readTextLineChunks(file, {
            startLine: 2,
            endLine: 4,
            chunkLines: 3,
            highWaterMark: 8,
            onPhase: async (phase, details) => {
                if (phase !== 'after-byte-index-built' || details['attempt'] !== 1 || replaced) return;
                replaced = true;
                await replaceTextFileFromChild(file, newContent);
            },
        });

        expect(result).toMatchObject({
            attempts: 2,
            consistent: true,
            cacheFingerprintStrategy: 'byte-line-index',
            snapshotFingerprintStrategy: 'mtime-size-ctime-dev-ino',
        });
        expect(result.chunks.map((chunk) => chunk.content)).toEqual(['new-02\nnew-03\nnew-04']);
        expect(result.snapshotVersion).toMatch(/^[a-f0-9]{24}$/);
    });

    it('readTextLineChunks propaga highWaterMark para index e byte-seek', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'byte-index-high-water-mark.txt');
        await writeFile(file, Array.from({ length: 30 }, (_, index) => `linha-${index + 1}`).join('\r\n'), 'utf8');
        /** @type {number[]} */
        const physicalChunkBytes = [];

        const result = await readTextLineChunks(file, {
            startLine: 4,
            endLine: 8,
            chunkLines: 2,
            highWaterMark: 3,
            onPhase: async (phase, details) => {
                if (phase === 'after-byte-index-chunk' || phase === 'after-byte-range-chunk') {
                    physicalChunkBytes.push(Number(details['chunkBytes']));
                }
            },
        });

        expect(result.chunks.flatMap((chunk) => chunk.content.split('\n'))).toEqual([
            'linha-4',
            'linha-5',
            'linha-6',
            'linha-7',
            'linha-8',
        ]);
        expect(physicalChunkBytes.length).toBeGreaterThan(5);
        expect(Math.max(...physicalChunkBytes)).toBeLessThanOrEqual(3);
    });

    it('readTextLineChunksStream encerra stale após replace externo sem misturar tokens', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'stream-external.txt');
        const oldContent = Array.from({ length: 80 }, (_, index) => `old-${String(index + 1).padStart(3, '0')}`).join(
            '\n',
        );
        const newContent = Array.from({ length: 80 }, (_, index) => `new-${String(index + 1).padStart(3, '0')}`).join(
            '\n',
        );
        await writeFile(file, oldContent, 'utf8');
        let replaced = false;
        const stream = readTextLineChunksStream(file, {
            chunkLines: 1,
            highWaterMark: 16,
            onPhase: async (phase) => {
                if (phase !== 'after-stream-chunk' || replaced) return;
                replaced = true;
                await replaceTextFileFromChild(file, newContent);
            },
        });
        const reader = stream.getReader();
        /** @type {Array<Awaited<ReturnType<typeof reader.read>>['value']>} */
        const chunks = [];
        let caught;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
        } catch (error) {
            caught = error;
        }

        expect(chunks.length).toBeGreaterThan(0);
        const versions = new Set(chunks.map((chunk) => chunk?.snapshotVersion));
        expect(versions.size).toBe(1);
        expect([...versions][0]).toMatch(/^[a-f0-9]{24}$/);
        expect(chunks.every((chunk) => chunk?.content.startsWith('old-'))).toBe(true);
        expect(caught).toMatchObject({
            code: 'ESTALECHUNKSTREAM',
            partial: true,
            snapshotVersion: [...versions][0],
        });
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

    it('readBinaryMutationSnapshot publica sidecar durável quando excede o orçamento', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'snapshot-large.bin');
        const sidecarDirectory = join(dir, 'rollback');
        const payload = Buffer.concat([Buffer.alloc(12, 'a'), Buffer.alloc(12, 'b'), Buffer.alloc(12, 'c')]);
        await writeFile(file, payload);

        const result = await readBinaryMutationSnapshot(file, {
            snapshotMaxBytes: 10,
            highWaterMark: 7,
            rollbackSidecar: { directory: sidecarDirectory, ttlMs: 5_000, nowMs: 1_000 },
        });

        expect(result.snapshotBase64).toBeNull();
        expect(result.snapshotTruncated).toBe(true);
        expect(result.rollbackSidecar).toMatchObject({
            version: 1,
            contentHash: sha256(payload),
            bytes: payload.byteLength,
            createdAtMs: 1_000,
            expiresAtMs: 6_000,
        });
        await expect(readFile(result.rollbackSidecar?.path ?? '')).resolves.toEqual(payload);
        const sidecarStat = await stat(result.rollbackSidecar?.path ?? '');
        expect(sidecarStat.mode & 0o777).toBe(0o600);
    });

    it('readBinaryMutationSnapshot repete após replace atômico externo e descarta sidecar parcial', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'snapshot-external.bin');
        const sidecarDirectory = join(dir, 'rollback-external');
        const size = 512 * 1024;
        const replacement = Buffer.alloc(size, 'b');
        await writeFile(file, Buffer.alloc(size, 'a'));
        let replaced = false;

        const result = await readBinaryMutationSnapshot(file, {
            snapshotMaxBytes: 0,
            highWaterMark: 4 * 1024,
            rollbackSidecar: { directory: sidecarDirectory },
            onPhase: async (phase, details) => {
                if (phase !== 'after-chunk' || details['attempt'] !== 1 || replaced) return;
                replaced = true;
                await replaceFileFromChild(file, size, 'b');
            },
        });

        expect(result).toMatchObject({
            attempts: 2,
            consistent: true,
            bytesRead: size,
            contentHash: sha256(replacement),
            snapshotTruncated: true,
        });
        await expect(readFile(result.rollbackSidecar?.path ?? '')).resolves.toEqual(replacement);
        expect((await readdir(sidecarDirectory)).filter((name) => name.endsWith('.rollback'))).toHaveLength(1);
    });

    it('cleanup de sidecars remove somente arquivos expirados do schema', async () => {
        const dir = await createTempDir();
        const sidecarDirectory = join(dir, 'rollback-cleanup');
        const expired = await persistRollbackSidecar(Buffer.from('expired'), {
            directory: sidecarDirectory,
            ttlMs: 10,
            nowMs: 100,
        });
        const active = await persistRollbackSidecar(Buffer.from('active'), {
            directory: sidecarDirectory,
            ttlMs: 1_000,
            nowMs: 100,
        });
        await writeFile(join(sidecarDirectory, '.pending-110-999-00000000-0000-4000-8000-000000000000'), 'partial');
        await writeFile(join(sidecarDirectory, 'unknown.rollback'), 'preserve', 'utf8');

        const cleanup = await cleanupExpiredRollbackSidecars({
            directory: sidecarDirectory,
            nowMs: 111,
        });

        expect(cleanup).toMatchObject({ removed: 2, failed: 0, limited: false });
        await expect(readFile(expired.path)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(active.path, 'utf8')).resolves.toBe('active');
        expect(await readdir(sidecarDirectory)).toContain('unknown.rollback');
    });

    it('mantém rollback automático opt-in e expõe budgets configuráveis', () => {
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', '');
        vi.stubEnv('COPILOT_IO_ROLLBACK_TTL_MS', '1234');
        vi.stubEnv('COPILOT_IO_ROLLBACK_MAX_ENTRIES', '7');
        vi.stubEnv('COPILOT_IO_ROLLBACK_MAX_BYTES', '4096');
        expect(getIoRollbackPolicy()).toEqual({ enabled: false, ttlMs: 1234, maxEntries: 7, maxBytes: 4096 });

        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'true');
        expect(getIoRollbackPolicy().enabled).toBe(true);
    });

    it('aplica budget de quantidade preservando explicitamente um sidecar sem ultrapassar o limite', async () => {
        const dir = await createTempDir();
        const sidecarDirectory = join(dir, 'rollback-budget');
        const first = await persistRollbackSidecar(Buffer.from('first'), {
            directory: sidecarDirectory,
            ttlMs: 10_000,
            nowMs: 100,
        });
        const second = await persistRollbackSidecar(Buffer.from('second'), {
            directory: sidecarDirectory,
            ttlMs: 10_000,
            nowMs: 101,
        });
        const third = await persistRollbackSidecar(Buffer.from('third'), {
            directory: sidecarDirectory,
            ttlMs: 10_000,
            nowMs: 102,
        });
        await writeFile(join(sidecarDirectory, 'manual-note.txt'), 'preserve', 'utf8');

        const cleanup = await cleanupRollbackSidecars({
            directory: sidecarDirectory,
            nowMs: 200,
            maxEntries: 1,
            maxBytes: 1024,
            preservePath: first.path,
            enforceBudget: true,
        });

        expect(cleanup).toMatchObject({ removed: 2, budgetRemoved: 2, expiredRemoved: 0, remainingCount: 1 });
        await expect(readFile(first.path, 'utf8')).resolves.toBe('first');
        await expect(readFile(second.path)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(third.path)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readdir(sidecarDirectory)).toContain('manual-note.txt');
    });

    it('persistRollbackSidecar rejeita hash que não corresponde aos bytes', async () => {
        const dir = await createTempDir();

        await expect(
            persistRollbackSidecar(Buffer.from('payload'), {
                directory: join(dir, 'rollback-hash'),
                contentHash: '0'.repeat(64),
            }),
        ).rejects.toMatchObject({ code: 'EROLLBACKSIDECARHASH' });
    });
});
