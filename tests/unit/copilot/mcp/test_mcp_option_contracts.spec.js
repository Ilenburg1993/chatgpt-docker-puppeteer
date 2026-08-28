// @ts-check

import {
    buildMcpWireToolCatalog,
    projectMcpToolOptionPolicy,
    readMcpToolOptionContractCoverage,
} from '#copilot/mcp/public/tools/catalog';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

function policy(tool, args) {
    const projected = projectMcpToolOptionPolicy(tool, args);
    assert.ok(projected, `${tool} should be covered by the Option Contract SSOT`);
    return projected;
}

describe('MCP Option Contract SSOT', () => {
    it('covers the first ten high-friction tools and stays in parity with the canonical wire catalog', () => {
        const coverage = readMcpToolOptionContractCoverage();
        assert.equal(coverage.version, '1.8.0');
        assert.equal(coverage.coveredToolCount, 10);
        assert.equal(coverage.optionCount, 101);
        assert.deepEqual(coverage.categoryCounts, {
            semantic: 58,
            tuning: 18,
            result: 10,
            safety: 13,
            recovery: 2,
        });
        assert.deepEqual(coverage.toolNames, [
            'repo_apply_file_batch',
            'repo_apply_patch',
            'repo_apply_patch_batch',
            'repo_bulk_inspect',
            'repo_read_file',
            'repo_read_file_chunks',
            'repo_search_text',
            'terminal_exec',
            'terminal_session_control',
            'terminal_session_read',
        ]);
        assert.equal(buildMcpWireToolCatalog().length, 84);
    });

    it('projects only bounded aggregate facts and never input values', () => {
        const projected = policy('terminal_exec', {
            command: 'TOP_SECRET_COMMAND --token=do-not-persist',
            cwd: '/secret/private/path',
            env: { VERY_SECRET: 'credential-value' },
        });
        const serialized = JSON.stringify(projected);
        assert.doesNotMatch(
            serialized,
            /TOP_SECRET_COMMAND|do-not-persist|secret\/private|VERY_SECRET|credential-value/u,
        );
        assert.equal(projected.optionPolicyCoverage, 'complete');
        assert.equal(projected.optionMode, 'single');
        assert.equal(projected.optionIgnoredCount, 0);
        assert.equal(projected.optionRejectedCount, 0);
    });

    it('rejects terminal options that are inactive in the selected single/batch mode', () => {
        const rejectedBatchField = policy('terminal_exec', {
            batch: [{ command: 'printf ok' }],
            cwd: '/must-not-be-silently-ignored',
        });
        assert.equal(rejectedBatchField.optionMode, 'batch');
        assert.equal(rejectedBatchField.optionRequestedCount, 2);
        assert.equal(rejectedBatchField.optionEffectiveRequestedCount, 1);
        assert.equal(rejectedBatchField.optionIgnoredCount, 0);
        assert.equal(rejectedBatchField.optionRejectedCount, 1);
        assert.equal(rejectedBatchField.optionConflictCount, 1);

        const rejected = policy('terminal_exec', {
            batch: [{ command: 'printf ok' }],
            command: 'must-not-coexist',
        });
        assert.equal(rejected.optionIgnoredCount, 0);
        assert.equal(rejected.optionRejectedCount, 1);
        assert.equal(rejected.optionConflictCount, 1);

        const singleWithBatchKnob = policy('terminal_exec', {
            command: 'printf ok',
            batchConcurrency: 1,
        });
        assert.equal(singleWithBatchKnob.optionMode, 'single');
        assert.equal(singleWithBatchKnob.optionIgnoredCount, 0);
        assert.equal(singleWithBatchKnob.optionRejectedCount, 1);
        assert.equal(singleWithBatchKnob.optionConflictCount, 1);
    });

    it('records search alias normalization and divergent alias precedence without exposing values', () => {
        const aliasOnly = policy('repo_search_text', { query: 'alpha-secret' });
        assert.equal(aliasOnly.optionNormalizedCount, 1);
        assert.equal(aliasOnly.optionIgnoredCount, 0);
        assert.equal(aliasOnly.optionConflictCount, 0);

        const equal = policy('repo_search_text', { pattern: 'same-secret', query: 'same-secret' });
        assert.equal(equal.optionNormalizedCount, 1);
        assert.equal(equal.optionIgnoredCount, 0);
        assert.equal(equal.optionConflictCount, 0);

        const divergent = policy('repo_search_text', { pattern: 'primary-secret', query: 'alias-secret' });
        assert.equal(divergent.optionNormalizedCount, 0);
        assert.equal(divergent.optionIgnoredCount, 0);
        assert.equal(divergent.optionRejectedCount, 1);
        assert.equal(divergent.optionConflictCount, 1);
        assert.doesNotMatch(JSON.stringify(divergent), /primary-secret|alias-secret/u);
    });

    it('models patch-batch dry-run/apply precedence and result-mode coercion explicitly', () => {
        const apply = policy('repo_apply_patch_batch', {
            targets: [{ path: 'a', operations: [{ old_string: 'x', new_string: 'y' }] }],
            confirmBatch: true,
        });
        assert.equal(apply.optionMode, 'apply');
        assert.equal(apply.optionIgnoredCount, 0);

        const dryRunWins = policy('repo_apply_patch_batch', {
            targets: [{ path: 'a', operations: [{ old_string: 'x', new_string: 'y' }] }],
            dryRun: true,
            confirmBatch: true,
            failureMode: 'fail-fast',
        });
        assert.equal(dryRunWins.optionMode, 'dry-run');
        assert.equal(dryRunWins.optionIgnoredCount, 0);
        assert.equal(dryRunWins.optionRejectedCount, 2);
        assert.equal(dryRunWins.optionConflictCount, 2);

        const coerced = policy('repo_apply_patch_batch', {
            targets: [{ path: 'a', operations: [{ old_string: 'x', new_string: 'y', includeDiffPreview: true }] }],
            resultMode: 'compact',
        });
        assert.equal(coerced.optionCoercedCount, 1);
        assert.equal(coerced.optionConflictCount, 1);
    });

    it('rejects patch/file-batch options that are inactive in dry-run mode', () => {
        const patchSingle = policy('repo_apply_patch', {
            path: 'a',
            old_string: 'x',
            new_string: 'y',
            dryRun: true,
            durability: 'none',
        });
        assert.equal(patchSingle.optionMode, 'dry-run');
        assert.equal(patchSingle.optionIgnoredCount, 0);
        assert.equal(patchSingle.optionRejectedCount, 1);

        const fileBatch = policy('repo_apply_file_batch', {
            operations: [{ type: 'create_file', path: 'a' }],
            dryRun: true,
            confirmBatch: true,
            includePreflightDetails: true,
        });
        assert.equal(fileBatch.optionMode, 'dry-run');
        assert.equal(fileBatch.optionIgnoredCount, 0);
        assert.equal(fileBatch.optionRejectedCount, 2);
        assert.equal(fileBatch.optionConflictCount, 2);
    });

    it('rejects terminal session-control fields outside their selected action', () => {
        const projected = policy('terminal_session_control', {
            action: 'forget',
            sessionId: 'opaque-session-id',
            data: 'must-not-be-ignored',
        });
        assert.equal(projected.optionMode, 'forget');
        assert.equal(projected.optionIgnoredCount, 0);
        assert.equal(projected.optionRejectedCount, 1);
        assert.equal(projected.optionConflictCount, 1);
        assert.doesNotMatch(JSON.stringify(projected), /opaque-session-id|must-not-be-ignored/u);
    });

    it('rejects terminal session-read fields outside their selected action', () => {
        const listWithReadFields = policy('terminal_session_read', {
            action: 'list',
            sessionId: 'opaque-session-id',
            afterSeq: 10,
            maxBytes: 4096,
            limit: 5,
        });
        assert.equal(listWithReadFields.optionMode, 'list');
        assert.equal(listWithReadFields.optionIgnoredCount, 0);
        assert.equal(listWithReadFields.optionRejectedCount, 3);
        assert.equal(listWithReadFields.optionConflictCount, 3);
        assert.doesNotMatch(JSON.stringify(listWithReadFields), /opaque-session-id/u);
    });

    it('treats waitMs without waitFor as a rejected session-read combination', () => {
        const projected = policy('terminal_session_read', {
            action: 'read',
            sessionId: 'opaque-session-id',
            waitMs: 500,
        });
        assert.equal(projected.optionMode, 'read');
        assert.equal(projected.optionRejectedCount, 1);
        assert.equal(projected.optionConflictCount, 1);
        assert.doesNotMatch(JSON.stringify(projected), /opaque-session-id/u);
    });
});
