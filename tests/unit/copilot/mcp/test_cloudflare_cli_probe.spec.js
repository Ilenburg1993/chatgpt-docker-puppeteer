// @ts-check
/** Tests for Cloudflare MCP CLI probe retry behavior. */

import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'vitest';

import { probeJsonWithRetry } from '#copilot/mcp/cloudflare/cli-probe.js';

/** @type {http.Server[]} */
const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('Cloudflare CLI probe retry', () => {
    it('retries transient Cloudflare 530 tunnel warm-up responses', async () => {
        let calls = 0;
        const server = http.createServer((request, response) => {
            calls += 1;
            response.setHeader('content-type', 'application/json');
            if (calls === 1) {
                response.writeHead(530);
                response.end(JSON.stringify({ error: 'tunnel warming' }));
                return;
            }
            response.writeHead(200);
            response.end(JSON.stringify({ ok: true, path: request.url }));
        });
        servers.push(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        assert.ok(address && typeof address === 'object');

        const result = await probeJsonWithRetry(`http://127.0.0.1:${address.port}/health`, {
            attempts: 2,
            delayMs: 1,
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 200);
        assert.equal(result.attempts, 2);
        assert.equal(calls, 2);
    });
});
