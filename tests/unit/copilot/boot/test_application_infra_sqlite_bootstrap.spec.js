// @ts-check

import { createApplicationInfraHost } from '#copilot/boot';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {Array<ReturnType<typeof createApplicationInfraHost>>} */
const hosts = [];
/** @type {string[]} */
const tempDirs = [];

async function createTempDir() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'copilot-application-infra-db-'));
    tempDirs.push(dir);
    return dir;
}

/** @param {string} filePath */
async function pathExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

afterEach(async () => {
    await Promise.allSettled(hosts.splice(0).map((host) => host.dispose()));
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('application infra SQLite bootstrap', () => {
    it('captures DB config once, coalesces bootstrap and owns connection shutdown', async () => {
        const tempDir = await createTempDir();
        const dbPath = path.join(tempDir, 'captured', 'copilot.sqlite');
        const ignoredLaterPath = path.join(tempDir, 'retargeted', 'copilot.sqlite');
        const env = { ...process.env, COPILOT_DB_PATH: dbPath };
        const host = createApplicationInfraHost({
            hostId: 'application-infra-sqlite-bootstrap-test',
            defaultWorkspaceRoot: tempDir,
            registerProcessShutdown: false,
            env,
        });
        hosts.push(host);

        // Mutation after composition must not retarget this host generation.
        env.COPILOT_DB_PATH = ignoredLaterPath;
        const results = await Promise.all(Array.from({ length: 12 }, () => host.bootstrapSqliteProvider()));
        const firstRevision = results[0]?.revision ?? -1;

        expect(results).toHaveLength(12);
        expect(results.every((result) => result.configured)).toBe(true);
        expect(new Set(results.map((result) => result.revision))).toEqual(new Set([firstRevision]));
        expect(host.snapshot().applicationDbPath).toBe(dbPath);
        expect(host.runtime.database.status()).toEqual({ configured: true, revision: firstRevision });
        expect(host.runtime.database.get().prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
        expect(await pathExists(dbPath)).toBe(true);
        expect(await pathExists(ignoredLaterPath)).toBe(false);
        host.runtime.database.reset();
        const rebound = await host.bootstrapSqliteProvider();
        expect(rebound.configured).toBe(true);
        expect(rebound.revision).toBeGreaterThan(firstRevision);
        expect(host.runtime.database.get().prepare('SELECT 2 AS value').get()).toEqual({ value: 2 });

        await host.dispose();
        hosts.splice(hosts.indexOf(host), 1);
        expect(host.snapshot().state).toBe('disposed');
        expect(host.runtime.database.status().configured).toBe(false);
        expect(() => host.runtime.database.get()).toThrow(/not configured/u);
    });
});
