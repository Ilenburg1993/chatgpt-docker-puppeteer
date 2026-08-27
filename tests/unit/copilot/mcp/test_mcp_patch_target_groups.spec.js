// @ts-check

import assert from 'node:assert/strict';
import { hash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterAll, afterEach, describe, it } from 'vitest';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';

/** @type {string[]} */
const tempDirs = [];
const TEST_PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-patch-target-groups-unit-process-host',
    backgroundServices: false,
});
const TOOL_OPERATION_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-patch-target-groups-unit',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_patch_target_groups' },
            envelope: { protocol: '2026' },
        },
    },
    {
        workspace: TEST_PROCESS_HOST.workspace,
        config: TEST_PROCESS_HOST.processConfig.toolConfig,
        capabilities: TEST_PROCESS_HOST.toolCapabilities,
    },
);

/** @param {string} value */
function sha256(value) {
    return hash('sha256', value, 'hex');
}

/** @param {string} name */
function findTool(name) {
    const tool = getCanonicalMcpTools().find((candidate) => candidate.name === name);
    assert.ok(tool, `missing tool ${name}`);
    return {
        ...tool,
        handler: /** @type {typeof tool.handler} */ ((input) => tool.handler(input, TOOL_OPERATION_CONTEXT)),
    };
}

/**
 * @param {string} name
 * @param {string} content
 */
async function createRepoFile(name, content) {
    const root = join(process.cwd(), 'src/copilot/.ai/jobs');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'patch-target-groups-'));
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

afterAll(async () => {
    await TEST_PROCESS_HOST.dispose();
});

describe('repo_apply_patch_batch target groups', () => {
    it('reuses one baseline hash across sequential same-file operations and elides duplicate preflight', async () => {
        const initial = 'alpha beta gamma';
        const { absolutePath, repoPath } = await createRepoFile('baseline.txt', initial);
        const baseline = sha256(initial);
        const operations = [
            { old_string: 'alpha', new_string: 'ALPHA' },
            { old_string: 'beta', new_string: 'BETA' },
            { old_string: 'gamma', new_string: 'GAMMA' },
        ];

        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [{ path: repoPath, expectedHash: baseline, operations }],
            dryRun: false,
            confirmBatch: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['appliedCount'], 3);
        assert.equal(result.structuredContent?.['preflightElided'], true);
        assert.equal(result.structuredContent?.['preflightElisionReason'], 'per-target-fast-direct-atomic-apply');
        assert.equal(result.structuredContent?.['preflightSummary']?.['ran'], false);
        assert.equal(result.structuredContent?.['resultMode'], 'compact');
        assert.equal(result.structuredContent?.['detailsAvailable'], true);
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['applied']);
        assert.equal(rows.length, 3);
        assert.equal(
            rows.every((row) => row['expectedHashMode'] === 'target-baseline'),
            true,
        );
        assert.equal(
            rows.every((row) => !('traceId' in row) && !('previousHash' in row)),
            true,
        );
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
            targets: [
                {
                    path: repoPath,
                    expectedHash: baseline,
                    operations: [
                        { old_string: 'alpha', new_string: 'ALPHA' },
                        { old_string: 'beta', new_string: 'BETA' },
                    ],
                },
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
        assert.equal(
            rows.every((row) => typeof row['traceId'] === 'string'),
            true,
        );
        assert.equal(
            rows.every((row) => typeof row['previousHash'] === 'string'),
            true,
        );
        assert.equal(
            rows.every((row) => typeof row['contentHash'] === 'string'),
            true,
        );
        assert.equal(
            rows.every((row) => typeof row['firstMatchLine'] === 'number'),
            true,
        );
        assert.equal(await readFile(absolutePath, 'utf8'), 'ALPHA BETA');
    });

    it('forces detailed results when a diff preview is explicitly requested', async () => {
        const initial = 'alpha beta';
        const { repoPath } = await createRepoFile('diff-preview.txt', initial);
        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [
                {
                    path: repoPath,
                    operations: [{ old_string: 'alpha', new_string: 'ALPHA', includeDiffPreview: true }],
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
            { old_string: 'alpha', new_string: 'ALPHA' },
            { old_string: 'missing', new_string: 'MISSING' },
            { old_string: 'gamma', new_string: 'GAMMA' },
        ];

        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [{ path: repoPath, expectedHash: baseline, operations }],
            dryRun: false,
            confirmBatch: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['resultMode'], 'compact');
        assert.equal(result.structuredContent?.['preflightElided'], true);
        const failures = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['failures']);
        assert.equal(failures.length, 1, 'compact mode reports one causal failure per target');
        assert.equal(result.structuredContent?.['reportedFailureCount'], 1);
        assert.deepEqual(result.structuredContent?.['failureSummary'], {
            failedOperationCount: 3,
            failedTargetCount: 1,
            causalFailureCount: 1,
            abortedOperationCount: 2,
            causalByCode: { ERR_PATCH_NOT_FOUND: 1 },
            failureClassCounts: { 'virtual-batch-context': 1 },
            retryabilityCounts: { 'manual-decision': 1 },
            recoveryRequiredTargetCount: 0,
            convergenceCandidateCount: 0,
            recoveryRecipeTargetCount: 1,
            retrySafeRecoveryRecipeTargetCount: 0,
            suggestedRecoveryRecipeTargetCount: 0,
        });
        const causal = failures[0];
        assert.equal(causal?.['index'], 1);
        assert.equal(causal?.['code'], 'ERR_PATCH_NOT_FOUND');
        assert.deepEqual(causal?.['affectedOperationIndices'], [0, 1, 2]);
        assert.equal(causal?.['affectedOperationCount'], 3);
        assert.equal(causal?.['abortedOperationCount'], 2);
        assert.equal(causal?.['failureClass'], 'virtual-batch-context');
        assert.equal(causal?.['retryability'], 'manual-decision');
        assert.equal(causal?.['recoveryRequired'], false);
        assert.match(String(causal?.['nextAction']), /virtual|anchor|ordering/iu);
        assert.equal(await readFile(absolutePath, 'utf8'), initial);
    });

    it('returns bounded occurrence-line evidence for ambiguous retries without another file read', async () => {
        const { repoPath } = await createRepoFile('ambiguous.txt', 'same\nmiddle\nsame\n');
        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [{ path: repoPath, operations: [{ old_string: 'same', new_string: 'other' }] }],
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['reportedFailureCount'], 1);
        const failures = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['failures']);
        assert.equal(failures.length, 1);
        const failure = /** @type {Record<string, unknown>} */ (failures[0]);
        assert.equal(failure['code'], 'ERR_PATCH_AMBIGUOUS_MATCH');
        assert.deepEqual(/** @type {Record<string, unknown>} */ (failure['details'])['occurrenceLines'], [1, 3]);
        assert.match(String(failure['nextAction']), /occurrence_index/);
    });

    it('keeps a representative 12-operation compact dry-run below 3 KiB', async () => {
        const initial = 'alpha';
        const { repoPath } = await createRepoFile('compact-payload.txt', initial);
        const baseline = sha256(initial);
        const operations = Array.from({ length: 12 }, () => ({
            old_string: 'alpha',
            new_string: 'alpha',
            allowNoop: true,
        }));
        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [{ path: repoPath, expectedHash: baseline, operations }],
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['resultMode'], 'compact');
        assert.equal(result.structuredContent?.['operationCount'], 12);
        const resultBytes = Buffer.byteLength(JSON.stringify(result.structuredContent), 'utf8');
        assert.ok(resultBytes < 3 * 1024, `compact result should stay under 3 KiB; got ${resultBytes}`);
    });

    it('defaults multi-target apply to per-target-fast and preserves independent progress', async () => {
        const first = await createRepoFile('fast-first.txt', 'alpha');
        const second = await createRepoFile('fast-second.txt', 'beta');
        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [
                { path: first.repoPath, operations: [{ old_string: 'alpha', new_string: 'ALPHA' }] },
                { path: second.repoPath, operations: [{ old_string: 'missing', new_string: 'BETA' }] },
            ],
            dryRun: false,
            confirmBatch: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['partial'], true);
        assert.equal(result.structuredContent?.['applyMode'], 'per-target-fast');
        assert.equal(result.structuredContent?.['failureMode'], 'best-effort');
        assert.equal(result.structuredContent?.['preflightElided'], true);
        assert.equal(result.structuredContent?.['preflightElisionReason'], 'per-target-fast-direct-atomic-apply');
        assert.equal(result.structuredContent?.['appliedCount'], 1);
        assert.equal(result.structuredContent?.['reportedFailureCount'], 1);
        assert.equal(await readFile(first.absolutePath, 'utf8'), 'ALPHA');
        assert.equal(await readFile(second.absolutePath, 'utf8'), 'beta');
    });

    it('keeps global preflight as an explicit all-target preview gate', async () => {
        const first = await createRepoFile('first.txt', 'alpha');
        const second = await createRepoFile('second.txt', 'beta');
        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [
                { path: first.repoPath, operations: [{ old_string: 'alpha', new_string: 'ALPHA' }] },
                { path: second.repoPath, operations: [{ old_string: 'beta', new_string: 'BETA' }] },
            ],
            dryRun: false,
            confirmBatch: true,
            applyMode: 'global-preflight',
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['applyMode'], 'global-preflight');
        assert.equal(result.structuredContent?.['preflightElided'], false);
        assert.equal(result.structuredContent?.['preflightSummary']?.['ran'], true);
        assert.equal(await readFile(first.absolutePath, 'utf8'), 'ALPHA');
        assert.equal(await readFile(second.absolutePath, 'utf8'), 'BETA');
    });
});
