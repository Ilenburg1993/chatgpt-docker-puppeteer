// @ts-check

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    readBytes,
    readText,
    readTextChunks,
    withIoResourceLock,
    writeFileAtomic,
} from '../../../../src/copilot/infra/io-engine.js';
import { scanDirectory } from '../../../../src/copilot/infra/io-scanner.js';

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
        await expect(readFile(destination, 'utf8')).resolves.toBe('source');
        await expect(readFile(source, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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
