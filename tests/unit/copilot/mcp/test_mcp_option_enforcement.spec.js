// @ts-check

import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

function tool(name) {
    const definition = getCanonicalMcpTools().find((candidate) => candidate.name === name);
    assert.ok(definition, `missing tool ${name}`);
    return definition;
}

describe('MCP option enforcement before side effects', () => {
    it('rejects terminal_exec single fields in batch mode before acquiring terminal runtime', async () => {
        const result = await tool('terminal_exec').handler({
            batch: [{ command: 'printf ok' }],
            cwd: '/must-not-be-used',
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['code'], 'ERR_TERMINAL_EXEC_SHAPE');
        assert.deepEqual(result.structuredContent?.['details']?.['conflictingFields'], ['cwd']);
    });

    it('rejects terminal_exec batch-only tuning in single mode before execution', async () => {
        const result = await tool('terminal_exec').handler({ command: 'printf ok', batchConcurrency: 2 });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['code'], 'ERR_TERMINAL_EXEC_SHAPE');
        assert.deepEqual(result.structuredContent?.['details']?.['conflictingFields'], ['batchConcurrency']);
    });

    it('rejects terminal session fields that do not apply to the selected action', async () => {
        const result = await tool('terminal_session_control').handler({
            action: 'forget',
            sessionId: 'opaque-session-id',
            data: 'must-not-be-written',
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['code'], 'ERR_TERMINAL_SESSION_ACTION_OPTIONS');
        assert.deepEqual(result.structuredContent?.['details']?.['invalidOptions'], ['data']);
    });

    it('rejects divergent repo_search_text aliases before acquiring workspace authority', async () => {
        const result = await tool('repo_search_text').handler({ pattern: 'primary', query: 'different' });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['code'], 'ERR_SEARCH_ALIAS_CONFLICT');
    });

    it('rejects terminal session-read fields outside the selected action before runtime acquisition', async () => {
        const result = await tool('terminal_session_read').handler({
            action: 'list',
            sessionId: 'opaque-session-id',
            afterSeq: 5,
            limit: 10,
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['code'], 'ERR_TERMINAL_SESSION_READ_ACTION_OPTIONS');
        assert.deepEqual(result.structuredContent?.['details']?.['invalidOptions'], ['sessionId', 'afterSeq']);
    });

    it('rejects replace_all plus occurrence_index even when expected_occurrences is also present', async () => {
        const result = await tool('repo_apply_patch').handler({
            path: 'never-read.txt',
            old_string: 'x',
            new_string: 'y',
            replace_all: true,
            occurrence_index: 1,
            expected_occurrences: 2,
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['code'], 'ERR_PATCH_CONFLICTING_MODE');
    });

    it('rejects postValidateOnPartial in apply mode when postValidate is absent before repository runtime', async () => {
        const result = await tool('repo_apply_patch_batch').handler({
            targets: [{ path: 'never-read.txt', operations: [{ old_string: 'x', new_string: 'y' }] }],
            dryRun: false,
            confirmBatch: true,
            postValidateOnPartial: true,
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['code'], 'ERR_PATCH_BATCH_OPTION_INACTIVE');
        const details = /** @type {Record<string, unknown>} */ (result.structuredContent?.['details']);
        assert.deepEqual(details['invalidOptions'], ['postValidateOnPartial']);
    });

    it('rejects patch-batch apply-only options in dry-run before acquiring repository runtime', async () => {
        const result = await tool('repo_apply_patch_batch').handler({
            targets: [{ path: 'never-read.txt', operations: [{ old_string: 'x', new_string: 'y' }] }],
            dryRun: true,
            failureMode: 'fail-fast',
            includePreflightDetails: true,
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['code'], 'ERR_PATCH_BATCH_OPTION_INACTIVE');
        const details = /** @type {Record<string, unknown>} */ (result.structuredContent?.['details']);
        assert.deepEqual(details['invalidOptions'], ['failureMode', 'includePreflightDetails']);
    });

    it('rejects durability on a single patch dry-run before acquiring repository runtime', async () => {
        const result = await tool('repo_apply_patch').handler({
            path: 'never-read.txt',
            old_string: 'x',
            new_string: 'y',
            dryRun: true,
            durability: 'none',
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['code'], 'ERR_PATCH_OPTION_INACTIVE');
        const details = /** @type {Record<string, unknown>} */ (result.structuredContent?.['details']);
        assert.deepEqual(details['invalidOptions'], ['durability']);
    });

    it('rejects file-batch apply-only presentation options in dry-run before repository runtime', async () => {
        const result = await tool('repo_apply_file_batch').handler({
            operations: [{ type: 'create_file', path: 'never-created.txt' }],
            dryRun: true,
            confirmBatch: true,
            includePreflightDetails: true,
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['code'], 'ERR_FILE_BATCH_OPTION_INACTIVE');
        const details = /** @type {Record<string, unknown>} */ (result.structuredContent?.['details']);
        assert.deepEqual(details['invalidOptions'], ['confirmBatch', 'includePreflightDetails']);
    });
});
