import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    evaluateIoPathPolicy,
    evaluateIoPathPolicyAsync,
    evaluateIoUrlPolicy,
    getIoPathPolicyCacheStats,
    invalidateIoPathPolicyCache,
    IO_URL_MAX_REDIRECTS,
    resetIoPathPolicyCacheForTest,
    resolveIoAdvisoryLimits,
    sanitizeIoTextOutput,
} from '../../../../src/copilot/core/io-policy.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
    delete process.env['IO_PATH_POLICY_CACHE_TTL_MS'];
    resetIoPathPolicyCacheForTest();
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function createTempDir() {
    const dir = await mkdtemp(path.join(tmpdir(), 'copilot-io-policy-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('core/io-policy evaluateIoPathPolicy', () => {
    const workspaceRoot = path.resolve('/workspace/project');

    it('accepts regular workspace-relative path', () => {
        const result = evaluateIoPathPolicy('src/copilot/index.js', { workspaceRoot });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.absolutePath).toBe(path.resolve(workspaceRoot, 'src/copilot/index.js'));
    });

    it('rejects traversal path', () => {
        const result = evaluateIoPathPolicy('../etc/passwd', { workspaceRoot });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('PATH_TRAVERSAL');
    });

    it('rejects blocked path segments', () => {
        const result = evaluateIoPathPolicy('.git/config', { workspaceRoot });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('PATH_BLOCKED');
    });

    it('keeps secrets blocked even when their extension is a textual script', () => {
        const result = evaluateIoPathPolicy('scripts/secret-bootstrap.sh', { workspaceRoot, mode: 'write' });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('PATH_BLOCKED');
    });

    it('allows repository text scripts to be edited while keeping opaque native binaries blocked', () => {
        for (const scriptPath of ['scripts/run.sh', 'scripts/run.ps1', 'scripts/run.bat', 'scripts/run.cmd']) {
            const writeResult = evaluateIoPathPolicy(scriptPath, { workspaceRoot, mode: 'write' });
            expect(writeResult.ok, scriptPath).toBe(true);
        }

        const binaryWrite = evaluateIoPathPolicy('bin/tool.exe', { workspaceRoot, mode: 'write' });
        expect(binaryWrite.ok).toBe(false);
        if (!binaryWrite.ok) expect(binaryWrite.code).toBe('PATH_BLOCKED');

        const readResult = evaluateIoPathPolicy('scripts/run.sh', { workspaceRoot, mode: 'read' });
        expect(readResult.ok).toBe(true);
    });
});

describe('core/io-policy evaluateIoPathPolicyAsync', () => {
    it('rejects symlink traversal that resolves outside workspace', async () => {
        const workspaceRoot = await createTempDir();
        const outsideRoot = await createTempDir();
        const outsideFile = path.join(outsideRoot, 'outside.txt');
        await writeFile(outsideFile, 'secret', 'utf8');
        await symlink(outsideFile, path.join(workspaceRoot, 'link.txt'));

        const result = await evaluateIoPathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('PATH_SYMLINK_OUTSIDE');
    });

    it('rejects symlink traversal through the nearest existing ancestor when deeper parents do not exist', async () => {
        const workspaceRoot = await createTempDir();
        const outsideRoot = await createTempDir();
        await symlink(outsideRoot, path.join(workspaceRoot, 'escape'));

        const result = await evaluateIoPathPolicyAsync('escape/missing/deep/file.txt', {
            workspaceRoot,
            mode: 'write',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('PATH_SYMLINK_OUTSIDE');
    });

    it('resolves symlink target inside workspace and exposes realPath', async () => {
        const workspaceRoot = await createTempDir();
        await writeFile(path.join(workspaceRoot, 'target.txt'), 'ok', 'utf8');
        await symlink(path.join(workspaceRoot, 'target.txt'), path.join(workspaceRoot, 'link.txt'));

        const result = await evaluateIoPathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.symlinkResolved).toBe(true);
        expect(result.realPath).toBe(path.join(workspaceRoot, 'target.txt'));
    });

    it('reuses read-only realpath decisions inside a fixed window and invalidates them explicitly', async () => {
        process.env['IO_PATH_POLICY_CACHE_TTL_MS'] = '1000';
        resetIoPathPolicyCacheForTest();
        const workspaceRoot = await createTempDir();
        const targetA = path.join(workspaceRoot, 'target-a.txt');
        const targetB = path.join(workspaceRoot, 'target-b.txt');
        const linkPath = path.join(workspaceRoot, 'link.txt');
        await Promise.all([writeFile(targetA, 'a', 'utf8'), writeFile(targetB, 'b', 'utf8')]);
        await symlink(targetA, linkPath);

        const first = await evaluateIoPathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });
        const second = await evaluateIoPathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });
        expect(first.ok && first.realPath).toBe(targetA);
        expect(second.ok && second.realPath).toBe(targetA);
        expect(getIoPathPolicyCacheStats()).toMatchObject({ hits: 1, misses: 1, sets: 1, size: 1 });

        await rm(linkPath, { force: true });
        await symlink(targetB, linkPath);
        const stillCached = await evaluateIoPathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });
        expect(stillCached.ok && stillCached.realPath).toBe(targetA);

        expect(invalidateIoPathPolicyCache(linkPath)).toBe(1);
        const refreshed = await evaluateIoPathPolicyAsync('link.txt', { workspaceRoot, mode: 'read' });
        expect(refreshed.ok && refreshed.realPath).toBe(targetB);
        expect(getIoPathPolicyCacheStats()).toMatchObject({ invalidationEvents: 1, invalidatedEntries: 1 });
    });
});

describe('core/io-policy evaluateIoUrlPolicy', () => {
    it('accepts public https URL', () => {
        const result = evaluateIoUrlPolicy({ input: 'https://example.com/docs' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.url?.hostname).toBe('example.com');
    });

    it('rejects localhost URL by default', () => {
        const result = evaluateIoUrlPolicy({ input: 'http://127.0.0.1:3000' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('URL_BLOCKED');
    });

    it('IO_URL_MAX_REDIRECTS is exported and is a positive number', () => {
        expect(typeof IO_URL_MAX_REDIRECTS).toBe('number');
        expect(IO_URL_MAX_REDIRECTS).toBeGreaterThan(0);
    });

    it('ok result includes maxRedirects defaulting to IO_URL_MAX_REDIRECTS', () => {
        const result = evaluateIoUrlPolicy({ input: 'https://example.com/page' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.maxRedirects).toBe(IO_URL_MAX_REDIRECTS);
    });

    it('ok result respects caller-supplied maxRedirects', () => {
        const result = evaluateIoUrlPolicy({ input: 'https://example.com/page', maxRedirects: 2 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.maxRedirects).toBe(2);
    });

    it('ok result allows maxRedirects=0 (disable follows)', () => {
        const result = evaluateIoUrlPolicy({ input: 'https://example.com/page', maxRedirects: 0 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.maxRedirects).toBe(0);
    });

    it('blocked result does not include maxRedirects', () => {
        const result = evaluateIoUrlPolicy({ input: 'http://192.168.1.1/admin' });
        expect(result.ok).toBe(false);
        expect('maxRedirects' in result ? result.maxRedirects : undefined).toBeUndefined();
    });
});

describe('core/io-policy resolveIoAdvisoryLimits', () => {
    it('returns advisory defaults for read operation', () => {
        const result = resolveIoAdvisoryLimits({ operation: 'read' });
        expect(result.operation).toBe('read');
        expect(result.maxBytes).toBeGreaterThan(0);
        expect(result.maxLines).toBeGreaterThan(0);
        expect(result.advisory).toBe(true);
    });

    it('allows overrides while remaining advisory', () => {
        const result = resolveIoAdvisoryLimits({ operation: 'scan', maxLines: 20 });
        expect(result.operation).toBe('scan');
        expect(result.maxLines).toBe(20);
        expect(result.advisory).toBe(true);
    });
});

describe('core/io-policy sanitizeIoTextOutput', () => {
    it('redacts bearer tokens', () => {
        const result = sanitizeIoTextOutput({ text: 'Authorization: Bearer abcdefghijklmnop' });
        expect(result.sanitized).toBe(true);
        expect(result.redactions).toBeGreaterThan(0);
        expect(result.text).toContain('Bearer [redacted]');
    });

    it('keeps plain text untouched', () => {
        const result = sanitizeIoTextOutput({ text: 'hello world' });
        expect(result.sanitized).toBe(false);
        expect(result.redactions).toBe(0);
        expect(result.text).toBe('hello world');
    });
});
