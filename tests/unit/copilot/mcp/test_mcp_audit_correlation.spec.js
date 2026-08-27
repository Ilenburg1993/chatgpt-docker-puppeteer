// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildMcpToolCallAuditCorrelation,
    buildMcpToolResultAuditMetadataForTests,
    readMcpToolTargetCorrelation,
    readMcpTraceCorrelation,
    scopeMcpToolAuditCapability,
} from '#copilot/testing/mcp/registry';

const VALID_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const VALID_PARENT_ID = '00f067aa0ba902b7';
const VALID_TRACEPARENT = `00-${VALID_TRACE_ID}-${VALID_PARENT_ID}-01`;

describe('MCP audit correlation boundary', () => {
    it('hashes a valid W3C v00 trace id without persisting raw trace context', () => {
        const first = readMcpTraceCorrelation({
            traceparent: VALID_TRACEPARENT,
            tracestate: 'vendor=secret',
            baggage: 'private=value',
        });
        const second = readMcpTraceCorrelation({ traceparent: VALID_TRACEPARENT });
        assert.equal(first.state, 'valid');
        assert.match(first.traceKey ?? '', /^[0-9a-f]{32}$/u);
        assert.equal(first.traceKey, second.traceKey);
        assert.notEqual(first.traceKey, VALID_TRACE_ID);
        const serialized = JSON.stringify(first);
        assert.equal(serialized.includes(VALID_TRACE_ID), false);
        assert.equal(serialized.includes(VALID_PARENT_ID), false);
        assert.equal(serialized.includes('vendor=secret'), false);
        assert.equal(serialized.includes('private=value'), false);
    });

    it('keeps absent, invalid and unsupported trace context explicit instead of inventing lineage', () => {
        assert.deepEqual(readMcpTraceCorrelation(undefined), { state: 'absent', traceKey: null });
        assert.deepEqual(readMcpTraceCorrelation({ traceparent: 'not-a-traceparent' }), {
            state: 'invalid',
            traceKey: null,
        });
        assert.deepEqual(readMcpTraceCorrelation({ traceparent: `00-${'0'.repeat(32)}-${VALID_PARENT_ID}-01` }), {
            state: 'invalid',
            traceKey: null,
        });
        assert.deepEqual(readMcpTraceCorrelation({ traceparent: `01-${VALID_TRACE_ID}-${VALID_PARENT_ID}-01-extra` }), {
            state: 'unsupported-version',
            traceKey: null,
        });
    });

    it('fingerprints only exact target identities and does not promote search scopes to exact targets', () => {
        const single = readMcpToolTargetCorrelation('repo_read_file', { path: 'src/copilot/mcp/tools/meta.js' });
        const same = readMcpToolTargetCorrelation('repo_read_file', { path: './src/copilot/mcp/tools/meta.js' });
        const searchScope = readMcpToolTargetCorrelation('repo_search_text', {
            pattern: 'workflow',
            path: 'src/copilot/mcp',
        });
        const batchSearchScope = readMcpToolTargetCorrelation('repo_search_text', {
            batch: [
                { pattern: 'workflow', path: 'src/copilot/mcp' },
                { pattern: 'roundTrip', path: 'src/copilot/mcp/diagnostics' },
            ],
        });
        assert.equal(single.precision, 'exact-single');
        assert.equal(single.keys.length, 1);
        assert.deepEqual(single, same);
        assert.deepEqual(searchScope, { precision: 'none', keys: [] });
        assert.deepEqual(batchSearchScope, { precision: 'none', keys: [] });
        assert.equal(JSON.stringify(single).includes('meta.js'), false);
    });

    it('derives a bounded exact target set for heterogeneous bulk inspect while ignoring broad search operations', () => {
        const targets = readMcpToolTargetCorrelation('repo_bulk_inspect', {
            operations: [
                { op: 'read', args: { path: 'src/copilot/a.js' } },
                { op: 'search', args: { pattern: 'x', path: 'src/copilot' } },
                { op: 'stat', args: { path: 'src/copilot/b.js' } },
            ],
        });
        assert.equal(targets.precision, 'exact-set');
        assert.equal(targets.keys.length, 2);
        const serialized = JSON.stringify(targets);
        assert.equal(serialized.includes('a.js'), false);
        assert.equal(serialized.includes('b.js'), false);
        assert.equal(serialized.includes('src/copilot'), false);
    });

    it('narrows partial-batch child events to a proven invocation target subset without persisting raw paths', async () => {
        const pathA = 'src/copilot/a.js';
        const pathB = 'src/copilot/b.js';
        const correlation = buildMcpToolCallAuditCorrelation({
            callId: 'batch-call',
            toolName: 'repo_apply_patch_batch',
            args: {
                operations: [
                    { path: pathA, old_string: 'a', new_string: 'aa' },
                    { path: pathB, old_string: 'b', new_string: 'bb' },
                ],
            },
        });
        const targetA = readMcpToolTargetCorrelation('repo_apply_patch', { path: pathA }).keys[0];
        /** @type {Record<string, unknown>[]} */
        const captured = [];
        const scoped = scopeMcpToolAuditCapability(
            /** @type {any} */ ({ append: async (event) => captured.push(event) }),
            correlation,
        );
        assert.ok(scoped);
        await scoped.append({
            event: 'repo_apply_patch_batch_partial_failure',
            correlationTargetPaths: [pathA],
        });
        assert.equal(captured[0]?.['targetPrecision'], 'exact-single');
        assert.deepEqual(captured[0]?.['targetKeys'], [targetA]);
        const serialized = JSON.stringify(captured[0]);
        assert.equal(serialized.includes(pathA), false);
        assert.equal(serialized.includes(pathB), false);
        assert.equal(serialized.includes('correlationTargetPaths'), false);

        await scoped.append({
            event: 'repo_apply_patch_batch_partial_failure',
            correlationTargetPaths: ['src/outside-this-invocation.js'],
        });
        assert.equal(captured[1]?.['targetPrecision'], 'none');
        assert.equal('targetKeys' in /** @type {Record<string, unknown>} */ (captured[1]), false);
    });

    it('serializes only bounded numeric execution/payload facts for completion audit metadata', () => {
        const sensitive = 'source-text-that-must-not-enter-audit';
        const metadata = buildMcpToolResultAuditMetadataForTests(
            'repo_read_file',
            {
                content: [{ type: 'text', text: sensitive }],
                structuredContent: { content: sensitive },
            },
            { strategy: 'hint', bytes: 10_000, limitBytes: 1_000_000 },
            {
                logicalOperations: 5,
                failedOperations: 1,
                skippedOperations: 2,
                mode: 'read-batch:best-effort',
                batchSize: 5,
                batchCapacity: 64,
                resultBudgetBytes: 1_000_000,
                truncatedOperations: 1,
                continuationRequired: true,
            },
        );
        assert.equal(metadata['logicalOperations'], 5);
        assert.equal(metadata['failedOperations'], 1);
        assert.equal(metadata['skippedOperations'], 2);
        assert.equal(metadata['batchSize'], 5);
        assert.equal(metadata['batchCapacity'], 64);
        assert.equal(metadata['resultBytes'], 10_000);
        assert.equal(metadata['duplicateTextBytes'], Buffer.byteLength(sensitive, 'utf8'));
        assert.equal(metadata['continuationRequired'], true);
        assert.equal(JSON.stringify(metadata).includes(sensitive), false);
    });

    it('builds per-call correlation from bounded metadata only', () => {
        const correlation = buildMcpToolCallAuditCorrelation({
            callId: 'call-123',
            toolName: 'repo_apply_patch',
            args: {
                path: 'src/copilot/target.js',
                old_string: 'sensitive source anchor',
                new_string: 'sensitive replacement',
            },
            requestMeta: {
                traceparent: VALID_TRACEPARENT,
                baggage: 'never=persist',
                arbitrary: 'also-not-persisted',
            },
        });
        assert.equal(correlation['callId'], 'call-123');
        assert.equal(correlation['traceContextState'], 'valid');
        assert.equal(correlation['targetPrecision'], 'exact-single');
        const serialized = JSON.stringify(correlation);
        for (const forbidden of [
            'target.js',
            'sensitive source anchor',
            'sensitive replacement',
            'never=persist',
            'also-not-persisted',
            VALID_TRACE_ID,
        ]) {
            assert.equal(serialized.includes(forbidden), false, forbidden);
        }
    });
});
