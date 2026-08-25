// @ts-check
/**
 * Incremental, rebuildable analytics over the append-only MCP audit JSONL.
 *
 * The JSONL remains the source of record. This module stores only sanitized derived event fields plus a byte cursor in
 * the shared SQLite database so repeated diagnostics process only new audit bytes instead of rescanning a growing
 * file.
 *
 * @module copilot/mcp/diagnostics/latency/round-trip/analytics
 */

import { runSqliteTransaction } from '#copilot/infra/public/database/sqlite';
import { MCP_ROUND_TRIP_NORMALIZER_VERSION, normalizeMcpRoundTripAuditEvent } from './normalizer.js';
import { buildUnavailableRoundTripSnapshot, summarizeMcpRoundTripRows } from './summary.js';

const CURSOR_TABLE = 'copilot_mcp_round_trip_cursor';
const EVENT_TABLE = 'copilot_mcp_round_trip_events';

const CURSOR_ID = `mcp-audit:v${MCP_ROUND_TRIP_NORMALIZER_VERSION}`;
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_CHUNKS = 8;
const DEFAULT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SUMMARY_ROWS = 100_000;

/**
 * @param {{
 *     db: import('#copilot/infra/public/database/sqlite').SqliteDatabasePort;
 *     readSlice: ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>['readSlice'];
 *     chunkBytes?: number;
 *     maxChunks?: number;
 *     retentionMs?: number;
 *     now?: () => number;
 * }} options
 */
export function createMcpRoundTripAnalytics(options) {
    const db = options.db;
    if (!db) throw new Error('createMcpRoundTripAnalytics requires an injected database capability.');
    const readSlice = options.readSlice;
    if (typeof readSlice !== 'function')
        throw new TypeError('MCP round-trip analytics requires an audit slice reader.');
    const chunkBytes = boundedInteger(options.chunkBytes, DEFAULT_CHUNK_BYTES, 64 * 1024, 16 * 1024 * 1024);
    const maxChunks = boundedInteger(options.maxChunks, DEFAULT_MAX_CHUNKS, 1, 32);
    const retentionMs = boundedInteger(
        options.retentionMs,
        DEFAULT_RETENTION_MS,
        60 * 60 * 1000,
        90 * 24 * 60 * 60 * 1000,
    );
    const now = options.now ?? Date.now;
    ensureSchema(db);

    const insertEvent = db.prepare(`
        INSERT INTO ${EVENT_TABLE} (
            source_identity, source_offset, ts_ms, event, tool, duration_ms, is_error, code,
            failure_class, retryability, causal_by_code_json, failure_class_counts_json, retryability_counts_json,
            recovery_required, inline_next_action_provided, inline_next_action_target_count,
            inline_recovery_anchor_provided, inline_recovery_anchor_target_count,
            workflow_success, partial, apply_mode, operation_count, target_count, applied_count, failed_count,
            causal_failure_count, aborted_operation_count, recovery_required_target_count,
            convergence_candidate_count, synthetic
        ) VALUES (
            @sourceIdentity, @sourceOffset, @tsMs, @event, @tool, @durationMs, @isError, @code,
            @failureClass, @retryability, @causalByCodeJson, @failureClassCountsJson, @retryabilityCountsJson,
            @recoveryRequired, @inlineNextActionProvided, @inlineNextActionTargetCount,
            @inlineRecoveryAnchorProvided, @inlineRecoveryAnchorTargetCount,
            @workflowSuccess, @partial, @applyMode, @operationCount, @targetCount, @appliedCount, @failedCount,
            @causalFailureCount, @abortedOperationCount, @recoveryRequiredTargetCount,
            @convergenceCandidateCount, @synthetic
        )
        ON CONFLICT(source_identity, source_offset) DO UPDATE SET
            ts_ms = excluded.ts_ms,
            event = excluded.event,
            tool = excluded.tool,
            duration_ms = excluded.duration_ms,
            is_error = excluded.is_error,
            code = excluded.code,
            failure_class = excluded.failure_class,
            retryability = excluded.retryability,
            causal_by_code_json = excluded.causal_by_code_json,
            failure_class_counts_json = excluded.failure_class_counts_json,
            retryability_counts_json = excluded.retryability_counts_json,
            recovery_required = excluded.recovery_required,
            inline_next_action_provided = excluded.inline_next_action_provided,
            inline_next_action_target_count = excluded.inline_next_action_target_count,
            inline_recovery_anchor_provided = excluded.inline_recovery_anchor_provided,
            inline_recovery_anchor_target_count = excluded.inline_recovery_anchor_target_count,
            workflow_success = excluded.workflow_success,
            partial = excluded.partial,
            apply_mode = excluded.apply_mode,
            operation_count = excluded.operation_count,
            target_count = excluded.target_count,
            applied_count = excluded.applied_count,
            failed_count = excluded.failed_count,
            causal_failure_count = excluded.causal_failure_count,
            aborted_operation_count = excluded.aborted_operation_count,
            recovery_required_target_count = excluded.recovery_required_target_count,
            convergence_candidate_count = excluded.convergence_candidate_count,
            synthetic = excluded.synthetic
    `);
    const upsertCursor = db.prepare(`
        INSERT INTO ${CURSOR_TABLE} (cursor_id, file_identity, byte_offset, file_bytes, updated_at_ms)
        VALUES (@cursorId, @fileIdentity, @byteOffset, @fileBytes, @updatedAtMs)
        ON CONFLICT(cursor_id) DO UPDATE SET
            file_identity = excluded.file_identity,
            byte_offset = excluded.byte_offset,
            file_bytes = excluded.file_bytes,
            updated_at_ms = excluded.updated_at_ms
    `);
    /**
     * @param {Record<string, unknown>[]} rows
     * @param {{cursorId:string;fileIdentity:string|null;byteOffset:number;fileBytes:number;updatedAtMs:number}} cursor
     */
    const ingestTransaction = (rows, cursor) =>
        runSqliteTransaction(db, () => {
            for (const row of rows) insertEvent.run(row);
            upsertCursor.run(cursor);
        });

    async function sync() {
        let cursor = readCursor(db);
        let offset = cursor?.byteOffset ?? 0;
        let expectedIdentity = cursor?.fileIdentity ?? null;
        let processedBytes = 0;
        let parsedEvents = 0;
        let indexedEvents = 0;
        let invalidLines = 0;
        let chunks = 0;
        let reset = false;
        let complete = false;
        let fileBytes = cursor?.fileBytes ?? 0;
        let fileIdentity = expectedIdentity;

        while (chunks < maxChunks) {
            const slice = await readSlice({ offset, maxBytes: chunkBytes, maxEvents: 200_000 });
            chunks += 1;
            if (!slice.ok) {
                return {
                    ok: false,
                    error: slice.error,
                    chunks,
                    processedBytes,
                    parsedEvents,
                    indexedEvents,
                    invalidLines,
                    complete: false,
                };
            }
            fileBytes = Number(slice.fileBytes ?? 0);
            fileIdentity = typeof slice.fileIdentity === 'string' ? slice.fileIdentity : null;
            if (expectedIdentity && fileIdentity && expectedIdentity !== fileIdentity && offset > 0) {
                offset = 0;
                expectedIdentity = fileIdentity;
                reset = true;
                continue;
            }
            if (slice.resetRequired && fileIdentity) {
                db.prepare(`DELETE FROM ${EVENT_TABLE} WHERE source_identity = ?`).run(fileIdentity);
                offset = 0;
                expectedIdentity = fileIdentity;
                reset = true;
                if (Number(slice.startOffset ?? 0) !== 0) continue;
            }
            expectedIdentity = fileIdentity;
            const entries = Array.isArray(slice.entries) ? slice.entries : [];
            const normalizedRows = [];
            for (const entry of entries) {
                const sourceOffset = Number(entry?.sourceOffset);
                const event = entry?.event;
                if (!Number.isInteger(sourceOffset) || sourceOffset < 0 || !event || typeof event !== 'object')
                    continue;
                const normalized = normalizeMcpRoundTripAuditEvent(/** @type {Record<string, unknown>} */ (event));
                if (!normalized) continue;
                normalizedRows.push({ sourceIdentity: fileIdentity ?? 'unknown', sourceOffset, ...normalized });
            }
            const nextOffset = Number(slice.nextOffset ?? offset);
            ingestTransaction(normalizedRows, {
                cursorId: CURSOR_ID,
                fileIdentity,
                byteOffset: nextOffset,
                fileBytes,
                updatedAtMs: now(),
            });
            processedBytes += Number(slice.bytesRead ?? 0);
            parsedEvents += Number(slice.parsedEvents ?? 0);
            indexedEvents += normalizedRows.length;
            invalidLines += Number(slice.invalidLines ?? 0);
            offset = nextOffset;
            complete = slice.complete === true;
            if (complete || Number(slice.bytesRead ?? 0) <= 0) break;
        }

        const cutoff = now() - retentionMs;
        db.prepare(`DELETE FROM ${EVENT_TABLE} WHERE ts_ms < ?`).run(cutoff);
        cursor = readCursor(db);
        return {
            ok: true,
            error: null,
            chunks,
            processedBytes,
            parsedEvents,
            indexedEvents,
            invalidLines,
            complete,
            reset,
            cursor,
            fileIdentity,
            fileBytes,
            lagBytes: Math.max(0, fileBytes - (cursor?.byteOffset ?? 0)),
        };
    }

    /** @param {{ windowMs?: number; top?: number; includeSynthetic?: boolean; sync?: boolean }} [summaryOptions] */
    async function summarize(summaryOptions = {}) {
        const ingestion = summaryOptions.sync === false ? null : await sync();
        const windowMs = boundedInteger(summaryOptions.windowMs, DEFAULT_WINDOW_MS, 60_000, 14 * 24 * 60 * 60 * 1000);
        const top = boundedInteger(summaryOptions.top, 20, 1, 100);
        const includeSynthetic = summaryOptions.includeSynthetic === true;
        const cutoff = now() - windowMs;
        const rows = db
            .prepare(
                `SELECT * FROM ${EVENT_TABLE}
                 WHERE ts_ms >= ? ${includeSynthetic ? '' : 'AND synthetic = 0'}
                 ORDER BY ts_ms ASC, id ASC
                 LIMIT ?`,
            )
            .all(cutoff, MAX_SUMMARY_ROWS);
        return {
            ingestion,
            ...summarizeMcpRoundTripRows(/** @type {Record<string, unknown>[]} */ (rows), {
                windowMs,
                top,
                includeSynthetic,
            }),
        };
    }

    return { sync, summarize };
}

/**
 * Build one process-host-owned analytics capability over a lazy SQLite authority. The database reader is intentionally
 * supplied by composition so this owner never discovers Application Infra and never stores process-global runtime
 * identity. If the concrete database generation changes, the closure rebuilds its derived runtime locally.
 *
 * @param {() => import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} readDatabase
 * @param {Pick<ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>, 'readSlice'>} audit
 */
export function createMcpRoundTripAnalyticsCapability(readDatabase, audit) {
    if (typeof readDatabase !== 'function') {
        throw new TypeError('MCP round-trip analytics capability requires a database reader.');
    }
    if (!audit || typeof audit.readSlice !== 'function') {
        throw new TypeError('MCP round-trip analytics capability requires an audit reader.');
    }
    /** @type {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} */
    let boundDatabase = null;
    /** @type {ReturnType<typeof createMcpRoundTripAnalytics> | null} */
    let analytics = null;

    const requireAnalytics = () => {
        const database = readDatabase();
        if (!database) throw new Error('MCP round-trip analytics database capability is unavailable.');
        if (database !== boundDatabase || !analytics) {
            boundDatabase = database;
            analytics = createMcpRoundTripAnalytics({ db: database, readSlice: audit.readSlice });
        }
        return analytics;
    };

    return Object.freeze({
        sync: () => requireAnalytics().sync(),
        summarize: (
            /** @type {{ windowMs?: number; top?: number; includeSynthetic?: boolean; sync?: boolean }} */ options = {},
        ) => requireAnalytics().summarize(options),
        readSnapshot: (
            /** @type {{ windowMs?: number; top?: number; includeSynthetic?: boolean; now?: () => number }} */ options = {},
        ) => {
            const database = readDatabase();
            return readMcpRoundTripAnalyticsSnapshot({
                ...options,
                ...(database ? { db: database } : {}),
            });
        },
    });
}

/**
 * Read the already-materialized derived index without creating tables, advancing cursors or ingesting audit bytes. This
 * is safe for read-only dashboards; the background monitor or explicit analytics tool owns synchronization.
 *
 * @param {{
 *     db?: import('#copilot/infra/public/database/sqlite').SqliteDatabasePort;
 *     windowMs?: number;
 *     top?: number;
 *     includeSynthetic?: boolean;
 *     now?: () => number;
 * }} [options]
 */
export function readMcpRoundTripAnalyticsSnapshot(options = {}) {
    const db = options.db;
    const windowMs = boundedInteger(options.windowMs, DEFAULT_WINDOW_MS, 60_000, 14 * 24 * 60 * 60 * 1000);
    const top = boundedInteger(options.top, 20, 1, 100);
    const includeSynthetic = options.includeSynthetic === true;
    if (!db) return buildUnavailableRoundTripSnapshot(windowMs, includeSynthetic, 'database-capability-unavailable');
    const exists = db
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
        .get(EVENT_TABLE);
    if (!exists) {
        return buildUnavailableRoundTripSnapshot(
            windowMs,
            includeSynthetic,
            'derived-round-trip-index-not-materialized-yet',
        );
    }
    const cutoff = (options.now ?? Date.now)() - windowMs;
    const rows = db
        .prepare(
            `SELECT * FROM ${EVENT_TABLE}
             WHERE ts_ms >= ? ${includeSynthetic ? '' : 'AND synthetic = 0'}
             ORDER BY ts_ms ASC, id ASC
             LIMIT ?`,
        )
        .all(cutoff, MAX_SUMMARY_ROWS);
    return {
        available: true,
        ...summarizeMcpRoundTripRows(/** @type {Record<string, unknown>[]} */ (rows), {
            windowMs,
            top,
            includeSynthetic,
        }),
    };
}

/** @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db */
function ensureSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${CURSOR_TABLE} (
            cursor_id TEXT PRIMARY KEY,
            file_identity TEXT,
            byte_offset INTEGER NOT NULL DEFAULT 0,
            file_bytes INTEGER NOT NULL DEFAULT 0,
            updated_at_ms INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS ${EVENT_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_identity TEXT NOT NULL,
            source_offset INTEGER NOT NULL,
            ts_ms INTEGER NOT NULL,
            event TEXT NOT NULL,
            tool TEXT,
            duration_ms INTEGER,
            is_error INTEGER,
            code TEXT,
            failure_class TEXT,
            retryability TEXT,
            causal_by_code_json TEXT,
            failure_class_counts_json TEXT,
            retryability_counts_json TEXT,
            recovery_required INTEGER,
            inline_next_action_provided INTEGER,
            inline_next_action_target_count INTEGER,
            inline_recovery_anchor_provided INTEGER,
            inline_recovery_anchor_target_count INTEGER,
            workflow_success INTEGER,
            partial INTEGER,
            apply_mode TEXT,
            operation_count INTEGER,
            target_count INTEGER,
            applied_count INTEGER,
            failed_count INTEGER,
            causal_failure_count INTEGER,
            aborted_operation_count INTEGER,
            recovery_required_target_count INTEGER,
            convergence_candidate_count INTEGER,
            synthetic INTEGER NOT NULL DEFAULT 0 CHECK(synthetic IN (0, 1)),
            UNIQUE(source_identity, source_offset)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_mcp_round_trip_events_ts ON ${EVENT_TABLE}(ts_ms);
        CREATE INDEX IF NOT EXISTS idx_mcp_round_trip_events_event_tool ON ${EVENT_TABLE}(event, tool, ts_ms);
    `);
    ensureRoundTripEventColumns(db);
}

/** @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db */
function ensureRoundTripEventColumns(db) {
    const columns = new Set(
        /** @type {{ name?: unknown }[]} */ (db.prepare(`PRAGMA table_info(${EVENT_TABLE})`).all())
            .map((column) => stringOrNull(column.name))
            .filter((name) => name !== null),
    );
    /** @type {readonly (readonly [string, string])[]} */
    const additions = [
        ['causal_by_code_json', 'TEXT'],
        ['failure_class_counts_json', 'TEXT'],
        ['retryability_counts_json', 'TEXT'],
        ['inline_next_action_provided', 'INTEGER'],
        ['inline_next_action_target_count', 'INTEGER'],
        ['inline_recovery_anchor_provided', 'INTEGER'],
        ['inline_recovery_anchor_target_count', 'INTEGER'],
    ];
    for (const [name, type] of additions) {
        if (columns.has(name)) continue;
        db.exec(`ALTER TABLE ${EVENT_TABLE} ADD COLUMN ${name} ${type}`);
    }
}

/** @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db */
function readCursor(db) {
    const row = /** @type {Record<string, unknown> | undefined} */ (
        db
            .prepare(
                `SELECT file_identity, byte_offset, file_bytes, updated_at_ms FROM ${CURSOR_TABLE} WHERE cursor_id = ?`,
            )
            .get(CURSOR_ID)
    );
    if (!row) return null;
    return {
        fileIdentity: stringOrNull(row['file_identity']),
        byteOffset: Number(row['byte_offset'] ?? 0),
        fileBytes: Number(row['file_bytes'] ?? 0),
        updatedAtMs: Number(row['updated_at_ms'] ?? 0),
    };
}

/** @param {unknown} value */
function stringOrNull(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}
