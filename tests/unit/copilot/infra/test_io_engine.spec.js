// @ts-check

import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as ioCacheL2Registry from '../../../../src/copilot/infra/io-cache-l2-registry.js';
import { resetIoL1CacheForTest } from '../../../../src/copilot/infra/io-cache.js';
import {
    copyFileLocked,
    createOrReplaceFileAtomic,
    deleteFileLocked,
    mkdirPathLocked,
    moveFileLocked,
    patchTextLocked,
    readBytes,
    readText,
    readTextChunks,
    searchText,
    searchWorkspaceSymbols,
    withIoResourceLock,
    writeFileAtomic,
} from '../../../../src/copilot/infra/io-engine.js';
import { scanDirectory } from '../../../../src/copilot/infra/io-scanner.js';
import { acquireIoResourceLock, getIoLockStats } from '../../../../src/copilot/infra/io-locks.js';
import { getFileResourceLockPath } from '../../../../src/copilot/infra/locks/file-resource-lock.js';
import { sha256 } from '../../../../src/copilot/infra/shared/hash.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
    vi.restoreAllMocks();
    resetIoL1CacheForTest();
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-io-engine-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('infra/io-engine', () => {
    it('rejeita parâmetros inválidos em searchText/searchWorkspaceSymbols', async () => {
        await expect(searchText('/tmp/ok', { pattern: '' })).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
        await expect(
            searchText('/tmp/ok', { pattern: 'alpha', includePattern: '*.js\u0000bad' }),
        ).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
        await expect(searchWorkspaceSymbols('/tmp/ok', { symbolName: '   ' })).rejects.toMatchObject({
            code: 'ERR_INVALID_ARG_VALUE',
        });
        await expect(
            searchWorkspaceSymbols('/tmp/ok', { symbolName: 'foo', includePattern: '*.ts\u0000bad' }),
        ).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
    });

    it('mantém contratos de retorno estáveis para readBytes/readText/writeFileAtomic', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'contract-shapes.txt');
        await writeFile(file, 'alpha\nbeta', 'utf8');

        const bytesResult = await readBytes(file);
        expect(bytesResult).toEqual(
            expect.objectContaining({
                path: file,
                content: expect.any(Buffer),
                bytesRead: expect.any(Number),
                io: expect.any(Object),
            }),
        );

        const textResult = await readText(file, { startLine: 1, endLine: 1 });
        expect(textResult).toEqual(
            expect.objectContaining({
                path: file,
                content: 'alpha',
                bytesRead: expect.any(Number),
                sizeBytes: Buffer.byteLength('alpha\nbeta', 'utf8'),
                mtimeMs: expect.any(Number),
                contentHash: sha256('alpha\nbeta'),
                returnedContentHash: sha256('alpha'),
                cacheFingerprintStrategy: 'fs-read',
                totalLines: 2,
                returnedLines: { start: 1, end: 1 },
                io: expect.any(Object),
            }),
        );

        const writeResult = await writeFileAtomic(file, 'gamma');
        expect(writeResult).toEqual(
            expect.objectContaining({
                path: file,
                bytesWritten: Buffer.byteLength('gamma', 'utf8'),
                lockWaitMs: expect.any(Number),
                previousHash: null,
                contentHash: expect.any(String),
                durability: expect.objectContaining({
                    durability: 'file-and-directory',
                    fileFlushRequested: true,
                    directorySync: expect.objectContaining({ attempted: true, ok: true }),
                }),
                io: expect.any(Object),
            }),
        );
        expect(writeResult.io.advisoryLimits?.durability).toEqual(writeResult.durability);
    });

    it('readText retorna range vazio consistente quando startLine passa do fim', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'notes.txt');
        await writeFile(file, 'a\nb\nc', 'utf8');

        const result = await readText(file, { startLine: 10 });

        expect(result.content).toBe('');
        expect(result.totalLines).toBe(3);
        expect(result.returnedLines).toEqual({ start: 4, end: 3 });
        expect(result.io.engine).toBe('io-engine.fs.readFile.text');
    });

    it('readText reutiliza cache completo e ainda respeita ranges posteriores', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'cached-range.txt');
        await writeFile(file, 'one\ntwo\nthree', 'utf8');

        const full = await readText(file);
        const range = await readText(file, { startLine: 2, endLine: 2 });

        expect(full.content).toBe('one\ntwo\nthree');
        expect(range.content).toBe('two');
        expect(range.contentHash).toBe(sha256('one\ntwo\nthree'));
        expect(range.returnedContentHash).toBe(sha256('two'));
        expect(range.cacheFingerprintStrategy).toBe('fs-read');
        expect(range.totalLines).toBe(3);
        expect(range.returnedLines).toEqual({ start: 2, end: 2 });
        expect(range.io.cache).toBe('l1-hit');
    });

    it('readBytes usa L2 em miss de L1 e reaquece L1 para próxima leitura', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'l2-hit.bin');
        const payload = Buffer.from('L2_PAYLOAD', 'utf8');
        await writeFile(file, payload);
        const fileStat = await stat(file);

        const l2Mock = {
            get: vi.fn(() => ({
                key: 'mock-key',
                path: file,
                kind: 'bytes',
                payload,
                sizeBytes: payload.length,
                mtimeMs: Number(fileStat.mtimeMs),
                createdAtMs: Date.now(),
                expiresAtMs: Date.now() + 60_000,
            })),
            set: vi.fn(),
            invalidatePath: vi.fn(),
        };
        vi.spyOn(ioCacheL2Registry, 'getIoL2Cache').mockReturnValue(/** @type {any} */ (l2Mock));

        const first = await readBytes(file);
        expect(first.content.toString('utf8')).toBe('L2_PAYLOAD');
        expect(first.io.cache).toBe('l2-hit');
        expect(first.contentHash).toBe(sha256(payload));
        expect(first.cacheFingerprintStrategy).toBe('l2-mtime-size');
        expect(l2Mock.get).toHaveBeenCalledTimes(1);

        const second = await readBytes(file);
        expect(second.content.toString('utf8')).toBe('L2_PAYLOAD');
        expect(second.io.cache).toBe('l1-hit');
        expect(l2Mock.get).toHaveBeenCalledTimes(1);
    });

    it('writeFileAtomic não falha quando invalidação L2 lança erro (best-effort)', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'invalidate-best-effort.txt');
        await writeFile(file, 'before', 'utf8');

        const l2Mock = {
            get: vi.fn(() => null),
            set: vi.fn(),
            invalidatePath: vi.fn(() => {
                throw new Error('l2 invalidate failed');
            }),
        };
        vi.spyOn(ioCacheL2Registry, 'getIoL2Cache').mockReturnValue(/** @type {any} */ (l2Mock));

        const result = await writeFileAtomic(file, 'after');
        expect(result.bytesWritten).toBe(Buffer.byteLength('after', 'utf8'));
        await expect(readFile(file, 'utf8')).resolves.toBe('after');
        expect(l2Mock.invalidatePath).toHaveBeenCalled();
    });

    it('readTextChunks pagina leitura por linhas com metadados observáveis', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'chunks.txt');
        await writeFile(file, 'l1\nl2\nl3\nl4\nl5', 'utf8');

        const result = await readTextChunks(file, { chunkLines: 2, startLine: 2, endLine: 5 });

        expect(result.totalLines).toBe(5);
        expect(result.chunks).toEqual([
            { index: 0, startLine: 2, endLine: 3, content: 'l2\nl3', bytes: 5 },
            { index: 1, startLine: 4, endLine: 5, content: 'l4\nl5', bytes: 5 },
        ]);
        expect(result.io.engine).toBe('io-engine.fs.createReadStream.textChunks');
        expect(result.io.advisoryLimits?.limitMode).toBe('informative');
    });

    it('createOrReplaceFileAtomic reporta bytes reais de UTF-8 multibyte', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'emoji.txt');

        const result = await createOrReplaceFileAtomic(file, 'ação 🚀');

        expect(result.bytesWritten).toBe(Buffer.byteLength('ação 🚀', 'utf8'));
        await expect(readFile(file, 'utf8')).resolves.toBe('ação 🚀');
        expect(result.io.operation).toBe('write');
    });

    it('copyFileLocked falha em overwrite direto quando destino existe', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'source.txt');
        const destination = join(dir, 'destination.txt');
        await writeFile(source, 'source', 'utf8');
        await writeFile(destination, 'existing', 'utf8');

        await expect(copyFileLocked(source, destination, { overwrite: false })).rejects.toMatchObject({
            code: 'EEXIST',
        });
        await expect(readFile(destination, 'utf8')).resolves.toBe('existing');
    });

    it('copyFileLocked com overwrite captura snapshot/hash do destino anterior para rollback', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'copy-source.txt');
        const destination = join(dir, 'copy-destination.txt');
        await writeFile(source, 'source-content', 'utf8');
        await writeFile(destination, 'old-destination', 'utf8');

        const result = await copyFileLocked(source, destination, { overwrite: true });

        expect(result.destinationPreviousHash).toBe(sha256('old-destination'));
        expect(result.destinationPreviousBytes).toBe(Buffer.byteLength('old-destination', 'utf8'));
        expect(result.destinationPreviousSnapshotBase64).toBe(
            Buffer.from('old-destination', 'utf8').toString('base64'),
        );
        expect(result.destinationPreviousSnapshotTruncated).toBe(false);
        expect(result.fileSync).toMatchObject({ attempted: true, ok: true });
        expect(result.destinationDirectorySync).toMatchObject({ attempted: true, ok: true });
        expect(result.io.advisoryLimits?.fileSync).toEqual(result.fileSync);
        expect(result.io.advisoryLimits?.destinationDirectorySync).toEqual(result.destinationDirectorySync);
        await expect(readFile(destination, 'utf8')).resolves.toBe('source-content');
    });

    it('copyFileLocked aguarda lock ativo no source', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'source.txt');
        const destination = join(dir, 'destination.txt');
        await writeFile(source, 'source', 'utf8');
        await mkdir(join(dir, 'nested'), { recursive: true });

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            source,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let copied = false;
        const copy = copyFileLocked(source, destination).then((result) => {
            copied = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(copied).toBe(false);

        release();
        await holder;
        const result = await copy;
        expect(copied).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        expect(result.sourceHash).toBe(sha256('source'));
        expect(result.sourceBytes).toBe(Buffer.byteLength('source', 'utf8'));
        await expect(readFile(destination, 'utf8')).resolves.toBe('source');
    });

    it('writeFileAtomic aguarda lock ativo no mesmo arquivo antes de escrever', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'write-vs-write.txt');
        await writeFile(file, 'before', 'utf8');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            file,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let written = false;
        const write = writeFileAtomic(file, 'after').then((result) => {
            written = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(written).toBe(false);
        await expect(readFile(file, 'utf8')).resolves.toBe('before');

        release();
        await holder;
        const result = await write;

        expect(written).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        await expect(readFile(file, 'utf8')).resolves.toBe('after');
    });

    it('writeFileAtomic respeita expectedHash antes de sobrescrever', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'expected-hash-write.txt');
        await writeFile(file, 'before', 'utf8');

        const ok = await writeFileAtomic(file, 'after', { expectedHash: sha256('before') });

        expect(ok.previousHash).toBe(sha256('before'));
        expect(ok.contentHash).toBe(sha256('after'));
        await expect(readFile(file, 'utf8')).resolves.toBe('after');

        await expect(writeFileAtomic(file, 'nope', { expectedHash: sha256('stale') })).rejects.toMatchObject({
            code: 'EEXPECTEDHASH',
        });
        await expect(readFile(file, 'utf8')).resolves.toBe('after');
    });

    it('writeFileAtomic com failIfExists não sobrescreve destino existente', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'exclusive-create.txt');
        await writeFile(file, 'existing', 'utf8');

        await expect(writeFileAtomic(file, 'incoming', { failIfExists: true })).rejects.toMatchObject({
            code: 'EEXIST',
        });
        await expect(readFile(file, 'utf8')).resolves.toBe('existing');
    });

    it('patchTextLocked respeita expectedHash antes de aplicar patch', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'expected-hash-patch.txt');
        await writeFile(file, 'alpha beta', 'utf8');

        const patched = await patchTextLocked(file, {
            oldString: 'beta',
            newString: 'gamma',
            expectedHash: sha256('alpha beta'),
        });

        expect(patched.previousHash).toBe(sha256('alpha beta'));
        expect(patched.contentHash).toBe(sha256('alpha gamma'));
        await expect(readFile(file, 'utf8')).resolves.toBe('alpha gamma');

        await expect(
            patchTextLocked(file, { oldString: 'gamma', newString: 'delta', expectedHash: sha256('alpha beta') }),
        ).rejects.toMatchObject({ code: 'EEXPECTEDHASH' });
        await expect(readFile(file, 'utf8')).resolves.toBe('alpha gamma');
    });

    it('patchTextLocked dryRun calcula patch sem escrever no disco', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'dry-run-patch.txt');
        await writeFile(file, 'alpha beta', 'utf8');

        const result = await patchTextLocked(file, {
            oldString: 'beta',
            newString: 'gamma',
            expectedHash: sha256('alpha beta'),
            dryRun: true,
        });

        expect(result.dryRun).toBe(true);
        expect(result.bytesWritten).toBe(0);
        expect(result.projectedBytes).toBe(Buffer.byteLength('alpha gamma', 'utf8'));
        expect(result.contentHash).toBe(sha256('alpha gamma'));
        expect(result.diffPreview).toContain('-alpha beta');
        expect(result.diffPreview).toContain('+alpha gamma');
        expect(result.diffPreviewTruncated).toBe(false);
        await expect(readFile(file, 'utf8')).resolves.toBe('alpha beta');
    });

    it('patchTextLocked rejeita bytes inválidos para UTF-8 sem regravar arquivo', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'binary-patch.bin');
        const original = Buffer.from([0xff, 0x00, 0x61]);
        await writeFile(file, original);

        await expect(
            patchTextLocked(file, {
                oldString: 'a',
                newString: 'b',
            }),
        ).rejects.toMatchObject({ name: 'BinaryFileError' });
        await expect(readFile(file)).resolves.toEqual(original);
    });

    it('patchTextLocked aplica occurrenceIndex para conteúdo repetido', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'occurrence-index-patch.txt');
        await writeFile(file, 'value=1\nvalue=1\n', 'utf8');

        const result = await patchTextLocked(file, {
            oldString: 'value=1',
            newString: 'value=2',
            occurrenceIndex: 2,
        });

        expect(result.occurrences).toBe(2);
        expect(result.replacedOccurrences).toBe(1);
        expect(result.occurrenceIndex).toBe(2);
        expect(result.firstMatchLine).toBe(1);
        expect(result.lastMatchLine).toBe(2);
        await expect(readFile(file, 'utf8')).resolves.toBe('value=1\nvalue=2\n');
    });

    it('moveFileLocked aguarda lock ativo no source antes de mover', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'write-vs-move.txt');
        const destination = join(dir, 'moved.txt');
        await writeFile(source, 'source', 'utf8');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            source,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let moved = false;
        const move = moveFileLocked(source, destination).then((result) => {
            moved = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(moved).toBe(false);
        await expect(readFile(source, 'utf8')).resolves.toBe('source');

        release();
        await holder;
        const result = await move;

        expect(moved).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        expect(result.sourceHash).toBe(sha256('source'));
        expect(result.sourceBytes).toBe(Buffer.byteLength('source', 'utf8'));
        await expect(readFile(destination, 'utf8')).resolves.toBe('source');
        await expect(readFile(source, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('moveFileLocked com overwrite captura snapshot/hash do destino anterior para rollback', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'move-source.txt');
        const destination = join(dir, 'move-destination.txt');
        await writeFile(source, 'incoming', 'utf8');
        await writeFile(destination, 'existing-destination', 'utf8');

        const result = await moveFileLocked(source, destination, { overwrite: true });

        expect(result.destinationPreviousHash).toBe(sha256('existing-destination'));
        expect(result.destinationPreviousBytes).toBe(Buffer.byteLength('existing-destination', 'utf8'));
        expect(result.destinationPreviousSnapshotBase64).toBe(
            Buffer.from('existing-destination', 'utf8').toString('base64'),
        );
        expect(result.destinationPreviousSnapshotTruncated).toBe(false);
        expect(result.fileSync).toBeNull();
        expect(result.destinationDirectorySync).toMatchObject({ attempted: true, ok: true });
        expect(result.sourceDirectorySync).toBeNull();
        expect(result.io.advisoryLimits?.destinationDirectorySync).toEqual(result.destinationDirectorySync);
        await expect(readFile(destination, 'utf8')).resolves.toBe('incoming');
        await expect(readFile(source, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('patchTextLocked retorna snapshot base64 do conteúdo anterior para rollback', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'patch-snapshot.txt');
        await writeFile(file, 'before patch', 'utf8');

        const result = await patchTextLocked(file, {
            oldString: 'before',
            newString: 'after',
        });

        expect(result.previousSnapshotBase64).toBe(Buffer.from('before patch', 'utf8').toString('base64'));
        expect(result.previousSnapshotTruncated).toBe(false);
        await expect(readFile(file, 'utf8')).resolves.toBe('after patch');
    });

    it('mkdirPathLocked aguarda lock ativo no diretório antes de criar', async () => {
        const dir = await createTempDir();
        const nested = join(dir, 'locked-dir');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            nested,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let created = false;
        const creation = mkdirPathLocked(nested, { recursive: true }).then((result) => {
            created = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(created).toBe(false);

        release();
        await holder;
        const result = await creation;

        expect(created).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        await expect(stat(nested)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
        expect((await stat(nested)).isDirectory()).toBe(true);
        expect(result.io.operation).toBe('mkdir');
        expect(result.io.engine).toBe('io-engine.fs.mkdir');
    });

    it('deleteFileLocked aguarda lock ativo no arquivo antes de deletar', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'write-vs-delete.txt');
        await writeFile(file, 'source', 'utf8');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            file,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let deleted = false;
        const deletion = deleteFileLocked(file).then((result) => {
            deleted = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(deleted).toBe(false);
        await expect(readFile(file, 'utf8')).resolves.toBe('source');

        release();
        await holder;
        const result = await deletion;

        expect(deleted).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        expect(result.previousHash).toBe(sha256('source'));
        expect(result.previousBytes).toBe(Buffer.byteLength('source', 'utf8'));
        await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('withIoResourceLock respeita timeout enquanto aguarda lock anterior', async () => {
        const dir = await createTempDir();
        const resource = join(dir, 'busy.txt');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            resource,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let executed = false;

        try {
            await expect(
                withIoResourceLock(
                    resource,
                    async () => {
                        executed = true;
                    },
                    { timeoutMs: 5 },
                ),
            ).rejects.toMatchObject({ code: 'ETIMEDOUT', name: 'TimeoutError' });
            expect(executed).toBe(false);
        } finally {
            release();
            await holder;
        }
    });

    it('withIoResourceLock respeita AbortSignal antes de executar operação protegida', async () => {
        const dir = await createTempDir();
        const resource = join(dir, 'abort.txt');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            resource,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        const controller = new AbortController();
        let executed = false;

        const queued = withIoResourceLock(
            resource,
            async () => {
                executed = true;
            },
            { signal: controller.signal },
        );
        controller.abort();

        try {
            await expect(queued).rejects.toMatchObject({ code: 'ABORT_ERR', name: 'AbortError' });
            expect(executed).toBe(false);
        } finally {
            release();
            await holder;
        }
    });

    it('acquireIoResourceLock cria lockfile L1 quando habilitado explicitamente', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.locks');
        const resource = join(dir, 'locked.txt');

        const lease = await acquireIoResourceLock(resource, {
            fileLock: true,
            fileLockDir: lockDir,
            operation: 'unit-test',
            target: resource,
            timeoutMs: 500,
        });
        try {
            expect(lease.fileLockEnabled).toBe(true);
            expect(lease.fileLockPath).toBe(getFileResourceLockPath(resource, lockDir));
            expect(await readdir(lockDir)).toHaveLength(1);
            expect(getIoLockStats().fileLocks.activeLeases).toBeGreaterThanOrEqual(1);
        } finally {
            await lease.releaseAsync();
        }

        expect(await readdir(lockDir)).toEqual([]);
    });

    it('acquireIoResourceLock recupera lockfile stale por PID morto', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.locks');
        const resource = join(dir, 'stale.txt');
        await mkdir(lockDir, { recursive: true });
        const lockPath = getFileResourceLockPath(resource, lockDir);
        await writeFile(
            lockPath,
            `${JSON.stringify({
                schemaVersion: 1,
                token: 'stale-token',
                pid: 999_999_999,
                hostname: hostname(),
                resourceKey: resource,
                resourceHash: 'stale-hash',
                operation: 'stale-test',
                target: resource,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                startedAtMs: Date.now() - 60_000,
            })}\n`,
            'utf8',
        );

        const lease = await acquireIoResourceLock(resource, {
            fileLock: true,
            fileLockDir: lockDir,
            operation: 'unit-test',
            target: resource,
            timeoutMs: 500,
        });
        try {
            expect(lease.fileLockEnabled).toBe(true);
            expect(lease.staleFileLockRecovered).toBe(true);
            const metadata = JSON.parse(await readFile(lockPath, 'utf8'));
            expect(metadata.token).not.toBe('stale-token');
            expect(metadata.pid).toBe(process.pid);
        } finally {
            await lease.releaseAsync();
        }
    });

    it('acquireIoResourceLock não rouba lock local antigo de PID vivo', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.locks');
        const resource = join(dir, 'live-old.txt');
        await mkdir(lockDir, { recursive: true });
        const lockPath = getFileResourceLockPath(resource, lockDir);
        await writeFile(
            lockPath,
            `${JSON.stringify({
                schemaVersion: 1,
                token: 'live-token',
                pid: process.pid,
                hostname: hostname(),
                resourceKey: resource,
                resourceHash: 'live-hash',
                operation: 'long-running-test',
                target: resource,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                startedAtMs: Date.now() - 60_000,
            })}\n`,
            'utf8',
        );

        await expect(
            acquireIoResourceLock(resource, {
                fileLock: true,
                fileLockDir: lockDir,
                operation: 'contender',
                target: resource,
                timeoutMs: 30,
                fileLockStaleMs: 10,
            }),
        ).rejects.toMatchObject({ code: 'ETIMEDOUT', name: 'TimeoutError' });
        expect(JSON.parse(await readFile(lockPath, 'utf8')).token).toBe('live-token');
    });

    it('acquireIoResourceLock não remove metadata inválida recente', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.locks');
        const resource = join(dir, 'partial-metadata.txt');
        await mkdir(lockDir, { recursive: true });
        const lockPath = getFileResourceLockPath(resource, lockDir);
        await writeFile(lockPath, '', 'utf8');

        await expect(
            acquireIoResourceLock(resource, {
                fileLock: true,
                fileLockDir: lockDir,
                operation: 'contender',
                target: resource,
                timeoutMs: 30,
                fileLockStaleMs: 1_000,
            }),
        ).rejects.toMatchObject({ code: 'ETIMEDOUT', name: 'TimeoutError' });
        expect(await readFile(lockPath, 'utf8')).toBe('');
    });

    it('scanDirectory centraliza listagem, filtro, hidden e metadata de scan', async () => {
        const dir = await createTempDir();
        await writeFile(join(dir, 'visible.txt'), 'visible', 'utf8');
        await writeFile(join(dir, 'ignored.log'), 'ignored', 'utf8');
        await writeFile(join(dir, '.gitignore'), 'ignored.log\n', 'utf8');
        await writeFile(join(dir, '.hidden.txt'), 'hidden', 'utf8');
        await mkdir(join(dir, 'sub'), { recursive: true });
        await writeFile(join(dir, 'sub', 'nested.md'), 'nested', 'utf8');
        await writeFile(join(dir, 'sub', 'skip.tmp'), 'skip', 'utf8');
        await mkdir(join(dir, '.git'), { recursive: true });
        await writeFile(join(dir, '.git', 'config'), 'protected', 'utf8');
        await mkdir(join(dir, 'node_modules'), { recursive: true });
        await writeFile(join(dir, 'node_modules', 'pkg.js'), 'protected', 'utf8');

        const shallow = await scanDirectory(dir, { workspaceRoot: dir, recursive: false, respectGitignore: true });
        expect(shallow.io.operation).toBe('scan');
        expect(shallow.io.engine).toBe('io-scanner.fs.readdir');
        expect(shallow.entries.map((entry) => entry.name)).toEqual(['sub', 'visible.txt']);
        expect(shallow.entries.some((entry) => entry.name === 'ignored.log')).toBe(false);
        expect(shallow.entries.find((entry) => entry.name === 'visible.txt')?.fingerprint).toMatchObject({
            size: 'visible'.length,
        });

        const visibleOnly = await scanDirectory(dir, {
            workspaceRoot: dir,
            recursive: true,
            depth: 2,
            filter: '*.md',
        });
        const sub = visibleOnly.entries.find((entry) => entry.name === 'sub');
        expect(sub?.children?.map((entry) => entry.name)).toEqual(['nested.md']);
        expect(visibleOnly.entries.some((entry) => entry.name === '.hidden.txt')).toBe(false);

        const withHidden = await scanDirectory(dir, { workspaceRoot: dir, showHidden: true, respectGitignore: true });
        expect(withHidden.entries.map((entry) => entry.name)).toContain('.hidden.txt');
        expect(withHidden.entries.map((entry) => entry.name)).not.toContain('.git');
        expect(withHidden.entries.map((entry) => entry.name)).not.toContain('node_modules');
        expect(withHidden.io.advisoryLimits).toMatchObject({ denylist: 'enabled', gitignore: 'enabled' });

        const included = await scanDirectory(dir, {
            workspaceRoot: dir,
            recursive: true,
            depth: 2,
            include: ['*.md'],
            exclude: ['skip.tmp'],
            concurrency: 2,
        });
        const includedSub = included.entries.find((entry) => entry.name === 'sub');
        expect(includedSub?.children?.map((entry) => entry.name)).toEqual(['nested.md']);
        expect(included.io.advisoryLimits).toMatchObject({
            includePatternCount: 1,
            excludePatternCount: 1,
            concurrency: 2,
            fingerprint: true,
        });
    });
});
