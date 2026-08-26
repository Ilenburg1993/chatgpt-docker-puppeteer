// @ts-check

import { createApplicationInfraHost } from '#copilot/boot';
import { createBetterSqliteProvider } from '#copilot/infra/public/testing/database/sqlite';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {string[]} */
const tempRoots = [];
/** @type {Array<ReturnType<typeof createApplicationInfraHost>>} */
const hosts = [];
/** @typedef {{ensureDirectory:()=>Promise<unknown>;getDatabase:ReturnType<typeof createBetterSqliteProvider>}} TestSqliteProvider */
/** @type {Array<import('better-sqlite3').Database>} */
const databases = [];

async function createTempRoot() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'application-infra-host-'));
    tempRoots.push(root);
    return root;
}

afterEach(async () => {
    await Promise.allSettled(hosts.splice(0).map((host) => host.dispose()));
    for (const database of databases.splice(0)) {
        if (database.open) database.close();
    }
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ApplicationInfraHost', () => {
    it('owns the full ProcessInfra → InfraRuntime → WorkspaceInfra hierarchy with explicit identities', async () => {
        const root = await createTempRoot();
        const host = createApplicationInfraHost({
            hostId: 'unit-application-host',
            processId: 'unit-application-process',
            runtimeId: 'unit-application-runtime',
            defaultWorkspaceRoot: root,
            registerProcessShutdown: false,
        });
        hosts.push(host);

        const first = host.workspace();
        const second = host.workspace(root);
        expect(second).toBe(first);
        expect(first.workspaceId).toBe('unit-application-runtime:workspace:1');
        expect(host.processInfra.listRuntimes()).toEqual([host.runtime]);
        expect(host.runtime.listWorkspaces()).toEqual([first]);
        expect(host.snapshot()).toMatchObject({
            hostId: 'unit-application-host',
            state: 'active',
            processId: 'unit-application-process',
            runtimeId: 'unit-application-runtime',
            defaultWorkspaceRoot: path.resolve(root),
            shutdownRegistered: false,
            sqliteBootstrapInFlight: false,
            process: {
                state: 'active',
                runtimes: 1,
                runtimeGeneration: 1,
                runtimeIds: ['unit-application-runtime'],
            },
            runtime: {
                state: 'active',
                generation: 1,
                workspaces: 1,
                workspaceGeneration: 1,
                workspaceIdentities: [
                    {
                        workspaceId: 'unit-application-runtime:workspace:1',
                        workspaceRoot: path.resolve(root),
                        generation: 1,
                    },
                ],
            },
        });

        const firstDispose = host.dispose();
        const secondDispose = host.dispose();
        expect(secondDispose).toBe(firstDispose);
        await firstDispose;
        expect(host.snapshot()).toMatchObject({
            state: 'disposed',
            process: { state: 'disposed', runtimes: 0 },
            runtime: { state: 'disposed', workspaces: 0 },
        });
        expect(() => host.workspace(root)).toThrow(/disposed/iu);
    });

    it('anchors relative rollback policy to the host workspace identity', async () => {
        const root = await createTempRoot();
        const host = createApplicationInfraHost({
            hostId: 'rollback-identity-host',
            defaultWorkspaceRoot: root,
            registerProcessShutdown: false,
            env: { ...process.env, COPILOT_IO_ROLLBACK_DIR: 'relative-rollback' },
        });
        hosts.push(host);

        expect(host.processInfra.config.runtimeDefaults.rollback.directory).toBe(path.join(root, 'relative-rollback'));
        expect(host.runtime.config.rollback.directory).toBe(path.join(root, 'relative-rollback'));
    });

    it('exposes async disposal as the same idempotent host-owned teardown', async () => {
        const root = await createTempRoot();
        const host = createApplicationInfraHost({
            hostId: 'async-dispose-host',
            defaultWorkspaceRoot: root,
            registerProcessShutdown: false,
        });
        hosts.push(host);
        host.workspace();

        expect(typeof host[Symbol.asyncDispose]).toBe('function');
        const viaAsyncDispose = host[Symbol.asyncDispose]();
        const viaDispose = host.dispose();
        expect(viaAsyncDispose).toBe(viaDispose);
        await viaAsyncDispose;
        expect(host.snapshot()).toMatchObject({
            state: 'disposed',
            process: { state: 'disposed' },
            runtime: { state: 'disposed' },
        });
    });

    it('registers exactly one host-owned graceful-shutdown handler in its ProcessInfra controller', async () => {
        const root = await createTempRoot();
        const host = createApplicationInfraHost({
            hostId: 'shutdown-host',
            defaultWorkspaceRoot: root,
            registerProcessShutdown: true,
            shutdownHandlerName: 'test.application-infra.dispose',
            shutdownTimeoutMs: 12_345,
        });
        hosts.push(host);

        host.workspace();
        const registrations = host.processInfra.shutdown.handlers();
        expect(registrations).toEqual([
            {
                name: 'test.application-infra.dispose',
                phase: 'application-infra',
                timeoutMs: 12_345,
            },
        ]);
        expect(host.snapshot().shutdownRegistered).toBe(true);

        await host.processInfra.shutdown.run('unit-test');
        expect(host.snapshot().state).toBe('disposed');
        expect(host.processInfra.shutdown.lastReport()?.handlers[0]?.status).toBe('ok');
    });

    it('coalesces concurrent SQLite bootstrap and allows an explicit provider reset/rebind', async () => {
        const root = await createTempRoot();
        let loads = 0;
        const database = new Database(':memory:');
        databases.push(database);
        const host = createApplicationInfraHost({
            hostId: 'sqlite-host',
            defaultWorkspaceRoot: root,
            registerProcessShutdown: false,
            loadSqliteProvider: async () => {
                loads += 1;
                return {
                    ensureDirectory: async () => undefined,
                    getDatabase: createBetterSqliteProvider(() => database),
                };
            },
        });
        hosts.push(host);

        const results = await Promise.all(Array.from({ length: 16 }, () => host.bootstrapSqliteProvider()));
        expect(loads).toBe(1);
        expect(new Set(results.map((result) => result.revision)).size).toBe(1);
        expect(results.every((result) => result.configured)).toBe(true);

        const firstRevision = results[0]?.revision ?? -1;
        host.runtime.database.reset();
        const rebound = await host.bootstrapSqliteProvider();
        expect(loads).toBe(2);
        expect(rebound).toMatchObject({ configured: true });
        expect(rebound.revision).toBeGreaterThan(firstRevision);
    });

    it('delegates path-bound checkpoint maintenance and revokes that authority on structural provider rebind', async () => {
        const root = await createTempRoot();
        const database = new Database(':memory:');
        databases.push(database);
        let checkpointCalls = 0;
        const host = createApplicationInfraHost({
            hostId: 'sqlite-checkpoint-host',
            defaultWorkspaceRoot: root,
            registerProcessShutdown: false,
            loadSqliteProvider: async () => ({
                ensureDirectory: async () => undefined,
                getDatabase: createBetterSqliteProvider(() => database),
                checkpoint: async () => {
                    checkpointCalls += 1;
                    return {
                        attempted: true,
                        mode: /** @type {const} */ ('PASSIVE'),
                        busy: 0,
                        walPages: 7,
                        checkpointedPages: 7,
                        durationMs: 2,
                        workerDurationMs: 1,
                    };
                },
            }),
        });
        hosts.push(host);

        await host.bootstrapSqliteProvider();
        expect(host.snapshot().sqliteCheckpointConfigured).toBe(true);
        await expect(host.checkpointSqlite()).resolves.toMatchObject({
            attempted: true,
            mode: 'PASSIVE',
            walPages: 7,
        });
        expect(checkpointCalls).toBe(1);

        host.runtime.database.reset();
        host.configureSqliteProvider(createBetterSqliteProvider(() => database));
        expect(host.snapshot().sqliteCheckpointConfigured).toBe(false);
        await expect(host.checkpointSqlite()).resolves.toMatchObject({
            attempted: false,
            mode: 'PASSIVE',
            reason: 'application_sqlite_checkpoint_unavailable',
        });
        expect(checkpointCalls).toBe(1);
    });

    it('blocks late SQLite activation when dispose wins the race against an in-flight bootstrap', async () => {
        const root = await createTempRoot();
        const database = new Database(':memory:');
        databases.push(database);
        /** @type {(value:TestSqliteProvider)=>void} */
        let releaseProvider = () => {
            throw new Error('provider loader was not started');
        };
        const providerReady = new Promise((/** @type {(value:TestSqliteProvider)=>void} */ resolve) => {
            releaseProvider = /** @type {typeof releaseProvider} */ (resolve);
        });
        const host = createApplicationInfraHost({
            hostId: 'bootstrap-dispose-race-host',
            defaultWorkspaceRoot: root,
            registerProcessShutdown: false,
            loadSqliteProvider: async () => providerReady,
        });
        hosts.push(host);

        const bootstrap = host.bootstrapSqliteProvider();
        await Promise.resolve();
        expect(host.snapshot()).toMatchObject({ state: 'active', sqliteBootstrapInFlight: true });
        const dispose = host.dispose();
        expect(host.snapshot().state).toBe('disposing');

        releaseProvider({
            ensureDirectory: async () => undefined,
            getDatabase: createBetterSqliteProvider(() => database),
        });
        await expect(bootstrap).rejects.toThrow(/disposing/iu);
        await dispose;
        expect(host.runtime.database.status().configured).toBe(false);
        expect(host.snapshot()).toMatchObject({ state: 'disposed', sqliteBootstrapInFlight: false });
    });
});
