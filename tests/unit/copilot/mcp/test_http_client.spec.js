// @ts-check
/** Tests for shared MCP HTTP client helpers. */

import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'vitest';

import { mcpFetchStatus, mcpFetchTextWithRetry } from '#copilot/mcp/control-plane';

/** @type {http.Server[]} */
const servers = [];

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            (server) =>
                new Promise((resolve) => {
                    server.close(() => resolve(undefined));
                }),
        ),
    );
});

/**
 * @param {(request: http.IncomingMessage, response: http.ServerResponse) => void} handler
 * @returns {Promise<string>}
 */
function startServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        servers.push(server);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            assert.ok(address && typeof address === 'object');
            resolve(`http://127.0.0.1:${address.port}`);
        });
    });
}

describe('MCP HTTP client', () => {
    it('fetches status with timeout handling', async () => {
        const baseUrl = await startServer((_request, response) => {
            response.writeHead(204).end();
        });

        const result = await mcpFetchStatus(`${baseUrl}/health`, { timeoutMs: 1000 });
        assert.deepEqual(result, { ok: true, status: 204 });
    });

    it('retries retryable statuses while preserving response text', async () => {
        let calls = 0;
        const baseUrl = await startServer((_request, response) => {
            calls += 1;
            if (calls === 1) {
                response.writeHead(530, { 'content-type': 'application/json' }).end('{"error":"warming"}');
                return;
            }
            response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        });

        const result = await mcpFetchTextWithRetry(`${baseUrl}/mcp`, { attempts: 2, delayMs: 0, timeoutMs: 1000 });
        assert.equal(result.ok, true);
        assert.equal(result.status, 200);
        assert.equal(result.rawBody, '{"ok":true}');
        assert.equal(result.attempts, 2);
        assert.equal(calls, 2);
    });
});
