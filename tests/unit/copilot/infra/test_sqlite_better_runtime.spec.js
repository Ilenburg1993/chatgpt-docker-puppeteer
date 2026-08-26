// @ts-check

import { createBetterSqliteApplicationRuntime } from '#copilot/infra/internal/database/sqlite/better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {string[]} */
const tempDirs = [];
/** @type {Array<ReturnType<typeof createBetterSqliteApplicationRuntime>>} */
const runtimes = [];

afterEach(async () => {
    for (const runtime of runtimes.splice(0)) runtime.close();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-infra-sqlite-runtime-'));
    tempDirs.push(dir);
    return dir;
}

describe('Infra better-sqlite3 application resource', () => {
    it('is lazy, isolated and idempotently disposable', async () => {
        const root = await createTempDir();
        const dbPath = join(root, 'isolated.sqlite');
        const runtime = createBetterSqliteApplicationRuntime({ dbPath });
        runtimes.push(runtime);

        expect(runtime.status()).toEqual({ dbPath, open: false, disposed: false, checkpointInFlight: false });
        expect(runtime.getDatabase().prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
        expect(runtime.getStructuralDatabase().prepare('SELECT 2 AS value').get()).toEqual({ value: 2 });
        expect(runtime.status()).toEqual({ dbPath, open: true, disposed: false, checkpointInFlight: false });

        runtime.close();
        runtime.close();
        expect(runtime.status()).toEqual({ dbPath, open: false, disposed: true, checkpointInFlight: false });
        expect(() => runtime.getDatabase()).toThrow(/has been disposed/u);
    });

    it('allows independent resources with distinct paths instead of process-global retargeting', async () => {
        const root = await createTempDir();
        const firstPath = join(root, 'first.sqlite');
        const secondPath = join(root, 'second.sqlite');
        const first = createBetterSqliteApplicationRuntime({ dbPath: firstPath });
        const second = createBetterSqliteApplicationRuntime({ dbPath: secondPath });
        runtimes.push(first, second);

        first.getDatabase().exec("CREATE TABLE isolated(value TEXT); INSERT INTO isolated VALUES ('first');");
        second.getDatabase().exec("CREATE TABLE isolated(value TEXT); INSERT INTO isolated VALUES ('second');");

        expect(first.getDatabase().prepare('SELECT value FROM isolated').get()).toEqual({ value: 'first' });
        expect(second.getDatabase().prepare('SELECT value FROM isolated').get()).toEqual({ value: 'second' });

        first.close();
        expect(first.status()).toEqual({
            dbPath: firstPath,
            open: false,
            disposed: true,
            checkpointInFlight: false,
        });
        expect(second.status()).toEqual({
            dbPath: secondPath,
            open: true,
            disposed: false,
            checkpointInFlight: false,
        });
        expect(second.getDatabase().prepare('SELECT value FROM isolated').get()).toEqual({ value: 'second' });
    });

    it('offloads PASSIVE WAL checkpoint I/O to a coalesced worker-thread capability', async () => {
        const root = await createTempDir();
        const dbPath = join(root, 'checkpoint.sqlite');
        const runtime = createBetterSqliteApplicationRuntime({ dbPath });
        runtimes.push(runtime);
        const database = runtime.getDatabase();
        database.exec('CREATE TABLE checkpoint_probe(id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
        const insert = database.prepare('INSERT INTO checkpoint_probe(payload) VALUES (?)');
        const write = database.transaction(() => {
            for (let index = 0; index < 2_000; index += 1) insert.run(`payload-${index}-${'x'.repeat(64)}`);
        });
        write();

        const first = runtime.checkpoint();
        const second = runtime.checkpoint();
        expect(second).toBe(first);
        expect(runtime.status().checkpointInFlight).toBe(true);
        let eventLoopTurnObserved = false;
        await new Promise((resolve) =>
            setImmediate(() => {
                eventLoopTurnObserved = true;
                resolve(undefined);
            }),
        );
        const result = await first;

        expect(eventLoopTurnObserved).toBe(true);
        expect(result).toMatchObject({ attempted: true, mode: 'PASSIVE', busy: 0 });
        expect(result.walPages).toBeGreaterThanOrEqual(0);
        expect(result.checkpointedPages).toBeGreaterThanOrEqual(0);
        expect(result.durationMs).toBeGreaterThanOrEqual(result.workerDurationMs);
        expect(runtime.status().checkpointInFlight).toBe(false);
        expect(database.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    });

    it('supports explicit resource management without exporting application-global accessors', async () => {
        const root = await createTempDir();
        const runtime = createBetterSqliteApplicationRuntime({ dbPath: join(root, 'dispose.sqlite') });
        runtimes.push(runtime);
        runtime.getDatabase();
        expect(runtime.status().open).toBe(true);
        runtime[Symbol.dispose]();
        expect(runtime.status()).toMatchObject({ open: false, disposed: true });
    });
});
