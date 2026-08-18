// @ts-check

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    publishIoInvalidation,
    resetIoInvalidationBusForTest,
} from '../../../../src/copilot/infra/io/invalidation/bus.js';
import {
    getIoExternalWatchStats,
    resetIoExternalWatchForTest,
    startIoExternalWatch,
    stopIoExternalWatch,
} from '../../../../src/copilot/infra/io/invalidation/external-watch.js';

/** @type {string[]} */
const TEMP_DIRS = [];

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-external-watch-'));
    TEMP_DIRS.push(dir);
    return dir;
}

/** @param {() => boolean} predicate */
async function waitUntil(predicate) {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('timeout waiting for external watch hint');
}

afterEach(async () => {
    resetIoExternalWatchForTest();
    resetIoInvalidationBusForTest();
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

describe('infra/io/invalidation/external-watch', () => {
    it('publica hint bounded para alteração nested e filtra domínio hidden', async () => {
        const root = await createTempDir();
        const nested = join(root, 'nested');
        const file = join(nested, 'module.js');
        await mkdir(nested, { recursive: true });
        /** @type {Array<{ filePath: string; source: string }>} */
        const invalidations = [];

        const started = startIoExternalWatch(root, {
            enabled: true,
            debounceMs: 20,
            onInvalidate: (filePath, event) => invalidations.push({ filePath, source: event.source }),
        });
        expect(started).toMatchObject({ started: true, reused: false });
        expect(startIoExternalWatch(root, { enabled: true })).toMatchObject({ started: true, reused: true });

        await writeFile(file, 'export const watched = true;\n', 'utf8');
        await waitUntil(() => invalidations.some((entry) => entry.filePath === file));
        expect(invalidations.find((entry) => entry.filePath === file)?.source).toBe('external-watch');

        const hiddenDir = join(root, '.ai', 'jobs');
        const hiddenFile = join(hiddenDir, 'job.js');
        await mkdir(hiddenDir, { recursive: true });
        await writeFile(hiddenFile, 'export const hidden = true;\n', 'utf8');
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(invalidations.some((entry) => entry.filePath === hiddenFile)).toBe(false);
        expect(getIoExternalWatchStats()).toMatchObject({
            watching: true,
            invalidated: expect.any(Number),
            errors: 0,
            dropped: 0,
        });
        expect(getIoExternalWatchStats().invalidated).toBeGreaterThanOrEqual(1);
        expect(getIoExternalWatchStats().filtered).toBeGreaterThanOrEqual(1);
        stopIoExternalWatch();
        expect(getIoExternalWatchStats().watching).toBe(false);
    });

    it('suprime hint do mesmo evento quando invalidation canônica já o cobriu', async () => {
        const root = await createTempDir();
        const file = join(root, 'canonical.js');
        /** @type {string[]} */
        const invalidations = [];
        startIoExternalWatch(root, {
            enabled: true,
            debounceMs: 100,
            onInvalidate: (filePath) => invalidations.push(filePath),
        });

        await writeFile(file, 'export const canonical = true;\n', 'utf8');
        await waitUntil(() => getIoExternalWatchStats().queued >= 1);
        publishIoInvalidation(file, { source: 'canonical-test' });
        await new Promise((resolve) => setTimeout(resolve, 180));

        expect(invalidations).not.toContain(file);
        expect(getIoExternalWatchStats().canonicalSuppressed).toBeGreaterThanOrEqual(1);
        expect(getIoExternalWatchStats().invalidated).toBe(0);
    });
});
