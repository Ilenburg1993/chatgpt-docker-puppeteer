import { createCrossProcessInvalidationJournal } from '#copilot/infra/internal/filesystem/invalidation';
import Database from 'better-sqlite3';

const [dbPath, expectedPath] = process.argv.slice(2);
if (!dbPath || !expectedPath) process.exit(3);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 1000');
const journal = createCrossProcessInvalidationJournal({
    db,
    processInstance: `consumer-${process.pid}`,
    config: {
        enabled: true,
        pollMs: 25,
        batchMax: 64,
        maxRows: 1000,
        retentionMs: 60_000,
        cleanupIntervalMs: 60_000,
    },
});

process.stdout.write('READY\n');
const startedAt = Date.now();
const interval = setInterval(() => {
    journal.poll((filePath, event) => {
        if (filePath !== expectedPath) return;
        clearInterval(interval);
        process.stdout.write(
            `${JSON.stringify({ received: true, filePath, recursive: event.recursive, source: event.source, elapsedMs: Date.now() - startedAt })}\n`,
        );
        db.close();
        process.exit(0);
    });
}, 25);

setTimeout(() => {
    clearInterval(interval);
    db.close();
    process.exit(2);
}, 3_000).unref();
