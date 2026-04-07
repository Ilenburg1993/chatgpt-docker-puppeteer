// @ts-check
import assert from 'node:assert';

import { fingerprintBuffer } from '../../../tools/rag/lib/fingerprint.mjs';

describe('RAG Fingerprinting', () => {
    it('generates xxhash64 and sha256 for buffer', async () => {
        const buf = Buffer.from('Hello, RAG!', 'utf8');
        const fp = await fingerprintBuffer(buf);

        assert.ok(fp.xxhash64, 'Should have xxhash64');
        assert.ok(fp.sha256, 'Should have sha256');
        assert.strictEqual(typeof fp.xxhash64, 'string');
        assert.strictEqual(typeof fp.sha256, 'string');
        assert.ok(fp.xxhash64.length > 0);
        assert.ok(fp.sha256.length === 64); // SHA256 hex is 64 chars
    });

    it('produces identical fingerprints for identical content', async () => {
        const content = 'Test content for determinism';
        const buf1 = Buffer.from(content, 'utf8');
        const buf2 = Buffer.from(content, 'utf8');

        const fp1 = await fingerprintBuffer(buf1);
        const fp2 = await fingerprintBuffer(buf2);

        assert.strictEqual(fp1.xxhash64, fp2.xxhash64);
        assert.strictEqual(fp1.sha256, fp2.sha256);
    });

    it('produces different fingerprints for different content', async () => {
        const buf1 = Buffer.from('Content A', 'utf8');
        const buf2 = Buffer.from('Content B', 'utf8');

        const fp1 = await fingerprintBuffer(buf1);
        const fp2 = await fingerprintBuffer(buf2);

        assert.notStrictEqual(fp1.xxhash64, fp2.xxhash64);
        assert.notStrictEqual(fp1.sha256, fp2.sha256);
    });

    it('handles empty buffer', async () => {
        const buf = Buffer.from('', 'utf8');
        const fp = await fingerprintBuffer(buf);

        assert.ok(fp.xxhash64);
        assert.ok(fp.sha256);
    });

    it('handles large buffer', async () => {
        const largeContent = 'x'.repeat(100000);
        const buf = Buffer.from(largeContent, 'utf8');
        const fp = await fingerprintBuffer(buf);

        assert.ok(fp.xxhash64);
        assert.strictEqual(fp.sha256.length, 64);
    });
});
