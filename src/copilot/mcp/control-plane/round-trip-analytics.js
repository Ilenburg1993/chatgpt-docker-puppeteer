// @ts-check
/**
 * Incremental, rebuildable analytics over the append-only MCP audit JSONL.
 *
 * The JSONL remains the source of record. This module stores only sanitized derived event fields plus a byte cursor in
 * the shared SQLite database so repeated diagnostics process only new audit bytes instead of rescanning a growing
 * file.
 *
 * @module copilot/mcp/control-plane/round-trip-analytics
 */

import { getCopilotDb } from '#copilot/db';
import { readMcpAuditEventSlice } from './audit.js';

const CURSOR_TABLE = 'copilot_mcp_round_trip_cursor';
const EVENT_TABLE = 'copilot_mcp_round_trip_events';
export const MCP_ROUND_TRIP_NORMALIZER_VERSION = 2;
const CURSOR_ID = `mcp-audit:v${MCP_ROUND_TRIP_NORMALIZER_VERSION}`;
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_CHUNKS = 8;
const DEFAULT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SUMMARY_ROWS = 100_000;
const RECOVERY_WINDOW_MS = 5 * 60 * 1000;
const MAX_INTERACTIVE_TRANSITION_GAP_MS = 5 * 60 * 1000;

const INDEXED_EVENTS = new Set([
    'tool_call_started',
    'tool_call_completed',
    'repo_apply_patch_failed',
    'repo_apply_patch_batch_preflight_blocked',
    'repo_apply_patch_batch_partial_failure',
    'repo_apply_patch_batch_applied',
    'repo_apply_patch_batch_post_validation',
]);
const INSPECTION_TOOLS = new Set([
    'repo_read_file',
    'repo_read_file_chunks',
    'repo_search_text',
    'repo_file_stats',
    'repo_bulk_inspect',
    'repo_working_set',
]);
const PATCH_TOOLS = new Set(['repo_apply_patch', 'repo_apply_patch_batch']);
const PLAN_APPLY_PAIRS = new Map([
    ['repo_patch_plan', 'repo_apply_patch'],
    ['repo_patch_batch_plan', 'repo_apply_patch_batch'],
    ['repo_apply_file_batch_plan', 'repo_apply_file_batch'],
    ['git_stage_plan', 'git_stage'],
    ['git_commit_plan', 'git_commit'],
    ['git_push_plan', 'git_push'],
]);

/**
 * @param {{
 *     db?: import('better-sqlite3').Database;
 *     readSlice?: typeof readMcpAuditEventSlice;
 *     chunkBytes?: number;
 *     maxChunks?: number;
 *     retentionMs?: number;
 *     now?: () => number;
 * }} [options]
 */
export function createMcpRoundTripAnalytics(options = {}) {
    const db = options.db ?? getCopilotDb();
    const readSlice = options.readSlice ?? readMcpAuditEventSlice;
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
            failure_class, retryability, recovery_required, workflow_success, partial, apply_mode,
            operation_count, target_count, applied_count, failed_count, causal_failure_count,
            aborted_operation_count, recovery_required_target_count, convergence_candidate_count, synthetic
        ) VALUES (
            @sourceIdentity, @sourceOffset, @tsMs, @event, @tool, @durationMs, @isError, @code,
            @failureClass, @retryability, @recoveryRequired, @workflowSuccess, @partial, @applyMode,
            @operationCount, @targetCount, @appliedCount, @failedCount, @causalFailureCount,
            @abortedOperationCount, @recoveryRequiredTargetCount, @convergenceCandidateCount, @synthetic
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
            recovery_required = excluded.recovery_required,
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
    const ingestTransaction = db.transaction((rows, cursor) => {
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
                const normalized = normalizeAuditEvent(/** @type {Record<string, unknown>} */ (event));
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
            ...summarizeRows(/** @type {Record<string, unknown>[]} */ (rows), { windowMs, top, includeSynthetic }),
        };
    }

    return { sync, summarize };
}

/** @type {ReturnType<typeof createMcpRoundTripAnalytics> | null} */
let runtimeAnalytics = null;

export function getMcpRoundTripAnalytics() {
    if (!runtimeAnalytics) runtimeAnalytics = createMcpRoundTripAnalytics();
    return runtimeAnalytics;
}

/** @param {{ windowMs?: number; top?: number; includeSynthetic?: boolean; sync?: boolean }} [options] */
export async function readMcpRoundTripAnalytics(options = {}) {
    return getMcpRoundTripAnalytics().summarize(options);
}

/**
 * Read the already-materialized derived index without creating tables, advancing cursors or ingesting audit bytes. This
 * is safe for read-only dashboards; the background monitor or explicit analytics tool owns synchronization.
 *
 * @param {{
 *     db?: import('better-sqlite3').Database;
 *     windowMs?: number;
 *     top?: number;
 *     includeSynthetic?: boolean;
 *     now?: () => number;
 * }} [options]
 */
export function readMcpRoundTripAnalyticsSnapshot(options = {}) {
    const db = options.db ?? getCopilotDb();
    const exists = db
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
        .get(EVENT_TABLE);
    const windowMs = boundedInteger(options.windowMs, DEFAULT_WINDOW_MS, 60_000, 14 * 24 * 60 * 60 * 1000);
    const top = boundedInteger(options.top, 20, 1, 100);
    const includeSynthetic = options.includeSynthetic === true;
    if (!exists) {
        return {
            available: false,
            schemaVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
            normalizerVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
            authority: 'derived-round-trip-index-not-materialized-yet',
            windowMs,
            includeSynthetic,
            indexedRows: 0,
            topTransitions: [],
            failures: { byCode: {}, byClass: {}, byRetryability: {} },
            recovery: {
                traceCount: 0,
                withInspectionCount: 0,
                withoutInspectionCount: 0,
                roundTrips: 0,
                totalGapMs: 0,
                averageGapMs: 0,
            },
            workflowPressure: {
                planThenApplyCount: 0,
                planThenApplyByPair: {},
                validatorPollCount: 0,
                patchThenValidatorTransitions: 0,
                compositePostValidationCount: 0,
                gitGranularCalls: 0,
                gitGranularByTool: {},
                gitOneShotCalls: 0,
                gitGranularToOneShotRatio: null,
            },
            discontinuities: {
                thresholdMs: MAX_INTERACTIVE_TRANSITION_GAP_MS,
                count: 0,
                totalMs: 0,
                maxMs: 0,
            },
            toolStarts: [],
        };
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
        ...summarizeRows(/** @type {Record<string, unknown>[]} */ (rows), {
            windowMs,
            top,
            includeSynthetic,
        }),
    };
}

/** @param {Record<string, unknown>} event */
export function normalizeMcpRoundTripAuditEvent(event) {
    return normalizeAuditEvent(event);
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{ windowMs: number; top: number; includeSynthetic: boolean }} options
 */
export function summarizeMcpRoundTripRows(rows, options) {
    return summarizeRows(rows, options);
}

/** @param {Record<string, unknown>} event */
function normalizeAuditEvent(event) {
    const eventName = stringOrNull(event['event']);
    if (!eventName || !INDEXED_EVENTS.has(eventName)) return null;
    const tsMs = Date.parse(String(event['ts'] ?? ''));
    if (!Number.isFinite(tsMs)) return null;
    const path = stringOrNull(event['path']);
    return {
        tsMs: Math.trunc(tsMs),
        event: eventName,
        tool: stringOrNull(event['tool']),
        durationMs: integerOrNull(event['durationMs']),
        isError: boolInt(event['isError']),
        code: stringOrNull(event['code']),
        failureClass: stringOrNull(event['failureClass']),
        retryability: stringOrNull(event['retryability']),
        recoveryRequired: boolInt(event['recoveryRequired']),
        workflowSuccess: boolInt(event['workflowSuccess']),
        partial: boolInt(event['partial']),
        applyMode: stringOrNull(event['applyMode']),
        operationCount: integerOrNull(event['operationCount']),
        targetCount: integerOrNull(event['targetCount']),
        appliedCount: integerOrNull(event['appliedCount']),
        failedCount: integerOrNull(event['failedCount']),
        causalFailureCount: integerOrNull(event['causalFailureCount']),
        abortedOperationCount: integerOrNull(event['abortedOperationCount']),
        recoveryRequiredTargetCount: integerOrNull(event['recoveryRequiredTargetCount']),
        convergenceCandidateCount: integerOrNull(event['convergenceCandidateCount']),
        synthetic: path && path.includes('/.ai/jobs/') ? 1 : 0,
    };
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{ windowMs: number; top: number; includeSynthetic: boolean }} options
 */
function summarizeRows(rows, options) {
    const transitions = new Map();
    const failureCodes = new Map();
    const failureClasses = new Map();
    const retryability = new Map();
    const toolStarts = new Map();
    let lastCompleted = null;
    let pendingFailure = null;
    let recoveryTraceCount = 0;
    let recoveryWithInspectionCount = 0;
    let recoveryRoundTrips = 0;
    let recoveryGapMs = 0;
    let planThenApplyCount = 0;
    const planThenApplyByPair = new Map();
    let validatorPollCount = 0;
    let patchThenValidatorTransitions = 0;
    let compositePostValidationCount = 0;
    let gitGranularCalls = 0;
    const gitGranularByTool = new Map();
    let gitOneShotCalls = 0;
    let discontinuityCount = 0;
    let discontinuityTotalMs = 0;
    let discontinuityMaxMs = 0;

    for (const row of rows) {
        const event = String(row['event'] ?? '');
        const tool = stringOrNull(row['tool']);
        const tsMs = Number(row['ts_ms'] ?? row['tsMs'] ?? 0);
        if (
            event === 'repo_apply_patch_failed' ||
            event === 'repo_apply_patch_batch_preflight_blocked' ||
            event === 'repo_apply_patch_batch_partial_failure'
        ) {
            const code = stringOrNull(row['code']) ?? 'aggregate-or-legacy';
            increment(failureCodes, code);
            const failureClass = stringOrNull(row['failure_class'] ?? row['failureClass']) ?? 'unknown-or-legacy';
            increment(failureClasses, failureClass);
            const retry = stringOrNull(row['retryability']) ?? 'unknown-or-legacy';
            increment(retryability, retry);
            pendingFailure = { tsMs, inspected: false, interveningCalls: 0 };
            continue;
        }
        if (event === 'repo_apply_patch_batch_post_validation') {
            compositePostValidationCount += 1;
            continue;
        }
        if (event === 'tool_call_completed' && tool) {
            lastCompleted = { tool, tsMs };
            continue;
        }
        if (event !== 'tool_call_started' || !tool) continue;
        increment(toolStarts, tool);
        if (tool === 'git_publish_changes') gitOneShotCalls += 1;
        if (
            ['git_stage_plan', 'git_stage', 'git_commit_plan', 'git_commit', 'git_push_plan', 'git_push'].includes(tool)
        ) {
            gitGranularCalls += 1;
            increment(gitGranularByTool, tool);
        }
        if (tool === 'job_get_summary' || tool === 'job_get_output') validatorPollCount += 1;
        if (lastCompleted) {
            const gapMs = Math.max(0, tsMs - lastCompleted.tsMs);
            if (gapMs > MAX_INTERACTIVE_TRANSITION_GAP_MS) {
                discontinuityCount += 1;
                discontinuityTotalMs += gapMs;
                discontinuityMaxMs = Math.max(discontinuityMaxMs, gapMs);
            } else {
                const key = `${lastCompleted.tool}→${tool}`;
                const aggregate = transitions.get(key) ?? {
                    from: lastCompleted.tool,
                    to: tool,
                    count: 0,
                    totalGapMs: 0,
                    gaps: [],
                };
                aggregate.count += 1;
                aggregate.totalGapMs += gapMs;
                aggregate.gaps.push(gapMs);
                transitions.set(key, aggregate);
                if (PLAN_APPLY_PAIRS.get(lastCompleted.tool) === tool) {
                    planThenApplyCount += 1;
                    increment(planThenApplyByPair, `${lastCompleted.tool}→${tool}`);
                }
                if (PATCH_TOOLS.has(lastCompleted.tool) && tool === 'run_copilot_validator') {
                    patchThenValidatorTransitions += 1;
                }
            }
            lastCompleted = null;
        }
        if (pendingFailure) {
            if (tsMs - pendingFailure.tsMs > RECOVERY_WINDOW_MS) {
                pendingFailure = null;
            } else {
                pendingFailure.interveningCalls += 1;
                if (INSPECTION_TOOLS.has(tool)) pendingFailure.inspected = true;
                if (PATCH_TOOLS.has(tool)) {
                    recoveryTraceCount += 1;
                    if (pendingFailure.inspected) recoveryWithInspectionCount += 1;
                    recoveryRoundTrips += pendingFailure.interveningCalls;
                    recoveryGapMs += Math.max(0, tsMs - pendingFailure.tsMs);
                    pendingFailure = null;
                }
            }
        }
    }

    const topTransitions = [...transitions.values()]
        .map((row) => ({
            from: row.from,
            to: row.to,
            count: row.count,
            totalGapMs: row.totalGapMs,
            p50GapMs: percentile(row.gaps, 0.5),
            p95GapMs: percentile(row.gaps, 0.95),
        }))
        .sort((left, right) => right.totalGapMs - left.totalGapMs)
        .slice(0, options.top);

    return {
        schemaVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        normalizerVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        authority: 'derived-from-incrementally-indexed-mcp-audit',
        windowMs: options.windowMs,
        includeSynthetic: options.includeSynthetic,
        indexedRows: rows.length,
        topTransitions,
        failures: {
            byCode: mapToObject(failureCodes),
            byClass: mapToObject(failureClasses),
            byRetryability: mapToObject(retryability),
        },
        recovery: {
            traceCount: recoveryTraceCount,
            withInspectionCount: recoveryWithInspectionCount,
            withoutInspectionCount: Math.max(0, recoveryTraceCount - recoveryWithInspectionCount),
            roundTrips: recoveryRoundTrips,
            totalGapMs: recoveryGapMs,
            averageGapMs: recoveryTraceCount > 0 ? Math.round(recoveryGapMs / recoveryTraceCount) : 0,
        },
        workflowPressure: {
            planThenApplyCount,
            planThenApplyByPair: mapToObject(planThenApplyByPair),
            validatorPollCount,
            patchThenValidatorTransitions,
            compositePostValidationCount,
            gitGranularCalls,
            gitGranularByTool: mapToObject(gitGranularByTool),
            gitOneShotCalls,
            gitGranularToOneShotRatio:
                gitOneShotCalls > 0 ? Number((gitGranularCalls / gitOneShotCalls).toFixed(2)) : null,
        },
        discontinuities: {
            thresholdMs: MAX_INTERACTIVE_TRANSITION_GAP_MS,
            count: discontinuityCount,
            totalMs: discontinuityTotalMs,
            maxMs: discontinuityMaxMs,
        },
        toolStarts: [...toolStarts.entries()]
            .map(([tool, count]) => ({ tool, count }))
            .sort((left, right) => right.count - left.count)
            .slice(0, options.top),
    };
}

/** @param {import('better-sqlite3').Database} db */
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
            recovery_required INTEGER,
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
}

/** @param {import('better-sqlite3').Database} db */
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

/** @param {Map<string, number>} map @param {string} key */
function increment(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
}

/** @param {Map<string, number>} map */
function mapToObject(map) {
    return Object.fromEntries([...map.entries()].sort((left, right) => right[1] - left[1]));
}

/** @param {number[]} values @param {number} ratio */
function percentile(values, ratio) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return Math.round(sorted[index] ?? 0);
}

/** @param {unknown} value */
function stringOrNull(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** @param {unknown} value */
function integerOrNull(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

/** @param {unknown} value */
function boolInt(value) {
    return value === true ? 1 : value === false ? 0 : null;
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}
