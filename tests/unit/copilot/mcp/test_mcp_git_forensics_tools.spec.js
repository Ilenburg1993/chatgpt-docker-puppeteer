// @ts-check

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

import { createMcpGitProcessConfig } from '#copilot/mcp/public/workspace/git';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';

/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'mcp-git-forensics-tools-'));
    tempDirs.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.name', 'MCP Tool Test']);
    git(root, ['config', 'user.email', 'mcp-tool@example.test']);
    await writeFile(join(root, 'src/a.js'), 'export const a = 1;\n', 'utf8');
    git(root, ['add', 'src/a.js']);
    git(root, ['commit', '-m', 'base']);
    const base = git(root, ['rev-parse', 'HEAD']);
    await writeFile(join(root, 'src/a.js'), 'export const a = 2;\nexport const b = 3;\n', 'utf8');
    git(root, ['add', 'src/a.js']);
    git(root, ['commit', '-m', 'change a']);
    const head = git(root, ['rev-parse', 'HEAD']);
    await writeFile(join(root, 'src/a.js'), 'export const a = 4;\nexport const b = 3;\n', 'utf8');
    await writeFile(join(root, 'src/untracked.js'), 'export const c = 5;\n', 'utf8');

    const operationContext = /** @type {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} */ (
        /** @type {unknown} */ ({
            workspace: { workspaceRoot: root },
            config: { git: createMcpGitProcessConfig(process.env) },
        })
    );
    return { root, base, head, operationContext };
}

/** @param {string} name @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} context */
function tool(name, context) {
    const definition = getCanonicalMcpTools().find((candidate) => candidate.name === name);
    assert.ok(definition, `missing ${name}`);
    return /** @param {Record<string, unknown>} input */ (input) => definition.handler(input, context);
}

describe('MCP structured Git forensics tools', () => {
    it('exposes structured status/diff/log and consolidated forensic inspect views', async () => {
        const { root, base, head, operationContext } = await fixture();

        const status = await tool('git_status', operationContext)({});
        assert.equal(status.isError, undefined);
        assert.equal(status.structuredContent?.['success'], true);
        const statusBranch = /** @type {Record<string, unknown>} */ (status.structuredContent?.['branch']);
        assert.equal(statusBranch['head'], 'main');
        const entries = /** @type {Record<string, unknown>[]} */ (status.structuredContent?.['entries']);
        assert.ok(entries.some((entry) => entry['path'] === 'src/a.js'));
        assert.ok(entries.some((entry) => entry['path'] === 'src/untracked.js'));

        const diff = await tool('git_diff', operationContext)({ base, head, view: 'name-status' });
        assert.equal(diff.isError, undefined);
        assert.equal(diff.structuredContent?.['view'], 'name-status');
        const changes = /** @type {Record<string, unknown>[]} */ (diff.structuredContent?.['changes']);
        assert.deepEqual(changes.map((row) => [row['status'], row['path']]), [['M', 'src/a.js']]);

        const log = await tool('git_log', operationContext)({ base, head, limit: 5 });
        assert.equal(log.isError, undefined);
        const commits = /** @type {Record<string, unknown>[]} */ (log.structuredContent?.['commits']);
        assert.equal(commits.length, 1);
        assert.equal(commits[0]?.['hash'], head);

        const mergeBase = await tool('git_inspect', operationContext)({ view: 'merge-base', base, head });
        assert.equal(mergeBase.isError, undefined);
        assert.equal(mergeBase.structuredContent?.['mergeBase'], base);

        const show = await tool('git_inspect', operationContext)({ view: 'show', revision: head, path: 'src/a.js' });
        assert.equal(show.isError, undefined);
        assert.match(String(show.structuredContent?.['content'] ?? ''), /a = 2/u);
        assert.doesNotMatch(String(show.structuredContent?.['content'] ?? ''), /a = 4/u);

        const tree = await tool('git_inspect', operationContext)({
            view: 'tree',
            revision: head,
            path: 'src',
            recursive: true,
            maxEntries: 20,
        });
        assert.equal(tree.isError, undefined);
        const treeEntries = /** @type {Record<string, unknown>[]} */ (tree.structuredContent?.['entries']);
        assert.ok(treeEntries.some((entry) => entry['type'] === 'blob' && entry['path'] === 'src/a.js'));

        const blame = await tool('git_inspect', operationContext)({
            view: 'blame',
            revision: head,
            path: 'src/a.js',
            startLine: 1,
            endLine: 2,
        });
        assert.equal(blame.isError, undefined);
        const blameLines = /** @type {Record<string, unknown>[]} */ (blame.structuredContent?.['lines']);
        assert.equal(blameLines.length, 2);

        const worktrees = await tool('git_inspect', operationContext)({ view: 'worktrees' });
        assert.equal(worktrees.isError, undefined);
        const worktreeRows = /** @type {Record<string, unknown>[]} */ (worktrees.structuredContent?.['worktrees']);
        assert.equal(worktreeRows[0]?.['path'], root);
    });

    it('rejects unsafe revision atoms and view-incompatible fields at the wire handler', async () => {
        const { operationContext } = await fixture();
        const unsafe = await tool('git_inspect', operationContext)({ view: 'merge-base', base: '--all', head: 'HEAD' });
        assert.equal(unsafe.isError, true);
        assert.equal(unsafe.structuredContent?.['code'], 'ERR_GIT_REVISION');

        const wrongShape = await tool('git_inspect', operationContext)({ view: 'worktrees', revision: 'HEAD' });
        assert.equal(wrongShape.isError, true);
        assert.equal(wrongShape.structuredContent?.['code'], 'ERR_GIT_INSPECT_SHAPE');
    });
});
