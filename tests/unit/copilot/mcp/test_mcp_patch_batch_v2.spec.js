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
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['applied']);
        assert.equal(rows.length, 3);
        assert.equal(rows.every((row) => row['expectedHashMode'] === 'group-baseline'), true);
        assert.equal(new Set(rows.map((row) => row['traceId'])).size, 1);
        assert.equal(await readFile(absolutePath, 'utf8'), 'ALPHA BETA GAMMA');
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
