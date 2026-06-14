// @ts-check

import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJsonlFileWriter } from '../../../../src/copilot/infra/io/jsonl-file-writer.js';
import { copyFileUnlocked } from '../../../../src/copilot/infra/io/fs/copy.js';
import { moveFileUnlocked } from '../../../../src/copilot/infra/io/fs/move.js';
import { writeAtomicFileUnlocked } from '../../../../src/copilot/infra/io/fs/write-atomic.js';
import { sha256 } from '../../../../src/copilot/infra/shared/hash.js';

/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
    const dir = await mkdtemp(path.join(tmpdir(), 'copilot-io-fault-'));
    tempDirs.push(dir);
    return dir;
}

function throwAt(expectedPhase) {
    return (phase) => {
        if (phase === expectedPhase) throw new Error(`fault:${phase}`);
    };
}

describe('infra/io deterministic fault injection', () => {
    it('preserva destino e remove temp quando write falha antes de publish', async () => {
        const dir = await createTempDir();
        const target = path.join(dir, 'write.txt');
        await writeFile(target, 'old');

        await expect(writeAtomicFileUnlocked(target, 'new', { onPhase: throwAt('before-publish') })).rejects.toThrow(
            'fault:before-publish',
        );

        expect(await readFile(target, 'utf8')).toBe('old');
        expect(await readdir(dir)).toEqual(['write.txt']);
    });

    it('expõe estado aplicado quando write falha depois de publish', async () => {
        const dir = await createTempDir();
        const target = path.join(dir, 'write.txt');
        await writeFile(target, 'old');

        await expect(writeAtomicFileUnlocked(target, 'new', { onPhase: throwAt('after-publish') })).rejects.toThrow(
            'fault:after-publish',
        );

        expect(await readFile(target, 'utf8')).toBe('new');
        expect(await readdir(dir)).toEqual(['write.txt']);
    });

    it('preserva alteração concorrente quando expectedHash diverge antes do publish', async () => {
        const dir = await createTempDir();
        const target = path.join(dir, 'write-expected.txt');
        await writeFile(target, 'base');
        let replaced = false;

        await expect(
            writeAtomicFileUnlocked(target, 'patched', {
                expectedHash: sha256('base'),
                onPhase: async (phase) => {
                    if (phase !== 'before-publish' || replaced) return;
                    replaced = true;
                    await writeFile(target, 'external');
                },
            }),
        ).rejects.toMatchObject({ code: 'EEXPECTEDHASH' });

        expect(await readFile(target, 'utf8')).toBe('external');
        expect(await readdir(dir)).toEqual(['write-expected.txt']);
    });

    it('promove falha real de directory sync após write sem ocultar o estado aplicado', async () => {
        const dir = await createTempDir();
        const target = path.join(dir, 'write.txt');
        await writeFile(target, 'old');

        await expect(
            writeAtomicFileUnlocked(target, 'new', {
                syncDirectory: async () => ({ attempted: true, ok: false, errorCode: 'EIO' }),
            }),
        ).rejects.toMatchObject({ code: 'EDIRECTORYSYNC', cause: 'EIO' });

        expect(await readFile(target, 'utf8')).toBe('new');
    });

    it('preserva destino anterior quando copy staged falha antes de publish', async () => {
        const dir = await createTempDir();
        const source = path.join(dir, 'source.txt');
        const destination = path.join(dir, 'destination.txt');
        await Promise.all([writeFile(source, 'new'), writeFile(destination, 'old')]);

        await expect(
            copyFileUnlocked(source, destination, { onPhase: throwAt('before-publish') }),
        ).rejects.toThrow('fault:before-publish');

        expect(await readFile(destination, 'utf8')).toBe('old');
        expect((await readdir(dir)).sort()).toEqual(['destination.txt', 'source.txt']);
    });

    it('promove falha real de directory sync após copy e preserva a origem', async () => {
        const dir = await createTempDir();
        const source = path.join(dir, 'source.txt');
        const destination = path.join(dir, 'destination.txt');
        await Promise.all([writeFile(source, 'new'), writeFile(destination, 'old')]);

        await expect(
            copyFileUnlocked(source, destination, {
                syncDirectory: async () => ({ attempted: true, ok: false, errorCode: 'EIO' }),
            }),
        ).rejects.toMatchObject({ code: 'EDIRECTORYSYNC', cause: 'EIO' });

        expect(await readFile(source, 'utf8')).toBe('new');
        expect(await readFile(destination, 'utf8')).toBe('new');
    });

    it('reporta duplicação quando move publica mas falha antes de remover origem', async () => {
        const dir = await createTempDir();
        const source = path.join(dir, 'source.txt');
        const destination = path.join(dir, 'destination.txt');
        await writeFile(source, 'content');

        const result = await moveFileUnlocked(source, destination, {
            overwrite: false,
            onPhase: throwAt('before-source-unlink'),
        });

        expect(result.duplicatedAfterCrossDeviceMove).toBe(true);
        expect(await readFile(source, 'utf8')).toBe('content');
        expect(await readFile(destination, 'utf8')).toBe('content');
    });

    it('não remove origem quando directory sync do destino falha após publish', async () => {
        const dir = await createTempDir();
        const source = path.join(dir, 'source.txt');
        const destination = path.join(dir, 'destination.txt');
        await writeFile(source, 'content');

        const result = await moveFileUnlocked(source, destination, {
            overwrite: false,
            syncDirectory: async () => ({ attempted: true, ok: false, errorCode: 'EIO' }),
        });

        expect(result).toMatchObject({
            crossDevice: false,
            duplicatedAfterCrossDeviceMove: true,
            sourceUnlinkErrorCode: 'EDIRECTORYSYNC',
        });
        expect(await readFile(source, 'utf8')).toBe('content');
        expect(await readFile(destination, 'utf8')).toBe('content');
    });

    it('não reporta duplicação falsa quando sync da origem falha após unlink', async () => {
        const dir = await createTempDir();
        const source = path.join(dir, 'source.txt');
        const destination = path.join(dir, 'destination.txt');
        await writeFile(source, 'content');
        let syncCalls = 0;

        await expect(
            moveFileUnlocked(source, destination, {
                overwrite: false,
                syncDirectory: async () => {
                    syncCalls += 1;
                    return syncCalls === 1
                        ? { attempted: true, ok: true }
                        : { attempted: true, ok: false, errorCode: 'EIO' };
                },
            }),
        ).rejects.toMatchObject({ code: 'EDIRECTORYSYNC', cause: 'EIO' });

        await expect(access(source)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(destination, 'utf8')).toBe('content');
    });

    it('executa fallback EXDEV real entre devices distintos quando /dev/shm está disponível', async () => {
        let sharedMemoryStats;
        try {
            sharedMemoryStats = await stat('/dev/shm');
        } catch {
            return;
        }
        if (sharedMemoryStats.dev === (await stat(tmpdir())).dev) return;

        const sourceDir = await createTempDir();
        const destinationDir = await mkdtemp('/dev/shm/copilot-io-exdev-');
        tempDirs.push(destinationDir);
        const source = path.join(sourceDir, 'source.txt');
        const destination = path.join(destinationDir, 'destination.txt');
        await writeFile(source, 'cross-device-content');

        const result = await moveFileUnlocked(source, destination, { overwrite: false });

        expect(result).toMatchObject({
            crossDevice: true,
            duplicatedAfterCrossDeviceMove: false,
            sourceUnlinkErrorCode: null,
        });
        await expect(access(source)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(destination, 'utf8')).toBe('cross-device-content');
    });

    it('não sobrescreve temporário cross-device preexistente', async () => {
        let sharedMemoryStats;
        try {
            sharedMemoryStats = await stat('/dev/shm');
        } catch {
            return;
        }
        if (sharedMemoryStats.dev === (await stat(tmpdir())).dev) return;

        const sourceDir = await createTempDir();
        const destinationDir = await mkdtemp('/dev/shm/copilot-io-exdev-temp-');
        tempDirs.push(destinationDir);
        const source = path.join(sourceDir, 'source.txt');
        const destination = path.join(destinationDir, 'destination.txt');
        const controlledTemp = path.join(destinationDir, '.destination.controlled.move.tmp');
        await Promise.all([writeFile(source, 'source-content'), writeFile(controlledTemp, 'sentinel')]);

        await expect(
            moveFileUnlocked(source, destination, {
                overwrite: false,
                tempPathFactory: () => controlledTemp,
            }),
        ).rejects.toMatchObject({ code: 'EEXIST' });

        expect(await readFile(source, 'utf8')).toBe('source-content');
        expect(await readFile(controlledTemp, 'utf8')).toBe('sentinel');
        await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('reencaminha lote JSONL quando falha depois da rotação e antes do append', async () => {
        const dir = await createTempDir();
        const filePath = path.join(dir, 'events.jsonl');
        await writeFile(filePath, '{"old":true}\n');
        let fail = true;
        const writer = createJsonlFileWriter({
            filePath,
            autoFlush: false,
            maxBytes: 1,
            onPhase: (phase) => {
                if (phase === 'before-append' && fail) {
                    fail = false;
                    throw new Error('fault:before-append');
                }
            },
        });
        writer.enqueueLine('{"new":true}');

        await expect(writer.flush()).rejects.toThrow('fault:before-append');
        expect(writer.getState().queueDepth).toBe(1);
        expect(await readFile(`${filePath}.1`, 'utf8')).toBe('{"old":true}\n');

        await writer.flush();
        expect(await readFile(filePath, 'utf8')).toBe('{"new":true}\n');
        expect(writer.getState().queueDepth).toBe(0);
    });
});
