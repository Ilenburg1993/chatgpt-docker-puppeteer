// @ts-check

import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { withIoResourceLock } from '../../../../src/copilot/infra/io-locks.js';
import { acquireLock, releaseLock } from '../../../../src/copilot/infra/lockfile.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-locks-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('infra locks', () => {
    it('serializa resource lock para path absoluto e relativo equivalentes', async () => {
        const dir = await createTempDir();
        const filePath = join(dir, 'resource.txt');
        const relativePath = relative(process.cwd(), filePath);

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            filePath,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );

        let acquired = false;
        const waiter = withIoResourceLock(relativePath, async () => {
            acquired = true;
            return 'ok';
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(acquired).toBe(false);

        release();
        await holder;
        await expect(waiter).resolves.toMatchObject({ value: 'ok' });
        expect(acquired).toBe(true);
    });

    it('acquireLock é atomico para concorrência no mesmo lockfile', async () => {
        const dir = await createTempDir();
        const lockPath = join(dir, 'agent.lock');

        const results = await Promise.all([acquireLock(lockPath), acquireLock(lockPath)]);

        expect(results.filter(Boolean)).toHaveLength(1);
        releaseLock(lockPath);
        expect(existsSync(lockPath)).toBe(false);
    });

    it('withIoResourceLock permite reentrância no mesmo recurso dentro do mesmo contexto', async () => {
        const dir = await createTempDir();
        const filePath = join(dir, 'reentrant.txt');

        const locked = await withIoResourceLock(filePath, async () => {
            const nested = await withIoResourceLock(filePath, async () => 'nested-ok', {
                timeoutMs: 25,
            });
            return nested;
        });

        expect(locked.value.value).toBe('nested-ok');
        expect(locked.value.waitMs).toBe(0);
    });

    it('releaseLock não remove lock de outro processo', async () => {
        const dir = await createTempDir();
        const lockPath = join(dir, 'foreign.lock');
        writeFileSync(lockPath, JSON.stringify({ pid: 1, createdAt: Date.now() }), 'utf8');

        releaseLock(lockPath);

        expect(existsSync(lockPath)).toBe(true);
    });
});
