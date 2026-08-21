// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createBoundedProcessOutputCapture } from '../../../../src/copilot/infra/platform/process-output.js';

describe('bounded process output capture', () => {
    it('retains a byte-exact head and reports omitted bytes', () => {
        const capture = createBoundedProcessOutputCapture({ maxBytes: 5 });
        capture.append('abc');
        capture.append('def');

        assert.equal(capture.toString(), 'abcde');
        assert.deepEqual(capture.snapshot(), {
            mode: 'head',
            maxBytes: 5,
            observedBytes: 6,
            storedBytes: 5,
            omittedBytes: 1,
            truncated: true,
        });
        assert.match(capture.toString({ includeTruncationMarker: true }), /1 bytes omitted/u);
    });

    it('retains a byte-exact tail across ring-buffer wraps', () => {
        const capture = createBoundedProcessOutputCapture({ maxBytes: 5, mode: 'tail' });
        capture.append('ab');
        capture.append('cdef');
        capture.append('gh');

        assert.equal(capture.toString(), 'defgh');
        assert.equal(capture.snapshot().omittedBytes, 3);
    });

    it('preserves multibyte UTF-8 split across physical chunks', () => {
        const bytes = Buffer.from('ação');
        const capture = createBoundedProcessOutputCapture({ maxBytes: bytes.byteLength });
        capture.append(bytes.subarray(0, 3));
        capture.append(bytes.subarray(3));

        assert.equal(capture.toString({ fatal: true }), 'ação');
    });

    it('rejects invalid UTF-8 only when fatal text is requested', () => {
        const capture = createBoundedProcessOutputCapture({ maxBytes: 8 });
        capture.append(Buffer.from([0xff]));

        assert.match(capture.toString(), /\uFFFD/u);
        assert.throws(() => capture.toString({ fatal: true, label: 'stdout' }), /stdout contains invalid UTF-8/u);
    });
});
