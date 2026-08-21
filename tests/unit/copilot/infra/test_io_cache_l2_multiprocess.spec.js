// @ts-check

import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CACHE_URL = new URL('../../../../src/copilot/infra/cache/l2/sqlite/index.js', import.meta.url).href;
const DB_URL = new URL('../../../../src/copilot/db/sqlite.js', import.meta.url).href;

const CHILD_SCRIPT = `
const options = JSON.parse(process.env['COPILOT_L2_MULTIPROCESS_CASE']);
const print = (value) => process.stdout.write(JSON.stringify(value) + '\\n');

try {
    if (options.operation === 'pending-crash') {
        const [{ default: Database }, { createIoL2SqliteCache }] = await Promise.all([
            import('better-sqlite3'),
            import(options.cacheUrl),
        ]);
        const db = new Database(options.dbPath);
        db.pragma('journal_mode = WAL');
        const cache = createIoL2SqliteCache({ db, ttlMs: 60_000, setBatchWindowMs: 60_000 });
        cache.clearAll();
        cache.set({ key: options.key, path: '/l2/pending-crash', payload: 'pending-crash' });
        print({ ready: true });
        await new Promise(() => {});
    } else if (options.operation === 'graceful') {
        const [{ createInfraRuntime }, database] = await Promise.all([
            import('#copilot/infra/public/composition/runtime'),
            import(options.dbUrl),
        ]);
        await database.ensureCopilotDbDir();
        const runtime = createInfraRuntime({ runtimeId: 'l2-multiprocess-graceful', sqliteProvider: database.getCopilotDb });
        const cache = runtime.coherence.l2.get();
        if (!cache) throw new Error('L2 cache unavailable');
        cache.clearAll();
        cache.set({ key: options.key, path: '/l2/graceful', payload: 'graceful' });
        const before = database
            .getCopilotDb()
            .prepare('SELECT COUNT(*) AS total FROM copilot_io_cache_l2 WHERE cache_key = ?')
            .get(options.key);
        await runtime.dispose();
        database.closeCopilotDb();
        print({ ok: true, persistedBeforeShutdown: Number(before?.total || 0) });
    } else if (options.operation === 'signal-graceful') {
        const nativeSetTimeout = globalThis.setTimeout;
        globalThis.setTimeout = (handler, delay, ...args) =>
            nativeSetTimeout(handler, delay === 25 ? 60_000 : delay, ...args);
        const [{ createInfraRuntime }, database] = await Promise.all([
            import('#copilot/infra/public/composition/runtime'),
            import(options.dbUrl),
        ]);
        await database.ensureCopilotDbDir();
        const runtime = createInfraRuntime({ runtimeId: 'l2-multiprocess-signal', sqliteProvider: database.getCopilotDb });
        const keepAlive = setInterval(() => {}, 60_000);
        const shutdownFromSignal = (signal) => {
            clearInterval(keepAlive);
            void runtime.dispose().then(
                () => {
                    database.closeCopilotDb();
                    process.exit(0);
                },
                () => process.exit(1),
            );
        };
        process.once('SIGTERM', () => shutdownFromSignal('SIGTERM'));
        process.once('SIGINT', () => shutdownFromSignal('SIGINT'));
        const cache = runtime.coherence.l2.get();
        if (!cache) throw new Error('L2 cache unavailable');
        cache.clearAll();
        cache.set({ key: options.key, path: '/l2/signal-graceful', payload: 'signal-graceful' });
        const before = database
            .getCopilotDb()
            .prepare('SELECT COUNT(*) AS total FROM copilot_io_cache_l2 WHERE cache_key = ?')
            .get(options.key);
        print({ ready: true, persistedBeforeShutdown: Number(before?.total || 0) });
    } else if (options.operation === 'lock-holder') {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(options.dbPath);
        db.pragma('journal_mode = WAL');
        db.exec('BEGIN IMMEDIATE');
        print({ locked: true });
        await new Promise((resolve) => setTimeout(resolve, options.holdMs));
        db.exec('COMMIT');
        db.close();
        print({ released: true });
    } else if (options.operation === 'contention-writer') {
        const [{ default: Database }, { createIoL2SqliteCache }] = await Promise.all([
            import('better-sqlite3'),
            import(options.cacheUrl),
        ]);
        const db = new Database(options.dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 100');
        const cache = createIoL2SqliteCache({ db, ttlMs: 60_000, setBatchWindowMs: 60_000 });
        cache.set({ key: options.key, path: '/l2/contention', payload: 'contention' });
        const firstFlush = cache.flushPending();
        const readableAfterFailure = cache.get(options.key)?.payload.toString('utf8') === 'contention';
        await new Promise((resolve) => setTimeout(resolve, options.retryAfterMs));
        const secondFlush = cache.flushPending();
        const stats = cache.getStats();
        db.close();
        print({ ok: true, firstFlush, secondFlush, readableAfterFailure, stats });
    } else {
        throw new Error('unknown operation');
    }
} catch (error) {
    print({
        ok: false,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
}
`;

/** @type {string[]} */
const tempDirs = [];
/** @type {import('node:child_process').ChildProcess[]} */
const liveChildren = [];

afterEach(async () => {
    for (const child of liveChildren.splice(0)) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
    const dir = await mkdtemp(path.join(tmpdir(), 'copilot-l2-multiprocess-'));
    tempDirs.push(dir);
    return dir;
}

/**
 * @param {Record<string, unknown>} options
 */
function spawnCase(options) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            COPILOT_DB_PATH: String(options['dbPath']),
            IO_L2_CACHE_PROFILE: 'experimental',
            COPILOT_L2_MULTIPROCESS_CASE: JSON.stringify({
                cacheUrl: CACHE_URL,
                dbUrl: DB_URL,
                ...options,
            }),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    liveChildren.push(child);
    return child;
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {(value: Record<string, unknown>) => boolean} predicate
 * @param {number} [timeoutMs]
 */
function waitForJson(child, predicate, timeoutMs = 5_000) {
    return new Promise((/** @type {(value: Record<string, unknown>) => void} */ resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => finish(new Error(`child output timeout: ${stderr || stdout}`)), timeoutMs);

        function finish(
            /** @type {Error | null} */ error,
            /** @type {Record<string, unknown> | undefined} */ value = undefined,
        ) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.stdout?.off('data', onStdout);
            child.stderr?.off('data', onStderr);
            child.off('error', onError);
            child.off('close', onClose);
            if (error) reject(error);
            else if (value !== undefined) resolve(value);
        }

        function onStdout(/** @type {Buffer | string} */ chunk) {
            stdout += String(chunk);
            const lines = stdout.split('\n');
            stdout = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim().startsWith('{')) continue;
                const value = JSON.parse(line);
                if (predicate(value)) {
                    finish(null, value);
                    return;
                }
            }
        }

        function onStderr(/** @type {Buffer | string} */ chunk) {
            stderr += String(chunk);
        }

        function onError(/** @type {Error} */ error) {
            finish(error);
        }

        function onClose(/** @type {number | null} */ code, /** @type {NodeJS.Signals | null} */ signal) {
            finish(new Error(`child exited before expected output: code=${code} signal=${signal} ${stderr}`));
        }

        child.stdout?.on('data', onStdout);
        child.stderr?.on('data', onStderr);
        child.once('error', onError);
        child.once('close', onClose);
    });
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [timeoutMs]
 */
function waitForClose(child, timeoutMs = 5_000) {
    return new Promise(
        (/** @type {(value: { code: number | null; signal: NodeJS.Signals | null }) => void} */ resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('child close timeout')), timeoutMs);
            child.once('close', (code, signal) => {
                clearTimeout(timer);
                resolve({ code, signal });
            });
        },
    );
}

/**
 * @param {Record<string, unknown>} options
 * @param {number} [timeoutMs]
 */
async function runCase(options, timeoutMs = 5_000) {
    const child = spawnCase(options);
    const closed = new Promise((resolve) => child.once('close', resolve));
    const result = await waitForJson(child, (value) => value['ok'] === true, timeoutMs);
    await closed;
    expect(child.exitCode).toBe(0);
    return result;
}

describe('io-cache-l2 write-behind multiprocess proofs', () => {
    it('limits SIGKILL loss to the unconfirmed pending batch', async () => {
        const dir = await createTempDir();
        const dbPath = path.join(dir, 'crash.sqlite');
        const key = 'pending-crash';
        const child = spawnCase({ operation: 'pending-crash', dbPath, key });

        await waitForJson(child, (value) => value['ready'] === true);
        child.kill('SIGKILL');
        await new Promise((resolve) => child.once('close', resolve));
        expect(child.signalCode).toBe('SIGKILL');

        const db = new Database(dbPath);
        expect(
            db.prepare('SELECT COUNT(*) AS total FROM copilot_io_cache_l2 WHERE cache_key = ?').get(key),
        ).toMatchObject({ total: 0 });
        expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
        db.close();
    }, 15_000);

    it('flushes the pending batch before the database closes on coordinated shutdown', async () => {
        const dir = await createTempDir();
        const dbPath = path.join(dir, 'graceful.sqlite');
        const key = 'graceful';

        const result = await runCase({ operation: 'graceful', dbPath, key }, 10_000);
        expect(result).toMatchObject({ ok: true, persistedBeforeShutdown: 0 });

        const db = new Database(dbPath);
        const row = /** @type {{ payload: Buffer }} */ (
            db.prepare('SELECT payload FROM copilot_io_cache_l2 WHERE cache_key = ?').get(key)
        );
        expect(row.payload.toString('utf8')).toBe('graceful');
        expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
        db.close();
    }, 15_000);

    it('explicit signal owner disposes runtime and flushes cache before database close', async () => {
        const dir = await createTempDir();
        const dbPath = path.join(dir, 'signal-graceful.sqlite');
        const key = 'signal-graceful';
        const child = spawnCase({ operation: 'signal-graceful', dbPath, key });
        const closed = waitForClose(child, 10_000);

        const ready = await waitForJson(child, (value) => value['ready'] === true);
        expect(ready).toMatchObject({ persistedBeforeShutdown: 0 });
        child.kill('SIGTERM');
        await expect(closed).resolves.toEqual({ code: 0, signal: null });

        const db = new Database(dbPath);
        const row = /** @type {{ payload: Buffer }} */ (
            db.prepare('SELECT payload FROM copilot_io_cache_l2 WHERE cache_key = ?').get(key)
        );
        expect(row.payload.toString('utf8')).toBe('signal-graceful');
        expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
        db.close();
    }, 15_000);

    it('keeps a failed batch readable and persists it after external SQLite contention clears', async () => {
        const dir = await createTempDir();
        const dbPath = path.join(dir, 'contention.sqlite');
        const key = 'contention';

        const setup = new Database(dbPath);
        const { createIoL2SqliteCache } = await import('../../../../src/copilot/infra/cache/l2/sqlite/index.js');
        createIoL2SqliteCache({ db: setup }).clearAll();
        setup.close();

        const holder = spawnCase({ operation: 'lock-holder', dbPath, holdMs: 700 });
        const holderClosed = new Promise((resolve) => holder.once('close', resolve));
        await waitForJson(holder, (value) => value['locked'] === true);
        const writerResult = await runCase({ operation: 'contention-writer', dbPath, key, retryAfterMs: 850 }, 10_000);
        await holderClosed;
        expect(holder.exitCode).toBe(0);

        expect(writerResult).toMatchObject({
            ok: true,
            firstFlush: 0,
            secondFlush: 1,
            readableAfterFailure: true,
            stats: {
                errors: 1,
                batchFailures: 1,
                batchFlushes: 1,
                batchedRows: 1,
                pendingSets: 0,
            },
        });

        const db = new Database(dbPath);
        const row = /** @type {{ payload: Buffer }} */ (
            db.prepare('SELECT payload FROM copilot_io_cache_l2 WHERE cache_key = ?').get(key)
        );
        expect(row.payload.toString('utf8')).toBe('contention');
        expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
        db.close();
    }, 20_000);
});
