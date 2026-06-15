import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    preflightIoCapacity,
    resetIoCapacityPreflightCacheForTest,
} from '../../../../src/copilot/infra/io/fs/capacity-preflight.js';
import { copyFileUnlocked } from '../../../../src/copilot/infra/io/fs/copy.js';
import { writeAtomicFileUnlocked } from '../../../../src/copilot/infra/io/fs/write-atomic.js';

/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    resetIoCapacityPreflightCacheForTest();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
    const dir = await mkdtemp(path.join(tmpdir(), 'copilot-io-capacity-'));
    tempDirs.push(dir);
    return dir;
}

function statfsWith(availableBlocks, blockSize = 1n) {
    return /** @type {any} */ (async () => ({ bavail: availableBlocks, bsize: blockSize }));
}

describe('io capacity preflight', () => {
    it('is disabled explicitly with a zero threshold', async () => {
        const report = await preflightIoCapacity('/tmp/target', 10_000, { minBytes: 0 });

        expect(report).toMatchObject({ enabled: false, checked: false, sufficient: null, reason: 'disabled' });
    });

    it('skips statfs below the configured threshold', async () => {
        const report = await preflightIoCapacity('/tmp/target', 9, {
            minBytes: 10,
            statfs: /** @type {any} */ (async () => {
                throw new Error('must not run');
            }),
        });

        expect(report).toMatchObject({ enabled: true, checked: false, reason: 'below-threshold' });
    });

    it('reports available capacity and reserve headroom', async () => {
        const report = await preflightIoCapacity('/tmp/target', 60, {
            minBytes: 1,
            reserveBytes: 20,
            statfs: statfsWith(100n),
        });

        expect(report).toMatchObject({
            checked: true,
            sufficient: true,
            reason: 'sufficient',
            requiredBytes: 60,
            reserveBytes: 20,
            requiredWithReserveBytes: 80,
            availableBytes: 100,
            headroomBytes: 20,
        });
    });

    it('reusa statfs por diretório durante a janela curta e expira depois dela', async () => {
        let calls = 0;
        const statfs = /** @type {any} */ (async () => {
            calls += 1;
            return { bavail: 1_000n, bsize: 1n };
        });

        await preflightIoCapacity('/tmp/a/first', 10, {
            minBytes: 1,
            reserveBytes: 0,
            cacheTtlMs: 1_000,
            nowMs: 10_000,
            statfs,
        });
        await preflightIoCapacity('/tmp/a/second', 20, {
            minBytes: 1,
            reserveBytes: 0,
            cacheTtlMs: 1_000,
            nowMs: 10_500,
            statfs,
        });
        await preflightIoCapacity('/tmp/a/third', 30, {
            minBytes: 1,
            reserveBytes: 0,
            cacheTtlMs: 1_000,
            nowMs: 11_000,
            statfs,
        });

        expect(calls).toBe(2);
    });

    it('fails early with ENOSPC when insufficiency is observable', async () => {
        await expect(
            preflightIoCapacity('/tmp/target', 90, {
                minBytes: 1,
                reserveBytes: 20,
                statfs: statfsWith(100n),
            }),
        ).rejects.toMatchObject({
            code: 'ENOSPC',
            capacityPreflight: {
                checked: true,
                sufficient: false,
                reason: 'insufficient',
                availableBytes: 100,
            },
        });
    });

    it('fails open when statfs is unavailable', async () => {
        const report = await preflightIoCapacity('/tmp/target', 100, {
            minBytes: 1,
            statfs: /** @type {any} */ (async () => {
                const error = new Error('unsupported');
                /** @type {any} */ (error).code = 'ENOSYS';
                throw error;
            }),
        });

        expect(report).toMatchObject({
            checked: false,
            sufficient: null,
            reason: 'statfs-unavailable',
            errorCode: 'ENOSYS',
        });
    });

    it('blocks atomic write before creating temp or replacing the target', async () => {
        const dir = await createTempDir();
        const target = path.join(dir, 'target.txt');
        await writeFile(target, 'old');

        await expect(
            writeAtomicFileUnlocked(target, 'new', {
                capacityPreflight: async () => {
                    const error = new Error('no capacity');
                    /** @type {any} */ (error).code = 'ENOSPC';
                    throw error;
                },
            }),
        ).rejects.toMatchObject({ code: 'ENOSPC' });

        expect(await readFile(target, 'utf8')).toBe('old');
        expect(await readdir(dir)).toEqual(['target.txt']);
    });

    it('blocks staged copy before allocating a temporary destination', async () => {
        const dir = await createTempDir();
        const source = path.join(dir, 'source.txt');
        const destination = path.join(dir, 'destination.txt');
        await Promise.all([writeFile(source, 'source'), writeFile(destination, 'old')]);

        await expect(
            copyFileUnlocked(source, destination, {
                capacityPreflight: async () => {
                    const error = new Error('no capacity');
                    /** @type {any} */ (error).code = 'ENOSPC';
                    throw error;
                },
            }),
        ).rejects.toMatchObject({ code: 'ENOSPC' });

        expect(await readFile(source, 'utf8')).toBe('source');
        expect(await readFile(destination, 'utf8')).toBe('old');
        expect((await readdir(dir)).sort()).toEqual(['destination.txt', 'source.txt']);
    });
});
