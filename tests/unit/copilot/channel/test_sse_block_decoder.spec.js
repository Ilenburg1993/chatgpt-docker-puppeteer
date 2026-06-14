// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createSseBlockDecoder } from '../../../../src/copilot/channel/sse-client.js';

describe('channel SSE block decoder', () => {
    it('preserves UTF-8 code points and delimiters split across chunks', () => {
        const decoder = createSseBlockDecoder({ maxPendingBytes: 64 });
        const bytes = Buffer.from('event: delta\ndata: {"text":"ação"}\n\n');

        assert.deepEqual(decoder.push(bytes.subarray(0, 29)), []);
        assert.deepEqual(decoder.push(bytes.subarray(29)), ['event: delta\ndata: {"text":"ação"}']);
        assert.equal(decoder.finish(), '');
    });

    it('rejects invalid UTF-8 and an unterminated oversized event', () => {
        assert.throws(
            () => createSseBlockDecoder().push(Buffer.from([0xff])),
            /encoded data was not valid|valid for encoding/iu,
        );
        assert.throws(
            () => createSseBlockDecoder({ maxPendingBytes: 4 }).push(Buffer.from('12345')),
            /exceeds 4 bytes/u,
        );
    });
});
