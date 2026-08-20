// @ts-check
/** Tests for Cloudflare MCP CLI probe retry behavior. */

import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'vitest';

import { readCloudflareTunnelConfig } from '#copilot/mcp/cloudflare/config.js';
import { probeJsonWithRetry, readSmokeBearerToken } from '#copilot/mcp/cloudflare/cli-probe.js';
import { runCloudflareSmoke } from '#copilot/mcp/cloudflare/cli-smoke.js';

/** @type {http.Server[]} */
const servers = [];

/**
 * @param {string} publicMcpUrl
 * @param {string} [smokeStateFile='/tmp/cloudflare-smoke-test.json']
 * @returns {ReturnType<typeof readCloudflareTunnelConfig>}
 */
function smokeConfig(publicMcpUrl, smokeStateFile = '/tmp/cloudflare-smoke-test.json') {
    return readCloudflareTunnelConfig({
        COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
        COPILOT_MCP_CLOUDFLARE_ZONE: 'example.com',
        COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME: 'mcp.example.com',
        COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: 'https://mcp.example.com/mcp',
        COPILOT_MCP_ORIGIN_TRANSPORT: 'http',
        COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: 'http://127.0.0.1:3008',
        COPILOT_MCP_CLOUDFLARE_SMOKE_STATE_FILE: smokeStateFile,
        COPILOT_MCP_SMOKE_URL: publicMcpUrl,
    });
}

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
        await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
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
                config: smokeConfig('https://example.invalid/mcp'),
                authenticated: true,
                env: {},
            }),
            /COPILOT_MCP_SMOKE_BEARER_TOKEN/u,
        );
    });

    it('runs independent health, protected-resource and tools probes concurrently', async () => {
        let activeRequests = 0;
        let maxActiveRequests = 0;
        /** @type {string | null} */
        let baseUrl = null;
        const server = http.createServer((request, response) => {
            activeRequests += 1;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            setTimeout(() => {
                response.setHeader('content-type', 'application/json');
                if (request.url === '/health') {
                    response.writeHead(200);
                    response.end(JSON.stringify({ ok: true }));
                } else if (request.url === '/.well-known/oauth-protected-resource') {
                    response.writeHead(200);
                    response.end(JSON.stringify({ authorization_servers: [baseUrl] }));
                } else if (request.url === '/.well-known/oauth-authorization-server') {
                    response.writeHead(200);
                    response.end(JSON.stringify({ issuer: baseUrl }));
                } else if (request.url === '/mcp') {
                    response.setHeader(
                        'www-authenticate',
                        `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
                    );
                    response.writeHead(401);
                    response.end(JSON.stringify({ error: 'unauthorized' }));
                } else {
                    response.writeHead(404);
                    response.end(JSON.stringify({ error: 'not-found' }));
                }
                activeRequests -= 1;
            }, 60);
        });
        servers.push(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        baseUrl = `http://127.0.0.1:${address.port}`;

        const report = await runCloudflareSmoke({
            config: smokeConfig(`${baseUrl}/mcp`, '/definitely/not/writable/smoke.json'),
            authenticated: false,
            env: {
                COPILOT_MCP_PUBLIC_URL: `${baseUrl}/mcp`,
                COPILOT_MCP_AUTH_MODE: 'oauth',
                COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
                COPILOT_MCP_SMOKE_ATTEMPTS: '1',
                COPILOT_MCP_SMOKE_DELAY_MS: '100',
            },
        });

        assert.equal(report['ok'], true);
        assert.ok(maxActiveRequests >= 3, `expected >=3 concurrent requests, observed ${maxActiveRequests}`);
        assert.deepEqual(report['timings'], {
            strategy: 'parallel-health-resource-tools-then-auth-metadata',
            discoveryParallelMs: report['timings'].discoveryParallelMs,
            authorizationServerMs: report['timings'].authorizationServerMs,
            totalMs: report['timings'].totalMs,
        });
        assert.equal(typeof report['timings'].totalMs, 'number');
    });
});
