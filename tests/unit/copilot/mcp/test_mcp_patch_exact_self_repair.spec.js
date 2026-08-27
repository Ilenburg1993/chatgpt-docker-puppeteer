// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { runRepositoryPatchTargetGroups } from '#copilot/mcp/public/workspace/repository/patch';
import { readMcpRepositoryPatchConfig } from '#copilot/mcp/public/workspace/repository/patch/config';

const SNAPSHOT_HASH = 'a'.repeat(64);
const CHANGED_HASH = 'b'.repeat(64);

/** @param {string} code @param {Record<string, unknown>} [details] */
function patchError(code, details = {}) {
    const error = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (new Error(code));
    error.code = code;
    error.details = details;
    return error;
}

function recoverableNotFoundError() {
    return patchError('ERR_PATCH_NOT_FOUND', {
        currentHash: SNAPSHOT_HASH,
        currentStateKind: 'locked-file',
        recoveryExactAnchor: true,
        recoveryRereadRequired: false,
        recoveryOldString: 'const value = 1;\r\n',
        recoveryReason: 'line-ending-normalization',
    });
}

/** @param {Record<string, unknown>} options */
function successfulDryRunPatch(options) {
    return {
        occurrences: 1,
        replacedOccurrences: 1,
        bytesWritten: 0,
        projectedBytes: 18,
        previousBytes: 18,
        byteDelta: 0,
        oldStringBytes: 18,
        newStringBytes: 18,
        firstMatchLine: 1,
        lastMatchLine: 1,
        lineDelta: 0,
        occurrenceIndex: null,
        noop: false,
        diffPreview: '',
        diffPreviewTruncated: false,
        diffPreviewLines: 0,
        diffPreviewBytes: 0,
        diffContextLines: Number(options['diffContextLines'] ?? 3),
        diffRangeOptimized: false,
        computeDiff: options['computeDiff'] === true,
        previousHash: String(options['expectedHash'] ?? SNAPSHOT_HASH),
        contentHash: 'c'.repeat(64),
        dryRun: true,
        rollbackCaptureEnabled: false,
        previousSnapshotBase64: null,
        previousSnapshotTruncated: false,
        previousRollbackSidecar: null,
        capacityPreflight: null,
        durability: null,
        io: {
            operation: 'patch',
            targetKind: 'file',
            bytesWritten: 0,
            durationMs: 1,
            engine: 'test.patchTextLocked',
            traceId: 'test-self-repair',
        },
    };
}

/**
 * @param {{
 *   patchTextLocked: (path: string, options: Record<string, unknown>) => Promise<Record<string, unknown>>;
 *   patchTextBatchLocked?: (path: string, options: Record<string, unknown>) => Promise<Record<string, unknown>>;
 * }} io
 */
function createWorkspace(io) {
    return /** @type {any} */ ({
        workspaceRoot: '/workspace',
        io: {
            patchTextLocked: io.patchTextLocked,
            patchTextBatchLocked:
                io.patchTextBatchLocked ??
                (async () => {
                    throw new Error('patchTextBatchLocked should not run in this test');
                }),
        },
        resolveWritePath: async (path) => ({
            ok: true,
            relative: String(path),
            resolved: `/workspace/${String(path)}`,
        }),
    });
}

function enabledConfig() {
    return readMcpRepositoryPatchConfig({});
}

/**
 * @param {string} path
 * @param {Record<string, unknown>[]} operations
 * @param {{ expectedHash?: string; durability?: 'file-and-directory' | 'file' | 'none' }} [options]
 */
function target(path, operations, options = {}) {
    return {
        path,
        expectedHashMode: options.expectedHash
            ? /** @type {const} */ ('target-baseline')
            : /** @type {const} */ ('none'),
        ...(options.expectedHash ? { expectedHash: options.expectedHash } : {}),
        ...(options.durability ? { durability: options.durability } : {}),
        entries: operations.map((operation, index) => ({ index, operation })),
    };
}

describe('MCP exact bounded patch self-repair', () => {
    it('performs exactly one hash-bound retry from the B1 recipe and succeeds', async () => {
        /** @type {Record<string, unknown>[]} */
        const calls = [];
        const workspace = createWorkspace({
            patchTextLocked: async (_path, options) => {
                calls.push(options);
                if (calls.length === 1) throw recoverableNotFoundError();
                return successfulDryRunPatch(options);
            },
        });

        const run = await runRepositoryPatchTargetGroups(
            workspace,
            [target('a.js', [{ old_string: 'const value = 1;\n', new_string: 'const value = 2;\r\n' }])],
            true,
            { repositoryPatchConfig: enabledConfig(), concurrency: 1, maxTargets: 1 },
        );

        assert.equal(calls.length, 2);
        assert.equal(calls[0]?.['expectedHash'], undefined);
        assert.equal(calls[1]?.['expectedHash'], SNAPSHOT_HASH);
        assert.equal(calls[1]?.['oldString'], 'const value = 1;\r\n');
        assert.equal(calls[1]?.['newString'], 'const value = 2;\r\n');
        assert.equal(calls[1]?.['replaceAll'], undefined);
        const row = /** @type {Record<string, unknown>} */ (run.operations[0]);
        assert.equal(row['success'], true);
        assert.deepEqual(row['exactSelfRepair'], {
            attempted: true,
            succeeded: true,
            failedClosed: false,
            attemptCount: 1,
            reasonCode: 'patch-exact-anchor-same-snapshot',
        });
    });

    it('fails closed on a race between locks and never performs a third attempt', async () => {
        /** @type {Record<string, unknown>[]} */
        const calls = [];
        const workspace = createWorkspace({
            patchTextLocked: async (_path, options) => {
                calls.push(options);
                if (calls.length === 1) throw recoverableNotFoundError();
                throw patchError('EEXPECTEDHASH', { expectedHash: SNAPSHOT_HASH, currentHash: CHANGED_HASH });
            },
        });

        const run = await runRepositoryPatchTargetGroups(
            workspace,
            [target('race.js', [{ old_string: 'const value = 1;\n', new_string: 'const value = 2;\r\n' }])],
            true,
            { repositoryPatchConfig: enabledConfig(), concurrency: 1, maxTargets: 1 },
        );

        assert.equal(calls.length, 2);
        const row = /** @type {Record<string, unknown>} */ (run.operations[0]);
        assert.equal(row['success'], false);
        assert.equal(row['code'], 'EEXPECTEDHASH');
        assert.deepEqual(row['exactSelfRepair'], {
            attempted: true,
            succeeded: false,
            failedClosed: true,
            attemptCount: 1,
            reasonCode: 'patch-exact-anchor-same-snapshot',
            failureCode: 'EEXPECTEDHASH',
        });
        const recipe = /** @type {Record<string, unknown>} */ (row['recoveryRecipe']);
        assert.equal(recipe['disposition'], 'suggested');
        assert.equal(recipe['retryInvocation'], undefined);
    });

    it('never overrides caller expectedHash or selector semantics', async () => {
        const cases = [
            { expectedHash: SNAPSHOT_HASH },
            { replace_all: true },
            { expected_occurrences: 1 },
            { occurrence_index: 1 },
        ];
        for (const extra of cases) {
            let callCount = 0;
            const workspace = createWorkspace({
                patchTextLocked: async () => {
                    callCount += 1;
                    throw recoverableNotFoundError();
                },
            });
            const { expectedHash, ...operationOptions } = extra;
            const run = await runRepositoryPatchTargetGroups(
                workspace,
                [
                    target(
                        'guarded.js',
                        [{ old_string: 'const value = 1;\n', new_string: 'const value = 2;', ...operationOptions }],
                        expectedHash ? { expectedHash } : {},
                    ),
                ],
                true,
                { repositoryPatchConfig: enabledConfig(), concurrency: 1, maxTargets: 1 },
            );
            assert.equal(callCount, 1, `unexpected self-repair for ${JSON.stringify(extra)}`);
            const row = /** @type {Record<string, unknown>} */ (run.operations[0]);
            assert.equal(row['success'], false);
            assert.equal(row['exactSelfRepair'], undefined);
            const recipe = /** @type {Record<string, unknown>} */ (row['recoveryRecipe']);
            assert.notEqual(recipe['disposition'], 'retry-safe');
        }
    });

    it('never self-repairs dependent same-file groups through the independent-target path', async () => {
        let singleCalls = 0;
        let batchCalls = 0;
        const workspace = createWorkspace({
            patchTextLocked: async () => {
                singleCalls += 1;
                throw new Error('single-target path must not execute');
            },
            patchTextBatchLocked: async () => {
                batchCalls += 1;
                const error = recoverableNotFoundError();
                /** @type {any} */ (error).operationIndex = 0;
                /** @type {any} */ (error).completedOperationCount = 0;
                /** @type {any} */ (error).failurePhase = 'compute';
                throw error;
            },
        });

        const run = await runRepositoryPatchTargetGroups(
            workspace,
            [
                target('same.js', [
                    { old_string: 'const value = 1;\n', new_string: 'const value = 2;' },
                    { old_string: 'const other = 1;', new_string: 'const other = 2;' },
                ]),
            ],
            true,
            { repositoryPatchConfig: enabledConfig(), concurrency: 1, maxTargets: 1 },
        );

        assert.equal(singleCalls, 0);
        assert.equal(batchCalls, 1);
        assert.equal(run.operations.length, 2);
        for (const row of run.operations) {
            assert.equal(row['success'], false);
            assert.equal(row['exactSelfRepair'], undefined);
        }
        const causal = /** @type {Record<string, unknown>} */ (run.operations[0]);
        const recipe = /** @type {Record<string, unknown>} */ (causal['recoveryRecipe']);
        assert.equal(recipe['disposition'], 'manual');
        assert.equal(recipe['scope'], 'dependency-group');
    });
});
