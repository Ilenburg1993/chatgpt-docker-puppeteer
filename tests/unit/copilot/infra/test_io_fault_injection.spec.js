// @ts-check

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJsonlFileWriter } from '../../../../src/copilot/infra/io/jsonl-file-writer.js';
import { copyFileUnlocked } from '../../../../src/copilot/infra/io/fs/copy.js';
import { moveFileUnlocked } from '../../../../src/copilot/infra/io/fs/move.js';
import { writeAtomicFileUnlocked } from '../../../../src/copilot/infra/io/fs/write-atomic.js';

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
