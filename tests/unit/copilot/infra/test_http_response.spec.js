// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    readBoundedResponseBytes,
    readBoundedResponseJson,
    readBoundedResponseText,
} from '../../../../src/copilot/infra/public/http-response.js';

describe('bounded HTTP response bodies', () => {
    it('reads byte, text and JSON bodies within their budget', async () => {
        assert.deepEqual(await readBoundedResponseBytes(new Response('abc'), { maxBytes: 3 }), Buffer.from('abc'));
        assert.equal(await readBoundedResponseText(new Response('ação'), { maxBytes: 16 }), 'ação');
        assert.deepEqual(await readBoundedResponseJson(new Response('{"ok":true}'), { maxBytes: 32 }), { ok: true });
    });

    it('rejects Content-Length and streamed bodies above the budget', async () => {
        await assert.rejects(
            readBoundedResponseText(new Response('ok', { headers: { 'content-length': '100' } }), {
                maxBytes: 4,
                label: 'probe',
            }),
            /probe exceeds 4 bytes/u,
        );
        await assert.rejects(
            readBoundedResponseText(new Response('abcdef'), { maxBytes: 4, label: 'probe' }),
            /probe exceeds 4 bytes/u,
        );
    });

    it('rejects malformed UTF-8 and preserves json-only test doubles', async () => {
        await assert.rejects(
            readBoundedResponseText(new Response(Buffer.from([0xff])), { label: 'probe' }),
            /probe contains invalid UTF-8/u,
        );
        const fake = /** @type {Response} */ ({ json: async () => ({ ok: true }) });
        assert.deepEqual(await readBoundedResponseJson(fake), { ok: true });
    });
});
