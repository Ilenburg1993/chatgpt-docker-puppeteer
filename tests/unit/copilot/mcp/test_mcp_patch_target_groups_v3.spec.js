// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { normalizePatchBatchWireInput } from '#copilot/testing/mcp/tools/repo-write';

const LIMITS = Object.freeze({ maxOperations: 128, maxTargets: 64, maxInputBytes: 3 * 1024 * 1024 });
const HASH_A = 'a'.repeat(64);

function normalize(input) {
    return normalizePatchBatchWireInput(input, LIMITS);
}

describe('Patch Target Groups V3 wire canonicalizer', () => {
    it('accepts target-native V3 and assigns deterministic target-major operation indices', () => {
        const result = normalize({
            targets: [
                {
                    path: 'src/copilot/a.js',
                    expectedHash: HASH_A,
                    durability: 'file',
                    operations: [
                        { old_string: 'alpha', new_string: 'ALPHA' },
                        { old_string: 'beta', new_string: 'BETA', includeDiffPreview: true },
                    ],
                },
                { path: 'src/copilot/b.js', operations: [{ old_string: 'gamma', new_string: 'GAMMA' }] },
            ],
            dryRun: true,
        });
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.operationCount, 3);
        assert.equal(result.targetCount, 2);
        assert.deepEqual(
            result.targets.map((target) => ({
                path: target.path,
                expectedHashMode: target.expectedHashMode,
                expectedHash: target.expectedHash,
                durability: target.durability,
                indices: target.entries.map((entry) => entry.index),
            })),
            [
                {
                    path: 'src/copilot/a.js',
                    expectedHashMode: 'target-baseline',
                    expectedHash: HASH_A,
                    durability: 'file',
                    indices: [0, 1],
                },
                {
                    path: 'src/copilot/b.js',
                    expectedHashMode: 'none',
                    expectedHash: undefined,
                    durability: undefined,
                    indices: [2],
                },
            ],
        );
        assert.equal('path' in result.targets[0].entries[0].operation, false);
        assert.equal('expectedHash' in result.targets[0].entries[0].operation, false);
        assert.equal('durability' in result.targets[0].entries[0].operation, false);
    });

    it('rejects missing targets, stale flat operations and top-level durability', () => {
        const missing = normalize({ dryRun: true });
        const staleFlat = normalize({ operations: [{ path: 'a', old_string: 'a', new_string: 'b' }] });
        const topLevelDurability = normalize({
            targets: [{ path: 'a', operations: [{ old_string: 'a', new_string: 'b' }] }],
            durability: 'none',
        });
        for (const result of [missing, staleFlat, topLevelDurability]) {
            assert.equal(result.ok, false);
            if (!result.ok) assert.equal(result.code, 'ERR_PATCH_BATCH_INPUT_SHAPE');
        }
    });

    it('rejects duplicate target identities after path normalization', () => {
        const result = normalize({
            targets: [
                { path: './src/copilot/a.js', operations: [{ old_string: 'a', new_string: 'b' }] },
                { path: 'src/copilot/a.js', operations: [{ old_string: 'c', new_string: 'd' }] },
            ],
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.code, 'ERR_PATCH_BATCH_DUPLICATE_TARGET');
            assert.equal(result.duplicatePath, 'src/copilot/a.js');
        }
    });

    it('enforces operation, target and full-wire byte limits', () => {
        const operationOverflow = normalize({
            targets: [
                {
                    path: 'src/copilot/a.js',
                    operations: Array.from({ length: 129 }, (_, index) => ({
                        old_string: `old-${index}`,
                        new_string: `new-${index}`,
                    })),
                },
            ],
        });
        assert.equal(operationOverflow.ok, false);
        if (!operationOverflow.ok) assert.equal(operationOverflow.code, 'ERR_PATCH_BATCH_OPERATION_LIMIT');

        const targetOverflow = normalize({
            targets: Array.from({ length: 65 }, (_, index) => ({
                path: `src/copilot/${index}.js`,
                operations: [{ old_string: 'a', new_string: 'b' }],
            })),
        });
        assert.equal(targetOverflow.ok, false);
        if (!targetOverflow.ok) assert.equal(targetOverflow.code, 'ERR_PATCH_BATCH_TARGET_LIMIT');

        const tinyBudget = normalizePatchBatchWireInput(
            { targets: [{ path: 'src/copilot/a.js', operations: [{ old_string: 'alpha', new_string: 'beta' }] }] },
            { ...LIMITS, maxInputBytes: 8 },
        );
        assert.equal(tinyBudget.ok, false);
        if (!tinyBudget.ok) assert.equal(tinyBudget.code, 'ERR_PATCH_BATCH_INPUT_BYTES_LIMIT');
    });

    it('retains material request-payload savings over the retired flat representation', () => {
        const path = 'src/copilot/mcp/workspace/repository/patch/operations.js';
        const retiredFlatBaseline = {
            operations: Array.from({ length: 12 }, (_, index) => ({
                path,
                old_string: `old-${index}`,
                new_string: `new-${index}`,
                expectedHash: HASH_A,
            })),
            dryRun: false,
            confirmBatch: true,
            durability: 'file-and-directory',
        };
        const targets = {
            targets: [
                {
                    path,
                    expectedHash: HASH_A,
                    durability: 'file-and-directory',
                    operations: Array.from({ length: 12 }, (_, index) => ({
                        old_string: `old-${index}`,
                        new_string: `new-${index}`,
                    })),
                },
            ],
            dryRun: false,
            confirmBatch: true,
        };
        const flatBytes = Buffer.byteLength(JSON.stringify(retiredFlatBaseline), 'utf8');
        const targetBytes = Buffer.byteLength(JSON.stringify(targets), 'utf8');
        assert.ok(targetBytes < flatBytes * 0.5, `expected >50% reduction; flat=${flatBytes} targets=${targetBytes}`);
    });
});
