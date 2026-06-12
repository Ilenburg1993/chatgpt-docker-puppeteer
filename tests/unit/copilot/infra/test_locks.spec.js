// @ts-check

import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    acquireIoResourceLock,
    acquireIoResourceLocks,
    withIoResourceLock,
} from '../../../../src/copilot/infra/io-locks.js';
import { acquireLock, releaseLock, releaseLockAsync } from '../../../../src/copilot/infra/lockfile.js';

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

    it('releaseLockAsync remove lock do processo atual', async () => {
        const dir = await createTempDir();
        const lockPath = join(dir, 'async.lock');

        const acquired = await acquireLock(lockPath);
        expect(acquired).toBe(true);
        expect(existsSync(lockPath)).toBe(true);

        await releaseLockAsync(lockPath);
        expect(existsSync(lockPath)).toBe(false);
    });

    it('acquireLock usa metadata do L1 canônico no path legado', async () => {
        const dir = await createTempDir();
        const lockPath = join(dir, 'canonical.lock');

        expect(await acquireLock(lockPath)).toBe(true);
        const metadata = JSON.parse(await readFile(lockPath, 'utf8'));
        expect(metadata).toMatchObject({
            schemaVersion: 1,
            pid: process.pid,
            resourceKey: lockPath,
            target: lockPath,
        });
        expect(metadata.token).toEqual(expect.any(String));

        await releaseLockAsync(lockPath);
    });

    it('acquireLock recusa lock path simbólico', async () => {
        const dir = await createTempDir();
        const target = join(dir, 'target.lock');
        const lockPath = join(dir, 'symlink.lock');
        await writeFile(target, '{}', 'utf8');
        await symlink(target, lockPath);

        await expect(acquireLock(lockPath)).rejects.toMatchObject({ code: 'ERR_LOCKFILE_SYMLINK' });
        expect(existsSync(target)).toBe(true);
    });

    it('acquireIoResourceLock expõe lease com run e liberação por asyncDispose', async () => {
        const dir = await createTempDir();
        const filePath = join(dir, 'disposable.txt');

        const lease = await acquireIoResourceLock(filePath);
        const nested = await lease.run(() => withIoResourceLock(filePath, async () => 'nested', { timeoutMs: 25 }));

        expect(nested.value).toBe('nested');
        expect(nested.waitMs).toBe(0);

        await /** @type {{ [Symbol.asyncDispose]: () => Promise<void> }} */ (/** @type {unknown} */ (lease))[
            Symbol.asyncDispose
        ]();

        const reacquired = await withIoResourceLock(filePath, async () => 'ok', { timeoutMs: 100 });
        expect(reacquired.value).toBe('ok');
    });

    it('acquireIoResourceLocks expõe lease multi-recurso com run e liberação por asyncDispose', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'source.txt');
        const destination = join(dir, 'destination.txt');

        const lease = await acquireIoResourceLocks([source, destination]);
        const nested = await lease.run(async () => {
            const sourceLock = await withIoResourceLock(source, async () => 'source-ok', { timeoutMs: 25 });
            const destinationLock = await withIoResourceLock(destination, async () => 'destination-ok', {
                timeoutMs: 25,
            });
            return [sourceLock.value, destinationLock.value];
        });

        expect(nested).toEqual(['source-ok', 'destination-ok']);

        await /** @type {{ [Symbol.asyncDispose]: () => Promise<void> }} */ (/** @type {unknown} */ (lease))[
            Symbol.asyncDispose
        ]();

        const reacquired = await withIoResourceLock(source, async () => 'ok', { timeoutMs: 100 });
        expect(reacquired.value).toBe('ok');
    });
});
