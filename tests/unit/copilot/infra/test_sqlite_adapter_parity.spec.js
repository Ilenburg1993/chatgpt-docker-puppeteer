// @ts-check

import { adaptBetterSqliteDatabase } from '#copilot/infra/internal/database/sqlite/better-sqlite3';
import { createNodeSqliteInfraRuntime } from '#copilot/infra/internal/database/sqlite/node-sqlite';
import { createCrossProcessInvalidationJournal } from '#copilot/infra/internal/filesystem/invalidation';
import { ensureIoIndexSchema } from '#copilot/infra/internal/indexing/registry/sqlite/schema';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { createIoL2SqliteCache } from '../../../../src/copilot/infra/cache/l2/sqlite/index.js';
import { createIoIndexSqlite } from '../../../../src/copilot/infra/indexing/registry/sqlite/index.js';

/** @type {Array<() => void>} */
const cleanups = [];
/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    while (tempDirs.length > 0) rmSync(tempDirs.pop() ?? '', { recursive: true, force: true });
});

function createBetterPort() {
    const database = new Database(':memory:');
    cleanups.push(() => database.close());
    return adaptBetterSqliteDatabase(database);
}

function createNodePort() {
    const runtime = createNodeSqliteInfraRuntime({ dbPath: ':memory:' });
    cleanups.push(runtime.close);
    return runtime.port;
}

/** @param {'better-sqlite3'|'node:sqlite'} adapter @param {string} dbPath */
function createFileBackedPair(adapter, dbPath) {
    if (adapter === 'better-sqlite3') {
        const first = new Database(dbPath);
        const second = new Database(dbPath);
        cleanups.push(
            () => first.close(),
            () => second.close(),
        );
        return [adaptBetterSqliteDatabase(first), adaptBetterSqliteDatabase(second)];
    }
    const first = createNodeSqliteInfraRuntime({ dbPath });
    const second = createNodeSqliteInfraRuntime({ dbPath });
    cleanups.push(first.close, second.close);
    return [first.port, second.port];
}

/** @type {ReadonlyArray<readonly [string, () => ReturnType<typeof createBetterPort>]>} */
const ADAPTERS = Object.freeze([
    ['better-sqlite3', createBetterPort],
    ['node:sqlite', createNodePort],
]);

/** @param {unknown} row */
function plainRow(row) {
    return row && typeof row === 'object' ? { .../** @type {Record<string, unknown>} */ (row) } : row;
}

/** @param {ReturnType<typeof createBetterPort>} db */
function exerciseSqlCore(db) {
    db.exec('CREATE TABLE parity_tx(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
    const insert = db.prepare('INSERT INTO parity_tx(value) VALUES (?)');
    const named = db.prepare('INSERT INTO parity_tx(value) VALUES (@value)');
    const read = db.prepare('SELECT id, value FROM parity_tx ORDER BY id');

    db.transaction?.(() => {
        const rootInsert = insert.run('root');
        expect(Number(rootInsert.changes)).toBe(1);
        expect(Number(rootInsert.lastInsertRowid)).toBe(1);
        db.transaction?.(() => {
            const nestedInsert = named.run({ value: 'nested' });
            expect(Number(nestedInsert.changes)).toBe(1);
            expect(Number(nestedInsert.lastInsertRowid)).toBe(2);
        })();
    })();

    expect(read.all().map(plainRow)).toEqual([
        { id: 1, value: 'root' },
        { id: 2, value: 'nested' },
    ]);

    expect(() =>
        db.transaction?.(() => {
            insert.run('rollback');
            throw new Error('force-rollback');
        })(),
    ).toThrow('force-rollback');
    expect(read.all().map(plainRow)).toEqual([
        { id: 1, value: 'root' },
        { id: 2, value: 'nested' },
    ]);
}

/** @param {ReturnType<typeof createBetterPort>} db */
async function exerciseOwners(db) {
    const cache = createIoL2SqliteCache({
        db,
        ttlMs: 60_000,
        minBytes: 0,
        setBatchWindowMs: 60_000,
        setBatchMaxEntries: 16,
    });
    cache.clearAll();
    cache.set({
        key: 'parity-key',
        path: '/workspace/parity.txt',
        kind: 'text',
        payload: Buffer.from('cache-payload', 'utf8'),
        encoding: 'utf8',
        sizeBytes: 13,
    });
    expect(cache.flushPending()).toBe(1);
    expect(cache.get('parity-key')?.payload.toString('utf8')).toBe('cache-payload');
    expect(cache.getStats()).toMatchObject({ size: 1 });

    expect(ensureIoIndexSchema(db)).toBeGreaterThanOrEqual(2);
    const index = createIoIndexSqlite({ db, now: () => 2_000 });
    await index.indexTextFile(
        {
            filePath: '/workspace/docs/parity.md',
            workspaceRoot: '/workspace',
            content: '# Parity\n\nalpha beta gamma\n',
            sizeBytes: 28,
            mtimeMs: 1_500,
        },
        { confirmCurrent: false },
    );
    expect(index.getStats()).toMatchObject({ files: 1 });
    const results = index.search('alpha', { maxResults: 10 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ relativePath: 'docs/parity.md' });

    const journalA = createCrossProcessInvalidationJournal({
        db,
        processInstance: 'adapter-parity-a',
        config: { cleanupIntervalMs: 60_000 },
    });
    const journalB = createCrossProcessInvalidationJournal({
        db,
        processInstance: 'adapter-parity-b',
        config: { cleanupIntervalMs: 60_000 },
    });
    const sequence = journalA.publish('/workspace/docs/parity.md', { recursive: true, source: 'adapter-parity' });
    /** @type {Array<{filePath:string;recursive:boolean;source:string;sequence:number}>} */
    const observed = [];
    const poll = journalB.poll((filePath, event) => observed.push({ filePath, ...event }));
    expect(sequence).toBeGreaterThan(0);
    expect(poll).toMatchObject({ observed: 1, received: 1, gapDetected: false });
    expect(observed).toEqual([
        {
            filePath: '/workspace/docs/parity.md',
            recursive: true,
            source: 'cross-process:adapter-parity',
            sequence,
            createdAtMs: expect.any(Number),
        },
    ]);
}

describe.each(ADAPTERS)('SQLite adapter parity: %s', (_name, createPort) => {
    it('preserves positional/named statements and nested transactional rollback', () => {
        exerciseSqlCore(createPort());
    });

    it('runs the real L2, index and cross-process invalidation owners', async () => {
        await exerciseOwners(createPort());
    });
});

describe.each(['better-sqlite3', 'node:sqlite'])('SQLite busy-lock parity: %s', (adapter) => {
    it('honors busy_timeout and becomes writable after the competing transaction releases the lock', () => {
        const root = mkdtempSync(join(tmpdir(), 'copilot-sqlite-busy-parity-'));
        tempDirs.push(root);
        const [writer, contender] = createFileBackedPair(
            /** @type {'better-sqlite3'|'node:sqlite'} */ (adapter),
            join(root, 'busy.sqlite'),
        );
        expect(writer).toBeDefined();
        expect(contender).toBeDefined();
        const first = /** @type {NonNullable<typeof writer>} */ (writer);
        const second = /** @type {NonNullable<typeof contender>} */ (contender);
        first.exec(
            'PRAGMA busy_timeout=25; CREATE TABLE busy_parity(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT',
        );
        second.exec('PRAGMA busy_timeout=25');
        first.exec("BEGIN IMMEDIATE; INSERT INTO busy_parity(value) VALUES ('held')");

        const startedAt = performance.now();
        /** @type {unknown} */
        let busyError = null;
        try {
            second.prepare('INSERT INTO busy_parity(value) VALUES (?)').run('blocked');
        } catch (error) {
            busyError = error;
        }
        const elapsedMs = performance.now() - startedAt;
        expect(busyError).toBeInstanceOf(Error);
        expect(busyError instanceof Error ? busyError.message : String(busyError)).toMatch(/database is locked/iu);
        expect(elapsedMs).toBeGreaterThanOrEqual(15);
        if (adapter === 'better-sqlite3') {
            expect(/** @type {{code?:unknown}} */ (busyError).code).toBe('SQLITE_BUSY');
        } else {
            expect(/** @type {{code?:unknown;errcode?:unknown}} */ (busyError).code).toBe('ERR_SQLITE_ERROR');
            expect(Number(/** @type {{errcode?:unknown}} */ (busyError).errcode)).toBe(5);
        }

        first.exec('ROLLBACK');
        const released = second.prepare('INSERT INTO busy_parity(value) VALUES (?)').run('released');
        expect(Number(released.changes)).toBe(1);
    });
});
