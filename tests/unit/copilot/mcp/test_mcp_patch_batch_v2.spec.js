// @ts-check

import assert from 'node:assert/strict';
import { hash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, describe, it } from 'vitest';

import { getCanonicalMcpTools } from '#copilot/mcp';

/** @type {string[]} */
const tempDirs = [];

function sha256(value) {
    return hash('sha256', value, 'hex');
}

function findTool(name) {
    const tool = getCanonicalMcpTools().find((candidate) => candidate.name === name);
    assert.ok(tool, `missing tool ${name}`);
    return tool;
}

async function createRepoFile(name, content) {
    const root = join(process.cwd(), 'src/copilot/.ai/jobs');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'patch-batch-v2-'));
    tempDirs.push(dir);
    const absolutePath = join(dir, name);
    await writeFile(absolutePath, content, 'utf8');
    return {
        absolutePath,
        repoPath: relative(process.cwd(), absolutePath).replaceAll('\\', '/'),
    };
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('repo_apply_patch_batch V2', () => {
    it('reuses one baseline hash across sequential same-file operations and elides duplicate preflight', async () => {
        const initial = 'alpha beta gamma';
        const { absolutePath, repoPath } = await createRepoFile('baseline.txt', initial);
        const baseline = sha256(initial);
        const operations = [
            { path: repoPath, old_string: 'alpha', new_string: 'ALPHA', expectedHash: baseline },
            { path: repoPath, old_string: 'beta', new_string: 'BETA', expectedHash: baseline },
            { path: repoPath, old_string: 'gamma', new_string: 'GAMMA', expectedHash: baseline },
        ];

        const result = await findTool('repo_apply_patch_batch').handler({
            operations,
            dryRun: false,
            confirmBatch: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['appliedCount'], 3);
        assert.equal(result.structuredContent?.['preflightElided'], true);
        assert.equal(
            result.structuredContent?.['preflightElisionReason'],
            'single-target-atomic-compute-before-write',
        );
        assert.equal(result.structuredContent?.['preflightSummary']?.['ran'], false);
        assert.equal(result.structuredContent?.['resultMode'], 'compact');
        assert.equal(result.structuredContent?.['detailsAvailable'], true);
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['applied']);
        assert.equal(rows.length, 3);
        assert.equal(rows.every((row) => row['expectedHashMode'] === 'group-baseline'), true);
        assert.equal(rows.every((row) => !('traceId' in row) && !('previousHash' in row)), true);
        const targetSummaries = /** @type {Record<string, unknown>[]} */ (
            result.structuredContent?.['targetSummaries']
        );
        assert.equal(targetSummaries.length, 1);
        assert.deepEqual(targetSummaries[0]?.['operationIndices'], [0, 1, 2]);
        assert.equal(targetSummaries[0]?.['initialHash'], baseline);
        assert.equal(targetSummaries[0]?.['finalHash'], sha256('ALPHA BETA GAMMA'));
        assert.equal(typeof targetSummaries[0]?.['traceId'], 'string');
        assert.equal(targetSummaries[0]?.['bytesWritten'], Buffer.byteLength('ALPHA BETA GAMMA'));
        assert.equal(await readFile(absolutePath, 'utf8'), 'ALPHA BETA GAMMA');
    });

    it('preserves full successful row details when resultMode=detailed', async () => {
        const initial = 'alpha beta';
        const { absolutePath, repoPath } = await createRepoFile('detailed.txt', initial);
        const baseline = sha256(initial);
        const result = await findTool('repo_apply_patch_batch').handler({
            operations: [
                { path: repoPath, old_string: 'alpha', new_string: 'ALPHA', expectedHash: baseline },
                { path: repoPath, old_string: 'beta', new_string: 'BETA', expectedHash: baseline },
            ],
            dryRun: false,
            confirmBatch: true,
            resultMode: 'detailed',
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['requestedResultMode'], 'detailed');
        assert.equal(result.structuredContent?.['resultMode'], 'detailed');
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['applied']);
        assert.equal(rows.length, 2);
        assert.equal(rows.every((row) => typeof row['traceId'] === 'string'), true);
        assert.equal(rows.every((row) => typeof row['previousHash'] === 'string'), true);
        assert.equal(rows.every((row) => typeof row['contentHash'] === 'string'), true);
        assert.equal(rows.every((row) => typeof row['firstMatchLine'] === 'number'), true);
        assert.equal(await readFile(absolutePath, 'utf8'), 'ALPHA BETA');
    });

    it('forces detailed results when a diff preview is explicitly requested', async () => {
        const initial = 'alpha beta';
        const { repoPath } = await createRepoFile('diff-preview.txt', initial);
        const result = await findTool('repo_apply_patch_batch').handler({
            operations: [
                {
                    path: repoPath,
                    old_string: 'alpha',
                    new_string: 'ALPHA',
                    includeDiffPreview: true,
                },
            ],
            resultMode: 'compact',
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['requestedResultMode'], 'compact');
        assert.equal(result.structuredContent?.['resultMode'], 'detailed');
        assert.equal(result.structuredContent?.['resultModeForcedByDiffPreview'], true);
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['operations']);
        assert.equal(rows.length, 1);
        assert.equal(typeof rows[0]?.['projectedHash'], 'string');
        assert.equal(typeof rows[0]?.['diffPreview'], 'string');
    });

    it('identifies the causal operation and aborts the rest without publishing partial content', async () => {
        const initial = 'alpha beta gamma';
        const { absolutePath, repoPath } = await createRepoFile('failure.txt', initial);
        const baseline = sha256(initial);
        const operations = [
            { path: repoPath, old_string: 'alpha', new_string: 'ALPHA', expectedHash: baseline },
            { path: repoPath, old_string: 'missing', new_string: 'MISSING', expectedHash: baseline },
            { path: repoPath, old_string: 'gamma', new_string: 'GAMMA', expectedHash: baseline },
        ];

        const result = await findTool('repo_apply_patch_batch').handler({
            operations,
            dryRun: false,
            confirmBatch: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['resultMode'], 'compact');
        assert.equal(result.structuredContent?.['preflightElided'], true);
        const failures = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['failures']);
        assert.equal(failures.length, 3);
        const causal = failures.find((row) => row['causalFailure'] === true);
        assert.equal(causal?.['index'], 1);
        assert.equal(causal?.['code'], 'ERR_PATCH_NOT_FOUND');
        assert.equal(causal?.['failedOperationIndex'], 1);
        assert.equal(causal?.['failedGroupOperationIndex'], 1);
        assert.equal(causal?.['completedOperationCount'], 1);
        assert.equal(causal?.['failurePhase'], 'operation');
        assert.equal(causal?.['expectedHashMode'], 'group-baseline');
        const aborted = failures.filter((row) => row['causalFailure'] === false);
        assert.equal(aborted.length, 2);
        assert.equal(aborted.every((row) => row['code'] === 'ERR_PATCH_BATCH_GROUP_ABORTED'), true);
        assert.equal(await readFile(absolutePath, 'utf8'), initial);
    });

    it('keeps a representative 12-operation compact dry-run below 3 KiB', async () => {
        const initial = 'alpha';
        const { repoPath } = await createRepoFile('compact-payload.txt', initial);
        const baseline = sha256(initial);
        const operations = Array.from({ length: 12 }, () => ({
            path: repoPath,
            old_string: 'alpha',
            new_string: 'alpha',
            allowNoop: true,
            expectedHash: baseline,
        }));
        const result = await findTool('repo_apply_patch_batch').handler({ operations });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['resultMode'], 'compact');
        assert.equal(result.structuredContent?.['operationCount'], 12);
        const resultBytes = Buffer.byteLength(JSON.stringify(result.structuredContent), 'utf8');
        assert.ok(resultBytes < 3 * 1024, `compact result should stay under 3 KiB; got ${resultBytes}`);
    });

    it('keeps global preflight for multiple targets', async () => {
        const first = await createRepoFile('first.txt', 'alpha');
        const second = await createRepoFile('second.txt', 'beta');
        const result = await findTool('repo_apply_patch_batch').handler({
            operations: [
                { path: first.repoPath, old_string: 'alpha', new_string: 'ALPHA' },
                { path: second.repoPath, old_string: 'beta', new_string: 'BETA' },
            ],
            dryRun: false,
            confirmBatch: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['preflightElided'], false);
        assert.equal(result.structuredContent?.['preflightSummary']?.['ran'], true);
        assert.equal(await readFile(first.absolutePath, 'utf8'), 'ALPHA');
        assert.equal(await readFile(second.absolutePath, 'utf8'), 'BETA');
    });
});
