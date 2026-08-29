// @ts-check

import { executeBufferedProcess } from '#copilot/infra/public/process/execution';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

const ENV = Object.freeze({ PATH: process.env['PATH'] ?? '' });

describe('generic buffered process execution', () => {
    it('captures bounded stdout/stderr and reports a normal exit', async () => {
        const result = await executeBufferedProcess(
            process.execPath,
            ['-e', "process.stdout.write('out'); process.stderr.write('err')"],
            { env: ENV, timeoutMs: 5_000, maxBufferBytes: 1024 },
        );
        assert.equal(result.success, true);
        assert.equal(result.stdout, 'out');
        assert.equal(result.stderr, 'err');
        assert.equal(result.exitCode, 0);
        assert.equal(result.cancelled, false);
        assert.equal(result.timedOut, false);
        assert.equal(result.outputLimitExceeded, false);
    });

    it('terminates only after observing close when one stream exceeds its budget', async () => {
        const result = await executeBufferedProcess(
            process.execPath,
            ['-e', "process.stdout.write('x'.repeat(8192)); setInterval(() => {}, 1000)"],
            { env: ENV, timeoutMs: 5_000, maxBufferBytes: 1024, terminationGraceMs: 50 },
        );
        assert.equal(result.success, false);
        assert.equal(result.outputLimitExceeded, true);
        assert.equal(Buffer.byteLength(result.stdout, 'utf8'), 1024);
        assert.notEqual(result.signal, null);
    });

    it('honors AbortSignal and does not leave the child running after cancellation', async () => {
        const controller = new AbortController();
        const pending = executeBufferedProcess(
            process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'],
            { env: ENV, timeoutMs: 5_000, maxBufferBytes: 1024, signal: controller.signal, terminationGraceMs: 50 },
        );
        setTimeout(() => controller.abort(new Error('test cancellation')), 25).unref();
        const result = await pending;
        assert.equal(result.success, false);
        assert.equal(result.cancelled, true);
        assert.notEqual(result.signal, null);
    });
});
