// @ts-check
/**
 * Cross-process invalidation journal for the shared Copilot workspace.
 *
 * MCP and the local LLM-B process keep independent in-memory caches while sharing the same filesystem and copilot.sqlite.
 * This bounded SQLite journal propagates *change information* between those processes; it never stores file contents and
 * it is not the sole freshness guarantee. Rich filesystem fingerprints remain the safety net for missed/external writes.
 *
 * Runtime writes happen after the in-process invalidation debounce, outside the canonical file mutation critical path.
 * Consumers poll a primary-key cursor at a short interval; WAL mode keeps empty reads cheap and concurrent with writers.
 *
 * @module copilot/infra/io/invalidation/cross-process-journal
 */

import { getCopilotDb } from '#copilot/db';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const isTestRuntime =
    process.env['VITEST'] === 'true' || process.env['NODE_ENV'] === 'test' || process.env['NODE_ENV'] === 'testing';
const DEFAULT_ENABLED = !isTestRuntime;
const DEFAULT_POLL_MS = 125;
const DEFAULT_BATCH_MAX = 256;
const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_RETENTION_MS = 10 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;

const TABLE = 'copilot_io_invalidation_journal';

/**
 * @typedef {{ recursive?: boolean; source?: string }} CrossProcessInvalidationEvent
 * @typedef {{
 *     sequence: number;
 *     processInstance: string;
 *     filePath: string;
 *     recursive: number;
 *     source: string;
 *     createdAtMs: number;
 * }} CrossProcessInvalidationRow
 * @typedef {{
 *     enabled: boolean;
 *     pollMs: number;
 *     batchMax: number;
 *     maxRows: number;
 *     retentionMs: number;
 *     cleanupIntervalMs: number;
 * }} CrossProcessInvalidationConfig
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {CrossProcessInvalidationConfig}
 */
export function readCrossProcessInvalidationConfig(env = process.env) {
    return {
        enabled: readBooleanWithDefault(env['IO_CROSS_PROCESS_INVALIDATION_ENABLED'], DEFAULT_ENABLED),
        pollMs: readBoundedInteger(env['IO_CROSS_PROCESS_INVALIDATION_POLL_MS'], DEFAULT_POLL_MS, 25, 5_000),
        batchMax: readBoundedInteger(env['IO_CROSS_PROCESS_INVALIDATION_BATCH_MAX'], DEFAULT_BATCH_MAX, 1, 2_000),
        maxRows: readBoundedInteger(env['IO_CROSS_PROCESS_INVALIDATION_MAX_ROWS'], DEFAULT_MAX_ROWS, 100, 100_000),
        retentionMs: readBoundedInteger(
            env['IO_CROSS_PROCESS_INVALIDATION_RETENTION_MS'],
            DEFAULT_RETENTION_MS,
            10_000,
            24 * 60 * 60 * 1000,
        ),
        cleanupIntervalMs: readBoundedInteger(
            env['IO_CROSS_PROCESS_INVALIDATION_CLEANUP_INTERVAL_MS'],
            DEFAULT_CLEANUP_INTERVAL_MS,
            1_000,
            60 * 60 * 1000,
        ),
    };
}

/**
 * Create an isolated journal instance. Exported to allow two SQLite connections/process identities to be tested without
 * mutating the runtime singleton.
 *
 * @param {{
 *     db: import('better-sqlite3').Database;
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

    const stmtLatest = options.db.prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM ${TABLE}`);
    const stmtInsert = options.db.prepare(`
        INSERT INTO ${TABLE}(process_instance, file_path, recursive, source, created_at_ms)
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
        FROM ${TABLE}
        WHERE sequence > ?
        ORDER BY sequence ASC
        LIMIT ?
    `);
    const stmtCleanup = options.db.prepare(`
        DELETE FROM ${TABLE}
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
            const operationStartedAt = monotonicMs();
            const createdAtMs = now();
            const normalizedPath = normalizeJournalPath(filePath);
            const info = stmtInsert.run(
                processInstance,
                normalizedPath,
                event.recursive === true ? 1 : 0,
                normalizeSource(event.source),
                createdAtMs,
            );
            const sequence = Number(info.lastInsertRowid);
            stats.published += 1;
            stats.lastPublishedSequence = sequence;
            maybeCleanup(sequence, createdAtMs);
            const durationMs = Math.max(0, monotonicMs() - operationStartedAt);
            stats.publishDurationMsTotal += durationMs;
            stats.maxPublishDurationMs = Math.max(stats.maxPublishDurationMs, durationMs);
            return sequence;
        },

        /**
         * @param {(filePath: string, event: { recursive: boolean; source: string; sequence: number; createdAtMs: number }) => void} onInvalidation
         */
        poll(onInvalidation) {
            const operationStartedAt = monotonicMs();
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
                    stats.published > 0 ? roundMilliseconds(stats.publishDurationMsTotal / stats.published) : null,
                averagePollDurationMs:
                    stats.polls > 0 ? roundMilliseconds(stats.pollDurationMsTotal / stats.polls) : null,
                maxPublishDurationMs: roundMilliseconds(stats.maxPublishDurationMs),
                maxPollDurationMs: roundMilliseconds(stats.maxPollDurationMs),
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
        const durationMs = Math.max(0, monotonicMs() - operationStartedAt);
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
 * @param {import('better-sqlite3').Database} db
 */
function ensureJournalSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            process_instance TEXT NOT NULL,
            file_path TEXT NOT NULL,
            recursive INTEGER NOT NULL DEFAULT 0 CHECK(recursive IN (0, 1)),
            source TEXT NOT NULL DEFAULT '',
            created_at_ms INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_copilot_io_invalidation_created
            ON ${TABLE}(created_at_ms);
    `);
}

/** @type {ReturnType<typeof createCrossProcessInvalidationJournal> | null} */
let runtimeJournal = null;
/** @type {NodeJS.Timeout | null} */
let runtimePollTimer = null;
/** @type {((filePath: string, event: { recursive: boolean; source: string; sequence: number; createdAtMs: number }) => void) | null} */
let runtimeConsumer = null;
let runtimeInitializationErrors = 0;
let runtimeWriteErrors = 0;
let runtimeReadErrors = 0;

function getRuntimeJournal() {
    const config = readCrossProcessInvalidationConfig();
    if (!config.enabled) return null;
    if (runtimeJournal) return runtimeJournal;
    try {
        runtimeJournal = createCrossProcessInvalidationJournal({
            db: getCopilotDb(),
            processInstance: `${process.pid}-${randomUUID()}`,
            config,
        });
        return runtimeJournal;
    } catch {
        runtimeInitializationErrors += 1;
        return null;
    }
}

/**
 * Best-effort publish. Errors never fail the canonical file mutation or local invalidation.
 *
 * @param {string} filePath
 * @param {CrossProcessInvalidationEvent} [event]
 * @returns {boolean}
 */
export function publishCrossProcessInvalidation(filePath, event = {}) {
    const journal = getRuntimeJournal();
    if (!journal) return false;
    try {
        journal.publish(filePath, event);
        return true;
    } catch {
        runtimeWriteErrors += 1;
        return false;
    }
}

/**
 * Start the singleton consumer. The timer is unref'ed so it never keeps a process alive.
 *
 * @param {(filePath: string, event: { recursive: boolean; source: string; sequence: number; createdAtMs: number }) => void} onInvalidation
 * @returns {() => void}
 */
export function startCrossProcessInvalidationConsumer(onInvalidation) {
    const config = readCrossProcessInvalidationConfig();
    if (!config.enabled) return () => {};
    runtimeConsumer = onInvalidation;
    const journal = getRuntimeJournal();
    if (!journal || runtimePollTimer) return stopCrossProcessInvalidationConsumer;
    runtimePollTimer = setInterval(() => {
        if (!runtimeConsumer) return;
        try {
            journal.poll(runtimeConsumer);
        } catch {
            runtimeReadErrors += 1;
        }
    }, config.pollMs);
    runtimePollTimer.unref?.();
    return stopCrossProcessInvalidationConsumer;
}

export function stopCrossProcessInvalidationConsumer() {
    if (runtimePollTimer) {
        clearInterval(runtimePollTimer);
        runtimePollTimer = null;
    }
    runtimeConsumer = null;
}

export function getCrossProcessInvalidationStats() {
    const config = readCrossProcessInvalidationConfig();
    const base = runtimeJournal?.getStats() ?? {
        enabled: config.enabled,
        initialized: false,
        processPid: process.pid,
        pollMs: config.pollMs,
        batchMax: config.batchMax,
        maxRows: config.maxRows,
        retentionMs: config.retentionMs,
        published: 0,
        received: 0,
        ownRowsObserved: 0,
        polls: 0,
        emptyPolls: 0,
        gapDetections: 0,
        cleanupRuns: 0,
        cleanupDeleted: 0,
        lastPublishedSequence: null,
        lastSeenSequence: 0,
        lastReceivedAtMs: null,
        lastPropagationMs: null,
        maxPropagationMs: 0,
        publishDurationMsTotal: 0,
        maxPublishDurationMs: 0,
        pollDurationMsTotal: 0,
        maxPollDurationMs: 0,
        averagePublishDurationMs: null,
        averagePollDurationMs: null,
        writeErrors: 0,
        readErrors: 0,
    };
    return {
        ...base,
        initializationErrors: runtimeInitializationErrors,
        writeErrors: Number(base.writeErrors ?? 0) + runtimeWriteErrors,
        readErrors: Number(base.readErrors ?? 0) + runtimeReadErrors,
        fallbackFreshness: 'rich-filesystem-fingerprint',
    };
}

export function resetCrossProcessInvalidationRuntimeForTest() {
    stopCrossProcessInvalidationConsumer();
    runtimeJournal = null;
    runtimeInitializationErrors = 0;
    runtimeWriteErrors = 0;
    runtimeReadErrors = 0;
}

/** @param {unknown} row */
function readSequence(row) {
    return Number(/** @type {{ sequence?: unknown }} */ (row ?? {}).sequence ?? 0);
}

/** @param {string} filePath */
function normalizeJournalPath(filePath) {
    return path.resolve(String(filePath));
}

/** @param {unknown} source */
function normalizeSource(source) {
    const normalized = String(source ?? 'io')
        .replace(/[\r\n\t]+/gu, ' ')
        .trim();
    return normalized.slice(0, 96) || 'io';
}

/** @param {unknown} value @param {boolean} fallback */
function readBooleanWithDefault(value, fallback) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function monotonicMs() {
    return Number(process.hrtime.bigint()) / 1_000_000;
}

/** @param {number} value */
function roundMilliseconds(value) {
    return Math.round(value * 1000) / 1000;
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function readBoundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}
