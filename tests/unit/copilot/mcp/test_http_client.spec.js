// @ts-check
/** Tests for shared MCP HTTP client helpers. */

import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'vitest';

import { mcpFetchStatus, mcpFetchText, mcpFetchTextWithRetry } from '#copilot/mcp/public/integrations/http';

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

    it('keeps the local timeout active when a caller signal is also provided', async () => {
        const baseUrl = await startServer((_request, _response) => {
            // Intentionally leave the response open until fetch cancellation closes the request.
        });
        const controller = new AbortController();
        const startedAt = Date.now();
        const result = await mcpFetchText(`${baseUrl}/slow`, { timeoutMs: 50, signal: controller.signal });
        assert.equal(result.ok, false);
        assert.equal(result.status, 0);
        assert.ok(Date.now() - startedAt < 1000, JSON.stringify(result));
        assert.equal(controller.signal.aborted, false);
    });

    it('stops retry backoff immediately when caller cancellation arrives', async () => {
        let calls = 0;
        const baseUrl = await startServer((_request, response) => {
            calls += 1;
            response.writeHead(530).end('retry');
        });
        const controller = new AbortController();
        setTimeout(() => controller.abort(new Error('cancel-retries')), 50).unref();
        const result = await mcpFetchTextWithRetry(`${baseUrl}/retry`, {
            attempts: 5,
            delayMs: 500,
            timeoutMs: 1000,
            signal: controller.signal,
        });
        assert.equal(result.ok, false);
        assert.equal(result.status, 0);
        assert.equal(result.attempts, 1);
        assert.match(String(result.error), /cancel-retries/u);
        assert.equal(calls, 1);
    });

    it('rejects invalid UTF-8 and enforces response byte budgets', async () => {
        const invalidBaseUrl = await startServer((_request, response) => {
            response
                .writeHead(200, { 'content-type': 'application/json' })
                .end(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
        });
        const invalid = await mcpFetchText(`${invalidBaseUrl}/invalid`, { timeoutMs: 1000 });

        assert.equal(invalid.ok, false);
        assert.equal(invalid.status, 0);
        assert.match(String(invalid.error), /invalid UTF-8/u);

        const largeBaseUrl = await startServer((_request, response) => {
            response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '6' }).end('abcdef');
        });
        const oversized = await mcpFetchText(`${largeBaseUrl}/large`, { timeoutMs: 1000, maxBytes: 4 });

        assert.equal(oversized.ok, false);
        assert.match(String(oversized.error), /exceeds 4 bytes/u);
    });
});
