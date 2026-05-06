// @ts-check

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    copyFileLocked,
    createOrReplaceFileAtomic,
    readText,
    withIoResourceLock,
} from '../../../../src/copilot/infra/io-engine.js';
import { scanDirectory } from '../../../../src/copilot/infra/io-scanner.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
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
        await writeFile(join(dir, '.hidden.txt'), 'hidden', 'utf8');
        await mkdir(join(dir, 'sub'), { recursive: true });
        await writeFile(join(dir, 'sub', 'nested.md'), 'nested', 'utf8');

        const shallow = await scanDirectory(dir, { workspaceRoot: dir, recursive: false });
        expect(shallow.io.operation).toBe('scan');
        expect(shallow.io.engine).toBe('io-scanner.fs.readdir');
        expect(shallow.entries.map((entry) => entry.name)).toEqual(['sub', 'visible.txt']);

        const visibleOnly = await scanDirectory(dir, {
            workspaceRoot: dir,
            recursive: true,
            depth: 2,
            filter: '*.md',
        });
        const sub = visibleOnly.entries.find((entry) => entry.name === 'sub');
        expect(sub?.children?.map((entry) => entry.name)).toEqual(['nested.md']);
        expect(visibleOnly.entries.some((entry) => entry.name === '.hidden.txt')).toBe(false);

        const withHidden = await scanDirectory(dir, { workspaceRoot: dir, showHidden: true });
        expect(withHidden.entries.map((entry) => entry.name)).toContain('.hidden.txt');
    });
});
