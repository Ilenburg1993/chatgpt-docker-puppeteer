// @ts-check

import {
    activateWorkspacePathPolicyCacheConfig,
    evaluateWorkspacePathPolicyAsync,
    getWorkspacePathPolicyCacheStats,
    invalidateWorkspacePathPolicyCache,
} from '#copilot/infra/internal/filesystem/workspace';
import { evaluateWorkspacePathPolicy } from '#copilot/infra/internal/policy';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetWorkspacePathPolicyCacheForTest } from '../../../../src/copilot/infra/filesystem/workspace/path-policy/cache.js';

/** @type {string[]} */
const TEMP_DIRS = [];
/** @type {Array<() => void>} */
const DEACTIVATORS = [];

afterEach(async () => {
    while (DEACTIVATORS.length > 0) DEACTIVATORS.pop()?.();
    resetWorkspacePathPolicyCacheForTest();
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function createTempDir() {
    const dir = await mkdtemp(path.join(tmpdir(), 'copilot-workspace-path-policy-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('infra workspace lexical path policy', () => {
    const workspaceRoot = path.resolve('/workspace/project');

    it('requires an explicit workspace root', () => {
        const result = evaluateWorkspacePathPolicy('src/copilot/index.js', { workspaceRoot: '' });
        expect(result).toMatchObject({ ok: false, code: 'WORKSPACE_ROOT_REQUIRED' });
    });

    it('accepts regular workspace-relative paths and rejects traversal/protected paths', () => {
        expect(evaluateWorkspacePathPolicy('src/copilot/index.js', { workspaceRoot }).ok).toBe(true);
        expect(evaluateWorkspacePathPolicy('../etc/passwd', { workspaceRoot })).toMatchObject({
            ok: false,
            code: 'PATH_TRAVERSAL',
        });
        expect(evaluateWorkspacePathPolicy('.git/config', { workspaceRoot })).toMatchObject({
            ok: false,
            code: 'PATH_BLOCKED',
        });
        expect(
            evaluateWorkspacePathPolicy('scripts/secret-bootstrap.sh', { workspaceRoot, mode: 'write' }),
        ).toMatchObject({
            ok: false,
            code: 'PATH_BLOCKED',
        });
    });

    it('allows repository text scripts while blocking opaque native binaries on write', () => {
        for (const scriptPath of ['scripts/run.sh', 'scripts/run.ps1', 'scripts/run.bat', 'scripts/run.cmd']) {
            expect(evaluateWorkspacePathPolicy(scriptPath, { workspaceRoot, mode: 'write' }).ok, scriptPath).toBe(true);
        }
        expect(evaluateWorkspacePathPolicy('bin/tool.exe', { workspaceRoot, mode: 'write' })).toMatchObject({
            ok: false,
            code: 'PATH_BLOCKED',
        });
    });
});

describe('infra workspace physical path policy', () => {
    it('rejects symlink traversal outside the workspace, including nearest existing ancestor', async () => {
        const workspaceRoot = await createTempDir();
        const outsideRoot = await createTempDir();
        const outsideFile = path.join(outsideRoot, 'outside.txt');
        await writeFile(outsideFile, 'secret', 'utf8');
        await symlink(outsideFile, path.join(workspaceRoot, 'link.txt'));
        await symlink(outsideRoot, path.join(workspaceRoot, 'escape'));

        expect(await evaluateWorkspacePathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' })).toMatchObject({
            ok: false,
            code: 'PATH_SYMLINK_OUTSIDE',
        });
        expect(
            await evaluateWorkspacePathPolicyAsync('escape/missing/deep/file.txt', { workspaceRoot, mode: 'write' }),
        ).toMatchObject({ ok: false, code: 'PATH_SYMLINK_OUTSIDE' });
    });

    it('resolves an internal symlink and preserves only the final symlink for metadata policy', async () => {
        const workspaceRoot = await createTempDir();
        const outsideRoot = await createTempDir();
        const insideTarget = path.join(workspaceRoot, 'target.txt');
        const insideLink = path.join(workspaceRoot, 'inside-link.txt');
        const outsideTarget = path.join(outsideRoot, 'outside.txt');
        const outsideLink = path.join(workspaceRoot, 'outside-link.txt');
        await Promise.all([writeFile(insideTarget, 'inside', 'utf8'), writeFile(outsideTarget, 'outside', 'utf8')]);
        await Promise.all([symlink(insideTarget, insideLink), symlink(outsideTarget, outsideLink)]);

        const resolved = await evaluateWorkspacePathPolicyAsync(insideLink, { workspaceRoot, mode: 'read' });
        expect(resolved.ok && resolved.symlinkResolved).toBe(true);
        expect(resolved.ok && resolved.realPath).toBe(insideTarget);

        const preservedInside = await evaluateWorkspacePathPolicyAsync(insideLink, {
            workspaceRoot,
            mode: 'stat',
            preserveFinalSymlink: true,
        });
        const preservedOutsideFinal = await evaluateWorkspacePathPolicyAsync(outsideLink, {
            workspaceRoot,
            mode: 'stat',
            preserveFinalSymlink: true,
        });
        expect(preservedInside.ok && preservedInside.realPath).toBe(insideLink);
        expect(preservedOutsideFinal.ok && preservedOutsideFinal.realPath).toBe(outsideLink);

        await symlink(outsideRoot, path.join(workspaceRoot, 'escape-parent'));
        expect(
            await evaluateWorkspacePathPolicyAsync('escape-parent/file.txt', {
                workspaceRoot,
                mode: 'stat',
                preserveFinalSymlink: true,
            }),
        ).toMatchObject({ ok: false, code: 'PATH_SYMLINK_OUTSIDE' });
    });

    it('reuses read-only realpath decisions inside a fixed window and invalidates them explicitly', async () => {
        const token = Object.freeze({ test: 'workspace-path-policy-cache' });
        DEACTIVATORS.push(
            activateWorkspacePathPolicyCacheConfig({
                token,
                processId: 'workspace-path-policy-test',
                config: { ttlMs: 1000, maxEntries: 256 },
            }),
        );
        const workspaceRoot = await createTempDir();
        const targetA = path.join(workspaceRoot, 'target-a.txt');
        const targetB = path.join(workspaceRoot, 'target-b.txt');
        const linkPath = path.join(workspaceRoot, 'link.txt');
        await Promise.all([writeFile(targetA, 'a', 'utf8'), writeFile(targetB, 'b', 'utf8')]);
        await symlink(targetA, linkPath);

        const first = await evaluateWorkspacePathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });
        const second = await evaluateWorkspacePathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });
        expect(first.ok && first.realPath).toBe(targetA);
        expect(second.ok && second.realPath).toBe(targetA);
        expect(getWorkspacePathPolicyCacheStats()).toMatchObject({ hits: 1, misses: 1, sets: 1, size: 1 });

        await rm(linkPath, { force: true });
        await symlink(targetB, linkPath);
        const stillCached = await evaluateWorkspacePathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });
        expect(stillCached.ok && stillCached.realPath).toBe(targetA);

        expect(invalidateWorkspacePathPolicyCache(linkPath)).toBe(1);
        const refreshed = await evaluateWorkspacePathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });
        expect(refreshed.ok && refreshed.realPath).toBe(targetB);
        expect(getWorkspacePathPolicyCacheStats()).toMatchObject({ invalidationEvents: 1, invalidatedEntries: 1 });
    });
});
