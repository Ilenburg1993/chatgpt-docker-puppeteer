// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    readCatalogResponseJson,
    readCatalogResponseText,
} from '../../../../src/copilot/model-gateway/catalog/importers/response-body.js';

describe('model-gateway importer response body', () => {
    it('reads bounded UTF-8 JSON responses', async () => {
        const response = new Response(JSON.stringify({ data: ['á'] }), {
            headers: { 'content-type': 'application/json' },
        });

        await assert.doesNotReject(async () => {
            assert.deepEqual(await readCatalogResponseJson(response, { maxBytes: 1_024 }), { data: ['á'] });
        });
    });

    it('rejects oversized and invalid UTF-8 responses', async () => {
        await assert.rejects(
            readCatalogResponseText(new Response('abcdef'), { maxBytes: 4, label: 'models' }),
            /exceeds 4 bytes/u,
        );
        await assert.rejects(readCatalogResponseText(new Response(Buffer.from([0xff]))), /invalid UTF-8/u);
    });

    it('preserves json-only test doubles without weakening real Response streams', async () => {
        const fake = /** @type {Response} */ ({
            ok: true,
            json: async () => ({ data: [] }),
        });

        assert.deepEqual(await readCatalogResponseJson(fake), { data: [] });
    });
});
