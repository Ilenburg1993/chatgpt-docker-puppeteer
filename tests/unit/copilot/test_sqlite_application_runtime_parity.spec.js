// @ts-check

import {
    createBetterSqliteApplicationRuntime,
    createNodeSqliteApplicationRuntime,
} from '#copilot/infra/public/testing/database/sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {string[]} */
const tempDirs = [];
/** @type {Array<() => void>} */
const cleanups = [];

afterEach(async () => {
    while (cleanups.length > 0) cleanups.pop()?.();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-sqlite-app-parity-'));
    tempDirs.push(dir);
    return dir;
}

/** @param {{prepare:(source:string)=>{get:(...args:unknown[])=>unknown;all:(...args:unknown[])=>unknown[]}}} db */
function readApplicationShape(db) {
    const migration = /** @type {{version?:unknown}|undefined} */ (
        db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
    );
    const objects = /** @type {{type?:unknown;name?:unknown}[]} */ (
        db
            .prepare(
                `SELECT type, name FROM sqlite_master
                 WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
                 ORDER BY type, name`,
            )
            .all()
    ).map((row) => ({ type: String(row.type), name: String(row.name) }));
    const journal = /** @type {{journal_mode?:unknown}|undefined} */ (db.prepare('PRAGMA journal_mode').get());
    const busy = /** @type {{timeout?:unknown}|undefined} */ (db.prepare('PRAGMA busy_timeout').get());
    const foreign = /** @type {{foreign_keys?:unknown}|undefined} */ (db.prepare('PRAGMA foreign_keys').get());
    return {
        migrationVersion: Number(migration?.version ?? 0),
        objects,
        journalMode: String(journal?.journal_mode ?? ''),
        busyTimeoutMs: Number(busy?.timeout ?? 0),
        foreignKeys: Number(foreign?.foreign_keys ?? 0),
    };
}

describe('application SQLite runtime parity', () => {
    it('better-sqlite3 and node:sqlite materialize the same application schema and connection policy', async () => {
        const root = await createTempDir();
        const betterPath = join(root, 'better.sqlite');
        const nodePath = join(root, 'node.sqlite');
        const better = createBetterSqliteApplicationRuntime({ dbPath: betterPath });
        const native = createNodeSqliteApplicationRuntime({ dbPath: nodePath });
        cleanups.push(better.close, native.close);

        const betterDb = better.getDatabase();
        const nativeDb = native.port;
        const betterShape = readApplicationShape(better.getStructuralDatabase());
        const nativeShape = readApplicationShape(nativeDb);

        expect(betterShape.migrationVersion).toBeGreaterThanOrEqual(15);
        expect(nativeShape).toEqual(betterShape);
        expect(nativeShape).toMatchObject({
            journalMode: 'wal',
            busyTimeoutMs: 5_000,
            foreignKeys: 1,
        });

        betterDb.prepare('CREATE TABLE IF NOT EXISTS parity_backup(value TEXT NOT NULL) STRICT').run();
        betterDb.prepare('INSERT INTO parity_backup(value) VALUES (?)').run('better');
        nativeDb.exec('CREATE TABLE IF NOT EXISTS parity_backup(value TEXT NOT NULL) STRICT');
        nativeDb.prepare('INSERT INTO parity_backup(value) VALUES (?)').run('native');

        const betterBackupPath = join(root, 'better-backup.sqlite');
        const nodeBackupPath = join(root, 'node-backup.sqlite');
        await betterDb.backup(betterBackupPath);
        await native.backupTo(nodeBackupPath);

        const betterBackup = createBetterSqliteApplicationRuntime({ dbPath: betterBackupPath });
        const nodeBackup = createNodeSqliteApplicationRuntime({ dbPath: nodeBackupPath, readOnly: true });
        cleanups.push(betterBackup.close, nodeBackup.close);
        expect(betterBackup.getDatabase().prepare('SELECT value FROM parity_backup').get()).toEqual({
            value: 'better',
        });
        expect({
            .../** @type {Record<string,unknown>} */ (nodeBackup.port.prepare('SELECT value FROM parity_backup').get()),
        }).toEqual({
            value: 'native',
        });
    });
});
