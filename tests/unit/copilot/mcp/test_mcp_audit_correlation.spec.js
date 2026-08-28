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

    it('derives exact patch-batch target identities from canonical V3 targets without persisting raw paths', () => {
        const targets = readMcpToolTargetCorrelation('repo_apply_patch_batch', {
            targets: [
                { path: 'src/copilot/a.js', operations: [{ old_string: 'a', new_string: 'aa' }] },
                { path: './src/copilot/b.js', operations: [{ old_string: 'b', new_string: 'bb' }] },
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
                targets: [
                    { path: pathA, operations: [{ old_string: 'a', new_string: 'aa' }] },
                    { path: pathB, operations: [{ old_string: 'b', new_string: 'bb' }] },
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

    it('serializes only bounded result-outcome/execution/payload facts for completion audit metadata', () => {
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
                executionPolicyClass: 'direct-apply',
                executionFailurePolicyClass: 'fail-fast',
                executionConcurrencyClass: 'parallel-bounded',
                batchSize: 5,
                batchCapacity: 64,
                resultBudgetBytes: 1_000_000,
                truncatedOperations: 1,
                continuationAvailable: true,
                continuationAvailableOperations: 2,
                continuationTransportRequired: true,
                continuationTransportRequiredOperations: 1,
                continuationRecommended: true,
                continuationRecommendedOperations: 2,
            },
        );
        assert.equal(metadata['resultState'], 'success');
        assert.equal(metadata['resultClass'], 'success');
        assert.equal(metadata['resultCode'], undefined);
        assert.equal(metadata['logicalOperations'], 5);
        assert.equal(metadata['failedOperations'], 1);
        assert.equal(metadata['skippedOperations'], 2);
        assert.equal(metadata['executionPolicyClass'], 'direct-apply');
        assert.equal(metadata['executionFailurePolicyClass'], 'fail-fast');
        assert.equal(metadata['executionConcurrencyClass'], 'parallel-bounded');
        assert.equal(metadata['batchSize'], 5);
        assert.equal(metadata['batchCapacity'], 64);
        assert.equal(metadata['resultBytes'], 10_000);
        assert.equal(metadata['duplicateTextBytes'], Buffer.byteLength(sensitive, 'utf8'));
        assert.equal(metadata['continuationAvailable'], true);
        assert.equal(metadata['continuationAvailableOperations'], 2);
        assert.equal(metadata['continuationTransportRequired'], true);
        assert.equal(metadata['continuationTransportRequiredOperations'], 1);
        assert.equal(metadata['continuationRecommended'], true);
        assert.equal(metadata['continuationRecommendedOperations'], 2);
        assert.equal(metadata['continuationRequired'], undefined);
        assert.equal(JSON.stringify(metadata).includes(sensitive), false);
    });

    it('persists only recovery-recipe disposition counts and never invocation arguments', () => {
        const sensitivePath = 'src/copilot/private-target.js';
        const sensitiveOld = 'sensitive old source';
        const sensitiveNew = 'sensitive new source';
        const metadata = buildMcpToolResultAuditMetadataForTests(
            'repo_apply_patch',
            {
                isError: true,
                content: [{ type: 'text', text: 'patch failed' }],
                structuredContent: {
                    success: false,
                    code: 'ERR_PATCH_NOT_FOUND',
                    error: 'patch failed',
                    details: {
                        recoveryRecipe: {
                            version: 1,
                            disposition: 'retry-safe',
                            scope: 'target',
                            reasonCode: 'patch-exact-anchor-same-snapshot',
                            retryInvocation: {
                                tool: 'repo_apply_patch',
                                args: { path: sensitivePath, old_string: sensitiveOld, new_string: sensitiveNew },
                            },
                        },
                    },
                },
            },
            undefined,
            undefined,
        );
        assert.equal(metadata['recoveryRecipeCount'], 1);
        assert.equal(metadata['retrySafeRecoveryRecipeCount'], 1);
        assert.equal(metadata['suggestedRecoveryRecipeCount'], 0);
        assert.equal(metadata['manualRecoveryRecipeCount'], 0);
        assert.equal(metadata['noRetryRecoveryRecipeCount'], 0);
        const serialized = JSON.stringify(metadata);
        assert.equal(serialized.includes(sensitivePath), false);
        assert.equal(serialized.includes(sensitiveOld), false);
        assert.equal(serialized.includes(sensitiveNew), false);
        assert.equal(serialized.includes('repo_apply_patch'), false);
    });

    it('persists only exact self-repair counters and excludes anchors, hashes, paths and reason text', () => {
        const sensitivePath = 'src/copilot/private-self-repair-target.js';
        const sensitiveAnchor = 'const secret = "anchor";\r\n';
        const sensitiveHash = 'a'.repeat(64);
        const sensitiveReason = 'private-recovery-reason-text';
        const single = buildMcpToolResultAuditMetadataForTests(
            'repo_apply_patch',
            {
                content: [{ type: 'text', text: 'patch repaired' }],
                structuredContent: {
                    success: true,
                    path: sensitivePath,
                    exactSelfRepair: {
                        attempted: true,
                        succeeded: true,
                        failedClosed: false,
                        attemptCount: 1,
                        reasonCode: sensitiveReason,
                        path: sensitivePath,
                        old_string: sensitiveAnchor,
                        expectedHash: sensitiveHash,
                    },
                },
            },
            undefined,
            undefined,
        );
        assert.equal(single['exactSelfRepairAttemptedCount'], 1);
        assert.equal(single['exactSelfRepairSucceededCount'], 1);
        assert.equal(single['exactSelfRepairFailedClosedCount'], 0);

        const batch = buildMcpToolResultAuditMetadataForTests(
            'repo_apply_patch_batch',
            {
                content: [{ type: 'text', text: 'batch repaired' }],
                structuredContent: {
                    success: true,
                    exactSelfRepair: {
                        attemptedCount: 4,
                        succeededCount: 3,
                        failedClosedCount: 1,
                        anchor: sensitiveAnchor,
                        expectedHash: sensitiveHash,
                    },
                },
            },
            undefined,
            undefined,
        );
        assert.equal(batch['exactSelfRepairAttemptedCount'], 4);
        assert.equal(batch['exactSelfRepairSucceededCount'], 3);
        assert.equal(batch['exactSelfRepairFailedClosedCount'], 1);

        const serialized = JSON.stringify({ single, batch });
        assert.equal(serialized.includes(sensitivePath), false);
        assert.equal(serialized.includes(sensitiveAnchor), false);
        assert.equal(serialized.includes(sensitiveHash), false);
        assert.equal(serialized.includes(sensitiveReason), false);
    });

    it('classifies errorResult-style and okResult-style logical failures without serializing failure payloads', () => {
        const sensitive = 'sensitive failure text /workspace/private/path';
        const toolError = buildMcpToolResultAuditMetadataForTests(
            'repo_read_file',
            {
                isError: true,
                content: [{ type: 'text', text: sensitive }],
                structuredContent: {
                    success: false,
                    code: 'ERR_BATCH_CONFLICTING_MODE',
                    error: sensitive,
                    details: { path: sensitive },
                },
            },
            { strategy: 'stringify', bytes: 4_000 },
            undefined,
        );
        assert.equal(toolError['resultState'], 'tool-error');
        assert.equal(toolError['resultClass'], 'option-config');
        assert.equal(toolError['resultCode'], 'ERR_BATCH_CONFLICTING_MODE');

        const domainFailure = buildMcpToolResultAuditMetadataForTests(
            'terminal_exec',
            {
                content: [{ type: 'text', text: sensitive }],
                structuredContent: {
                    success: false,
                    code: 'ERR_TERMINAL_EXEC_SHAPE',
                    hint: sensitive,
                },
            },
            { strategy: 'stringify', bytes: 2_000 },
            undefined,
        );
        assert.equal(domainFailure['resultState'], 'domain-failure');
        assert.equal(domainFailure['resultClass'], 'option-config');
        assert.equal(domainFailure['resultCode'], 'ERR_TERMINAL_EXEC_SHAPE');
        assert.equal(JSON.stringify(toolError).includes(sensitive), false);
        assert.equal(JSON.stringify(domainFailure).includes(sensitive), false);
    });

    it('classifies only explicitly catalogued result codes and rejects unsafe code labels fail-closed', () => {
        const precondition = buildMcpToolResultAuditMetadataForTests(
            'repo_apply_patch',
            {
                isError: true,
                content: [{ type: 'text', text: 'hash mismatch' }],
                structuredContent: { success: false, code: 'EEXPECTEDHASH', error: 'hash mismatch' },
            },
            undefined,
            undefined,
        );
        assert.equal(precondition['resultState'], 'tool-error');
        assert.equal(precondition['resultClass'], 'precondition');
        assert.equal(precondition['resultCode'], 'EEXPECTEDHASH');

        const unknown = buildMcpToolResultAuditMetadataForTests(
            'repo_apply_patch',
            {
                isError: true,
                content: [{ type: 'text', text: 'new failure' }],
                structuredContent: { success: false, code: 'ERR_NEW_UNCLASSIFIED_FAILURE', error: 'new failure' },
            },
            undefined,
            undefined,
        );
        assert.equal(unknown['resultClass'], 'domain-or-unknown');
        assert.equal(unknown['resultCode'], 'ERR_NEW_UNCLASSIFIED_FAILURE');

        const unsafeCode = '../../private/path:do-not-index';
        const malformed = buildMcpToolResultAuditMetadataForTests(
            'terminal_exec',
            {
                content: [{ type: 'text', text: 'failure' }],
                structuredContent: { success: false, code: unsafeCode },
            },
            undefined,
            undefined,
        );
        assert.equal(malformed['resultState'], 'domain-failure');
        assert.equal(malformed['resultClass'], 'uncoded-failure');
        assert.equal(malformed['resultCode'], undefined);
        assert.equal(JSON.stringify(malformed).includes(unsafeCode), false);
    });

    it('does not misclassify compact tree summaries as duplicated structured payload', () => {
        const structured = { success: true, path: 'src/copilot/mcp', entries: [{ name: 'README.md' }] };
        const legacy = JSON.stringify(structured, null, 2);
        const legacyMetadata = buildMcpToolResultAuditMetadataForTests(
            'repo_tree',
            { content: [{ type: 'text', text: legacy }], structuredContent: structured },
            { strategy: 'stringify', bytes: 4_000 },
            undefined,
        );
        assert.equal(legacyMetadata['duplicateTextBytes'], Buffer.byteLength(legacy, 'utf8'));

        const compact =
            'Tree src/copilot/mcp: entries=1, scanned=1, blocked=0, truncated=false; full tree entries are in structuredContent.entries.';
        const compactMetadata = buildMcpToolResultAuditMetadataForTests(
            'repo_tree',
            { content: [{ type: 'text', text: compact }], structuredContent: structured },
            { strategy: 'hint', bytes: 2_000 },
            undefined,
        );
        assert.equal(compactMetadata['duplicateTextBytes'], undefined);
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
