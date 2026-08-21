// @ts-check

import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'vitest';

import {
    createCrossProcessInvalidationJournal,
    readCrossProcessInvalidationReplay,
} from '#copilot/infra/internal/filesystem/invalidation';

/** @type {string[]} */
const tempDirs = [];

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-io-cross-process-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

describe('cross-process IO invalidation journal', () => {
    it('propagates events across independent SQLite connections without replaying the producer row locally', async () => {
        const dir = await createTempDir();
        const dbPath = join(dir, 'journal.sqlite');
        const dbA = new Database(dbPath);
        const dbB = new Database(dbPath);
        dbA.pragma('journal_mode = WAL');
        dbB.pragma('journal_mode = WAL');
        let now = 1_000;
        const config = {
            enabled: true,
            pollMs: 25,
            batchMax: 64,
            maxRows: 1000,
            retentionMs: 60_000,
            cleanupIntervalMs: 60_000,
        };
        const producer = createCrossProcessInvalidationJournal({
            db: dbA,
            processInstance: 'producer-A',
            now: () => now,
            config,
        });
        const consumer = createCrossProcessInvalidationJournal({
            db: dbB,
            processInstance: 'consumer-B',
            now: () => now,
            config,
        });
        const expectedPath = join(dir, 'src', 'example.js');
        producer.publish(expectedPath, { recursive: true, source: 'unit-test' });
        now += 37;

        /** @type {{ filePath: string; recursive: boolean; source: string }[]} */
        const received = [];
        const consumerPoll = consumer.poll((filePath, event) => received.push({ filePath, ...event }));
        const producerPoll = producer.poll(() => assert.fail('producer must not receive its own journal row'));

        assert.equal(consumerPoll.received, 1);
        assert.equal(producerPoll.received, 0);
        assert.equal(received[0]?.filePath, expectedPath);
        assert.equal(received[0]?.recursive, true);
        assert.equal(received[0]?.source, 'cross-process:unit-test');
        assert.equal(consumer.getStats().lastPropagationMs, 37);
        assert.equal(consumer.getStats().gapDetections, 0);
        dbA.close();
        dbB.close();
    });

    it('reads a bounded startup replay window without mutating the runtime poll cursor', async () => {
        const db = new Database(':memory:');
        let now = 1_000;
        const journal = createCrossProcessInvalidationJournal({
            db,
            processInstance: 'startup-replay-producer',
            now: () => now,
            config: {
                enabled: true,
                pollMs: 25,
                batchMax: 64,
                maxRows: 1000,
                retentionMs: 60_000,
                cleanupIntervalMs: 60_000,
            },
        });
        const seq1 = journal.publish('/workspace/src/copilot/a.js', { source: 'a' });
        now += 1;
        const seq2 = journal.publish('/workspace/src/copilot/b.js', { source: 'b' });
        now += 1;
        const seq3 = journal.publish('/workspace/src/copilot/c.js', { source: 'c' });

        const replay = readCrossProcessInvalidationReplay({ afterSequence: seq1, maxRows: 16, db });
        assert.equal(replay.available, true);
        assert.equal(replay.afterSequence, seq1);
        assert.equal(replay.highWatermark, seq3);
        assert.equal(replay.gapDetected, false);
        assert.equal(replay.truncated, false);
        assert.deepEqual(
            replay.rows.map((row) => row.sequence),
            [seq2, seq3],
        );
        assert.equal(journal.getStats().lastSeenSequence, 0);

        const truncated = readCrossProcessInvalidationReplay({ afterSequence: 0, maxRows: 1, db });
        assert.equal(truncated.truncated, true);
        assert.equal(truncated.rowCount, 1);

        db.prepare('DELETE FROM copilot_io_invalidation_journal WHERE sequence = ?').run(seq2);
        const gap = readCrossProcessInvalidationReplay({ afterSequence: seq1, maxRows: 16, db });
        assert.equal(gap.gapDetected, true);

        const reset = readCrossProcessInvalidationReplay({ afterSequence: seq3 + 50, maxRows: 16, db });
        assert.equal(reset.gapDetected, true);

        db.prepare('DELETE FROM copilot_io_invalidation_journal').run();
        const cleanedThroughCheckpoint = readCrossProcessInvalidationReplay({ afterSequence: seq3, maxRows: 16, db });
        assert.equal(cleanedThroughCheckpoint.highWatermark, seq3);
        assert.equal(cleanedThroughCheckpoint.rowCount, 0);
        assert.equal(cleanedThroughCheckpoint.gapDetected, false);
        db.close();
    });

    it('propagates a real event between two Node processes within the bounded polling window', async () => {
        const dir = await createTempDir();
        const dbPath = join(dir, 'journal.sqlite');
        const expectedPath = join(dir, 'src', 'peer-write.js');
        const fixture = fileURLToPath(new URL('./fixtures/io-invalidation-consumer.mjs', import.meta.url));
        const child = spawn(process.execPath, [fixture, dbPath, expectedPath], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        assert.ok(child.stdout);
        assert.ok(child.stderr);
        const lines = createInterface({ input: child.stdout });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });

        /** @type {(value: void) => void} */
        let resolveReady;
        /** @type {(value: Record<string, unknown>) => void} */
        let resolvePayload;
        const ready = new Promise((resolve) => {
            resolveReady = resolve;
        });
        const payload = new Promise((resolve) => {
            resolvePayload = resolve;
        });
        lines.on('line', (line) => {
            if (line === 'READY') {
                resolveReady();
                return;
            }
            if (line.startsWith('{')) resolvePayload(JSON.parse(line));
        });

        const timeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`cross-process consumer timed out: ${stderr}`)), 5_000).unref();
        });
        await Promise.race([ready, timeout]);

        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        const producer = createCrossProcessInvalidationJournal({
            db,
            processInstance: `parent-${process.pid}`,
            config: {
                enabled: true,
                pollMs: 25,
                batchMax: 64,
                maxRows: 1000,
                retentionMs: 60_000,
                cleanupIntervalMs: 60_000,
            },
        });
        producer.publish(expectedPath, { source: 'parent-process' });
        const result = /** @type {Record<string, unknown>} */ (await Promise.race([payload, timeout]));
        db.close();
        lines.close();

        assert.equal(result['received'], true);
        assert.equal(result['filePath'], expectedPath);
        assert.equal(result['source'], 'cross-process:parent-process');
        assert.ok(Number(result['elapsedMs'] ?? 10_000) < 250);

        if (child.exitCode === null) {
            await new Promise((resolve, reject) => {
                child.once('exit', (code) =>
                    code === 0 ? resolve(undefined) : reject(new Error(`child exit ${code}: ${stderr}`)),
                );
            });
        } else {
            assert.equal(child.exitCode, 0, stderr);
        }
    });
});
