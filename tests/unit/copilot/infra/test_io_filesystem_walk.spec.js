// @ts-check
/**
 * Regression coverage for the canonical governed filesystem walker shared by tree/inventory projections.
 */

import {
    listRegularFilesFresh,
    listWorkspaceTreeEntriesFresh,
    walkWorkspaceEntriesFresh,
} from '#copilot/infra/internal/filesystem/read';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { describe, it } from 'vitest';

function workspaceRelative(path) {
    return relative(process.cwd(), path).replace(/\\/gu, '/');
}

describe('governed filesystem walker', () => {
    it('centralizes protected-path pruning, hidden policy, symlink non-traversal and workspace-relative projection', async () => {
        const root = await mkdtemp(join(process.cwd(), 'tests/.tmp-io-walk-'));
        const rootRelative = workspaceRelative(root);
        await mkdir(join(root, 'nested'), { recursive: true });
        await mkdir(join(root, 'node_modules'), { recursive: true });
        await writeFile(join(root, 'root.js'), 'export const root = true;\n', 'utf8');
        await writeFile(join(root, 'root.txt'), 'root\n', 'utf8');
        await writeFile(join(root, '.hidden.js'), 'export const hidden = true;\n', 'utf8');
        await writeFile(join(root, '.env'), 'SECRET=redacted\n', 'utf8');
        await writeFile(join(root, 'nested', 'child.js'), 'export const child = true;\n', 'utf8');
        await writeFile(join(root, 'node_modules', 'blocked.js'), 'export const blocked = true;\n', 'utf8');
        await symlink(join(root, 'nested'), join(root, 'nested-link'), 'dir');

        try {
            const walked = await walkWorkspaceEntriesFresh(root, {
                workspaceRoot: process.cwd(),
                recursive: true,
                depth: 3,
                showHidden: true,
                includeSymlinks: true,
            });
            const paths = walked.entries.map((entry) => entry.path);
            assert.ok(paths.includes(`${rootRelative}/root.js`));
            assert.ok(paths.includes(`${rootRelative}/root.txt`));
            assert.ok(paths.includes(`${rootRelative}/nested`));
            assert.ok(paths.includes(`${rootRelative}/nested/child.js`));
            assert.ok(paths.includes(`${rootRelative}/nested-link`));
            assert.equal(paths.some((path) => path.endsWith('/.env') || path.includes('/node_modules')), false);
            assert.equal(paths.some((path) => path.includes('nested-link/child.js')), false);
            assert.ok(walked.protectedEntriesPruned >= 2);
            assert.equal(walked.symlinksObserved, 1);
            assert.equal(walked.symlinkTraversal, 'disabled');
            assert.equal(walked.pathProjection, 'workspace-relative-only');
            assert.equal(paths.some((path) => isAbsolute(path)), false);

            const hiddenDefault = await listWorkspaceTreeEntriesFresh(root, {
                workspaceRoot: process.cwd(),
                recursive: true,
                depth: 3,
            });
            assert.equal(hiddenDefault.entries.some((entry) => entry.name === '.hidden.js'), false);
            assert.ok(hiddenDefault.hiddenEntriesPruned >= 1);

            const filtered = await listWorkspaceTreeEntriesFresh(root, {
                workspaceRoot: process.cwd(),
                recursive: true,
                depth: 3,
                showHidden: true,
                includePattern: '*.js',
                excludePattern: 'child.js',
            });
            assert.deepEqual(filtered.entries.map((entry) => entry.path), [`${rootRelative}/root.js`]);
            assert.ok(filtered.protectedEntriesPruned >= 2);
            assert.ok(filtered.userExcludedEntries >= 1);

            const inventory = await listRegularFilesFresh(root, { workspaceRoot: process.cwd() });
            assert.deepEqual(inventory.files, [
                `${rootRelative}/nested/child.js`,
                `${rootRelative}/root.js`,
                `${rootRelative}/root.txt`,
            ]);
            assert.equal(inventory.engine, 'node:fs/promises.readdir');
            assert.equal(inventory.pathProjection, 'workspace-relative-only');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('fails explicitly when the traversal hard cap is exceeded', async () => {
        const root = await mkdtemp(join(process.cwd(), 'tests/.tmp-io-walk-limit-'));
        await writeFile(join(root, 'a.js'), 'a\n', 'utf8');
        await writeFile(join(root, 'b.js'), 'b\n', 'utf8');
        try {
            await assert.rejects(
                () =>
                    walkWorkspaceEntriesFresh(root, {
                        workspaceRoot: process.cwd(),
                        hardMaxEntries: 1,
                    }),
                (error) =>
                    Boolean(
                        error &&
                            typeof error === 'object' &&
                            'code' in error &&
                            error.code === 'ERR_WORKSPACE_WALK_LIMIT',
                    ),
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
