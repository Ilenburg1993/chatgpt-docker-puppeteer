// @ts-check

import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';

const FILE = '/tmp/copilot-line-offset-cache.txt';
/** @type {ReturnType<typeof createInfraRuntime>} */
let runtime;

beforeEach(() => {
    runtime = createInfraRuntime({ runtimeId: `line-offset-test-${Date.now()}-${Math.random()}` });
});

afterEach(async () => {
    process.env['IO_LINE_OFFSET_CACHE_ENABLED'] = '1';
    await runtime.dispose();
});

const stats = () => runtime.coherence.read.lineOffsets.stats();
const slice = (filePath, text, fingerprint, window = {}) =>
    runtime.coherence.read.lineOffsets.slice(filePath, text, fingerprint, window);
const invalidate = (filePath) => runtime.coherence.invalidation.invalidatePath(filePath, { source: 'test' });

describe('infra/io/fs line-offset cache', () => {
    it('returns split-equivalent windows while reusing cached line offsets', () => {
        const text = 'l1\nl2\nl3\n';
        const fingerprint = { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 1234 };

        const first = slice(FILE, text, fingerprint, { startLine: 2, endLine: 3 });
        const afterFirst = stats();
        const second = slice(FILE, text, fingerprint, { startLine: 1, endLine: 4 });
        const afterSecond = stats();

        assert.equal(first.content, 'l2\nl3');
        assert.deepEqual(first.returnedLines, { start: 2, end: 3 });
        assert.equal(first.totalLines, 4);
        assert.equal(first.cache, 'line-offset-miss');
        assert.equal(afterFirst['misses'], 1);
        assert.equal(afterFirst['sets'], 1);
        assert.ok(afterFirst.sizeBytes > 0);
        assert.ok(afterFirst.sizeBytes <= afterFirst.maxBytes);
        assert.equal(second.content, text);
        assert.deepEqual(second.returnedLines, { start: 1, end: 4 });
        assert.equal(second.cache, 'line-offset-hit');
        assert.equal(afterSecond['hits'], 1);
        assert.equal(afterSecond.size, 1);
    });

    it('clears cached offsets when canonical IO invalidation is published', () => {
        const text = 'alpha\nbeta\ngamma';
        const fingerprint = { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 5678 };
        slice(FILE, text, fingerprint, { startLine: 1, endLine: 2 });
        assert.equal(stats().size, 1);

        invalidate(FILE);
        const after = stats();
        assert.equal(after['busInvalidations'], 1);
        assert.equal(after['clears'], 1);
        assert.equal(after.size, 0);
        assert.equal(after.sizeBytes, 0);
    });

    it('normaliza paths relativos e absolutos para a mesma entrada', () => {
        const text = 'alpha\nbeta\ngamma';
        const fingerprint = { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 6789 };
        const relativeFile = path.relative(process.cwd(), FILE);
        const first = slice(relativeFile, text, fingerprint, { startLine: 1 });
        const second = slice(FILE, text, fingerprint, { startLine: 2 });
        assert.equal(first.cache, 'line-offset-miss');
        assert.equal(second.cache, 'line-offset-hit');
        assert.equal(stats().size, 1);
        invalidate(relativeFile);
        assert.equal(stats().size, 0);
    });

    it('bypasses caching when fingerprint is not finite', () => {
        const result = slice(FILE, 'a\nb', { sizeBytes: 3, mtimeMs: null }, { startLine: 2 });
        assert.equal(result.content, 'b');
        assert.equal(result.cache, 'line-offset-bypass');
        assert.equal(stats()['bypasses'], 1);
        assert.equal(stats().size, 0);
    });

    it('treats CRLF and isolated CR as physical delimiters on cache hits and misses', () => {
        const text = 'one\r\ntwo\rthree\nfour';
        const fingerprint = { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 8901 };
        const first = slice(FILE, text, fingerprint, { startLine: 2, endLine: 3 });
        const second = slice(FILE, text, fingerprint, { startLine: 1, endLine: 2 });
        assert.equal(first.content, 'two\rthree');
        assert.equal(first.totalLines, 4);
        assert.equal(first.cache, 'line-offset-miss');
        assert.equal(second.content, 'one\r\ntwo');
        assert.equal(second.totalLines, 4);
        assert.equal(second.cache, 'line-offset-hit');
    });

    it('uses the same physical-line semantics without allocating a split array on bypass', async () => {
        process.env['IO_LINE_OFFSET_CACHE_ENABLED'] = '0';
        await runtime.dispose();
        runtime = createInfraRuntime({ runtimeId: `line-offset-disabled-${Date.now()}-${Math.random()}` });
        const text = 'one\r\ntwo\rthree\n';
        const result = slice(
            FILE,
            text,
            { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 9012 },
            { startLine: 2, endLine: 3 },
        );
        const after = stats();
        assert.equal(result.content, 'two\rthree');
        assert.equal(result.totalLines, 4);
        assert.deepEqual(result.returnedLines, { start: 2, end: 3 });
        assert.equal(result.cache, 'line-offset-bypass');
        assert.equal(after.enabled, false);
        assert.equal(after['bypasses'], 1);
        assert.equal(after.size, 0);
    });
});
