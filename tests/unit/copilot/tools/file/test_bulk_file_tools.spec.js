// @ts-check

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, it } from 'vitest';

import {
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
    resetValidatedMutableWorkspacePathStatsForTest,
    resetValidatedReadWorkspacePathStatsForTest,
} from '../../../../../src/copilot/infra/io/policy/validated-path.js';
import { readFilesBatchTool } from '../../../../../src/copilot/tools/file/read/index.js';
import { patchFilesBatchTool } from '../../../../../src/copilot/tools/file/write/index.js';
import { isToolExecutionFailureResponse } from '../../../../../src/copilot/tools/infra/tool-feedback.js';

async function createFixture() {
    const jobsDir = join(process.cwd(), 'src/copilot/.ai/jobs');
    await mkdir(jobsDir, { recursive: true });
    return mkdtemp(join(jobsDir, 'local-bulk-tools-'));
}

function relativePath(/** @type {string} */ path) {
    return relative(process.cwd(), path).replaceAll('\\', '/');
}

describe('local LLM-B bulk file tools', () => {
    it('read_files_batch preserves successful reads when one item fails', async () => {
        const root = await createFixture();
        const a = join(root, 'a.txt');
        const b = join(root, 'b.txt');
        await Promise.all([writeFile(a, 'alpha\none\n', 'utf8'), writeFile(b, 'beta\ntwo\n', 'utf8')]);
        resetValidatedReadWorkspacePathStatsForTest();
        try {
            const result = await readFilesBatchTool.handler({
                requests: [
                    { path: relativePath(a), startLine: 1, endLine: 1 },
                    { path: relativePath(join(root, 'missing.txt')), startLine: 1, endLine: 1 },
                    { path: relativePath(b), startLine: 2, endLine: 2 },
                ],
                failureMode: 'best-effort',
                concurrency: 3,
            });

            assert.ok(!isToolExecutionFailureResponse(result));
            assert.equal(result.success, false);
            assert.equal(result.requestCount, 3);
            assert.equal(result.succeededCount, 2);
            assert.equal(result.failedCount, 1);
            assert.equal(result.skippedCount, 0);
            const first = result.results[0];
            assert.ok(first && first.success === true && 'content' in first);
            assert.match(String(first.content ?? ''), /alpha/u);
            assert.equal(result.results[1]?.success, false);
            const third = result.results[2];
            assert.ok(third && third.success === true && 'content' in third);
            assert.match(String(third.content ?? ''), /two/u);
            const readStats = getValidatedReadWorkspacePathStats();
            assert.equal(readStats.issued, 3);
            assert.equal(readStats.accepted, 3);
            assert.equal(readStats.rejectedUnbranded, 0);
        } finally {
            resetValidatedReadWorkspacePathStatsForTest();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('patch_files_batch reuses the mutable validated-path capability', async () => {
        const root = await createFixture();
        const a = join(root, 'validated.txt');
        await writeFile(a, 'stable\n', 'utf8');
        resetValidatedMutableWorkspacePathStatsForTest();
        try {
            const result = await patchFilesBatchTool.handler({
                operations: [{ path: relativePath(a), old_string: 'stable', new_string: 'stable', allowNoop: true }],
                dryRun: true,
                failureMode: 'best-effort',
                targetConcurrency: 1,
            });
            assert.ok(!isToolExecutionFailureResponse(result));
            assert.equal(result.success, true);
            const stats = getValidatedMutableWorkspacePathStats();
            assert.equal(stats.issued, 1);
            assert.equal(stats.accepted, 1);
            assert.equal(stats.rejectedUnbranded, 0);
            assert.equal(stats.rejectedWorkspace, 0);
            assert.equal(stats.rejectedMode, 0);
        } finally {
            resetValidatedMutableWorkspacePathStatsForTest();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('patch_files_batch is atomic within one target and isolates failures across targets', async () => {
        const root = await createFixture();
        const a = join(root, 'a.txt');
        const b = join(root, 'b.txt');
        await Promise.all([writeFile(a, 'alpha\nomega\n', 'utf8'), writeFile(b, 'beta\n', 'utf8')]);
        try {
            const sameTargetFailure = await patchFilesBatchTool.handler({
                operations: [
                    { path: relativePath(a), old_string: 'alpha', new_string: 'ALPHA' },
                    { path: relativePath(a), old_string: 'does-not-exist', new_string: 'OMEGA' },
                ],
                dryRun: false,
                failureMode: 'best-effort',
                targetConcurrency: 2,
            });
            assert.ok(!isToolExecutionFailureResponse(sameTargetFailure));
            assert.equal(sameTargetFailure.success, false);
            assert.equal(await readFile(a, 'utf8'), 'alpha\nomega\n');

            const crossTargetPartial = await patchFilesBatchTool.handler({
                operations: [
                    { path: relativePath(a), old_string: 'alpha', new_string: 'ALPHA' },
                    { path: relativePath(b), old_string: 'does-not-exist', new_string: 'BETA' },
                ],
                dryRun: false,
                failureMode: 'best-effort',
                targetConcurrency: 2,
            });
            assert.ok(!isToolExecutionFailureResponse(crossTargetPartial));
            assert.equal(crossTargetPartial.success, false);
            assert.equal(crossTargetPartial.partial, true);
            assert.equal(crossTargetPartial.succeededCount, 1);
            assert.equal(crossTargetPartial.failedCount, 1);
            assert.equal(await readFile(a, 'utf8'), 'ALPHA\nomega\n');
            assert.equal(await readFile(b, 'utf8'), 'beta\n');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
