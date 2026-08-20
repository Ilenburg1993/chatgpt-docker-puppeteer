// @ts-check

import { channel } from 'node:diagnostics_channel';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    acquireIoResourceLock,
    acquireIoResourceLocks,
    getIoLockStats,
    withIoResourceLock,
} from '../../../../src/copilot/infra/io-locks.js';
import { acquireLock, releaseLock, releaseLockAsync } from '../../../../src/copilot/infra/lockfile.js';
import {
    acquireFileResourceLock,
    getFileResourceLockProfile,
    hashFileResourceLockKey,
    shouldAcquireFileResourceLock,
} from '../../../../src/copilot/infra/locks/file-resource-lock.js';

/** @type {string[]} */
const TEMP_DIRS = [];
const ORIGINAL_FILE_LOCK_PROFILE = process.env['COPILOT_IO_FILE_LOCKS_ENABLED'];

afterEach(async () => {
    if (ORIGINAL_FILE_LOCK_PROFILE === undefined) {
        delete process.env['COPILOT_IO_FILE_LOCKS_ENABLED'];
    } else {
        process.env['COPILOT_IO_FILE_LOCKS_ENABLED'] = ORIGINAL_FILE_LOCK_PROFILE;
    }
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

    it('expõe contenção L0 e lease sanitizado sem path do recurso', async () => {
        const dir = await createTempDir();
        const resource = join(dir, 'sensitive-resource.txt');
        const before = getIoLockStats();
        const holder = await acquireIoResourceLock(resource, { operation: 'unit-write' });
        /** @type {Record<string, unknown>[]} */
        const staleEvents = [];
        const lockChannel = channel('copilot.io.lock');
        /** @param {unknown} message */
        const onLockEvent = (message) => staleEvents.push(/** @type {Record<string, unknown>} */ (message));
        lockChannel.subscribe(onLockEvent);

        try {
            const active = getIoLockStats();
            expect(active.activeLeases).toBeGreaterThanOrEqual(1);
            expect(active.activeLeaseSample).toContainEqual(
                expect.objectContaining({
                    resourceHash: hashFileResourceLockKey(resource),
                    operation: 'unit-write',
                    fileLockEnabled: false,
                }),
            );
            const stale = getIoLockStats({ nowMs: Date.now() + active.activeLeaseWarnMs + 1 });
            expect(stale.staleActiveLeases).toBeGreaterThanOrEqual(1);
            expect(stale.oldestActiveLeaseAgeMs).toBeGreaterThanOrEqual(active.activeLeaseWarnMs);
            getIoLockStats({ nowMs: Date.now() + active.activeLeaseWarnMs + 2 });
            expect(staleEvents.filter((event) => event['phase'] === 'lease.stale')).toHaveLength(1);
            expect(JSON.stringify(staleEvents)).not.toContain(resource);
            expect(JSON.stringify(active)).not.toContain(resource);

            await expect(
                acquireIoResourceLock(resource, { timeoutMs: 5, operation: 'unit-timeout' }),
            ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
            const after = getIoLockStats();
            expect(after.contended).toBe(before.contended + 1);
            expect(after.timeouts).toBe(before.timeouts + 1);
            expect(after.wait.overall.count).toBeGreaterThan(before.wait.overall.count);
            expect(after.wait.byOperation['unit-write']).toMatchObject({ count: expect.any(Number) });
        } finally {
            lockChannel.unsubscribe(onLockEvent);
            await holder.releaseAsync();
        }
    });

    it('expõe espera e lease L1 sanitizados e contabiliza timeout', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.private-locks');
        const resource = join(dir, 'private-target.txt');
        const before = getIoLockStats().fileLocks;
        const holder = await acquireFileResourceLock(resource, {
            lockDir,
            operation: 'unit-l1',
            timeoutMs: 100,
        });

        try {
            const active = getIoLockStats().fileLocks;
            expect(active.activeLeaseSample).toContainEqual(
                expect.objectContaining({
                    resourceHash: hashFileResourceLockKey(resource),
                    operation: 'unit-l1',
                }),
            );
            expect(JSON.stringify(active)).not.toContain(resource);
            expect(JSON.stringify(active)).not.toContain(lockDir);

            await expect(
                acquireFileResourceLock(resource, {
                    lockDir,
                    operation: 'unit-l1-timeout',
                    timeoutMs: 5,
                    pollMs: 1,
                }),
            ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
            const after = getIoLockStats().fileLocks;
            expect(after.contended).toBe(before.contended + 1);
            expect(after.timeouts).toBe(before.timeouts + 1);
            expect(after.wait.overall.count).toBeGreaterThan(before.wait.overall.count);
        } finally {
            await holder.release();
        }
    });

    it('contabiliza abort antes da aquisição em L0 e L1', async () => {
        const dir = await createTempDir();
        const resource = join(dir, 'aborted-resource.txt');
        const lockDir = join(dir, '.abort-locks');
        const before = getIoLockStats();
        const l0Controller = new AbortController();
        l0Controller.abort();

        await expect(
            acquireIoResourceLock(resource, {
                operation: 'unit-abort-l0',
                signal: l0Controller.signal,
            }),
        ).rejects.toMatchObject({ code: 'ABORT_ERR' });
        expect(getIoLockStats().aborts).toBe(before.aborts + 1);

        const l1Controller = new AbortController();
        l1Controller.abort();
        await expect(
            acquireFileResourceLock(resource, {
                lockDir,
                operation: 'unit-abort-l1',
                signal: l1Controller.signal,
            }),
        ).rejects.toMatchObject({ code: 'ABORT_ERR' });
        expect(getIoLockStats().fileLocks.aborts).toBe(before.fileLocks.aborts + 1);
    });

    it('resolve perfis L1 por risco preservando booleano legado como all', () => {
        delete process.env['COPILOT_IO_FILE_LOCKS_ENABLED'];
        expect(getFileResourceLockProfile()).toBe('off');
        expect(shouldAcquireFileResourceLock({ riskClass: 'critical' })).toBe(false);

        process.env['COPILOT_IO_FILE_LOCKS_ENABLED'] = 'high-risk';
        expect(shouldAcquireFileResourceLock({ riskClass: 'medium' })).toBe(false);
        expect(shouldAcquireFileResourceLock({ riskClass: 'high' })).toBe(true);
        expect(shouldAcquireFileResourceLock({ riskClass: 'critical' })).toBe(true);

        process.env['COPILOT_IO_FILE_LOCKS_ENABLED'] = 'mutations';
        expect(shouldAcquireFileResourceLock({ riskClass: 'low' })).toBe(false);
        expect(shouldAcquireFileResourceLock({ riskClass: 'medium' })).toBe(true);

        process.env['COPILOT_IO_FILE_LOCKS_ENABLED'] = '1';
        expect(getFileResourceLockProfile()).toBe('all');
        expect(shouldAcquireFileResourceLock({ riskClass: 'low' })).toBe(true);
        expect(shouldAcquireFileResourceLock()).toBe(true);
    });

    it('aplica high-risk no lock composto e mantém override explícito', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.profile-locks');
        process.env['COPILOT_IO_FILE_LOCKS_ENABLED'] = 'high-risk';

        const medium = await acquireIoResourceLock(join(dir, 'medium.txt'), {
            fileLockDir: lockDir,
            operation: 'profile-medium',
            riskClass: 'medium',
        });
        expect(medium.fileLockEnabled).toBe(false);
        await medium.releaseAsync();

        const high = await acquireIoResourceLock(join(dir, 'high.txt'), {
            fileLockDir: lockDir,
            operation: 'profile-high',
            riskClass: 'high',
        });
        expect(high.fileLockEnabled).toBe(true);
        await high.releaseAsync();

        process.env['COPILOT_IO_FILE_LOCKS_ENABLED'] = 'off';
        const forced = await acquireIoResourceLock(join(dir, 'forced.txt'), {
            fileLock: true,
            fileLockDir: lockDir,
            operation: 'profile-forced',
            riskClass: 'low',
        });
        expect(forced.fileLockEnabled).toBe(true);
        await forced.releaseAsync();
    });

    it('rejeita perfil L1 desconhecido e mantém health configurável', () => {
        process.env['COPILOT_IO_FILE_LOCKS_ENABLED'] = 'surprise';
        expect(() => getFileResourceLockProfile()).toThrow(
            expect.objectContaining({ code: 'ERR_IO_FILE_LOCK_PROFILE' }),
        );
        expect(getIoLockStats().fileLocks).toMatchObject({
            enabledByEnv: false,
            profile: 'off',
            configurationValid: false,
        });
    });
});
