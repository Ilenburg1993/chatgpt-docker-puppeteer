// @ts-check
/** Isolated SQLite journal instance: publish/poll cursor, bounded retention and metrics. */

import { randomUUID } from 'node:crypto';
import { readCrossProcessInvalidationConfig } from './config.js';
import {
    monotonicJournalMs,
    normalizeJournalPath,
    normalizeJournalSource,
    readSequence,
    roundJournalMilliseconds,
} from './utils.js';

/** @typedef {import('./types.js').CrossProcessInvalidationEvent} CrossProcessInvalidationEvent */
/** @typedef {import('./types.js').CrossProcessInvalidationRow} CrossProcessInvalidationRow */
/** @typedef {import('./types.js').CrossProcessInvalidationConfig} CrossProcessInvalidationConfig */

export const CROSS_PROCESS_INVALIDATION_TABLE = 'copilot_io_invalidation_journal';
/**
 * Create an isolated journal instance. Exported to allow two SQLite connections/process identities to be tested without
 * mutating the runtime singleton.
 *
 * @param {{
 *     db: import('#copilot/infra/internal/database/port').SqliteDatabasePort;
 *     processInstance?: string;
 *     now?: () => number;
 *     config?: Partial<CrossProcessInvalidationConfig>;
 * }} options
 */
export function createCrossProcessInvalidationJournal(options) {
    const processInstance = options.processInstance ?? `${process.pid}-${randomUUID()}`;
    const now = options.now ?? Date.now;
    const defaults = readCrossProcessInvalidationConfig();
    const config = {
        ...defaults,
        ...options.config,
        enabled: options.config?.enabled ?? true,
    };
    ensureJournalSchema(options.db);

    const stmtLatest = options.db.prepare(
        `SELECT COALESCE(MAX(sequence), 0) AS sequence FROM ${CROSS_PROCESS_INVALIDATION_TABLE}`,
    );
    const stmtInsert = options.db.prepare(`
        INSERT INTO ${CROSS_PROCESS_INVALIDATION_TABLE}(process_instance, file_path, recursive, source, created_at_ms)
        VALUES (?, ?, ?, ?, ?)
    `);
    const stmtReadAfter = options.db.prepare(`
        SELECT
            sequence,
            process_instance AS processInstance,
            file_path AS filePath,
            recursive,
            source,
            created_at_ms AS createdAtMs
        FROM ${CROSS_PROCESS_INVALIDATION_TABLE}
        WHERE sequence > ?
        ORDER BY sequence ASC
        LIMIT ?
    `);
    const stmtCleanup = options.db.prepare(`
        DELETE FROM ${CROSS_PROCESS_INVALIDATION_TABLE}
        WHERE sequence <= ? OR created_at_ms < ?
    `);

    let lastSeenSequence = readSequence(stmtLatest.get());
    let lastCleanupAtMs = 0;
    const stats = {
        published: 0,
        received: 0,
        ownRowsObserved: 0,
        polls: 0,
        emptyPolls: 0,
        writeErrors: 0,
        readErrors: 0,
        gapDetections: 0,
        cleanupRuns: 0,
        cleanupDeleted: 0,
        lastPublishedSequence: /** @type {number | null} */ (null),
        lastSeenSequence,
        lastReceivedAtMs: /** @type {number | null} */ (null),
        lastPropagationMs: /** @type {number | null} */ (null),
        maxPropagationMs: 0,
        publishDurationMsTotal: 0,
        maxPublishDurationMs: 0,
        pollDurationMsTotal: 0,
        maxPollDurationMs: 0,
    };

    return {
        /** @param {string} filePath @param {CrossProcessInvalidationEvent} [event] */
        publish(filePath, event = {}) {
            const operationStartedAt = monotonicJournalMs();
            const createdAtMs = now();
            const normalizedPath = normalizeJournalPath(filePath);
            const info = stmtInsert.run(
                processInstance,
                normalizedPath,
                event.recursive === true ? 1 : 0,
                normalizeJournalSource(event.source),
                createdAtMs,
            );
            const sequence = Number(info.lastInsertRowid);
            stats.published += 1;
            stats.lastPublishedSequence = sequence;
            maybeCleanup(sequence, createdAtMs);
            const durationMs = Math.max(0, monotonicJournalMs() - operationStartedAt);
            stats.publishDurationMsTotal += durationMs;
            stats.maxPublishDurationMs = Math.max(stats.maxPublishDurationMs, durationMs);
            return sequence;
        },

        /**
         * @param {(
         *     filePath: string,
         *     event: { recursive: boolean; source: string; sequence: number; createdAtMs: number },
         * ) => void} onInvalidation
         */
        poll(onInvalidation) {
            const operationStartedAt = monotonicJournalMs();
            stats.polls += 1;
            const rows = /** @type {CrossProcessInvalidationRow[]} */ (
                stmtReadAfter.all(lastSeenSequence, config.batchMax)
            );
            if (rows.length === 0) {
                stats.emptyPolls += 1;
                recordPollDuration(operationStartedAt);
                return { observed: 0, received: 0, gapDetected: false };
            }

            const firstSequence = Number(rows[0]?.sequence ?? lastSeenSequence + 1);
            const gapDetected = firstSequence > lastSeenSequence + 1;
            if (gapDetected) stats.gapDetections += 1;
            let received = 0;
            for (const row of rows) {
                const sequence = Number(row.sequence);
                lastSeenSequence = Math.max(lastSeenSequence, sequence);
                stats.lastSeenSequence = lastSeenSequence;
                if (row.processInstance === processInstance) {
                    stats.ownRowsObserved += 1;
                    continue;
                }
                const receivedAtMs = now();
                const propagationMs = Math.max(0, receivedAtMs - Number(row.createdAtMs));
                stats.received += 1;
                received += 1;
                stats.lastReceivedAtMs = receivedAtMs;
                stats.lastPropagationMs = propagationMs;
                stats.maxPropagationMs = Math.max(stats.maxPropagationMs, propagationMs);
                onInvalidation(row.filePath, {
                    recursive: Number(row.recursive) === 1,
                    source: `cross-process:${row.source || 'io'}`,
                    sequence,
                    createdAtMs: Number(row.createdAtMs),
                });
            }
            recordPollDuration(operationStartedAt);
            return { observed: rows.length, received, gapDetected };
        },

        getStats() {
            return {
                ...stats,
                averagePublishDurationMs:
                    stats.published > 0
                        ? roundJournalMilliseconds(stats.publishDurationMsTotal / stats.published)
                        : null,
                averagePollDurationMs:
                    stats.polls > 0 ? roundJournalMilliseconds(stats.pollDurationMsTotal / stats.polls) : null,
                maxPublishDurationMs: roundJournalMilliseconds(stats.maxPublishDurationMs),
                maxPollDurationMs: roundJournalMilliseconds(stats.maxPollDurationMs),
                enabled: config.enabled,
                initialized: true,
                processPid: process.pid,
                pollMs: config.pollMs,
                batchMax: config.batchMax,
                maxRows: config.maxRows,
                retentionMs: config.retentionMs,
            };
        },
    };

    /** @param {number} operationStartedAt */
    function recordPollDuration(operationStartedAt) {
        const durationMs = Math.max(0, monotonicJournalMs() - operationStartedAt);
        stats.pollDurationMsTotal += durationMs;
        stats.maxPollDurationMs = Math.max(stats.maxPollDurationMs, durationMs);
    }

    /** @param {number} latestSequence @param {number} createdAtMs */
    function maybeCleanup(latestSequence, createdAtMs) {
        if (createdAtMs - lastCleanupAtMs < config.cleanupIntervalMs) return;
        lastCleanupAtMs = createdAtMs;
        const sequenceFloor = Math.max(0, latestSequence - config.maxRows);
        const cutoff = createdAtMs - config.retentionMs;
        const result = stmtCleanup.run(sequenceFloor, cutoff);
        stats.cleanupRuns += 1;
        stats.cleanupDeleted += Number(result.changes ?? 0);
    }
}

/**
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} db
 */
export function ensureJournalSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${CROSS_PROCESS_INVALIDATION_TABLE} (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            process_instance TEXT NOT NULL,
            file_path TEXT NOT NULL,
            recursive INTEGER NOT NULL DEFAULT 0 CHECK(recursive IN (0, 1)),
            source TEXT NOT NULL DEFAULT '',
            created_at_ms INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_copilot_io_invalidation_created
            ON ${CROSS_PROCESS_INVALIDATION_TABLE}(created_at_ms);
    `);
}
