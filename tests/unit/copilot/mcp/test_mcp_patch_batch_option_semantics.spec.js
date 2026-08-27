// @ts-check

import { resolveRepoPatchPostValidationPolicy } from '#copilot/mcp/public/workspace/repository/write';
import { normalizePatchBatchWireInput } from '#copilot/testing/mcp/tools/repo-write';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

const LIMITS = Object.freeze({ maxOperations: 128, maxTargets: 64, maxInputBytes: 3 * 1024 * 1024 });

describe('MCP patch-batch option semantics', () => {
    it('runs post-validation only when there is mutated state worth validating', () => {
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(0, 0, false, false), { action: 'none', reason: null });
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(1, 2, true, false), { action: 'run', reason: null });
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(1, 1, false, false), {
            action: 'skip',
            reason: 'partial-patch-apply',
        });
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(1, 1, false, true), { action: 'run', reason: null });
        assert.deepEqual(resolveRepoPatchPostValidationPolicy(1, 0, false, true), {
            action: 'skip',
            reason: 'patch-not-applied',
        });
    });

    it('keeps durability target-owned and rejects a top-level override', () => {
        const normalized = normalizePatchBatchWireInput(
            {
                targets: [
                    {
                        path: 'a.txt',
                        durability: 'file',
                        operations: [
                            { old_string: 'a', new_string: 'A' },
                            { old_string: 'b', new_string: 'B' },
                        ],
                    },
                ],
            },
            LIMITS,
        );
        assert.equal(normalized.ok, true);
        if (normalized.ok) {
            assert.equal(normalized.targets[0]?.durability, 'file');
            assert.equal(
                normalized.targets[0]?.entries.every((entry) => !('durability' in entry.operation)),
                true,
            );
        }

        const rejected = normalizePatchBatchWireInput(
            {
                targets: [{ path: 'a.txt', operations: [{ old_string: 'a', new_string: 'A' }] }],
                durability: 'none',
            },
            LIMITS,
        );
        assert.equal(rejected.ok, false);
        if (!rejected.ok) assert.equal(rejected.code, 'ERR_PATCH_BATCH_INPUT_SHAPE');
    });
});
