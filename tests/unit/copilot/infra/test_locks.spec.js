// @ts-check

import { channel } from 'node:diagnostics_channel';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    acquireFileResourceLock,
    acquireIoResourceLock,
    acquireIoResourceLocks,
    getFileResourceLockProfile,
    getIoLockStats,
    hashFileResourceLockKey,
    readFileResourceLockPolicy,
    shouldAcquireFileResourceLock,
    withIoResourceLock,
} from '#copilot/infra/internal/concurrency/locks';
import { createProcessInfra } from '#copilot/infra/public/composition/process';

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

    it('acquireFileResourceLock é atômico para concorrência no mesmo lockfile', async () => {
        const dir = await createTempDir();
        const lockPath = join(dir, 'agent.lock');
        const attempts = await Promise.allSettled([
            acquireFileResourceLock(lockPath, { lockPath, timeoutMs: 0 }),
            acquireFileResourceLock(lockPath, { lockPath, timeoutMs: 0 }),
        ]);
        const acquired = attempts.filter((result) => result.status === 'fulfilled');
        const rejected = attempts.filter((result) => result.status === 'rejected');
        expect(acquired).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        if (rejected[0]?.status === 'rejected') expect(rejected[0].reason).toMatchObject({ code: 'ETIMEDOUT' });
        if (acquired[0]?.status === 'fulfilled') await acquired[0].value.release();
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

    it('lease canônico não toma nem remove lock estrangeiro ativo', async () => {
        const dir = await createTempDir();
        const lockPath = join(dir, 'foreign.lock');
        writeFileSync(
            lockPath,
            JSON.stringify({
                schemaVersion: 1,
                token: 'foreign-token',
                pid: process.pid,
                hostname: 'foreign-host',
                resourceKey: lockPath,
                resourceHash: hashFileResourceLockKey(lockPath),
                operation: 'foreign',
                target: lockPath,
                startedAt: new Date().toISOString(),
                startedAtMs: Date.now(),
            }),
            'utf8',
        );

        await expect(
            acquireFileResourceLock(lockPath, { lockPath, timeoutMs: 0, staleMs: 60_000 }),
        ).rejects.toMatchObject({
            code: 'ETIMEDOUT',
        });
        expect(existsSync(lockPath)).toBe(true);
    });

    it('lease.release remove lock pertencente ao processo atual', async () => {
        const dir = await createTempDir();
        const lockPath = join(dir, 'async.lock');
        const lease = await acquireFileResourceLock(lockPath, { lockPath });
        expect(existsSync(lockPath)).toBe(true);
        await lease.release();
        expect(existsSync(lockPath)).toBe(false);
    });

    it('acquireFileResourceLock persiste metadata do protocolo canônico', async () => {
        const dir = await createTempDir();
        const lockPath = join(dir, 'canonical.lock');
        const lease = await acquireFileResourceLock(lockPath, {
            lockPath,
            target: lockPath,
            operation: 'unit-canonical',
        });
        const metadata = JSON.parse(await readFile(lockPath, 'utf8'));
        expect(metadata).toMatchObject({
            schemaVersion: 1,
            pid: process.pid,
            resourceKey: lockPath,
            target: lockPath,
            operation: 'unit-canonical',
        });
        expect(metadata.token).toBe(lease.token);
        await lease.release();
    });

    it('acquireFileResourceLock recusa lock path simbólico', async () => {
        const dir = await createTempDir();
        const target = join(dir, 'target.lock');
        const lockPath = join(dir, 'symlink.lock');
        await writeFile(target, '{}', 'utf8');
        await symlink(target, lockPath);

        await expect(acquireFileResourceLock(lockPath, { lockPath })).rejects.toMatchObject({
            code: 'ERR_LOCKFILE_SYMLINK',
        });
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

    it('resolve perfis processuais por risco a partir de snapshots explícitos', () => {
        const off = readFileResourceLockPolicy({}, '/workspace');
        expect(off.profile).toBe('off');
        expect(shouldAcquireFileResourceLock({ riskClass: 'critical' }, off)).toBe(false);

        const highRisk = readFileResourceLockPolicy({ COPILOT_IO_FILE_LOCKS_ENABLED: 'high-risk' }, '/workspace');
        expect(shouldAcquireFileResourceLock({ riskClass: 'medium' }, highRisk)).toBe(false);
        expect(shouldAcquireFileResourceLock({ riskClass: 'high' }, highRisk)).toBe(true);
        expect(shouldAcquireFileResourceLock({ riskClass: 'critical' }, highRisk)).toBe(true);

        const mutations = readFileResourceLockPolicy({ COPILOT_IO_FILE_LOCKS_ENABLED: 'mutations' }, '/workspace');
        expect(shouldAcquireFileResourceLock({ riskClass: 'low' }, mutations)).toBe(false);
        expect(shouldAcquireFileResourceLock({ riskClass: 'medium' }, mutations)).toBe(true);

        const all = readFileResourceLockPolicy({ COPILOT_IO_FILE_LOCKS_ENABLED: '1' }, '/workspace');
        expect(all.profile).toBe('all');
        expect(shouldAcquireFileResourceLock({ riskClass: 'low' }, all)).toBe(true);
        expect(shouldAcquireFileResourceLock({}, all)).toBe(true);
        expect(Object.isFrozen(all)).toBe(true);
    });

    it('mantém override explícito de file lock independente do default processual', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.profile-locks');
        const forced = await acquireIoResourceLock(join(dir, 'forced.txt'), {
            fileLock: true,
            fileLockDir: lockDir,
            operation: 'profile-forced',
            riskClass: 'low',
        });
        expect(forced.fileLockEnabled).toBe(true);
        await forced.releaseAsync();
    });

    it('rejeita perfil processual desconhecido no resolver puro', () => {
        expect(() => readFileResourceLockPolicy({ COPILOT_IO_FILE_LOCKS_ENABLED: 'surprise' }, '/workspace')).toThrow(
            expect.objectContaining({ code: 'ERR_IO_FILE_LOCK_PROFILE' }),
        );
        expect(getIoLockStats().fileLocks).toMatchObject({
            processDefaultEnabled: getFileResourceLockProfile() !== 'off',
            profile: getFileResourceLockProfile(),
            configurationValid: true,
        });
    });

    it('ProcessInfra ativa uma única policy processual e dispose restaura o fallback puro', async () => {
        const processInfra = createProcessInfra({
            processId: `lock-owner-${Date.now()}`,
            env: {
                COPILOT_IO_FILE_LOCKS_ENABLED: 'high-risk',
                IO_LOCK_ACTIVE_LEASE_WARN_MS: '1234',
            },
            activateProcessPolicies: true,
        });
        try {
            expect(getFileResourceLockProfile()).toBe('high-risk');
            expect(getIoLockStats()).toMatchObject({
                activeLeaseWarnMs: 1234,
                fileLocks: { profile: 'high-risk', configurationValid: true, processDefaultEnabled: true },
            });
            expect(processInfra.lifecycleSnapshot().locks).toMatchObject({
                state: 'active',
                owner: { active: true, processId: processInfra.processId, fileProfile: 'high-risk' },
            });
            expect(() =>
                createProcessInfra({
                    processId: 'competing-lock-owner',
                    env: { COPILOT_IO_FILE_LOCKS_ENABLED: 'all' },
                    activateProcessPolicies: true,
                }),
            ).toThrow(expect.objectContaining({ code: 'ERR_PROCESS_LOCK_OWNER_ACTIVE' }));
        } finally {
            await processInfra.dispose();
        }
        expect(getFileResourceLockProfile()).toBe('off');
        expect(getIoLockStats().activeLeaseWarnMs).toBe(60_000);
    });

    it('ProcessInfra captura profile inválido como fail-safe observável sem habilitar file locks', async () => {
        const processInfra = createProcessInfra({
            processId: `lock-invalid-${Date.now()}`,
            env: { COPILOT_IO_FILE_LOCKS_ENABLED: 'surprise' },
            activateProcessPolicies: true,
        });
        try {
            expect(processInfra.config.locks.file.profile).toBe('off');
            expect(processInfra.config.locks.fileConfigurationError).toMatch(/surprise/iu);
            expect(() => getFileResourceLockProfile()).toThrow(
                expect.objectContaining({ code: 'ERR_IO_FILE_LOCK_PROFILE' }),
            );
            expect(getIoLockStats().fileLocks).toMatchObject({
                profile: 'off',
                configurationValid: false,
                processDefaultEnabled: false,
            });
        } finally {
            await processInfra.dispose();
        }
    });
});
