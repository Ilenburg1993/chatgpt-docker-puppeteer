// @ts-check

import { strict as assert } from 'node:assert';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';

import { invalidateIoCachePath } from '../../../../src/copilot/infra/io-cache.js';
import {
    getLineOffsetCacheStats,
    resetLineOffsetCacheForTest,
    sliceTextByCachedLineOffsets,
} from '../../../../src/copilot/infra/io/fs/line-offset-cache.js';

const FILE = '/tmp/copilot-line-offset-cache.txt';

afterEach(() => {
    process.env['IO_LINE_OFFSET_CACHE_ENABLED'] = '1';
    resetLineOffsetCacheForTest();
});

describe('infra/io/fs line-offset cache', () => {
    it('returns split-equivalent windows while reusing cached line offsets', () => {
        resetLineOffsetCacheForTest();
        const text = 'l1\nl2\nl3\n';
        const fingerprint = { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 1234 };

        const first = sliceTextByCachedLineOffsets(FILE, text, fingerprint, { startLine: 2, endLine: 3 });
        const afterFirst = getLineOffsetCacheStats();
        const second = sliceTextByCachedLineOffsets(FILE, text, fingerprint, { startLine: 1, endLine: 4 });
        const afterSecond = getLineOffsetCacheStats();

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
        resetLineOffsetCacheForTest();
        const text = 'alpha\nbeta\ngamma';
        const fingerprint = { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 5678 };

        sliceTextByCachedLineOffsets(FILE, text, fingerprint, { startLine: 1, endLine: 2 });
        assert.equal(getLineOffsetCacheStats().size, 1);

        invalidateIoCachePath(FILE);
        const stats = getLineOffsetCacheStats();
        assert.equal(stats['busInvalidations'], 1);
        assert.equal(stats['clears'], 1);
        assert.equal(stats.size, 0);
        assert.equal(stats.sizeBytes, 0);
    });

    it('normaliza paths relativos e absolutos para a mesma entrada', () => {
        resetLineOffsetCacheForTest();
        const text = 'alpha\nbeta\ngamma';
        const fingerprint = { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 6789 };
        const relativeFile = path.relative(process.cwd(), FILE);

        const first = sliceTextByCachedLineOffsets(relativeFile, text, fingerprint, { startLine: 1 });
        const second = sliceTextByCachedLineOffsets(FILE, text, fingerprint, { startLine: 2 });

        assert.equal(first.cache, 'line-offset-miss');
        assert.equal(second.cache, 'line-offset-hit');
        assert.equal(getLineOffsetCacheStats().size, 1);

        invalidateIoCachePath(relativeFile);
        assert.equal(getLineOffsetCacheStats().size, 0);
    });

    it('bypasses caching when fingerprint is not finite', () => {
        resetLineOffsetCacheForTest();
        const result = sliceTextByCachedLineOffsets(FILE, 'a\nb', { sizeBytes: 3, mtimeMs: null }, { startLine: 2 });

        assert.equal(result.content, 'b');
        assert.equal(result.cache, 'line-offset-bypass');
        assert.equal(getLineOffsetCacheStats()['bypasses'], 1);
        assert.equal(getLineOffsetCacheStats().size, 0);
    });

    it('treats CRLF and isolated CR as physical delimiters on cache hits and misses', () => {
        resetLineOffsetCacheForTest();
        const text = 'one\r\ntwo\rthree\nfour';
        const fingerprint = { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 8901 };

        const first = sliceTextByCachedLineOffsets(FILE, text, fingerprint, { startLine: 2, endLine: 3 });
        const second = sliceTextByCachedLineOffsets(FILE, text, fingerprint, { startLine: 1, endLine: 2 });

        assert.equal(first.content, 'two\rthree');
        assert.equal(first.totalLines, 4);
        assert.equal(first.cache, 'line-offset-miss');
        assert.equal(second.content, 'one\r\ntwo');
        assert.equal(second.totalLines, 4);
        assert.equal(second.cache, 'line-offset-hit');
    });

    it('uses the same physical-line semantics without allocating a split array on bypass', () => {
        process.env['IO_LINE_OFFSET_CACHE_ENABLED'] = '0';
        resetLineOffsetCacheForTest();
        const text = 'one\r\ntwo\rthree\n';
        const result = sliceTextByCachedLineOffsets(
            FILE,
            text,
            { sizeBytes: Buffer.byteLength(text, 'utf8'), mtimeMs: 9012 },
            { startLine: 2, endLine: 3 },
        );
        const stats = getLineOffsetCacheStats();

        assert.equal(result.content, 'two\rthree');
        assert.equal(result.totalLines, 4);
        assert.deepEqual(result.returnedLines, { start: 2, end: 3 });
        assert.equal(result.cache, 'line-offset-bypass');
        assert.equal(stats.enabled, false);
        assert.equal(stats['bypasses'], 1);
        assert.equal(stats.size, 0);
    });
});
