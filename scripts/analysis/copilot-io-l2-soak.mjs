#!/usr/bin/env node
// @ts-check

import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const CYCLES = 24;
const ENTRIES_PER_CYCLE = 300;
const PAYLOAD_BYTES = 4 * 1024;
const MAX_ENTRIES = 500;
const TTL_MS = 250;

/**
 * @param {string} name
 * @returns {string | null}
 */
function optionValue(name) {
    const prefix = `${name}=`;
    const inline = process.argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = process.argv.indexOf(name);
    return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/**
 * @param {number} ms
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} filePath
 */
async function sizeIfPresent(filePath) {
    try {
        return (await stat(filePath)).size;
    } catch {
        return 0;
    }
}

/** @param {number} value */
function rounded(value) {
    return Number(value.toFixed(3));
}

async function main() {
    const outputPath = optionValue('--output');
    const directory = await mkdtemp(path.join(tmpdir(), 'copilot-io-l2-soak-'));
    const dbPath = path.join(directory, 'copilot-l2-soak.sqlite');
    const walPath = `${dbPath}-wal`;
    const previousEnv = {
        dbPath: process.env['COPILOT_DB_PATH'],
        profile: process.env['IO_L2_CACHE_PROFILE'],
        ttlMs: process.env['IO_L2_CACHE_TTL_MS'],
        maxEntries: process.env['IO_L2_CACHE_MAX_ENTRIES'],
        pruneMs: process.env['IO_L2_CACHE_PRUNE_MS'],
        minBytes: process.env['IO_L2_CACHE_MIN_BYTES'],
    };

    process.env['COPILOT_DB_PATH'] = dbPath;
    process.env['IO_L2_CACHE_PROFILE'] = 'experimental';
    process.env['IO_L2_CACHE_TTL_MS'] = String(TTL_MS);
    process.env['IO_L2_CACHE_MAX_ENTRIES'] = String(MAX_ENTRIES);
    process.env['IO_L2_CACHE_PRUNE_MS'] = '60000';
    process.env['IO_L2_CACHE_MIN_BYTES'] = '0';

    const startedAt = performance.now();
    let summary;
    try {
        const [{ default: Database }, registry, database, core] = await Promise.all([
            import('better-sqlite3'),
            import('../../src/copilot/infra/io-cache-l2-registry.js'),
            import('../../src/copilot/db/sqlite.js'),
            import('../../src/copilot/core/index.js'),
        ]);

        const cache = registry.getIoL2Cache();
        assert.ok(cache, 'experimental profile must initialize L2');
        cache.clearAll();

        const heapStart = process.memoryUsage().heapUsed;
        let heapPeak = heapStart;
        let maxObservedEntries = 0;
        let immediatePendingHits = 0;
        /** @type {Array<{ cycle: number; size: number; batchFlushes: number; averageBatchSize: number }>} */
        const cycleSamples = [];

        for (let cycle = 0; cycle < CYCLES; cycle += 1) {
            for (let entry = 0; entry < ENTRIES_PER_CYCLE; entry += 1) {
                const ordinal = cycle * ENTRIES_PER_CYCLE + entry;
                const key = `soak:${ordinal}`;
                const payload = Buffer.alloc(PAYLOAD_BYTES, ordinal % 251);
                assert.equal(
                    cache.set({
                        key,
                        path: `/copilot-io-l2-soak/${cycle}/${entry}.bin`,
                        payload,
                        sizeBytes: payload.byteLength,
                    }),
                    true,
                );
                if (entry === ENTRIES_PER_CYCLE - 1 && cache.get(key)?.payload.equals(payload)) {
                    immediatePendingHits += 1;
                }
            }

            await sleep(30);
            /** @type {{ batchFailures: number; pendingSets: number; size: number; batchFlushes: number; averageBatchSize: number }} */
            const stats = cache.getStats();
            assert.equal(stats.batchFailures, 0);
            assert.equal(stats.pendingSets, 0);
            assert.ok(stats.size <= MAX_ENTRIES, `L2 size exceeded cap: ${stats.size}`);
            maxObservedEntries = Math.max(maxObservedEntries, stats.size);
            heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
            cycleSamples.push({
                cycle,
                size: stats.size,
                batchFlushes: stats.batchFlushes,
                averageBatchSize: stats.averageBatchSize,
            });
        }

        const stressStats = cache.getStats();
        assert.equal(immediatePendingHits, CYCLES);
        assert.equal(stressStats.sets, CYCLES * ENTRIES_PER_CYCLE);
        assert.equal(stressStats.batchFailures, 0);
        assert.ok(stressStats.size <= MAX_ENTRIES);

        await sleep(TTL_MS + 75);
        const expiredRemoved = cache.pruneExpired();
        const postExpiryStats = cache.getStats();
        assert.ok(expiredRemoved > 0);
        assert.equal(postExpiryStats.size, 0);

        cache.set({ key: 'transition:experimental-on', path: '/l2/transition-on', payload: 'transition-on' });
        process.env['IO_L2_CACHE_PROFILE'] = 'on';
        const onCache = registry.getIoL2Cache();
        assert.ok(onCache && onCache !== cache);
        assert.equal(onCache.get('transition:experimental-on')?.payload.toString('utf8'), 'transition-on');

        onCache.set({ key: 'transition:on-off', path: '/l2/transition-off', payload: 'transition-off' });
        process.env['IO_L2_CACHE_PROFILE'] = 'off';
        assert.equal(registry.getIoL2Cache(), null);

        process.env['IO_L2_CACHE_PROFILE'] = 'on';
        const resumedCache = registry.getIoL2Cache();
        assert.ok(resumedCache && resumedCache !== onCache);
        assert.equal(resumedCache.get('transition:on-off')?.payload.toString('utf8'), 'transition-off');

        for (let entry = 0; entry < 100; entry += 1) {
            resumedCache.set({
                key: `final:${entry}`,
                path: `/l2/final/${entry}.txt`,
                payload: `final-${entry}`,
            });
        }
        assert.equal(resumedCache.flushPending(), 100);
        const finalStats = resumedCache.getStats();
        assert.equal(finalStats.batchFailures, 0);
        assert.equal(finalStats.pendingSets, 0);

        const db = database.getCopilotDb();
        const passiveCheckpoint = db.pragma('wal_checkpoint(PASSIVE)');
        const walBytesBeforeTruncate = await sizeIfPresent(walPath);
        const truncateCheckpoint = db.pragma('wal_checkpoint(TRUNCATE)');
        const walBytesAfterTruncate = await sizeIfPresent(walPath);
        assert.ok(walBytesAfterTruncate <= walBytesBeforeTruncate);

        core.setShutdownLogger(() => {});
        await core.runShutdown('copilot-io-l2-soak');
        const shutdownReport = core.getLastShutdownReport();

        const reopened = new Database(dbPath);
        const integrity = reopened.pragma('integrity_check', { simple: true });
        const persisted = /** @type {{ total: number }} */ (
            reopened.prepare('SELECT COUNT(*) AS total FROM copilot_io_cache_l2').get()
        );
        const transitions = /** @type {{ total: number }} */ (
            reopened
                .prepare(
                    "SELECT COUNT(*) AS total FROM copilot_io_cache_l2 WHERE cache_key IN ('transition:experimental-on', 'transition:on-off')",
                )
                .get()
        );
        reopened.close();

        assert.equal(integrity, 'ok');
        assert.equal(transitions.total, 2);
        assert.equal(persisted.total, 102);

        const heapEnd = process.memoryUsage().heapUsed;
        summary = {
            ok: true,
            workload: {
                cycles: CYCLES,
                entriesPerCycle: ENTRIES_PER_CYCLE,
                totalSets: CYCLES * ENTRIES_PER_CYCLE,
                payloadBytes: PAYLOAD_BYTES,
                maxEntries: MAX_ENTRIES,
                ttlMs: TTL_MS,
            },
            stress: {
                maxObservedEntries,
                immediatePendingHits,
                batchFlushes: stressStats.batchFlushes,
                batchedRows: stressStats.batchedRows,
                averageBatchSize: stressStats.averageBatchSize,
                batchFailures: stressStats.batchFailures,
                expiredRemoved,
                postExpirySize: postExpiryStats.size,
                cycleSamples,
            },
            reconfiguration: {
                transitionsPersisted: transitions.total,
                finalPersistedEntries: persisted.total,
                finalBatchFlushes: finalStats.batchFlushes,
                finalBatchFailures: finalStats.batchFailures,
            },
            wal: {
                passiveCheckpoint,
                truncateCheckpoint,
                bytesBeforeTruncate: walBytesBeforeTruncate,
                bytesAfterTruncate: walBytesAfterTruncate,
            },
            memory: {
                heapStartBytes: heapStart,
                heapPeakBytes: heapPeak,
                heapEndBytes: heapEnd,
                peakGrowthBytes: Math.max(0, heapPeak - heapStart),
            },
            shutdown: {
                ok:
                    shutdownReport?.failedCount === 0 &&
                    shutdownReport?.timeoutCount === 0,
                handlers: shutdownReport?.handlers.map((handler) => handler.name) ?? [],
            },
            integrity,
            durationMs: rounded(performance.now() - startedAt),
        };
    } finally {
        if (previousEnv.dbPath === undefined) delete process.env['COPILOT_DB_PATH'];
        else process.env['COPILOT_DB_PATH'] = previousEnv.dbPath;
        if (previousEnv.profile === undefined) delete process.env['IO_L2_CACHE_PROFILE'];
        else process.env['IO_L2_CACHE_PROFILE'] = previousEnv.profile;
        if (previousEnv.ttlMs === undefined) delete process.env['IO_L2_CACHE_TTL_MS'];
        else process.env['IO_L2_CACHE_TTL_MS'] = previousEnv.ttlMs;
        if (previousEnv.maxEntries === undefined) delete process.env['IO_L2_CACHE_MAX_ENTRIES'];
        else process.env['IO_L2_CACHE_MAX_ENTRIES'] = previousEnv.maxEntries;
        if (previousEnv.pruneMs === undefined) delete process.env['IO_L2_CACHE_PRUNE_MS'];
        else process.env['IO_L2_CACHE_PRUNE_MS'] = previousEnv.pruneMs;
        if (previousEnv.minBytes === undefined) delete process.env['IO_L2_CACHE_MIN_BYTES'];
        else process.env['IO_L2_CACHE_MIN_BYTES'] = previousEnv.minBytes;
        await rm(directory, { recursive: true, force: true });
    }

    const serialized = `${JSON.stringify(summary, null, 2)}\n`;
    if (outputPath) await writeFile(path.resolve(outputPath), serialized, 'utf8');
    process.stdout.write(serialized);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
});
