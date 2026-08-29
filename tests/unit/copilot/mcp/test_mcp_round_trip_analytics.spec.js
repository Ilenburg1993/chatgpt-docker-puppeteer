// @ts-check

import { adaptBetterSqliteDatabase } from '#copilot/infra/public/testing/database/sqlite';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

/** @param {number} offset @param {string} [lineage] */
function continuityAnchor(offset, lineage = 'lineage-a') {
    const windowBytes = Math.min(4096, offset);
    return {
        version: 1,
        algorithm: 'sha256',
        offset,
        windowStart: offset - windowBytes,
        windowBytes,
        token: createHash('sha256')
            .update(`${lineage}:${String(offset)}`)
            .digest('hex'),
    };
}

/** @param {number} offset */
function sequenceProof(offset) {
    return {
        version: 1,
        algorithm: 'sha256-chain',
        token: createHash('sha256')
            .update(`synthetic-sequence:${String(offset)}`)
            .digest('hex'),
    };
}

/**
 * @param {{
 *   offset?: number;
 *   nextOffset?: number;
 *   fileBytes?: number;
 *   physicalFileIdentity?: string;
 *   lineage?: string;
 *   entries?: {sourceOffset:number;event:Record<string,unknown>}[];
 *   parsedEvents?: number;
 *   invalidLines?: number;
 *   complete?: boolean;
 *   sourcePresent?: boolean;
 *   offsetPastEnd?: boolean;
 * }} [options]
 */
function auditSlice(options = {}) {
    const offset = options.offset ?? 0;
    const nextOffset = options.nextOffset ?? offset;
    const fileBytes = options.fileBytes ?? nextOffset;
    const sourcePresent = options.sourcePresent !== false;
    const offsetPastEnd = options.offsetPastEnd === true || (sourcePresent && offset > fileBytes);
    const lineage = options.lineage ?? 'lineage-a';
    const entries = options.entries ?? [];
    return {
        ok: true,
        sourcePresent,
        physicalFileIdentity: sourcePresent ? (options.physicalFileIdentity ?? 'dev:ino-a') : null,
        fileBytes: sourcePresent ? fileBytes : 0,
        requestedOffset: offset,
        startOffset: offsetPastEnd ? fileBytes : offset,
        nextOffset,
        bytesRead: offsetPastEnd || !sourcePresent ? 0 : Math.max(0, nextOffset - offset),
        complete: options.complete ?? (sourcePresent ? nextOffset >= fileBytes : offset === 0),
        offsetPastEnd,
        continuityAtStart: sourcePresent && !offsetPastEnd ? continuityAnchor(offset, lineage) : null,
        continuityAtNext: sourcePresent && !offsetPastEnd ? continuityAnchor(nextOffset, lineage) : null,
        sequenceAtStart: sourcePresent && !offsetPastEnd ? sequenceProof(offset) : null,
        sequenceAtNext: sourcePresent && !offsetPastEnd ? sequenceProof(nextOffset) : null,
        parsedEvents: options.parsedEvents ?? entries.length,
        invalidLines: options.invalidLines ?? 0,
        entries,
        events: entries.map((item) => item.event),
        error: null,
    };
}

function emptySlice(offset = 0, physicalFileIdentity = 'dev:ino-a', fileBytes = offset, lineage = 'lineage-a') {
    return auditSlice({
        offset,
        nextOffset: offset,
        physicalFileIdentity,
        fileBytes,
        lineage,
        complete: offset >= fileBytes,
    });
}

describe('MCP incremental round-trip analytics v11', () => {
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
            executionPolicyClass: 'direct-apply',
            executionFailurePolicyClass: 'best-effort',
            executionConcurrencyClass: 'parallel-bounded',
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
        assert.equal(normalized?.executionPolicyClass, 'direct-apply');
        assert.equal(normalized?.executionFailurePolicyClass, 'best-effort');
        assert.equal(normalized?.executionConcurrencyClass, 'parallel-bounded');
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

    it('rejects open-ended execution-policy strings instead of persisting arbitrary policy cardinality', () => {
        const normalized = normalizeMcpRoundTripAuditEvent({
            ts: iso(11_000),
            event: 'tool_call_completed',
            tool: 'repo_apply_patch_batch',
            executionPolicyClass: 'caller-defined-policy',
            executionFailurePolicyClass: 'retry-until-success',
            executionConcurrencyClass: 'c128',
        });
        assert.equal(normalized?.executionPolicyClass, null);
        assert.equal(normalized?.executionFailurePolicyClass, null);
        assert.equal(normalized?.executionConcurrencyClass, null);
        const serialized = JSON.stringify(normalized);
        for (const forbidden of ['caller-defined-policy', 'retry-until-success', 'c128']) {
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

    it('aggregates v11 effective execution policies without inferring legacy patch completions', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_completed', 'repo_apply_patch_batch', 'legacy', {
                    execution_mode: 'patch-apply:per-target-fast:fail-fast',
                    runtime_epoch_id: 'epoch-old',
                }),
                row(2, 1_100, 'tool_call_completed', 'repo_apply_patch_batch', 'direct', {
                    execution_policy_class: 'direct-apply',
                    execution_failure_policy_class: 'fail-fast',
                    execution_concurrency_class: 'parallel-bounded',
                    runtime_epoch_id: 'epoch-new',
                }),
                row(3, 1_200, 'tool_call_completed', 'repo_apply_patch_batch', 'dry', {
                    execution_policy_class: 'dry-run',
                    execution_failure_policy_class: 'best-effort',
                    execution_concurrency_class: 'sequential',
                    runtime_epoch_id: 'epoch-new',
                }),
                row(4, 1_300, 'tool_call_completed', 'repo_read_file', 'other', {
                    runtime_epoch_id: 'epoch-new',
                }),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.executionPolicies.eligibleCalls, 3);
        assert.equal(summary.executionPolicies.observedCalls, 2);
        assert.equal(summary.executionPolicies.coverageRate, 0.6667);
        assert.deepEqual(summary.executionPolicies.byPolicyClass, { 'direct-apply': 1, 'dry-run': 1 });
        assert.deepEqual(summary.executionPolicies.byFailurePolicyClass, { 'fail-fast': 1, 'best-effort': 1 });
        assert.deepEqual(summary.executionPolicies.byConcurrencyClass, { 'parallel-bounded': 1, sequential: 1 });
        assert.equal(summary.executionPolicies.byTool[0]?.tool, 'repo_apply_patch_batch');
        assert.equal(summary.executionPolicies.byTool[0]?.observedCalls, 2);
        assert.equal(summary.executionPolicies.byRuntimeCohort['epoch:epoch-new']?.observedCalls, 2);
        assert.match(summary.executionPolicies.caveat, /never inferred/u);
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

    it('aggregates v8 recovery-recipe disposition counts without storing invocation data', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_completed', 'repo_apply_patch', 'a', {
                    recovery_recipe_count: 1,
                    retry_safe_recovery_recipe_count: 1,
                    suggested_recovery_recipe_count: 0,
                    manual_recovery_recipe_count: 0,
                    no_retry_recovery_recipe_count: 0,
                }),
                row(2, 1_100, 'tool_call_completed', 'repo_apply_patch', 'b', {
                    recovery_recipe_count: 2,
                    retry_safe_recovery_recipe_count: 0,
                    suggested_recovery_recipe_count: 1,
                    manual_recovery_recipe_count: 1,
                    no_retry_recovery_recipe_count: 0,
                }),
                row(3, 1_200, 'tool_call_completed', 'git_publish_changes', 'c', {
                    recovery_recipe_count: 1,
                    retry_safe_recovery_recipe_count: 1,
                    suggested_recovery_recipe_count: 0,
                    manual_recovery_recipe_count: 0,
                    no_retry_recovery_recipe_count: 0,
                }),
                row(4, 1_300, 'tool_call_completed', 'repo_apply_patch', 'legacy', {}),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );
        assert.equal(summary.recoveryRecipes.callsWithRecipe, 3);
        assert.equal(summary.recoveryRecipes.recipeCount, 4);
        assert.equal(summary.recoveryRecipes.retrySafeCount, 2);
        assert.equal(summary.recoveryRecipes.suggestedCount, 1);
        assert.equal(summary.recoveryRecipes.manualCount, 1);
        assert.equal(summary.recoveryRecipes.noRetryCount, 0);
        assert.deepEqual(summary.recoveryRecipes.byTool[0], {
            tool: 'repo_apply_patch',
            callsWithRecipe: 2,
            recipeCount: 3,
            retrySafeCount: 1,
            suggestedCount: 1,
            manualCount: 1,
            noRetryCount: 0,
        });
        assert.equal(JSON.stringify(summary.recoveryRecipes).includes('old_string'), false);
    });

    it('aggregates v9 exact self-repair counts without storing recovery content', () => {
        const summary = summarizeMcpRoundTripRows(
            [
                row(1, 1_000, 'tool_call_completed', 'repo_apply_patch', 'a', {
                    exact_self_repair_attempted_count: 1,
                    exact_self_repair_succeeded_count: 1,
                    exact_self_repair_failed_closed_count: 0,
                }),
                row(2, 1_100, 'tool_call_completed', 'repo_apply_patch', 'b', {
                    exact_self_repair_attempted_count: 1,
                    exact_self_repair_succeeded_count: 0,
                    exact_self_repair_failed_closed_count: 1,
                }),
                row(3, 1_200, 'tool_call_completed', 'repo_apply_patch_batch', 'c', {
                    exact_self_repair_attempted_count: 4,
                    exact_self_repair_succeeded_count: 3,
                    exact_self_repair_failed_closed_count: 1,
                }),
                row(4, 1_300, 'tool_call_completed', 'repo_apply_patch', 'legacy', {}),
            ],
            { windowMs: 10_000, top: 20, includeSynthetic: false },
        );

        assert.equal(summary.exactSelfRepair.callsWithAttempt, 3);
        assert.equal(summary.exactSelfRepair.attemptedCount, 6);
        assert.equal(summary.exactSelfRepair.succeededCount, 4);
        assert.equal(summary.exactSelfRepair.failedClosedCount, 2);
        assert.equal(summary.exactSelfRepair.successRate, 0.6667);
        assert.equal(summary.exactSelfRepair.failedClosedRate, 0.3333);
        assert.deepEqual(summary.exactSelfRepair.byTool[0], {
            tool: 'repo_apply_patch_batch',
            callsWithAttempt: 1,
            attemptedCount: 4,
            succeededCount: 3,
            failedClosedCount: 1,
            successRate: 0.75,
            failedClosedRate: 0.25,
        });
        const serialized = JSON.stringify(summary.exactSelfRepair);
        assert.equal(serialized.includes('old_string'), false);
        assert.equal(serialized.includes('expectedHash'), false);
        assert.equal(serialized.includes('reasonCode'), false);
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

    it('fails closed on a legacy derived schema, then rebuilds it as v11 from the raw reader', async () => {
        const db = createDb();
        db.exec(`
            CREATE TABLE copilot_mcp_round_trip_cursor (
                cursor_id TEXT PRIMARY KEY,
                file_identity TEXT,
                byte_offset INTEGER NOT NULL,
                file_bytes INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE copilot_mcp_round_trip_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_identity TEXT NOT NULL,
                source_offset INTEGER NOT NULL,
                ts_ms INTEGER NOT NULL,
                event TEXT NOT NULL,
                tool TEXT,
                synthetic INTEGER NOT NULL DEFAULT 0 CHECK(synthetic IN (0,1)),
                UNIQUE(source_identity, source_offset)
            ) STRICT;
            INSERT INTO copilot_mcp_round_trip_cursor
                (cursor_id,file_identity,byte_offset,file_bytes,updated_at_ms)
            VALUES ('mcp-audit:v9','legacy:ino',100,100,1);
            INSERT INTO copilot_mcp_round_trip_events
                (source_identity,source_offset,ts_ms,event,tool,synthetic)
            VALUES ('legacy:ino',0,90000,'tool_call_started','legacy_tool',0);
        `);
        const before = readMcpRoundTripAnalyticsSnapshot({
            db: adaptBetterSqliteDatabase(db),
            now: () => 100_000,
            windowMs: 20_000,
        });
        assert.equal(before.available, false);
        assert.equal(before.sourceIntegrity?.status, 'rebuild-required');
        assert.match(String(before.authority), /v11-rebuild-required/u);

        const event = entry(0, {
            ts: iso(90_000),
            event: 'tool_call_started',
            tool: 'repo_read_file',
            callId: 'fresh-a',
        });
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            now: () => 100_000,
            readSlice: async ({ offset = 0 } = {}) =>
                offset === 0
                    ? auditSlice({ offset: 0, nextOffset: 100, fileBytes: 100, entries: [event] })
                    : emptySlice(offset, 'dev:ino-a', 100),
        });
        const report = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(report.schemaVersion, 11);
        assert.equal(report.normalizerVersion, 11);
        assert.equal(report.indexedRows, 1);
        assert.deepEqual(
            report.toolStarts.map((item) => item.tool),
            ['repo_read_file'],
        );
        assert.equal(report.sourceIntegrity?.indexSchemaVersion, 11);

        const meta = db
            .prepare(
                "SELECT schema_version,normalizer_version,schema_created_at_ms FROM copilot_mcp_round_trip_meta WHERE meta_id='current'",
            )
            .get();
        assert.deepEqual(meta, { schema_version: 11, normalizer_version: 11, schema_created_at_ms: 100_000 });
        const columns = /** @type {{ name: string }[]} */ (
            db.prepare('PRAGMA table_info(copilot_mcp_round_trip_events)').all()
        );
        assert.equal(
            columns.some((column) => column.name === 'source_generation'),
            true,
        );
        assert.equal(
            columns.some((column) => column.name === 'physical_file_identity'),
            true,
        );
        for (const name of [
            'execution_policy_class',
            'execution_failure_policy_class',
            'execution_concurrency_class',
        ]) {
            assert.equal(
                columns.some((column) => column.name === name),
                true,
                name,
            );
        }
        assert.equal(
            columns.some((column) => column.name === 'source_identity'),
            false,
        );
        assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM copilot_mcp_round_trip_events').get().count), 1);
    });

    it('treats a matching schema with a stale normalizer generation as rebuild-required', async () => {
        const db = createDb();
        db.exec(`
            CREATE TABLE copilot_mcp_round_trip_meta (
                meta_id TEXT PRIMARY KEY,
                schema_version INTEGER NOT NULL,
                normalizer_version INTEGER NOT NULL,
                schema_created_at_ms INTEGER NOT NULL
            ) STRICT;
            INSERT INTO copilot_mcp_round_trip_meta
                (meta_id,schema_version,normalizer_version,schema_created_at_ms)
            VALUES ('current',11,10,1);
            CREATE TABLE copilot_mcp_round_trip_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_generation TEXT NOT NULL,
                physical_file_identity TEXT,
                source_offset INTEGER NOT NULL,
                ts_ms INTEGER NOT NULL,
                event TEXT NOT NULL,
                tool TEXT,
                synthetic INTEGER NOT NULL DEFAULT 0 CHECK(synthetic IN (0,1)),
                UNIQUE(source_generation,source_offset)
            ) STRICT;
        `);
        const snapshot = readMcpRoundTripAnalyticsSnapshot({
            db: adaptBetterSqliteDatabase(db),
            now: () => 100_000,
            windowMs: 20_000,
        });
        assert.equal(snapshot.available, false);
        assert.equal(snapshot.sourceIntegrity?.indexSchemaVersion, 11);
        assert.equal(snapshot.sourceIntegrity?.indexNormalizerVersion, 10);
        assert.equal(snapshot.sourceIntegrity?.expectedNormalizerVersion, 11);
        assert.equal(snapshot.sourceIntegrity?.status, 'rebuild-required');
        assert.match(String(snapshot.authority), /schema-11-normalizer-10/u);

        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            now: () => 100_000,
            readSlice: async ({ offset = 0 } = {}) => emptySlice(offset, 'dev:ino-a', 0),
        });
        const rebuilt = await analytics.sync();
        assert.equal(rebuilt.ok, true);
        const meta = db
            .prepare(
                "SELECT schema_version,normalizer_version FROM copilot_mcp_round_trip_meta WHERE meta_id='current'",
            )
            .get();
        assert.deepEqual(meta, { schema_version: 11, normalizer_version: 11 });
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
                    ? auditSlice({ offset: 0, nextOffset: 50, fileBytes: 50, entries: events })
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

    it('indexes slices idempotently, excludes synthetic rows by default and keeps one logical generation', async () => {
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
            return offset === 0
                ? auditSlice({ offset: 0, nextOffset: 300, fileBytes: 300, entries: events })
                : emptySlice(offset, 'dev:ino-a', 300);
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
        assert.equal(first.ingestion?.cursor?.generationSequence, 1);

        const second = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(second.ingestion?.indexedEvents, 0);
        assert.equal(second.indexedRows, 2);
        assert.deepEqual(requestedOffsets, [0, 300]);
        assert.equal(
            Number(
                db.prepare('SELECT COUNT(DISTINCT source_generation) AS count FROM copilot_mcp_round_trip_events').get()
                    .count,
            ),
            1,
        );

        const includingSynthetic = await analytics.summarize({ windowMs: 20_000, includeSynthetic: true, sync: false });
        assert.equal(includingSynthetic.indexedRows, 3);
        assert.deepEqual(includingSynthetic.failures.byCode, { ERR_PATCH_NOT_FOUND: 1 });
    });

    it('filters bounded summaries by runtime source binding before computing completeness and tool coverage', async () => {
        const db = createDb();
        const nowMs = 100_000;
        const events = [
            entry(0, {
                ts: iso(90_000),
                event: 'tool_call_started',
                tool: 'promoted_tool',
                callId: 'promoted-a',
                runtimeEpochId: 'epoch-promoted',
                runtimeSourceBinding: 'controlled-promotion',
                runtimeSourceFingerprint: 'a'.repeat(64),
            }),
            entry(100, {
                ts: iso(91_000),
                event: 'tool_call_completed',
                tool: 'promoted_tool',
                callId: 'promoted-a',
                runtimeEpochId: 'epoch-promoted',
                runtimeSourceBinding: 'controlled-promotion',
                runtimeSourceFingerprint: 'a'.repeat(64),
            }),
            entry(200, {
                ts: iso(92_000),
                event: 'tool_call_started',
                tool: 'manual_tool',
                callId: 'manual-a',
                runtimeEpochId: 'epoch-manual',
                runtimeSourceBinding: 'manual-unbound',
            }),
            entry(300, {
                ts: iso(93_000),
                event: 'tool_call_completed',
                tool: 'manual_tool',
                callId: 'manual-a',
                runtimeEpochId: 'epoch-manual',
                runtimeSourceBinding: 'manual-unbound',
            }),
        ];
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            now: () => nowMs,
            maxSummaryRows: 2,
            readSlice: async ({ offset = 0 } = {}) =>
                offset === 0
                    ? auditSlice({ offset: 0, nextOffset: 400, fileBytes: 400, entries: events })
                    : emptySlice(offset, 'dev:ino-a', 400),
        });

        const unfiltered = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(unfiltered.completeness.rowsEligible, 4);
        assert.equal(unfiltered.completeness.truncated, true);
        assert.deepEqual(unfiltered.toolStarts, [{ tool: 'manual_tool', count: 1 }]);

        const promoted = await analytics.summarize({
            windowMs: 20_000,
            sync: false,
            runtimeSourceBinding: 'controlled-promotion',
        });
        assert.deepEqual(promoted.queryScope, {
            includeSynthetic: false,
            runtimeSourceBinding: 'controlled-promotion',
        });
        assert.deepEqual(promoted.completeness, {
            rowsEligible: 2,
            rowsAnalyzed: 2,
            maxRows: 2,
            truncated: false,
            selection: 'complete-window',
            coverageRatio: 1,
        });
        assert.deepEqual(promoted.toolStarts, [{ tool: 'promoted_tool', count: 1 }]);
        assert.equal(promoted.callPairing.startedCallCount, 1);
        assert.equal(promoted.callPairing.pairedCallCount, 1);

        const currentEpoch = await analytics.summarize({
            windowMs: 20_000,
            sync: false,
            runtimeEpochId: 'epoch-manual',
        });
        assert.deepEqual(currentEpoch.queryScope, {
            includeSynthetic: false,
            runtimeSourceBinding: null,
            runtimeEpochId: 'epoch-manual',
        });
        assert.equal(currentEpoch.completeness.rowsEligible, 2);
        assert.deepEqual(currentEpoch.toolStarts, [{ tool: 'manual_tool', count: 1 }]);

        await assert.rejects(
            () => analytics.summarize({ windowMs: 20_000, sync: false, runtimeSourceBinding: 'bad binding' }),
            /bounded machine-like source binding/u,
        );
        await assert.rejects(
            () => analytics.summarize({ windowMs: 20_000, sync: false, runtimeEpochId: 'bad epoch' }),
            /bounded opaque runtime identity/u,
        );
    });

    it('keeps machine-level tool-start coverage above the public top-100 display cap', async () => {
        const db = createDb();
        const nowMs = 100_000;
        const events = Array.from({ length: 130 }, (_, index) =>
            entry(index * 100, {
                ts: iso(90_000 + index),
                event: 'tool_call_started',
                tool: `historical_tool_${String(index).padStart(3, '0')}`,
                callId: `call-${String(index)}`,
                runtimeSourceBinding: 'controlled-promotion',
            }),
        );
        const fileBytes = events.length * 100;
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            now: () => nowMs,
            readSlice: async ({ offset = 0 } = {}) =>
                offset === 0
                    ? auditSlice({ offset: 0, nextOffset: fileBytes, fileBytes, entries: events })
                    : emptySlice(offset, 'dev:ino-a', fileBytes),
        });
        const report = await analytics.summarize({
            windowMs: 20_000,
            top: 500,
            runtimeSourceBinding: 'controlled-promotion',
        });
        assert.equal(report.toolStarts.length, 130);
        assert.equal(report.toolStarts[0]?.count, 1);
        assert.equal(report.queryScope?.runtimeSourceBinding, 'controlled-promotion');
    });

    it('bounds background-style sync work per call without reducing explicit catch-up capacity', async () => {
        const db = createDb();
        const nowMs = 100_000;
        /** @type {number[]} */
        const offsets = [];
        const readSlice = async ({ offset = 0 } = {}) => {
            offsets.push(offset);
            const nextOffset = Math.min(300, offset + 100);
            return auditSlice({
                offset,
                nextOffset,
                fileBytes: 300,
                physicalFileIdentity: 'dev:ino-budget',
                lineage: 'budget-lineage',
                complete: nextOffset >= 300,
            });
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
        const duringCatchUp = readMcpRoundTripAnalyticsSnapshot({
            db: adaptBetterSqliteDatabase(db),
            now: () => nowMs,
            windowMs: 20_000,
        });
        assert.equal(duringCatchUp.available, false);
        assert.equal(duringCatchUp.sourceIntegrity?.status, 'materializing');
        assert.equal(duringCatchUp.sourceIntegrity?.lagBytes, 200);
        assert.match(String(duringCatchUp.authority), /v11-catch-up-required/u);

        const catchUp = await analytics.sync();
        assert.equal(catchUp.chunkBudget, 3);
        assert.equal(catchUp.chunks, 2);
        assert.equal(catchUp.complete, true);
        assert.equal(catchUp.lagBytes, 0);
        assert.equal(catchUp.cursor?.byteOffset, 300);
        const afterCatchUp = readMcpRoundTripAnalyticsSnapshot({
            db: adaptBetterSqliteDatabase(db),
            now: () => nowMs,
            windowMs: 20_000,
        });
        assert.equal(afterCatchUp.available, true);
        assert.equal(afterCatchUp.sourceIntegrity?.status, 'materialized');
        assert.equal(afterCatchUp.sourceIntegrity?.lagBytes, 0);
        assert.deepEqual(offsets, [0, 100, 200]);
    });

    it('does not publish a partial analytics window when explicit sync exhausts its catch-up budget', async () => {
        const db = createDb();
        const nowMs = 100_000;
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            now: () => nowMs,
            maxChunks: 1,
            readSlice: async ({ offset = 0 } = {}) => {
                const nextOffset = Math.min(200, offset + 100);
                return auditSlice({
                    offset,
                    nextOffset,
                    fileBytes: 200,
                    lineage: 'partial-catch-up',
                    entries:
                        offset === 0
                            ? [
                                  entry(0, {
                                      ts: iso(90_000),
                                      event: 'tool_call_started',
                                      tool: 'must-not-publish-yet',
                                      callId: 'a',
                                  }),
                              ]
                            : [],
                    complete: nextOffset >= 200,
                });
            },
        });
        const report = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(report.available, false);
        assert.equal(report.indexedRows, 0);
        assert.equal(report.ingestion?.complete, false);
        assert.equal(report.sourceIntegrity?.status, 'materializing');
        assert.equal(report.sourceIntegrity?.lagBytes, 100);
        assert.match(String(report.authority), /v11-catch-up-required/u);
        assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM copilot_mcp_round_trip_events').get().count), 1);
    });

    it('treats byte-identical physical replacement as rebind of the same generation without prefix replay', async () => {
        const db = createDb();
        const nowMs = 100_000;
        let phase = 'a';
        /** @type {{phase:string;offset:number}[]} */
        const calls = [];
        const readSlice = async ({ offset = 0 } = {}) => {
            calls.push({ phase, offset });
            if (phase === 'a') {
                return offset === 0
                    ? auditSlice({
                          offset: 0,
                          nextOffset: 100,
                          fileBytes: 100,
                          physicalFileIdentity: 'dev:ino-a',
                          lineage: 'shared-prefix',
                          entries: [
                              entry(0, {
                                  ts: iso(90_000),
                                  event: 'tool_call_started',
                                  tool: 'repo_read_file',
                                  callId: 'a',
                              }),
                          ],
                      })
                    : emptySlice(offset, 'dev:ino-a', 100, 'shared-prefix');
            }
            return offset === 100
                ? auditSlice({
                      offset: 100,
                      nextOffset: 120,
                      fileBytes: 120,
                      physicalFileIdentity: 'otherdev:otherino',
                      lineage: 'shared-prefix',
                      entries: [
                          entry(100, {
                              ts: iso(95_000),
                              event: 'tool_call_started',
                              tool: 'repo_search_text',
                              callId: 'b',
                          }),
                      ],
                  })
                : emptySlice(offset, 'otherdev:otherino', 120, 'shared-prefix');
        };
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice,
            readPrefixProof: async ({ offset }) => ({
                ok: true,
                sourcePresent: true,
                prefixAvailable: true,
                physicalFileIdentity: phase === 'a' ? 'dev:ino-a' : 'otherdev:otherino',
                fileBytes: phase === 'a' ? 100 : 120,
                offset,
                bytesRead: offset,
                continuityAtOffset: continuityAnchor(offset, 'shared-prefix'),
                sequenceAtOffset: sequenceProof(offset),
                error: null,
            }),
            now: () => nowMs,
            maxChunks: 3,
        });
        const first = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(first.indexedRows, 1);
        phase = 'b';
        const second = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(second.ingestion?.reset, false);
        assert.equal(second.ingestion?.rebound, true);
        assert.equal(second.ingestion?.rebindsThisSync, 1);
        assert.equal(second.ingestion?.newGenerationsThisSync, 0);
        assert.equal(second.ingestion?.cursor?.generationSequence, 1);
        assert.equal(second.ingestion?.cursor?.rebindCount, 1);
        assert.equal(second.ingestion?.cursor?.physicalFileIdentity, 'otherdev:otherino');
        assert.equal(second.indexedRows, 2);
        assert.deepEqual(second.toolStarts.map((item) => item.tool).sort(), ['repo_read_file', 'repo_search_text']);
        assert.deepEqual(calls, [
            { phase: 'a', offset: 0 },
            { phase: 'b', offset: 100 },
        ]);
        const third = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(third.ingestion?.indexedEvents, 0);
        assert.equal(third.indexedRows, 2);
        assert.equal(
            Number(
                db.prepare('SELECT COUNT(DISTINCT source_generation) AS count FROM copilot_mcp_round_trip_events').get()
                    .count,
            ),
            1,
        );
    });

    it('starts a new preserved generation when a new physical file fails the cursor continuity anchor', async () => {
        const db = createDb();
        const nowMs = 100_000;
        let phase = 'a';
        const readSlice = async ({ offset = 0 } = {}) => {
            if (phase === 'a') {
                return offset === 0
                    ? auditSlice({
                          offset: 0,
                          nextOffset: 100,
                          fileBytes: 100,
                          physicalFileIdentity: 'dev:ino-a',
                          lineage: 'generation-a',
                          entries: [
                              entry(0, {
                                  ts: iso(90_000),
                                  event: 'tool_call_started',
                                  tool: 'repo_read_file',
                                  callId: 'a',
                              }),
                          ],
                      })
                    : emptySlice(offset, 'dev:ino-a', 100, 'generation-a');
            }
            if (offset > 0) {
                return auditSlice({
                    offset,
                    nextOffset: 120,
                    fileBytes: 120,
                    physicalFileIdentity: 'dev:ino-b',
                    lineage: 'generation-b',
                    complete: true,
                });
            }
            return auditSlice({
                offset: 0,
                nextOffset: 120,
                fileBytes: 120,
                physicalFileIdentity: 'dev:ino-b',
                lineage: 'generation-b',
                entries: [
                    entry(0, { ts: iso(95_000), event: 'tool_call_started', tool: 'repo_search_text', callId: 'b' }),
                ],
            });
        };
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice,
            now: () => nowMs,
            maxChunks: 3,
        });
        await analytics.summarize({ windowMs: 20_000 });
        phase = 'b';
        const second = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(second.ingestion?.reset, true);
        assert.equal(second.ingestion?.newGenerationsThisSync, 1);
        assert.equal(second.ingestion?.cursor?.generationSequence, 2);
        assert.equal(second.ingestion?.cursor?.physicalChangeGenerationCount, 1);
        assert.equal(second.indexedRows, 2);
        const generations = db
            .prepare(
                'SELECT source_generation,COUNT(*) AS count FROM copilot_mcp_round_trip_events GROUP BY source_generation ORDER BY source_generation',
            )
            .all();
        assert.deepEqual(generations, [
            { source_generation: 'mcp-audit:v11:g1', count: 1 },
            { source_generation: 'mcp-audit:v11:g2', count: 1 },
        ]);
    });

    it('preserves prior history on same-physical copytruncate-like shrink', async () => {
        const db = createDb();
        const nowMs = 100_000;
        let phase = 'a';
        const readSlice = async ({ offset = 0 } = {}) => {
            if (phase === 'a') {
                return offset === 0
                    ? auditSlice({
                          offset: 0,
                          nextOffset: 100,
                          fileBytes: 100,
                          physicalFileIdentity: 'dev:ino-a',
                          lineage: 'generation-a',
                          entries: [
                              entry(0, {
                                  ts: iso(90_000),
                                  event: 'tool_call_started',
                                  tool: 'repo_read_file',
                                  callId: 'a',
                              }),
                          ],
                      })
                    : emptySlice(offset, 'dev:ino-a', 100, 'generation-a');
            }
            if (offset > 50) {
                return auditSlice({
                    offset,
                    nextOffset: offset,
                    fileBytes: 50,
                    physicalFileIdentity: 'dev:ino-a',
                    lineage: 'generation-b',
                    offsetPastEnd: true,
                });
            }
            return auditSlice({
                offset: 0,
                nextOffset: 50,
                fileBytes: 50,
                physicalFileIdentity: 'dev:ino-a',
                lineage: 'generation-b',
                entries: [
                    entry(0, { ts: iso(95_000), event: 'tool_call_started', tool: 'repo_search_text', callId: 'b' }),
                ],
            });
        };
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice,
            now: () => nowMs,
            maxChunks: 3,
        });
        await analytics.summarize({ windowMs: 20_000 });
        phase = 'b';
        const second = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(second.ingestion?.cursor?.generationSequence, 2);
        assert.equal(second.ingestion?.cursor?.truncationGenerationCount, 1);
        assert.equal(second.indexedRows, 2);
        assert.equal(
            Number(
                db.prepare('SELECT COUNT(DISTINCT source_generation) AS count FROM copilot_mcp_round_trip_events').get()
                    .count,
            ),
            2,
        );
    });

    it('preserves prior history on same-physical rewrite/regrow with a divergent anchor', async () => {
        const db = createDb();
        const nowMs = 100_000;
        let phase = 'a';
        const readSlice = async ({ offset = 0 } = {}) => {
            if (phase === 'a') {
                return offset === 0
                    ? auditSlice({
                          offset: 0,
                          nextOffset: 100,
                          fileBytes: 100,
                          physicalFileIdentity: 'dev:ino-a',
                          lineage: 'generation-a',
                          entries: [
                              entry(0, {
                                  ts: iso(90_000),
                                  event: 'tool_call_started',
                                  tool: 'repo_read_file',
                                  callId: 'a',
                              }),
                          ],
                      })
                    : emptySlice(offset, 'dev:ino-a', 100, 'generation-a');
            }
            if (offset > 0) {
                return auditSlice({
                    offset,
                    nextOffset: 140,
                    fileBytes: 140,
                    physicalFileIdentity: 'dev:ino-a',
                    lineage: 'rewritten-prefix',
                });
            }
            return auditSlice({
                offset: 0,
                nextOffset: 140,
                fileBytes: 140,
                physicalFileIdentity: 'dev:ino-a',
                lineage: 'rewritten-prefix',
                entries: [
                    entry(0, { ts: iso(95_000), event: 'tool_call_started', tool: 'repo_search_text', callId: 'b' }),
                ],
            });
        };
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice,
            now: () => nowMs,
            maxChunks: 3,
        });
        await analytics.summarize({ windowMs: 20_000 });
        phase = 'b';
        const second = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(second.ingestion?.cursor?.generationSequence, 2);
        assert.equal(second.ingestion?.cursor?.rewriteGenerationCount, 1);
        assert.equal(second.ingestion?.cursor?.physicalChangeGenerationCount, 0);
        assert.equal(second.indexedRows, 2);
    });

    it('preserves the certified cursor while the source path is temporarily absent', async () => {
        const db = createDb();
        const nowMs = 100_000;
        let present = true;
        const readSlice = async ({ offset = 0 } = {}) => {
            if (!present) return auditSlice({ offset, nextOffset: offset, sourcePresent: false });
            return offset === 0
                ? auditSlice({
                      offset: 0,
                      nextOffset: 100,
                      fileBytes: 100,
                      entries: [
                          entry(0, {
                              ts: iso(90_000),
                              event: 'tool_call_started',
                              tool: 'repo_read_file',
                              callId: 'a',
                          }),
                      ],
                  })
                : emptySlice(offset, 'dev:ino-a', 100);
        };
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice,
            now: () => nowMs,
        });
        const first = await analytics.sync();
        assert.equal(first.cursor?.byteOffset, 100);
        present = false;
        const second = await analytics.sync();
        assert.equal(second.sourcePresent, false);
        assert.equal(second.cursor?.byteOffset, 100);
        assert.equal(second.cursor?.generationSequence, 1);
        assert.equal(second.newGenerationsThisSync, 0);
    });

    it('rolls back event rows and cursor together when cursor persistence fails', async () => {
        const db = createDb();
        const nowMs = 100_000;
        const event = entry(0, { ts: iso(90_000), event: 'tool_call_started', tool: 'repo_read_file', callId: 'a' });
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            now: () => nowMs,
            readSlice: async ({ offset = 0 } = {}) =>
                offset === 0
                    ? auditSlice({ offset: 0, nextOffset: 100, fileBytes: 100, entries: [event] })
                    : emptySlice(offset, 'dev:ino-a', 100),
        });
        db.exec(`
            CREATE TRIGGER fail_round_trip_cursor_insert
            BEFORE INSERT ON copilot_mcp_round_trip_cursor
            BEGIN
                SELECT RAISE(ABORT, 'fail-cursor');
            END;
        `);
        await assert.rejects(() => analytics.sync(), /fail-cursor/u);
        assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM copilot_mcp_round_trip_events').get().count), 0);
        assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM copilot_mcp_round_trip_cursor').get().count), 0);
        db.exec('DROP TRIGGER fail_round_trip_cursor_insert');
        const retry = await analytics.sync();
        assert.equal(retry.indexedEvents, 1);
        assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM copilot_mcp_round_trip_events').get().count), 1);
        assert.equal(retry.cursor?.byteOffset, 100);
    });

    it('applies retention by timestamp across logical generations rather than deleting by physical identity', async () => {
        const db = createDb();
        const nowMs = 10_000_000;
        let phase = 'a';
        const readSlice = async ({ offset = 0 } = {}) => {
            if (phase === 'a') {
                return offset === 0
                    ? auditSlice({
                          offset: 0,
                          nextOffset: 100,
                          fileBytes: 100,
                          lineage: 'old-generation',
                          entries: [
                              entry(0, {
                                  ts: iso(1_000_000),
                                  event: 'tool_call_started',
                                  tool: 'old_tool',
                                  callId: 'a',
                              }),
                          ],
                      })
                    : emptySlice(offset, 'dev:ino-a', 100, 'old-generation');
            }
            if (offset > 0) {
                return auditSlice({
                    offset,
                    nextOffset: 120,
                    fileBytes: 120,
                    physicalFileIdentity: 'dev:ino-b',
                    lineage: 'new-generation',
                });
            }
            return auditSlice({
                offset: 0,
                nextOffset: 120,
                fileBytes: 120,
                physicalFileIdentity: 'dev:ino-b',
                lineage: 'new-generation',
                entries: [entry(0, { ts: iso(9_900_000), event: 'tool_call_started', tool: 'new_tool', callId: 'b' })],
            });
        };
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(db),
            readSlice,
            now: () => nowMs,
            retentionMs: 3_600_000,
            maxChunks: 3,
        });
        await analytics.sync();
        phase = 'b';
        await analytics.sync();
        const rows = db.prepare('SELECT tool,source_generation FROM copilot_mcp_round_trip_events ORDER BY tool').all();
        assert.deepEqual(rows, [{ tool: 'new_tool', source_generation: 'mcp-audit:v11:g2' }]);
    });
});
