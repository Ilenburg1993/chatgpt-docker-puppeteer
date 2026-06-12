// @ts-check
/** Tests for Cloudflare MCP CLI probe retry behavior. */

import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'vitest';

import { probeJsonWithRetry, readSmokeBearerToken } from '#copilot/mcp/cloudflare/cli-probe.js';
import { runCloudflareSmoke } from '#copilot/mcp/cloudflare/cli-smoke.js';

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

    it('reads the smoke bearer token from the injected environment', () => {
        assert.equal(readSmokeBearerToken({ COPILOT_MCP_SMOKE_BEARER_TOKEN: ' token-value ' }), 'token-value');
        assert.equal(readSmokeBearerToken({ COPILOT_MCP_SMOKE_BEARER_TOKEN: 'bad\nvalue' }), null);
        assert.equal(readSmokeBearerToken({}), null);
    });

    it('fails authenticated smoke before network access when the bearer token is missing', async () => {
        await assert.rejects(
            runCloudflareSmoke({
                config: /** @type {any} */ ({ publicMcpUrl: 'https://example.invalid/mcp' }),
                authenticated: true,
                env: {},
            }),
            /COPILOT_MCP_SMOKE_BEARER_TOKEN/u,
        );
    });
});
