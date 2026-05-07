import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    evaluateIoPathPolicy,
    evaluateIoPathPolicyAsync,
    evaluateIoUrlPolicy,
    resolveIoAdvisoryLimits,
    sanitizeIoTextOutput,
} from '../../../../src/copilot/core/io-policy.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
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

    it('blocks write-only executable patterns while allowing read policy for same extension', () => {
        const writeResult = evaluateIoPathPolicy('scripts/run.sh', { workspaceRoot, mode: 'write' });
        expect(writeResult.ok).toBe(false);
        if (!writeResult.ok) expect(writeResult.code).toBe('PATH_BLOCKED');

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
});

describe('core/io-policy evaluateIoUrlPolicy', () => {
    it('accepts public https URL', () => {
        const result = evaluateIoUrlPolicy({ input: 'https://example.com/docs' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.url.hostname).toBe('example.com');
    });

    it('rejects localhost URL by default', () => {
        const result = evaluateIoUrlPolicy({ input: 'http://127.0.0.1:3000' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('URL_BLOCKED');
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
