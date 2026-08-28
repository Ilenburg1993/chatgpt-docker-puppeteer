// @ts-check

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterAll, afterEach, describe, it } from 'vitest';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpRecoveryRecipe, createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import { buildRepositoryPatchRecoveryRecipe } from '#copilot/mcp/public/workspace/repository/patch';
import { readMcpRepositoryPatchConfig } from '#copilot/mcp/public/workspace/repository/patch/config';
import { buildGitPublishRecoveryRecipe } from '../../../../src/copilot/mcp/tools/git-write.js';

/** @type {string[]} */
const tempDirs = [];
const TEST_PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-recovery-recipe-unit-process-host',
    backgroundServices: false,
});
const TOOL_OPERATION_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-recovery-recipe-unit',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_recovery_recipe' },
            envelope: { protocol: '2026' },
        },
    },
    {
        workspace: TEST_PROCESS_HOST.workspace,
        config: TEST_PROCESS_HOST.processConfig.toolConfig,
        capabilities: TEST_PROCESS_HOST.toolCapabilities,
    },
);
const DISABLED_SELF_REPAIR_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-recovery-recipe-disabled-self-repair-unit',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_recovery_recipe' },
            envelope: { protocol: '2026' },
        },
    },
    {
        workspace: TEST_PROCESS_HOST.workspace,
        config: {
            ...TEST_PROCESS_HOST.processConfig.toolConfig,
            repositoryPatch: readMcpRepositoryPatchConfig({ COPILOT_MCP_PATCH_EXACT_SELF_REPAIR_DISABLED: 'true' }),
        },
        capabilities: TEST_PROCESS_HOST.toolCapabilities,
    },
);

/** @param {string} name @param {typeof TOOL_OPERATION_CONTEXT} [operationContext] */
function findTool(name, operationContext = TOOL_OPERATION_CONTEXT) {
    const tool = getCanonicalMcpTools().find((candidate) => candidate.name === name);
    assert.ok(tool, `missing tool ${name}`);
    return {
        ...tool,
        handler: /** @type {typeof tool.handler} */ ((input) => tool.handler(input, operationContext)),
    };
}

/** @param {string} name @param {string} content */
async function createRepoFile(name, content) {
    const root = join(process.cwd(), 'src/copilot/.ai/jobs');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'recovery-recipe-'));
    tempDirs.push(dir);
    const absolutePath = join(dir, name);
    await writeFile(absolutePath, content, 'utf8');
    return { absolutePath, repoPath: relative(process.cwd(), absolutePath).replaceAll('\\', '/') };
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

afterAll(async () => {
    await TEST_PROCESS_HOST.dispose();
});

describe('MCP machine-readable recovery recipes', () => {
    it('keeps retry-safe recipes immutable and rejects invalid disposition contracts', () => {
        const recipe = createMcpRecoveryRecipe({
            disposition: 'retry-safe',
            scope: 'target',
            reasonCode: 'test-safe',
            retryInvocation: { tool: 'repo_apply_patch', args: { path: 'a.js', nested: { hash: 'x' } } },
        });
        assert.equal(Object.isFrozen(recipe), true);
        assert.ok(recipe.retryInvocation);
        assert.equal(Object.isFrozen(recipe.retryInvocation), true);
        assert.equal(Object.isFrozen(recipe.retryInvocation.args), true);
        assert.equal(
            Object.isFrozen(/** @type {Record<string, unknown>} */ (recipe.retryInvocation.args)['nested']),
            true,
        );
        assert.throws(
            () =>
                createMcpRecoveryRecipe({
                    disposition: 'retry-safe',
                    scope: 'target',
                    reasonCode: 'missing-invocation',
                }),
            /requires retryInvocation/u,
        );
    });

    it('emits an exact hash-bound patch retry only when caller semantics can be preserved', () => {
        const hash = 'a'.repeat(64);
        const details = {
            recoveryExactAnchor: true,
            recoveryRereadRequired: false,
            recoveryOldString: 'const x = 1;\r\n',
            currentHash: hash,
        };
        const safe = buildRepositoryPatchRecoveryRecipe(
            'ERR_PATCH_NOT_FOUND',
            details,
            { path: 'a.js', old_string: 'const x = 1;\n', new_string: 'const x = 2;\r\n' },
            { dryRun: false, failureScope: 'target' },
        );
        assert.equal(safe?.disposition, 'retry-safe');
        assert.equal(safe?.retryInvocation?.tool, 'repo_apply_patch');
        assert.deepEqual(safe?.retryInvocation?.args, {
            path: 'a.js',
            old_string: 'const x = 1;\r\n',
            new_string: 'const x = 2;\r\n',
            expectedHash: hash,
            dryRun: false,
        });

        const callerHash = buildRepositoryPatchRecoveryRecipe(
            'ERR_PATCH_NOT_FOUND',
            details,
            { path: 'a.js', old_string: 'x', new_string: 'y', expectedHash: 'b'.repeat(64) },
            { dryRun: false, failureScope: 'target' },
        );
        assert.equal(callerHash?.disposition, 'manual');
        assert.equal(callerHash?.reasonCode, 'patch-caller-hash-must-not-be-overridden');
        assert.equal(callerHash?.retryInvocation, undefined);

        const dependent = buildRepositoryPatchRecoveryRecipe(
            'ERR_PATCH_NOT_FOUND',
            details,
            { path: 'a.js', old_string: 'x', new_string: 'y' },
            { dryRun: false, failureScope: 'dependency-group' },
        );
        assert.equal(dependent?.disposition, 'manual');
        assert.equal(dependent?.scope, 'dependency-group');
        assert.equal(dependent?.retryInvocation, undefined);
    });

    it('separates suggested diagnostic invocation from safe retry and terminal no-retry', () => {
        const hashMismatch = buildRepositoryPatchRecoveryRecipe(
            'EEXPECTEDHASH',
            {},
            { path: 'a.js', old_string: 'x', new_string: 'y', expectedHash: 'a'.repeat(64) },
        );
        assert.equal(hashMismatch?.disposition, 'suggested');
        assert.equal(hashMismatch?.suggestedInvocation?.tool, 'repo_bulk_inspect');
        assert.deepEqual(hashMismatch?.suggestedInvocation?.args, {
            single: { op: 'stat', args: { path: 'a.js', includeHash: true } },
        });
        assert.equal(hashMismatch?.retryInvocation, undefined);

        const converged = buildRepositoryPatchRecoveryRecipe(
            'ERR_PATCH_NOOP',
            {},
            { path: 'a.js', old_string: 'x', new_string: 'x' },
        );
        assert.equal(converged?.disposition, 'no-retry');
        assert.equal(converged?.retryInvocation, undefined);
    });

    it('projects an exact recovery recipe through the real repo_apply_patch error envelope without mutation', async () => {
        const content = 'header\r\nconst valueName = 2;\r\nfooter\r\n';
        const { absolutePath, repoPath } = await createRepoFile('crlf.js', content);
        const result = await findTool('repo_apply_patch', DISABLED_SELF_REPAIR_CONTEXT).handler({
            path: repoPath,
            old_string: 'const valueName = 2;\n',
            new_string: 'const valueName = 3;\r\n',
            dryRun: true,
        });
        assert.equal(result.isError, true);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const details = /** @type {Record<string, unknown>} */ (structured['details']);
        const recipe = /** @type {Record<string, unknown>} */ (details['recoveryRecipe']);
        assert.equal(structured['code'], 'ERR_PATCH_NOT_FOUND');
        assert.equal(recipe['disposition'], 'retry-safe');
        assert.equal(recipe['scope'], 'target');
        const invocation = /** @type {Record<string, unknown>} */ (recipe['retryInvocation']);
        assert.equal(invocation['tool'], 'repo_apply_patch');
        const args = /** @type {Record<string, unknown>} */ (invocation['args']);
        assert.equal(args['path'], repoPath);
        assert.equal(args['old_string'], 'const valueName = 2;\r\n');
        assert.equal(args['dryRun'], true);
        assert.equal(await readFile(absolutePath, 'utf8'), content);
    });

    it('self-repairs one exact recoverable patch inside the same MCP call without mutation in dry-run', async () => {
        const content = 'header\r\nconst valueName = 2;\r\nfooter\r\n';
        const { absolutePath, repoPath } = await createRepoFile('crlf-self-repair.js', content);
        const result = await findTool('repo_apply_patch').handler({
            path: repoPath,
            old_string: 'const valueName = 2;\n',
            new_string: 'const valueName = 3;\r\n',
            dryRun: true,
        });

        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const selfRepair = /** @type {Record<string, unknown>} */ (structured['exactSelfRepair']);
        assert.equal(structured['success'], true);
        assert.equal(structured['dryRun'], true);
        assert.deepEqual(selfRepair, {
            attempted: true,
            succeeded: true,
            failedClosed: false,
            attemptCount: 1,
            reasonCode: 'patch-exact-anchor-same-snapshot',
        });
        assert.equal(structured['bytesWritten'], 0);
        assert.equal(await readFile(absolutePath, 'utf8'), content);
    });

    it('self-repairs one exact recoverable patch and publishes the corrected content in one MCP call', async () => {
        const content = 'header\r\nconst valueName = 2;\r\nfooter\r\n';
        const { absolutePath, repoPath } = await createRepoFile('crlf-self-repair-apply.js', content);
        const result = await findTool('repo_apply_patch').handler({
            path: repoPath,
            old_string: 'const valueName = 2;\n',
            new_string: 'const valueName = 3;\r\n',
            dryRun: false,
        });

        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const selfRepair = /** @type {Record<string, unknown>} */ (structured['exactSelfRepair']);
        assert.equal(structured['success'], true);
        assert.equal(structured['workflowSuccess'], true);
        assert.equal(structured['dryRun'], false);
        assert.equal(Number(structured['bytesWritten']) > 0, true);
        assert.deepEqual(selfRepair, {
            attempted: true,
            succeeded: true,
            failedClosed: false,
            attemptCount: 1,
            reasonCode: 'patch-exact-anchor-same-snapshot',
        });
        assert.equal(await readFile(absolutePath, 'utf8'), 'header\r\nconst valueName = 3;\r\nfooter\r\n');
    });

    it('resumes commit-succeeded publication only with exact HEAD/upstream and never restages', () => {
        const head = 'c'.repeat(40);
        const retry = buildGitPublishRecoveryRecipe('ERR_GIT_PUSH_FAILED_AFTER_COMMIT', {
            committedHead: head,
            state: { head, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0 },
        });
        assert.equal(retry?.disposition, 'retry-safe');
        assert.equal(retry?.retryInvocation?.tool, 'git_push');
        assert.deepEqual(retry?.retryInvocation?.args, {
            expectedHead: head,
            expectedUpstream: 'origin/main',
            confirmPush: true,
        });
        assert.equal(JSON.stringify(retry).includes('git_stage'), false);
        assert.equal(JSON.stringify(retry).includes('git_commit'), false);

        const missingUpstream = buildGitPublishRecoveryRecipe('ERR_GIT_PUSH_FAILED_AFTER_COMMIT', {
            committedHead: head,
            state: { head, branch: 'main', upstream: null },
        });
        assert.equal(missingUpstream?.disposition, 'manual');
        assert.equal(missingUpstream?.retryInvocation, undefined);

        const dryRunFailure = buildGitPublishRecoveryRecipe('ERR_GIT_PUSH_DRY_RUN_FAILED_AFTER_COMMIT', {
            committedHead: head,
            state: { head, branch: 'main', upstream: 'origin/main' },
        });
        assert.equal(dryRunFailure?.retryInvocation?.args['pushDryRunFirst'], true);
    });
});
