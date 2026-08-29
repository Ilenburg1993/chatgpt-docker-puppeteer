// @ts-check

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, it } from 'vitest';

import { createMcpGitProcessConfig, createWorkspaceGitReadService } from '#copilot/mcp/public/workspace/git';

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
    const root = await mkdtemp(join(tmpdir(), 'mcp-git-read-service-'));
    tempDirs.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.name', 'MCP Test']);
    git(root, ['config', 'user.email', 'mcp@example.test']);
    await writeFile(join(root, 'src/a.js'), 'export const value = 1;\n', 'utf8');
    git(root, ['add', 'src/a.js']);
    git(root, ['commit', '-m', 'initial']);
    const base = git(root, ['rev-parse', 'HEAD']);

    git(root, ['mv', 'src/a.js', 'src/renamed.js']);
    await writeFile(join(root, 'src/renamed.js'), 'export const value = 1;\nexport const added = true;\n', 'utf8');
    git(root, ['add', 'src/renamed.js']);
    git(root, ['commit', '-m', 'rename source']);
    const head = git(root, ['rev-parse', 'HEAD']);

    await writeFile(join(root, 'src/renamed.js'), 'export const value = 2;\nexport const added = true;\n', 'utf8');
    await writeFile(join(root, 'src/untracked.js'), 'export const untracked = true;\n', 'utf8');

    const workspace = /** @type {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} */ (
        /** @type {unknown} */ ({ workspaceRoot: root })
    );
    const service = createWorkspaceGitReadService({ workspace, config: createMcpGitProcessConfig(process.env) });
    return { root, base, head, service };
}

describe('structured workspace Git read service', () => {
    it('reads status, ranges and historical content through bounded structured owners', async () => {
        const { root, base, head, service } = await fixture();

        const status = await service.status();
        assert.equal(status.ok, true);
        if (!status.ok) return;
        assert.equal(status.branch.head, 'main');
        assert.equal(status.branch.oid, head);
        assert.ok(status.entries.some((entry) => entry.kind === 'ordinary' && entry.path === 'src/renamed.js'));
        assert.ok(status.entries.some((entry) => entry.kind === 'untracked' && entry.path === 'src/untracked.js'));

        const changed = await service.changedFiles({ base, head });
        assert.equal(changed.ok, true);
        if (!changed.ok) return;
        assert.equal(changed.uncertain, false);
        assert.ok(changed.changes.some((entry) => entry.path === 'src/renamed.js'));

        const diff = await service.diff({ base, head, view: 'name-status' });
        assert.equal(diff.ok, true);
        if (!diff.ok) return;
        assert.equal(diff.view, 'name-status');
        assert.deepEqual(diff.changes, changed.changes);

        const log = await service.log({ base, head, limit: 5 });
        assert.equal(log.ok, true);
        if (!log.ok) return;
        assert.equal(log.uncertain, false);
        assert.equal(log.commits.length, 1);
        assert.equal(log.commits[0]?.hash, head);
        assert.equal(log.commits[0]?.subject, 'rename source');

        const mergeBase = await service.mergeBase(base, head);
        assert.deepEqual(mergeBase, { ok: true, base, head, mergeBase: base });

        const commit = await service.show({ revision: head });
        assert.equal(commit.ok, true);
        if (!commit.ok || commit.kind !== 'commit') return;
        assert.equal(commit.commit.hash, head);

        const historicalPath = await service.show({ revision: head, path: 'src/renamed.js' });
        assert.equal(historicalPath.ok, true);
        if (!historicalPath.ok || historicalPath.kind !== 'path') return;
        assert.match(historicalPath.content, /added = true/u);
        assert.doesNotMatch(historicalPath.content, /value = 2/u);

        const tree = await service.tree({ revision: head, recursive: true, path: 'src', maxEntries: 20 });
        assert.equal(tree.ok, true);
        if (!tree.ok) return;
        assert.equal(tree.uncertain, false);
        assert.equal(tree.truncated, false);
        assert.ok(tree.entries.some((entry) => entry.type === 'blob' && entry.path === 'src/renamed.js'));

        const blame = await service.blame({ revision: head, path: 'src/renamed.js', startLine: 1, endLine: 2 });
        assert.equal(blame.ok, true);
        if (!blame.ok) return;
        assert.equal(blame.uncertain, false);
        assert.equal(blame.lines.length, 2);
        assert.deepEqual(blame.lines.map((row) => row.finalLine), [1, 2]);

        const worktrees = await service.worktrees();
        assert.equal(worktrees.ok, true);
        if (!worktrees.ok) return;
        assert.equal(worktrees.uncertain, false);
        assert.equal(worktrees.worktrees.length, 1);
        assert.equal(worktrees.worktrees[0]?.path, root);
    });

    it('rejects unsafe revision/range/path combinations before spawning Git', async () => {
        const { service } = await fixture();
        await assert.rejects(() => service.changedFiles({ base: '--all', head: 'HEAD' }), /revision atom/u);
        await assert.rejects(() => service.diff({ staged: true, base: 'HEAD~1', head: 'HEAD' }), /cannot be combined/u);
        await assert.rejects(() => service.show({ revision: 'HEAD', path: '../outside.js' }), /Invalid workspace-relative Git path/u);
        await assert.rejects(() => service.tree({ revision: 'HEAD', path: '../outside' }), /Invalid workspace-relative Git path/u);
        await assert.rejects(() => service.log({ searchString: 'a', searchRegex: 'b' }), /mutually exclusive/u);
    });
});
