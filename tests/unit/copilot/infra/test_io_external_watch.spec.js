// @ts-check

import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {string[]} */
const TEMP_DIRS = [];
/** @type {ReturnType<typeof createInfraRuntime>[]} */
const RUNTIMES = [];

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-external-watch-'));
    TEMP_DIRS.push(dir);
    return dir;
}

function createTestRuntime() {
    const runtime = createInfraRuntime({ runtimeId: `external-watch-test-${Date.now()}-${Math.random()}` });
    RUNTIMES.push(runtime);
    return runtime;
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
    await Promise.allSettled(RUNTIMES.splice(0).map((runtime) => runtime.dispose()));
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

describe('infra/filesystem/invalidation/external-watch runtime ownership', () => {
    it('publica hint bounded para alteração nested e filtra domínio hidden', async () => {
        const root = await createTempDir();
        const nested = join(root, 'nested');
        const file = join(nested, 'module.js');
        await mkdir(nested, { recursive: true });
        const runtime = createTestRuntime();
        const workspace = runtime.workspace(root);
        /** @type {{ filePath: string; source: string }[]} */
        const invalidations = [];

        const started = await workspace.startExternalWatch(root, {
            enabled: true,
            debounceMs: 20,
            onInvalidate: (filePath, event) => invalidations.push({ filePath, source: event.source }),
        });
        expect(started).toMatchObject({ started: true, reused: false });
        expect(await workspace.startExternalWatch(root, { enabled: true })).toMatchObject({
            started: true,
            reused: true,
        });

        await writeFile(file, 'export const watched = true;\n', 'utf8');
        await waitUntil(() => invalidations.some((entry) => entry.filePath === file));
        expect(invalidations.find((entry) => entry.filePath === file)?.source).toBe('external-watch');

        const hiddenDir = join(root, '.ai', 'jobs');
        const hiddenFile = join(hiddenDir, 'job.js');
        await mkdir(hiddenDir, { recursive: true });
        await writeFile(hiddenFile, 'export const hidden = true;\n', 'utf8');
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(invalidations.some((entry) => entry.filePath === hiddenFile)).toBe(false);
        const stats = workspace.externalWatchStats()[0];
        expect(stats).toMatchObject({ watching: true, invalidated: expect.any(Number), errors: 0, dropped: 0 });
        expect(stats?.invalidated).toBeGreaterThanOrEqual(1);
        expect(stats?.filtered).toBeGreaterThanOrEqual(1);
    });

    it('reference-counts watcher leases and stops only when the final consumer releases', async () => {
        const root = await createTempDir();
        const runtime = createTestRuntime();
        const workspace = runtime.workspace(root);

        const first = await workspace.acquireExternalWatch(root, { enabled: true });
        const second = await workspace.acquireExternalWatch(root, { enabled: true });
        expect(first).toMatchObject({ started: true, reused: false, leases: 1 });
        expect(second).toMatchObject({ started: true, reused: true, leases: 2 });
        expect(workspace.externalWatchStats()[0]).toMatchObject({ watching: true, leases: 2 });
        expect(workspace.lifecycleSnapshot()).toMatchObject({ activeExternalWatchers: 1, externalWatchLeases: 2 });

        expect(first.release()).toBe(true);
        expect(first.release()).toBe(false);
        expect(workspace.externalWatchStats()[0]).toMatchObject({ watching: true, leases: 1 });

        expect(second.release()).toBe(true);
        expect(workspace.externalWatchStats()[0]).toMatchObject({ watching: false, leases: 0 });
        expect(workspace.lifecycleSnapshot()).toMatchObject({ activeExternalWatchers: 0, externalWatchLeases: 0 });

        const restarted = await workspace.acquireExternalWatch(root, { enabled: true });
        expect(restarted).toMatchObject({ started: true, reused: false, leases: 1 });
        expect(restarted.release()).toBe(true);
    });

    it('suprime hint do mesmo evento quando invalidation canônica da instância já o cobriu', async () => {
        const root = await createTempDir();
        const file = join(root, 'canonical.js');
        const runtime = createTestRuntime();
        const workspace = runtime.workspace(root);
        /** @type {string[]} */
        const invalidations = [];
        await workspace.startExternalWatch(root, {
            enabled: true,
            debounceMs: 100,
            onInvalidate: (filePath) => invalidations.push(filePath),
        });

        await writeFile(file, 'export const canonical = true;\n', 'utf8');
        await waitUntil(() => Number(workspace.externalWatchStats()[0]?.queued ?? 0) >= 1);
        runtime.coherence.invalidation.publish(file, { source: 'canonical-test' });
        await new Promise((resolve) => setTimeout(resolve, 180));

        const stats = workspace.externalWatchStats()[0];
        expect(invalidations).not.toContain(file);
        expect(stats?.canonicalSuppressed).toBeGreaterThanOrEqual(1);
        expect(stats?.invalidated).toBe(0);
    });
});
