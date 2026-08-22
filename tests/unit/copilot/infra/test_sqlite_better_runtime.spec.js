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

        expect(runtime.status()).toEqual({ dbPath, open: false, disposed: false });
        expect(runtime.getDatabase().prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
        expect(runtime.getStructuralDatabase().prepare('SELECT 2 AS value').get()).toEqual({ value: 2 });
        expect(runtime.status()).toEqual({ dbPath, open: true, disposed: false });

        runtime.close();
        runtime.close();
        expect(runtime.status()).toEqual({ dbPath, open: false, disposed: true });
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
        expect(first.status()).toEqual({ dbPath: firstPath, open: false, disposed: true });
        expect(second.status()).toEqual({ dbPath: secondPath, open: true, disposed: false });
        expect(second.getDatabase().prepare('SELECT value FROM isolated').get()).toEqual({ value: 'second' });
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
