// @ts-check

import { adaptBetterSqliteDatabase } from '#copilot/infra/public/testing/database/sqlite';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

import { readMcpRoundTripAnalyticsSnapshot } from '#copilot/mcp/public/diagnostics/latency/round-trip';
import {
    createMcpRoundTripAnalytics,
    normalizeMcpRoundTripAuditEvent,
    summarizeMcpRoundTripRows,
} from '#copilot/testing/mcp/diagnostics/latency/round-trip';

/** @type {import('better-sqlite3').Database[]} */
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

/**
 * @param {number} id
 * @param {number} ts
 * @param {string} event
 * @param {string} tool
 * @param {string} callId
 * @param {Record<string, unknown>} [extra]
 */
function row(id, ts, event, tool, callId, extra = {}) {
    return { id, ts_ms: ts, event, tool, call_id: callId, ...extra };
}

/** @param {string[]} values */
function setJson(values) {
    return JSON.stringify(values);
}

function emptySlice(offset = 0, fileIdentity = 'dev:ino-a', fileBytes = offset) {
    return {
        ok: true,
        fileIdentity,
        fileBytes,
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
}

describe('MCP incremental round-trip analytics v6', () => {
    it('normalizes only bounded correlation/execution metadata and never indexes raw sensitive payload fields', () => {
        const normalized = normalizeMcpRoundTripAuditEvent({
            ts: iso(10_000),
            event: 'tool_call_completed',
            tool: 'repo_apply_patch_batch',
            callId: 'call-a',
            traceKey: 'a'.repeat(32),
            traceContextState: 'valid',
            targetPrecision: 'exact-set',
            targetKeys: ['b'.repeat(32), 'c'.repeat(32)],
            runtimeEpochId: 'epoch-a',
            runtimeSourceBinding: 'verified-source-barrier',
            runtimeSourceFingerprint: 'd'.repeat(64),
            logicalOperations: 5,
            failedOperations: 1,
            skippedOperations: 1,
            executionMode: 'patch-apply:per-target-fast:best-effort',
            batchSize: 5,
            batchCapacity: 128,
            resultBudgetBytes: 1_000_000,
            truncatedOperations: 2,
            continuationRequired: true,
            continuationAvailable: true,
            continuationAvailableOperations: 3,
            continuationTransportRequired: true,
            continuationTransportRequiredOperations: 2,
            continuationRecommended: true,
            continuationRecommendedOperations: 3,
            resultBytes: 42_000,
            resultSizeStrategy: 'hint',
            textResultBytes: 500,
            nonTextResultBytes: 41_500,
            duplicateTextBytes: 0,
            resultCode: 'ERR_BATCH_CONFLICTING_MODE',
            resultState: 'tool-error',
            resultClass: 'option-config',
            optionContractVersion: '1.1.0',
            optionPolicyCoverage: 'complete',
            optionMode: 'apply',
            optionDeclaredCount: 11,
            optionRequestedCount: 4,
            optionEffectiveRequestedCount: 3,
            optionDefaultedCount: 4,
            optionNormalizedCount: 1,
            optionIgnoredCount: 1,
            optionCoercedCount: 0,
            optionRejectedCount: 0,
            optionConflictCount: 0,
            path: 'src/copilot/secret-not-derived.txt',
            secret: 'must-not-be-indexed',
            old_string: 'must-not-be-indexed',
            traceparent: 'must-not-be-indexed',
            baggage: 'must-not-be-indexed',
        });
        assert.equal(normalized?.callId, 'call-a');
        assert.equal(normalized?.traceKey, 'a'.repeat(32));
        assert.equal(normalized?.targetKeysJson, setJson(['b'.repeat(32), 'c'.repeat(32)]));
        assert.equal(normalized?.logicalOperations, 5);
        assert.equal(normalized?.batchSize, 5);
        assert.equal(normalized?.batchCapacity, 128);
        assert.equal(normalized?.truncatedOperations, 2);
        assert.equal(normalized?.legacyContinuationRequired, 1);
        assert.equal(normalized?.continuationAvailable, 1);
        assert.equal(normalized?.continuationAvailableOperations, 3);
        assert.equal(normalized?.continuationTransportRequired, 1);
        assert.equal(normalized?.continuationTransportRequiredOperations, 2);
        assert.equal(normalized?.continuationRecommended, 1);
        assert.equal(normalized?.continuationRecommendedOperations, 3);
        assert.equal(normalized?.duplicateTextBytes, 0);
        assert.equal(normalized?.resultCode, 'ERR_BATCH_CONFLICTING_MODE');
        assert.equal(normalized?.resultState, 'tool-error');
        assert.equal(normalized?.resultClass, 'option-config');
        assert.equal(normalized?.optionContractVersion, '1.1.0');
        assert.equal(normalized?.optionPolicyCoverage, 'complete');
        assert.equal(normalized?.optionMode, 'apply');
        assert.equal(normalized?.optionRequestedCount, 4);
        assert.equal(normalized?.optionEffectiveRequestedCount, 3);
        assert.equal(normalized?.optionIgnoredCount, 1);
        const serialized = JSON.stringify(normalized);
        for (const forbidden of ['secret-not-derived', 'must-not-be-indexed', 'traceparent', 'baggage', 'old_string']) {
            assert.equal(serialized.includes(forbidden), false, forbidden);
        }
    });

    it('indexes every terminal lifecycle class needed to close a started call', () => {
        for (const event of [
            'tool_call_completed',
            'tool_call_failed',
            'tool_call_rate_limited',
            'tool_call_auth_denied',
            'tool_call_result_rejected',
        ]) {
            const normalized = normalizeMcpRoundTripAuditEvent({
                ts: iso(20_000),
                event,
                tool: 'repo_read_file',
                callId: `call-${event}`,
            });
            assert.equal(normalized?.event, event);
            assert.equal(normalized?.callId, `call-${event}`);
        }
    });

    it('pairs interleaved calls by callId and excludes active overlap from quiescent transition evidence', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_read_file', 'a', { trace_key: 'trace-a' }),
                row(2, 1_100, 'tool_call_started', 'repo_search_text', 'b', { trace_key: 'trace-b' }),
                row(3, 1_200, 'tool_call_completed', 'repo_read_file', 'a', { trace_key: 'trace-a' }),
                row(4, 1_300, 'tool_call_completed', 'repo_search_text', 'b', { trace_key: 'trace-b' }),
                row(5, 1_500, 'tool_call_started', 'repo_apply_patch', 'c', { trace_key: 'trace-b' }),
                row(6, 1_600, 'tool_call_completed', 'repo_apply_patch', 'c', { trace_key: 'trace-b' }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.callPairing.startedCallCount, 3);
        assert.equal(summary.callPairing.pairedCallCount, 3);
        assert.equal(summary.callPairing.orphanStartCount, 0);
        assert.equal(summary.callPairing.orphanTerminalCount, 0);
        assert.equal(summary.sequenceEvidence.activeOverlapExcludedCount, 1);
        assert.equal(
            summary.topTransitions.some(
                (transition) => transition.from === 'repo_read_file' && transition.to === 'repo_search_text',
            ),
            false,
        );
        assert.deepEqual(summary.topTransitions[0], {
            from: 'repo_search_text',
            to: 'repo_apply_patch',
            count: 1,
            totalGapMs: 200,
            p50GapMs: 200,
            p95GapMs: 200,
        });
        assert.deepEqual(summary.sequenceEvidence.lineageBoundTransitions[0], summary.topTransitions[0]);
    });

    it('pairs non-completed terminal outcomes and reports orphan lifecycle rows without leaving calls active forever', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_read_file', 'a'),
                row(2, 1_100, 'tool_call_auth_denied', 'repo_read_file', 'a'),
                row(3, 1_200, 'tool_call_started', 'repo_search_text', 'b'),
                row(4, 1_300, 'tool_call_result_rejected', 'repo_search_text', 'b'),
                row(5, 1_400, 'tool_call_failed', 'repo_apply_patch', 'orphan-terminal'),
                row(6, 1_500, 'tool_call_started', 'repo_file_stats', 'orphan-start'),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.callPairing.pairedCallCount, 2);
        assert.equal(summary.callPairing.orphanTerminalCount, 1);
        assert.equal(summary.callPairing.orphanStartCount, 1);
        assert.ok(
            summary.topTransitions.some(
                (transition) => transition.from === 'repo_read_file' && transition.to === 'repo_search_text',
            ),
        );
    });

    it('keeps unknown and cross-trace temporal adjacency out of lineage-bound transitions', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_read_file', 'a', { trace_context_state: 'absent' }),
                row(2, 1_100, 'tool_call_completed', 'repo_read_file', 'a'),
                row(3, 1_200, 'tool_call_started', 'repo_search_text', 'b', {
                    trace_key: 'trace-b',
                    trace_context_state: 'valid',
                }),
                row(4, 1_300, 'tool_call_completed', 'repo_search_text', 'b', { trace_key: 'trace-b' }),
                row(5, 1_400, 'tool_call_started', 'repo_apply_patch', 'c', { trace_key: 'trace-c' }),
                row(6, 1_500, 'tool_call_completed', 'repo_apply_patch', 'c', { trace_key: 'trace-c' }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.topTransitions.length, 2);
        assert.equal(summary.sequenceEvidence.lineageBoundTransitions.length, 0);
        assert.deepEqual(summary.lineageContext.traceContextStateCounts, { absent: 1, unknown: 1, valid: 1 });
        assert.equal(summary.lineageContext.validTraceStartCount, 1);
        assert.equal(summary.lineageContext.validTraceStartRate, 0.3333);
        assert.equal(summary.sequenceEvidence.unknownLineageTransitionCount, 1);
        assert.equal(summary.sequenceEvidence.lineageUnknownPairCount, 1);
        assert.equal(summary.sequenceEvidence.lineageKnownPairCount, 1);
        assert.equal(summary.sequenceEvidence.lineageKnownRate, 0.5);
        assert.equal(summary.sequenceEvidence.crossTracePairRejectedCount, 1);
    });

    it('closes lineage-bound recovery only inside the same trace and keeps unrelated workflows out', () => {
        const targetA = 'a'.repeat(32);
        const targetB = 'b'.repeat(32);
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'repo_apply_patch_failed', 'repo_apply_patch', 'fail-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetA]),
                    code: 'ERR_PATCH_NOT_FOUND',
                    failure_class: 'stale-context',
                    retryability: 'caller-refresh',
                }),
                row(2, 1_100, 'tool_call_started', 'repo_read_file', 'read-b', {
                    trace_key: 'trace-b',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetB]),
                }),
                row(3, 1_200, 'tool_call_completed', 'repo_read_file', 'read-b', { trace_key: 'trace-b' }),
                row(4, 1_300, 'tool_call_started', 'repo_apply_patch', 'patch-b', {
                    trace_key: 'trace-b',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetB]),
                }),
                row(5, 1_400, 'tool_call_completed', 'repo_apply_patch', 'patch-b', { trace_key: 'trace-b' }),
                row(6, 1_500, 'tool_call_started', 'repo_read_file', 'read-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetA]),
                }),
                row(7, 1_600, 'tool_call_completed', 'repo_read_file', 'read-a', { trace_key: 'trace-a' }),
                row(8, 1_700, 'tool_call_started', 'repo_apply_patch', 'patch-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetA]),
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.recovery.lineageBound.candidateWithLineageCount, 1);
        assert.equal(summary.recovery.lineageBound.traceCount, 1);
        assert.equal(summary.recovery.lineageBound.withInspectionCount, 1);
        assert.equal(summary.recovery.lineageBound.sameTargetTraceCount, 1);
        assert.equal(summary.recovery.lineageBound.sameTargetWithInspectionCount, 1);
        assert.equal(summary.recovery.lineageBound.totalGapMs, 700);
    });

    it('keeps simultaneous target failures independent and closes a narrowed partial-batch failure only on its failed target', () => {
        const targetA = 'a'.repeat(32);
        const targetB = 'b'.repeat(32);
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'repo_apply_patch_batch_partial_failure', 'repo_apply_patch_batch', 'batch-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetA]),
                    code: 'ERR_PATCH_NOT_FOUND',
                }),
                row(2, 1_010, 'repo_apply_patch_failed', 'repo_apply_patch', 'single-b', {
                    trace_key: 'trace-b',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetB]),
                    code: 'ERR_PATCH_NOT_FOUND',
                }),
                row(3, 1_100, 'tool_call_started', 'repo_apply_patch', 'retry-b', {
                    trace_key: 'trace-b',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetB]),
                }),
                row(4, 1_150, 'tool_call_completed', 'repo_apply_patch', 'retry-b', { trace_key: 'trace-b' }),
                row(5, 1_200, 'tool_call_started', 'repo_apply_patch', 'wrong-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetB]),
                }),
                row(6, 1_250, 'tool_call_completed', 'repo_apply_patch', 'wrong-a', { trace_key: 'trace-a' }),
                row(7, 1_300, 'tool_call_started', 'repo_apply_patch', 'retry-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([targetA]),
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.recovery.lineageBound.candidateWithLineageCount, 2);
        assert.equal(summary.recovery.lineageBound.traceCount, 2);
        assert.equal(summary.recovery.lineageBound.sameTargetTraceCount, 2);
        assert.equal(summary.recovery.lineageBound.pendingCandidateCount, 0);
    });

    it('does not promote a different target in the same trace to same-target recovery', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'repo_apply_patch_failed', 'repo_apply_patch', 'fail-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson(['a'.repeat(32)]),
                    code: 'ERR_PATCH_NOT_FOUND',
                }),
                row(2, 1_200, 'tool_call_started', 'repo_apply_patch', 'patch-other', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson(['b'.repeat(32)]),
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.recovery.lineageBound.traceCount, 0);
        assert.equal(summary.recovery.lineageBound.sameTargetTraceCount, 0);
        assert.equal(summary.recovery.lineageBound.pendingCandidateCount, 1);
    });

    it('keeps failure without trace as temporal pressure only', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'repo_apply_patch_failed', 'repo_apply_patch', 'fail-a', {
                    code: 'ERR_PATCH_NOT_FOUND',
                }),
                row(2, 1_100, 'tool_call_started', 'repo_read_file', 'read-a'),
                row(3, 1_200, 'tool_call_completed', 'repo_read_file', 'read-a'),
                row(4, 1_300, 'tool_call_started', 'repo_apply_patch', 'patch-a'),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.recovery.temporalPressure.traceCount, 1);
        assert.equal(summary.recovery.temporalPressure.withInspectionCount, 1);
        assert.equal(summary.recovery.lineageBound.traceCount, 0);
        assert.equal(summary.recovery.lineageBound.candidateWithoutLineageCount, 1);
        assert.equal(summary.recovery.lineageBound.unknownRecoveryLineageCount, 1);
    });

    it('measures strong retry tax only for same trace, same tool and exact same target', () => {
        const target = 'a'.repeat(32);
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_apply_patch', 'fail-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                }),
                row(2, 1_050, 'repo_apply_patch_failed', 'repo_apply_patch', 'fail-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                    code: 'ERR_PATCH_NOT_FOUND',
                    failure_class: 'stale-context',
                    retryability: 'caller-refresh',
                }),
                row(3, 1_100, 'tool_call_completed', 'repo_apply_patch', 'fail-a', {
                    trace_key: 'trace-a',
                    result_state: 'tool-error',
                    result_class: 'domain-or-unknown',
                }),
                row(4, 1_200, 'tool_call_started', 'repo_read_file', 'inspect-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                }),
                row(5, 1_250, 'tool_call_completed', 'repo_read_file', 'inspect-a', { trace_key: 'trace-a' }),
                row(6, 1_400, 'tool_call_started', 'repo_apply_patch', 'retry-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.retryTax.retryTaxCalls, 1);
        assert.equal(summary.retryTax.retryTaxGapMs, 300);
        assert.equal(summary.retryTax.retryTaxInterveningCalls, 1);
        assert.deepEqual(summary.retryTax.byTool, { repo_apply_patch: 1 });
        assert.deepEqual(summary.retryTax.byFailureSignalClass, { 'stale-context': 1 });
        assert.deepEqual(summary.retryTax.byResultCode, { ERR_PATCH_NOT_FOUND: 1 });
        assert.equal(summary.retryTax.lineageBound.sameToolRepeatCount, 1);
        assert.equal(summary.retryTax.lineageBound.targetOverlapRepeatCount, 1);
        assert.equal(summary.retryTax.lineageBound.pendingCandidateCount, 0);
    });

    it('keeps same-trace same-tool repeats on a different target outside retry tax', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_apply_patch', 'fail-a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson(['a'.repeat(32)]),
                }),
                row(2, 1_100, 'tool_call_completed', 'repo_apply_patch', 'fail-a', {
                    trace_key: 'trace-a',
                    result_state: 'tool-error',
                    result_class: 'option-config',
                    result_code: 'ERR_PATCH_OPTION_INACTIVE',
                }),
                row(3, 1_200, 'tool_call_started', 'repo_apply_patch', 'other-target', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson(['b'.repeat(32)]),
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.retryTax.retryTaxCalls, 0);
        assert.equal(summary.retryTax.lineageBound.sameToolRepeatCount, 1);
        assert.equal(summary.retryTax.lineageBound.targetOverlapRepeatCount, 0);
        assert.deepEqual(summary.retryTax.lineageBound.byFailureSignalClass, { 'shape/config': 1 });
        assert.equal(summary.retryTax.lineageBound.pendingCandidateCount, 0);
    });

    it('keeps no-trace same-target repeats as temporal pressure rather than retry tax', () => {
        const target = 'a'.repeat(32);
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_apply_patch', 'fail-a', {
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                }),
                row(2, 1_100, 'tool_call_completed', 'repo_apply_patch', 'fail-a', {
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                    result_state: 'tool-error',
                    result_class: 'precondition',
                    result_code: 'EEXPECTEDHASH',
                }),
                row(3, 1_200, 'tool_call_started', 'repo_apply_patch', 'retry-a', {
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.retryTax.retryTaxCalls, 0);
        assert.equal(summary.retryTax.lineageBound.candidateWithoutLineageCount, 1);
        assert.equal(summary.retryTax.temporalPressure.sameToolAdjacentAfterFailureCount, 1);
        assert.equal(summary.retryTax.temporalPressure.sameExactTargetAdjacentAfterFailureCount, 1);
        assert.equal(summary.retryTax.temporalPressure.totalGapMs, 100);
    });

    it('measures heavy-result read follow-up pressure without calling it avoidable and proves exact same-target rereads only with lineage', () => {
        const target = 'e'.repeat(32);
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_read_file', 'a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                }),
                row(2, 1_100, 'tool_call_completed', 'repo_read_file', 'a', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                    result_bytes: 70_000,
                }),
                row(3, 1_300, 'tool_call_started', 'repo_read_file', 'b', {
                    trace_key: 'trace-a',
                    target_precision: 'exact-single',
                    target_keys_json: setJson([target]),
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.payloadAccounting.heavyResultThresholdBytes, 64 * 1024);
        assert.equal(summary.payloadAccounting.heavyResultFollowups.temporalReadFollowupCount, 1);
        assert.equal(summary.payloadAccounting.heavyResultFollowups.lineageReadFollowupCount, 1);
        assert.equal(summary.payloadAccounting.heavyResultFollowups.sameTargetRereadCount, 1);
        assert.match(summary.payloadAccounting.heavyResultFollowups.caveat, /observational pressure/u);
    });

    it('separates optional continuation from transport-required continuation in batch accounting', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_bulk_inspect', 'a', { trace_key: 'trace-a' }),
                row(2, 1_100, 'tool_call_completed', 'repo_bulk_inspect', 'a', {
                    trace_key: 'trace-a',
                    logical_operations: 4,
                    failed_operations: 0,
                    skipped_operations: 0,
                    batch_size: 4,
                    batch_capacity: 64,
                    truncated_operations: 0,
                    continuation_available: 1,
                    continuation_available_operations: 1,
                    continuation_transport_required: 0,
                    continuation_transport_required_operations: 0,
                    continuation_recommended: 1,
                    continuation_recommended_operations: 1,
                    result_bytes: 8_000,
                    text_result_bytes: 100,
                    non_text_result_bytes: 7_900,
                }),
                row(3, 1_300, 'tool_call_started', 'repo_bulk_inspect', 'b', { trace_key: 'trace-a' }),
                row(4, 1_400, 'tool_call_completed', 'repo_bulk_inspect', 'b', {
                    trace_key: 'trace-a',
                    logical_operations: 64,
                    batch_size: 64,
                    batch_capacity: 64,
                    truncated_operations: 2,
                    continuation_available: 1,
                    continuation_available_operations: 2,
                    continuation_transport_required: 1,
                    continuation_transport_required_operations: 2,
                    continuation_recommended: 1,
                    continuation_recommended_operations: 2,
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.executionAccounting.logicalOperations, 68);
        assert.equal(summary.executionAccounting.coalescedLogicalOperations, 66);
        assert.equal(summary.executionAccounting.batchCalls, 2);
        assert.equal(summary.executionAccounting.saturatedBatchCalls, 1);
        assert.equal(summary.executionAccounting.truncatedOperations, 2);
        assert.equal(summary.executionAccounting.continuationAvailableCalls, 2);
        assert.equal(summary.executionAccounting.continuationAvailableOperations, 3);
        assert.equal(summary.executionAccounting.continuationTransportRequiredCalls, 1);
        assert.equal(summary.executionAccounting.continuationTransportRequiredOperations, 2);
        assert.equal(summary.executionAccounting.continuationRecommendedCalls, 2);
        assert.equal(summary.executionAccounting.continuationRecommendedOperations, 3);
        assert.equal(summary.executionAccounting.legacyContinuationRequiredCalls, 0);
        assert.equal(summary.executionAccounting.repeatAfterBatch.unsaturatedComplete, 1);
        assert.equal(summary.executionAccounting.repeatAfterBatch.transportRequired, 0);
        assert.equal(summary.executionAccounting.byTool[0]?.singleCalls, 0);
        assert.deepEqual(summary.executionAccounting.byTool[0]?.batchSizeHistogram, { 4: 1, 64: 1 });
        assert.equal(summary.executionAccounting.byTool[0]?.batchSizeP50, 4);
        assert.equal(summary.executionAccounting.byTool[0]?.batchSizeP95, 64);
        assert.equal(summary.executionAccounting.byTool[0]?.logicalOperationsPerCallP50, 4);
        assert.equal(summary.executionAccounting.byTool[0]?.logicalOperationsPerCallP95, 64);
        assert.equal(summary.executionAccounting.byTool[0]?.saturationRate, 0.5);
        assert.equal(summary.executionAccounting.byTool[0]?.truncationRate, 0.5);
        assert.equal(summary.executionAccounting.byTool[0]?.continuationAvailableRate, 1);
        assert.equal(summary.executionAccounting.byTool[0]?.continuationTransportRequiredRate, 0.5);
        assert.equal(summary.executionAccounting.byTool[0]?.continuationRecommendedRate, 1);
        assert.equal(summary.payloadAccounting.byTool[0]?.resultBytes, 8_000);
    });

    it('keeps legacy v6 continuation_required out of transport-required metrics', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_completed', 'repo_search_text', 'legacy-a', {
                    logical_operations: 2,
                    batch_size: 2,
                    batch_capacity: 64,
                    continuation_required: 1,
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.executionAccounting.legacyContinuationRequiredCalls, 1);
        assert.equal(summary.executionAccounting.continuationAvailableCalls, 0);
        assert.equal(summary.executionAccounting.continuationTransportRequiredCalls, 0);
        assert.equal(summary.executionAccounting.continuationRecommendedCalls, 0);
        assert.match(summary.executionAccounting.caveat, /historical v6 metadata/u);
    });

    it('aggregates v5 result outcomes by state/class/code/tool/cohort without diluting rates with legacy unobserved completions', () => {
        const sourceA = '1'.repeat(64);
        const sourceB = '2'.repeat(64);
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_completed', 'repo_read_file', 'a', {
                    runtime_source_fingerprint: sourceA,
                    result_state: 'success',
                    result_class: 'success',
                }),
                row(2, 1_100, 'tool_call_completed', 'repo_read_file', 'b', {
                    runtime_source_fingerprint: sourceA,
                    result_state: 'tool-error',
                    result_class: 'option-config',
                    result_code: 'ERR_BATCH_CONFLICTING_MODE',
                }),
                row(3, 1_200, 'tool_call_completed', 'repo_read_file', 'legacy', {
                    runtime_source_fingerprint: sourceA,
                }),
                row(4, 1_300, 'tool_call_completed', 'terminal_exec', 'c', {
                    runtime_source_fingerprint: sourceB,
                    result_state: 'domain-failure',
                    result_class: 'option-config',
                    result_code: 'ERR_TERMINAL_EXEC_SHAPE',
                }),
                row(5, 1_400, 'tool_call_completed', 'repo_apply_patch', 'd', {
                    runtime_source_fingerprint: sourceB,
                    result_state: 'tool-error',
                    result_class: 'precondition',
                    result_code: 'EEXPECTEDHASH',
                }),
                row(6, 1_500, 'tool_call_completed', 'repo_apply_patch', 'e', {
                    runtime_source_fingerprint: sourceB,
                    result_state: 'tool-error',
                    result_class: 'domain-or-unknown',
                    result_code: 'ERR_NEW_UNCLASSIFIED_FAILURE',
                }),
                row(7, 1_600, 'tool_call_completed', 'terminal_exec', 'f', {
                    runtime_source_fingerprint: sourceB,
                    result_state: 'domain-failure',
                    result_class: 'uncoded-failure',
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );

        assert.equal(summary.resultOutcomes.completedCalls, 7);
        assert.equal(summary.resultOutcomes.observedOutcomeCalls, 6);
        assert.equal(summary.resultOutcomes.outcomeCoverageRate, 0.8571);
        assert.equal(summary.resultOutcomes.codedCalls, 4);
        assert.equal(summary.resultOutcomes.failureCalls, 5);
        assert.equal(summary.resultOutcomes.optionConfigFailures, 2);
        assert.equal(summary.resultOutcomes.preconditionFailures, 1);
        assert.equal(summary.resultOutcomes.domainOrUnknownFailures, 1);
        assert.equal(summary.resultOutcomes.uncodedFailures, 1);
        assert.equal(summary.resultOutcomes.optionErrorRate, 0.3333);
        assert.equal(summary.resultOutcomes.optionErrorShareOfFailures, 0.4);
        assert.deepEqual(summary.resultOutcomes.byState, {
            'tool-error': 3,
            'domain-failure': 2,
            success: 1,
            unobserved: 1,
        });
        assert.equal(summary.resultOutcomes.byCode['ERR_BATCH_CONFLICTING_MODE'], 1);
        assert.equal(summary.resultOutcomes.byCode['ERR_TERMINAL_EXEC_SHAPE'], 1);
        assert.equal(
            summary.resultOutcomes.byTool.find((item) => item.tool === 'repo_read_file')?.optionErrorRate,
            0.5,
        );
        assert.equal(summary.resultOutcomes.byRuntimeCohort[`source:${sourceA}`].outcomeCoverageRate, 0.6667);
        assert.equal(summary.resultOutcomes.byRuntimeCohort[`source:${sourceB}`].outcomeCoverageRate, 1);
        assert.match(summary.resultOutcomes.caveat, /unobserved/u);
    });

    it('aggregates v6 Option Contract policy telemetry with explicit call and option denominators', () => {
        const sourceA = 'a'.repeat(64);
        const sourceB = 'b'.repeat(64);
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'terminal_exec', 'a', {
                    runtime_source_fingerprint: sourceA,
                    option_contract_version: '1.1.0',
                    option_policy_coverage: 'complete',
                    option_mode: 'batch',
                    option_declared_count: 14,
                    option_requested_count: 2,
                    option_effective_requested_count: 1,
                    option_defaulted_count: 3,
                    option_normalized_count: 0,
                    option_ignored_count: 1,
                    option_coerced_count: 0,
                    option_rejected_count: 0,
                    option_conflict_count: 0,
                }),
                row(2, 1_100, 'tool_call_started', 'terminal_exec', 'b', {
                    runtime_source_fingerprint: sourceB,
                    option_contract_version: '1.1.0',
                    option_policy_coverage: 'complete',
                    option_mode: 'batch',
                    option_declared_count: 14,
                    option_requested_count: 2,
                    option_effective_requested_count: 1,
                    option_defaulted_count: 3,
                    option_normalized_count: 0,
                    option_ignored_count: 0,
                    option_coerced_count: 0,
                    option_rejected_count: 1,
                    option_conflict_count: 1,
                }),
                row(3, 1_200, 'tool_call_started', 'repo_search_text', 'c', {
                    runtime_source_fingerprint: sourceA,
                    option_contract_version: '1.1.0',
                    option_policy_coverage: 'complete',
                    option_mode: 'single',
                    option_declared_count: 14,
                    option_requested_count: 2,
                    option_effective_requested_count: 1,
                    option_defaulted_count: 5,
                    option_normalized_count: 0,
                    option_ignored_count: 1,
                    option_coerced_count: 0,
                    option_rejected_count: 0,
                    option_conflict_count: 1,
                }),
                row(4, 1_300, 'tool_call_started', 'repo_read_file', 'legacy', {
                    runtime_source_fingerprint: sourceA,
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );

        assert.equal(summary.optionPolicies.observedCalls, 3);
        assert.equal(summary.optionPolicies.requestedOptions, 6);
        assert.equal(summary.optionPolicies.effectiveRequestedOptions, 3);
        assert.equal(summary.optionPolicies.defaultedOptions, 11);
        assert.equal(summary.optionPolicies.ignoredOptions, 2);
        assert.equal(summary.optionPolicies.rejectedOptions, 1);
        assert.equal(summary.optionPolicies.conflictEvents, 2);
        assert.equal(summary.optionPolicies.ignoredCallRate, 0.6667);
        assert.equal(summary.optionPolicies.rejectionCallRate, 0.3333);
        assert.equal(summary.optionPolicies.conflictCallRate, 0.6667);
        assert.equal(summary.optionPolicies.ignoredRequestedOptionRate, 0.3333);
        assert.deepEqual(summary.optionPolicies.byContractVersion, { '1.1.0': 3 });
        assert.deepEqual(summary.optionPolicies.byMode, { batch: 2, single: 1 });
        assert.equal(summary.optionPolicies.byTool.find((item) => item.tool === 'terminal_exec')?.ignoredCallRate, 0.5);
        assert.equal(
            summary.optionPolicies.byTool.find((item) => item.tool === 'terminal_exec')?.rejectionCallRate,
            0.5,
        );
        assert.equal(summary.optionPolicies.byRuntimeCohort[`source:${sourceA}`].observedCalls, 2);
        assert.equal(summary.optionPolicies.byRuntimeCohort[`source:${sourceB}`].conflictCallRate, 1);
        assert.match(summary.optionPolicies.caveat, /pre-v6/u);
    });

    it('segments failure quality by runtime source generation instead of mixing rollout cohorts', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_apply_patch', 'a', {
                    runtime_source_fingerprint: '1'.repeat(64),
                }),
                row(2, 1_050, 'repo_apply_patch_failed', 'repo_apply_patch', 'a', {
                    runtime_source_fingerprint: '1'.repeat(64),
                    code: 'ERR_PATCH_NOT_FOUND',
                    causal_failure_count: 2,
                    inline_next_action_target_count: 0,
                }),
                row(3, 1_100, 'tool_call_completed', 'repo_apply_patch', 'a', {
                    runtime_source_fingerprint: '1'.repeat(64),
                }),
                row(4, 2_000, 'tool_call_started', 'repo_apply_patch', 'b', {
                    runtime_source_fingerprint: '2'.repeat(64),
                }),
                row(5, 2_050, 'repo_apply_patch_failed', 'repo_apply_patch', 'b', {
                    runtime_source_fingerprint: '2'.repeat(64),
                    code: 'ERR_PATCH_NOT_FOUND',
                    causal_failure_count: 2,
                    inline_next_action_target_count: 2,
                }),
                row(6, 2_100, 'tool_call_completed', 'repo_apply_patch', 'b', {
                    runtime_source_fingerprint: '2'.repeat(64),
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.runtimeCohorts.generationMixDetected, true);
        assert.equal(summary.runtimeCohorts.knownCohortCount, 2);
        assert.equal(summary.failures.byRuntimeCohort[`source:${'1'.repeat(64)}`].inlineNextActionCoverage, 0);
        assert.equal(summary.failures.byRuntimeCohort[`source:${'2'.repeat(64)}`].inlineNextActionCoverage, 1);
    });

    it('segments long quiescent gaps as discontinuities with call-paired lifecycle evidence', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_started', 'repo_create_file', 'a'),
                row(2, 1_100, 'tool_call_completed', 'repo_create_file', 'a'),
                row(3, 401_101, 'tool_call_started', 'mcp_apps_sdk_readiness', 'b'),
                row(4, 401_200, 'tool_call_completed', 'mcp_apps_sdk_readiness', 'b'),
                row(5, 402_000, 'tool_call_started', 'repo_read_file', 'c'),
                row(6, 402_100, 'tool_call_completed', 'repo_read_file', 'c'),
                row(7, 407_100, 'tool_call_started', 'repo_apply_patch', 'd'),
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
                (transition) => transition.from === 'repo_create_file' && transition.to === 'mcp_apps_sdk_readiness',
            ),
            false,
        );
        assert.ok(summary.topTransitions.some((row) => row.from === 'repo_read_file' && row.to === 'repo_apply_patch'));
    });

    it('keeps the dashboard snapshot read-only when the derived schema is absent', () => {
        const db = createDb();
        const before = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get();
        const snapshot = readMcpRoundTripAnalyticsSnapshot({
            db: adaptBetterSqliteDatabase(db),
            now: () => 100_000,
            windowMs: 20_000,
        });
        const after = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get();
        assert.equal(snapshot.available, false);
        assert.equal(snapshot.indexedRows, 0);
        assert.deepEqual(after, before);
    });

    it('migrates an older derived event table with v5 result-outcome/correlation/accounting columns', () => {
        const db = createDb();
        db.exec(`
            CREATE TABLE copilot_mcp_round_trip_events (
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
        `);
        createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice: async () => emptySlice(),
        });
        const columns = /** @type {{ name: string }[]} */ (
            db.prepare('PRAGMA table_info(copilot_mcp_round_trip_events)').all()
        );
        for (const name of [
            'call_id',
            'trace_key',
            'target_keys_json',
            'runtime_source_fingerprint',
            'result_code',
            'result_state',
            'result_class',
            'option_contract_version',
            'option_policy_coverage',
            'option_mode',
            'option_declared_count',
            'option_requested_count',
            'option_effective_requested_count',
            'option_defaulted_count',
            'option_normalized_count',
            'option_ignored_count',
            'option_coerced_count',
            'option_rejected_count',
            'option_conflict_count',
            'logical_operations',
            'batch_size',
            'batch_capacity',
            'truncated_operations',
            'continuation_required',
            'continuation_available',
            'continuation_available_operations',
            'continuation_transport_required',
            'continuation_transport_required_operations',
            'continuation_recommended',
            'continuation_recommended_operations',
            'result_bytes',
            'duplicate_text_bytes',
            'causal_by_code_json',
        ]) {
            assert.equal(
                columns.some((column) => column.name === name),
                true,
                name,
            );
        }
    });

    it('replays from zero when only the v6 normalizer cursor exists and materializes the v7 cursor', async () => {
        const db = createDb();
        const nowMs = 100_000;
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            now: () => nowMs,
            readSlice: async ({ offset = 0 } = {}) => ({
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
            }),
        });
        db.prepare(
            `INSERT OR REPLACE INTO copilot_mcp_round_trip_cursor
             (cursor_id, file_identity, byte_offset, file_bytes, updated_at_ms)
             VALUES ('mcp-audit:v6', 'dev:ino-a', 900, 900, ?)`,
        ).run(nowMs - 1_000);
        const report = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(report.schemaVersion, 7);
        assert.equal(report.normalizerVersion, 7);
        assert.deepEqual(report.failures.byClass, { 'stale-context': 1 });
        const cursor = db
            .prepare("SELECT byte_offset FROM copilot_mcp_round_trip_cursor WHERE cursor_id='mcp-audit:v7'")
            .get();
        assert.ok(cursor && typeof cursor === 'object');
        assert.equal(Number(/** @type {Record<string, unknown>} */ (cursor)['byte_offset']), 100);
    });

    it('marks an over-budget analytics window incomplete and retains the newest bounded tail', async () => {
        const db = createDb();
        const nowMs = 100_000;
        const events = [
            entry(0, { ts: iso(90_000), event: 'tool_call_started', tool: 'tool-1', callId: '1' }),
            entry(10, { ts: iso(91_000), event: 'tool_call_started', tool: 'tool-2', callId: '2' }),
            entry(20, { ts: iso(92_000), event: 'tool_call_started', tool: 'tool-3', callId: '3' }),
            entry(30, { ts: iso(93_000), event: 'tool_call_started', tool: 'tool-4', callId: '4' }),
            entry(40, { ts: iso(94_000), event: 'tool_call_started', tool: 'tool-5', callId: '5' }),
        ];
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            now: () => nowMs,
            maxSummaryRows: 3,
            readSlice: async ({ offset = 0 } = {}) =>
                offset === 0
                    ? {
                          ok: true,
                          fileIdentity: 'dev:ino-a',
                          fileBytes: 50,
                          requestedOffset: 0,
                          startOffset: 0,
                          nextOffset: 50,
                          bytesRead: 50,
                          complete: true,
                          resetRequired: false,
                          parsedEvents: events.length,
                          invalidLines: 0,
                          entries: events,
                          events: events.map((item) => item.event),
                          error: null,
                      }
                    : emptySlice(offset, 'dev:ino-a', 50),
        });
        const report = await analytics.summarize({ windowMs: 20_000 });
        assert.deepEqual(report.completeness, {
            rowsEligible: 5,
            rowsAnalyzed: 3,
            maxRows: 3,
            truncated: true,
            selection: 'newest-bounded-tail',
            coverageRatio: 0.6,
        });
        assert.deepEqual(report.toolStarts.map((item) => item.tool).sort(), ['tool-3', 'tool-4', 'tool-5']);
        assert.match(report.authority, /bounded-newest-tail/u);
    });

    it('indexes slices idempotently and excludes synthetic rows by default', async () => {
        const db = createDb();
        const nowMs = 100_000;
        /** @type {number[]} */
        const requestedOffsets = [];
        const events = [
            entry(0, { ts: iso(90_000), event: 'tool_call_started', tool: 'repo_read_file', callId: 'a' }),
            entry(100, { ts: iso(91_000), event: 'tool_call_completed', tool: 'repo_read_file', callId: 'a' }),
            entry(200, {
                ts: iso(92_000),
                event: 'repo_apply_patch_failed',
                tool: 'repo_apply_patch',
                callId: 'fixture',
                path: 'src/copilot/.ai/jobs/test/target.txt',
                code: 'ERR_PATCH_NOT_FOUND',
                failureClass: 'stale-context',
            }),
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
                    events: events.map((item) => item.event),
                    error: null,
                };
            }
            return emptySlice(offset, 'dev:ino-a', 300);
        };
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice,
            now: () => nowMs,
            maxChunks: 2,
        });
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

    it('bounds background-style sync work per call without reducing explicit catch-up capacity', async () => {
        const db = createDb();
        const nowMs = 100_000;
        /** @type {number[]} */
        const offsets = [];
        const readSlice = async ({ offset = 0 } = {}) => {
            offsets.push(offset);
            const nextOffset = Math.min(300, offset + 100);
            return {
                ok: true,
                fileIdentity: 'dev:ino-budget',
                fileBytes: 300,
                requestedOffset: offset,
                startOffset: offset,
                nextOffset,
                bytesRead: nextOffset - offset,
                complete: nextOffset >= 300,
                resetRequired: false,
                parsedEvents: 0,
                invalidLines: 0,
                entries: [],
                events: [],
                error: null,
            };
        };
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice,
            now: () => nowMs,
            maxChunks: 3,
        });

        const bounded = await analytics.sync({ maxChunks: 1 });
        assert.equal(bounded.chunks, 1);
        assert.equal(bounded.chunkBudget, 1);
        assert.equal(bounded.complete, false);
        assert.equal(bounded.lagBytes, 200);
        assert.equal(bounded.cursor?.byteOffset, 100);

        const catchUp = await analytics.sync();
        assert.equal(catchUp.chunkBudget, 3);
        assert.equal(catchUp.chunks, 2);
        assert.equal(catchUp.complete, true);
        assert.equal(catchUp.lagBytes, 0);
        assert.equal(catchUp.cursor?.byteOffset, 300);
        assert.deepEqual(offsets, [0, 100, 200]);
    });

    it('keeps old-identity history while restarting ingestion at zero for a rotated audit file', async () => {
        const db = createDb();
        const nowMs = 100_000;
        let generation = 'a';
        /** @type {{ generation: string; offset: number }[]} */
        const calls = [];
        const readSlice = async ({ offset = 0 } = {}) => {
            calls.push({ generation, offset });
            if (generation === 'a') {
                return offset === 0
                    ? {
                          ok: true,
                          fileIdentity: 'dev:ino-a',
                          fileBytes: 100,
                          requestedOffset: 0,
                          startOffset: 0,
                          nextOffset: 100,
                          bytesRead: 100,
                          complete: true,
                          resetRequired: false,
                          parsedEvents: 1,
                          invalidLines: 0,
                          entries: [
                              entry(0, {
                                  ts: iso(90_000),
                                  event: 'tool_call_started',
                                  tool: 'repo_read_file',
                                  callId: 'a',
                              }),
                          ],
                          events: [],
                          error: null,
                      }
                    : emptySlice(offset, 'dev:ino-a', 100);
            }
            if (offset > 0) {
                return {
                    ...emptySlice(offset, 'dev:ino-b', 120),
                    complete: false,
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
                entries: [
                    entry(0, {
                        ts: iso(95_000),
                        event: 'tool_call_started',
                        tool: 'repo_search_text',
                        callId: 'b',
                    }),
                ],
                events: [],
                error: null,
            };
        };
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice,
            now: () => nowMs,
            maxChunks: 3,
        });
        const first = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(first.indexedRows, 1);
        generation = 'b';
        const second = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(second.ingestion?.reset, true);
        assert.equal(second.ingestion?.cursor?.fileIdentity, 'dev:ino-b');
        assert.equal(second.indexedRows, 2);
        assert.deepEqual(second.toolStarts.map((item) => item.tool).sort(), ['repo_read_file', 'repo_search_text']);
        assert.deepEqual(calls, [
            { generation: 'a', offset: 0 },
            { generation: 'b', offset: 100 },
            { generation: 'b', offset: 0 },
        ]);
    });
});
