// @ts-check

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { afterEach, describe, it } from 'vitest';

import {
    createMcpRoundTripAnalytics,
    normalizeMcpRoundTripAuditEvent,
    readMcpRoundTripAnalyticsSnapshot,
    summarizeMcpRoundTripRows,
} from '#copilot/mcp/control-plane';


/** @type {Array<import('better-sqlite3').Database>} */
const databases = [];

afterEach(() => {
    while (databases.length > 0) databases.pop()?.close();
});

function createDb() {
    const db = new Database(':memory:');
    databases.push(db);
    return db;
}

/** @param {number} ms */
function iso(ms) {
    return new Date(ms).toISOString();
}

/** @param {number} sourceOffset @param {Record<string, unknown>} event */
function entry(sourceOffset, event) {
    return { sourceOffset, event };
}

describe('MCP incremental round-trip analytics', () => {
    it('normalizes only sanitized audit fields and marks job fixtures synthetic', () => {
        const normalized = normalizeMcpRoundTripAuditEvent({
            ts: iso(10_000),
            event: 'repo_apply_patch_failed',
            tool: 'repo_apply_patch',
            path: 'src/copilot/.ai/jobs/fixture/target.txt',
            code: 'ERR_PATCH_NOT_FOUND',
            failureClass: 'stale-context',
            retryability: 'caller-refresh',
            recoveryRequired: true,
            secret: 'must-not-be-indexed',
            old_string: 'must-not-be-indexed',
        });
        assert.deepEqual(normalized, {
            tsMs: 10_000,
            event: 'repo_apply_patch_failed',
            tool: 'repo_apply_patch',
            durationMs: null,
            isError: null,
            code: 'ERR_PATCH_NOT_FOUND',
            failureClass: 'stale-context',
            retryability: 'caller-refresh',
            recoveryRequired: 1,
            workflowSuccess: null,
            partial: null,
            applyMode: null,
            operationCount: null,
            targetCount: null,
            appliedCount: null,
            failedCount: null,
            causalFailureCount: null,
            abortedOperationCount: null,
            recoveryRequiredTargetCount: null,
            convergenceCandidateCount: null,
            synthetic: 1,
        });
        assert.equal(normalizeMcpRoundTripAuditEvent({ ts: iso(10_000), event: 'unrelated_event' }), null);
    });

    it('summarizes fail→inspect→retry, plan→apply, validator polling and Git strategy pressure', () => {
        const rows = [
            { id: 1, ts_ms: 1_000, event: 'repo_apply_patch_failed', tool: 'repo_apply_patch', code: 'ERR_PATCH_NOT_FOUND', failure_class: 'stale-context', retryability: 'caller-refresh' },
            { id: 2, ts_ms: 2_000, event: 'tool_call_started', tool: 'repo_read_file' },
            { id: 3, ts_ms: 2_100, event: 'tool_call_completed', tool: 'repo_read_file' },
            { id: 4, ts_ms: 4_000, event: 'tool_call_started', tool: 'repo_apply_patch_batch' },
            { id: 5, ts_ms: 5_000, event: 'tool_call_completed', tool: 'repo_patch_batch_plan' },
            { id: 6, ts_ms: 6_000, event: 'tool_call_started', tool: 'repo_apply_patch_batch' },
            { id: 7, ts_ms: 7_000, event: 'tool_call_started', tool: 'job_get_summary' },
            { id: 8, ts_ms: 8_000, event: 'tool_call_started', tool: 'git_stage_plan' },
            { id: 9, ts_ms: 9_000, event: 'tool_call_started', tool: 'git_stage' },
            { id: 10, ts_ms: 10_000, event: 'tool_call_started', tool: 'git_publish_changes' },
            { id: 11, ts_ms: 11_000, event: 'tool_call_completed', tool: 'repo_apply_patch_batch' },
            { id: 12, ts_ms: 12_000, event: 'tool_call_started', tool: 'run_copilot_validator' },
            { id: 13, ts_ms: 13_000, event: 'repo_apply_patch_batch_post_validation', tool: 'repo_apply_patch_batch' },
        ];
        const summary = summarizeMcpRoundTripRows(rows, { windowMs: 20_000, top: 20, includeSynthetic: false });
        assert.deepEqual(summary.failures.byCode, { ERR_PATCH_NOT_FOUND: 1 });
        assert.deepEqual(summary.failures.byClass, { 'stale-context': 1 });
        assert.deepEqual(summary.failures.byRetryability, { 'caller-refresh': 1 });
        assert.equal(summary.recovery.traceCount, 1);
        assert.equal(summary.recovery.withInspectionCount, 1);
        assert.equal(summary.recovery.roundTrips, 2);
        assert.equal(summary.recovery.totalGapMs, 3_000);
        assert.equal(summary.workflowPressure.planThenApplyCount, 1);
        assert.deepEqual(summary.workflowPressure.planThenApplyByPair, {
            'repo_patch_batch_plan→repo_apply_patch_batch': 1,
        });
        assert.equal(summary.workflowPressure.validatorPollCount, 1);
        assert.equal(summary.workflowPressure.patchThenValidatorTransitions, 1);
        assert.equal(summary.workflowPressure.compositePostValidationCount, 1);
        assert.equal(summary.workflowPressure.gitGranularCalls, 2);
        assert.deepEqual(summary.workflowPressure.gitGranularByTool, {
            git_stage_plan: 1,
            git_stage: 1,
        });
        assert.equal(summary.workflowPressure.gitOneShotCalls, 1);
        assert.equal(summary.workflowPressure.gitGranularToOneShotRatio, 2);
        assert.ok(summary.topTransitions.some((row) => row.from === 'repo_patch_batch_plan' && row.to === 'repo_apply_patch_batch'));
    });

    it('segments long idle/recovery gaps instead of ranking them as interactive round trips', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                { id: 1, ts_ms: 1_000, event: 'tool_call_completed', tool: 'repo_create_file' },
                { id: 2, ts_ms: 401_001, event: 'tool_call_started', tool: 'mcp_apps_sdk_readiness' },
                { id: 3, ts_ms: 402_000, event: 'tool_call_completed', tool: 'repo_read_file' },
                { id: 4, ts_ms: 407_000, event: 'tool_call_started', tool: 'repo_apply_patch' },
            ],
            { windowMs: 500_000, top: 20, includeSynthetic: false },
        );
        assert.deepEqual(summary.discontinuities, {
            thresholdMs: 5 * 60 * 1000,
            count: 1,
            totalMs: 400_001,
            maxMs: 400_001,
        });
        assert.equal(
            summary.topTransitions.some(
                (row) => row.from === 'repo_create_file' && row.to === 'mcp_apps_sdk_readiness',
            ),
            false,
        );
        assert.ok(summary.topTransitions.some((row) => row.from === 'repo_read_file' && row.to === 'repo_apply_patch'));
    });

    it('keeps the dashboard snapshot read-only when the derived schema is absent', () => {
        const db = createDb();
        const before = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get();
        const snapshot = readMcpRoundTripAnalyticsSnapshot({ db, now: () => 100_000, windowMs: 20_000 });
        const after = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get();
        assert.equal(snapshot.available, false);
        assert.equal(snapshot.indexedRows, 0);
        assert.deepEqual(after, before);
    });

    it('replays from zero when only an older normalizer cursor exists and upserts derived rows', async () => {
        const db = createDb();
        const nowMs = 100_000;
        const bootstrap = createMcpRoundTripAnalytics({
            db,
            readSlice: async () => ({
                ok: true,
                fileIdentity: 'dev:ino-a',
                fileBytes: 0,
                requestedOffset: 0,
                startOffset: 0,
                nextOffset: 0,
                bytesRead: 0,
                complete: true,
                resetRequired: false,
                parsedEvents: 0,
                invalidLines: 0,
                entries: [],
                events: [],
                error: null,
            }),
            now: () => nowMs,
        });
        await bootstrap.sync();
        db.prepare(
            `INSERT OR REPLACE INTO copilot_mcp_round_trip_cursor
             (cursor_id, file_identity, byte_offset, file_bytes, updated_at_ms)
             VALUES ('mcp-audit:v1', 'dev:ino-a', 900, 900, ?)`,
        ).run(nowMs - 1_000);
        db.prepare(
            `INSERT OR REPLACE INTO copilot_mcp_round_trip_events
             (source_identity, source_offset, ts_ms, event, tool, failure_class, synthetic)
             VALUES ('dev:ino-a', 0, ?, 'repo_apply_patch_failed', 'repo_apply_patch', 'legacy-wrong-class', 0)`,
        ).run(90_000);

        /** @type {number[]} */
        const requestedOffsets = [];
        const analytics = createMcpRoundTripAnalytics({
            db,
            now: () => nowMs,
            readSlice: async ({ offset = 0 } = {}) => {
                requestedOffsets.push(offset);
                return {
                    ok: true,
                    fileIdentity: 'dev:ino-a',
                    fileBytes: 100,
                    requestedOffset: offset,
                    startOffset: offset,
                    nextOffset: 100,
                    bytesRead: offset === 0 ? 100 : 0,
                    complete: true,
                    resetRequired: false,
                    parsedEvents: offset === 0 ? 1 : 0,
                    invalidLines: 0,
                    entries:
                        offset === 0
                            ? [
                                  entry(0, {
                                      ts: iso(90_000),
                                      event: 'repo_apply_patch_failed',
                                      tool: 'repo_apply_patch',
                                      code: 'ERR_PATCH_NOT_FOUND',
                                      failureClass: 'stale-context',
                                      retryability: 'caller-refresh',
                                  }),
                              ]
                            : [],
                    events: [],
                    error: null,
                };
            },
        });
        const report = await analytics.summarize({ windowMs: 20_000 });
        assert.deepEqual(requestedOffsets, [0]);
        assert.equal(report.schemaVersion, 2);
        assert.equal(report.normalizerVersion, 2);
        assert.deepEqual(report.failures.byClass, { 'stale-context': 1 });
        assert.deepEqual(report.failures.byCode, { ERR_PATCH_NOT_FOUND: 1 });
        const cursor = db
            .prepare("SELECT byte_offset FROM copilot_mcp_round_trip_cursor WHERE cursor_id='mcp-audit:v2'")
            .get();
        assert.ok(cursor && typeof cursor === 'object');
        assert.equal(Number(/** @type {Record<string, unknown>} */ (cursor)['byte_offset']), 100);
    });

    it('indexes slices idempotently, advances a byte cursor and excludes synthetic rows by default', async () => {
        const db = createDb();
        const nowMs = 100_000;
        /** @type {number[]} */
        const requestedOffsets = [];
        const events = [
            entry(0, { ts: iso(90_000), event: 'tool_call_started', tool: 'repo_read_file' }),
            entry(100, { ts: iso(91_000), event: 'tool_call_completed', tool: 'repo_read_file' }),
            entry(200, { ts: iso(92_000), event: 'repo_apply_patch_failed', tool: 'repo_apply_patch', path: 'src/copilot/.ai/jobs/test/target.txt', code: 'ERR_PATCH_NOT_FOUND', failureClass: 'stale-context' }),
        ];
        const readSlice = async ({ offset = 0 } = {}) => {
            requestedOffsets.push(offset);
            if (offset === 0) {
                return {
                    ok: true,
                    fileIdentity: 'dev:ino-a',
                    fileBytes: 300,
                    requestedOffset: 0,
                    startOffset: 0,
                    nextOffset: 300,
                    bytesRead: 300,
                    complete: true,
                    resetRequired: false,
                    parsedEvents: events.length,
                    invalidLines: 0,
                    entries: events,
                    events: events.map((row) => row.event),
                    error: null,
                };
            }
            return {
                ok: true,
                fileIdentity: 'dev:ino-a',
                fileBytes: 300,
                requestedOffset: offset,
                startOffset: offset,
                nextOffset: offset,
                bytesRead: 0,
                complete: true,
                resetRequired: false,
                parsedEvents: 0,
                invalidLines: 0,
                entries: [],
                events: [],
                error: null,
            };
        };
        const analytics = createMcpRoundTripAnalytics({ db, readSlice, now: () => nowMs, maxChunks: 2 });
        const first = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(first.ingestion?.indexedEvents, 3);
        assert.equal(first.indexedRows, 2);
        assert.equal(first.failures.byCode['ERR_PATCH_NOT_FOUND'], undefined);
        assert.equal(first.ingestion?.cursor?.byteOffset, 300);

        const second = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(second.ingestion?.indexedEvents, 0);
        assert.equal(second.indexedRows, 2);
        assert.deepEqual(requestedOffsets, [0, 300]);

        const includingSynthetic = await analytics.summarize({ windowMs: 20_000, includeSynthetic: true, sync: false });
        assert.equal(includingSynthetic.indexedRows, 3);
        assert.deepEqual(includingSynthetic.failures.byCode, { ERR_PATCH_NOT_FOUND: 1 });
    });

    it('keeps old-identity history while restarting ingestion at zero for a rotated audit file', async () => {
        const db = createDb();
        const nowMs = 100_000;
        let generation = 'a';
        /** @type {Array<{ generation: string; offset: number }>} */
        const calls = [];
        const readSlice = async ({ offset = 0 } = {}) => {
            calls.push({ generation, offset });
            if (generation === 'a') {
                return {
                    ok: true,
                    fileIdentity: 'dev:ino-a',
                    fileBytes: 100,
                    requestedOffset: offset,
                    startOffset: offset,
                    nextOffset: 100,
                    bytesRead: offset === 0 ? 100 : 0,
                    complete: true,
                    resetRequired: false,
                    parsedEvents: offset === 0 ? 1 : 0,
                    invalidLines: 0,
                    entries: offset === 0 ? [entry(0, { ts: iso(90_000), event: 'tool_call_started', tool: 'repo_read_file' })] : [],
                    events: [],
                    error: null,
                };
            }
            if (offset > 0) {
                return {
                    ok: true,
                    fileIdentity: 'dev:ino-b',
                    fileBytes: 120,
                    requestedOffset: offset,
                    startOffset: offset,
                    nextOffset: offset,
                    bytesRead: 0,
                    complete: false,
                    resetRequired: false,
                    parsedEvents: 0,
                    invalidLines: 0,
                    entries: [],
                    events: [],
                    error: null,
                };
            }
            return {
                ok: true,
                fileIdentity: 'dev:ino-b',
                fileBytes: 120,
                requestedOffset: 0,
                startOffset: 0,
                nextOffset: 120,
                bytesRead: 120,
                complete: true,
                resetRequired: false,
                parsedEvents: 1,
                invalidLines: 0,
                entries: [entry(0, { ts: iso(95_000), event: 'tool_call_started', tool: 'repo_search_text' })],
                events: [],
                error: null,
            };
        };
        const analytics = createMcpRoundTripAnalytics({ db, readSlice, now: () => nowMs, maxChunks: 3 });
        const first = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(first.indexedRows, 1);
        generation = 'b';
        const second = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(second.ingestion?.reset, true);
        assert.equal(second.ingestion?.cursor?.fileIdentity, 'dev:ino-b');
        assert.equal(second.indexedRows, 2);
        assert.deepEqual(
            second.toolStarts.map((row) => row.tool).sort(),
            ['repo_read_file', 'repo_search_text'],
        );
        assert.deepEqual(calls, [
            { generation: 'a', offset: 0 },
            { generation: 'b', offset: 100 },
            { generation: 'b', offset: 0 },
        ]);
    });
});
