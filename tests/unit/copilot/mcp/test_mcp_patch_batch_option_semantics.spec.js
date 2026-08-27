// @ts-check

import { resolveRepoPatchPostValidationPolicy } from '#copilot/mcp/public/workspace/repository/write';
import { normalizePatchBatchOperationsForExecution } from '#copilot/testing/mcp/tools/repo-write';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('MCP patch-batch option semantics', () => {
    it('runs post-validation only when there is mutated state worth validating', () => {
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(0, 0, false, false), {
            action: 'none',
            reason: null,
        });
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(1, 2, true, false), {
            action: 'run',
            reason: null,
        });
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(1, 1, false, false), {
            action: 'skip',
            reason: 'partial-patch-apply',
        });
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(1, 1, false, true), {
            action: 'run',
            reason: null,
        });
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(1, 0, false, true), {
            action: 'skip',
            reason: 'patch-not-applied',
        });
    });

    it('propagates one top-level durability policy uniformly without mutating caller operations', () => {
        const original = [
            { path: 'a.txt', old_string: 'a', new_string: 'A' },
            { path: 'a.txt', old_string: 'b', new_string: 'B' },
            { path: 'b.txt', old_string: 'c', new_string: 'C' },
        ];
        const normalized = normalizePatchBatchOperationsForExecution(original, 'none');

        assert.deepEqual(
            normalized.map((operation) => operation.durability),
            ['none', 'none', 'none'],
        );
        assert.equal('durability' in original[0], false);
        assert.equal('durability' in original[1], false);
        assert.equal('durability' in original[2], false);
        assert.notEqual(normalized[0], original[0]);
    });

    it('overrides any non-wire per-operation durability with the explicit top-level policy', () => {
        const normalized = normalizePatchBatchOperationsForExecution(
            [
                { path: 'a.txt', old_string: 'a', new_string: 'A', durability: 'file' },
                { path: 'a.txt', old_string: 'b', new_string: 'B', durability: 'file-and-directory' },
            ],
            'none',
        );
        assert.deepEqual(
            normalized.map((operation) => operation.durability),
            ['none', 'none'],
        );
    });
});
