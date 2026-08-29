// @ts-check

import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

import { createMcpGitProcessConfig } from '#copilot/mcp/public/workspace/git';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';

/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function gitBranchInfoTool() {
    const tool = getCanonicalMcpTools().find((candidate) => candidate.name === 'git_branch_info');
    assert.ok(tool, 'missing git_branch_info');
    return tool;
}

/** @param {{ failBranch?: boolean; failHead?: boolean }} options */
async function createOperationContext(options = {}) {
    const root = join(process.cwd(), 'src/copilot/.ai/jobs');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'git-read-tools-'));
    tempDirs.push(dir);
    const gitPath = join(dir, 'git');
    const script = `#!/bin/sh
if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then
    ${options.failBranch === true ? "echo 'branch failed' >&2; exit 7" : "printf 'main\\n'; exit 0"}
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then
    echo 'no upstream' >&2
    exit 128
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--short" ]; then
    ${options.failHead === true ? "echo 'head failed' >&2; exit 9" : "printf 'abc1234\\n'; exit 0"}
fi
echo "unexpected git args: $*" >&2
exit 64
`;
    await writeFile(gitPath, script, 'utf8');
    await chmod(gitPath, 0o755);
    const path = process.env['PATH'] ? `${dir}${delimiter}${process.env['PATH']}` : dir;
    const git = createMcpGitProcessConfig({ ...process.env, PATH: path });
    return /** @type {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} */ (
        /** @type {unknown} */ ({
            workspace: { workspaceRoot: process.cwd() },
            config: { git },
        })
    );
}

describe('MCP Git read tools', () => {
    it('keeps a missing upstream optional when branch and HEAD are readable', async () => {
        const result = await gitBranchInfoTool().handler({}, await createOperationContext());

        assert.equal(result.isError, undefined);
        assert.deepEqual(result.structuredContent, {
            success: true,
            branch: 'main',
            upstream: null,
            head: 'abc1234',
        });
    });

    it('fails closed when a required branch or HEAD read fails', async () => {
        const result = await gitBranchInfoTool().handler({}, await createOperationContext({ failHead: true }));

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['code'], 'ERR_GIT_BRANCH_INFO_FAILED');
        const details = /** @type {Record<string, unknown>} */ (result.structuredContent?.['details']);
        assert.equal(details['failureClass'], 'git-read');
        assert.equal(details['retryability'], 'inspect-before-retry');
        assert.equal(details['recoveryRequired'], false);
        const failedReads = /** @type {Record<string, unknown>[]} */ (details['failedReads']);
        assert.deepEqual(failedReads.map((row) => row['name']), ['head']);
        assert.equal(failedReads[0]?.['exitCode'], 9);
    });
});
