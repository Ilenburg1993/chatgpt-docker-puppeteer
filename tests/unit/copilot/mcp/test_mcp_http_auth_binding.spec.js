// @ts-check
/**
 * Tests for MCP HTTP stateful session auth binding.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { handleStatefulMcpHttpRequest } from '#copilot/mcp/adapters';
import { createMcpHttpSessionRuntime } from '#copilot/mcp/control-plane';

/**
 * @param {string} method
 * @param {Record<string, string>} [headers]
 * @returns {import('node:http').IncomingMessage}
 */
function fakeReq(method, headers = {}) {
    return /** @type {import('node:http').IncomingMessage} */ ({ method, headers, httpVersionMajor: 1 });
}

/** @returns {import('node:http').ServerResponse} */
function fakeRes() {
    return /** @type {import('node:http').ServerResponse} */ ({ headersSent: false, writableEnded: false, statusCode: 200, end() {} });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string} name
 * @returns {string | undefined}
 */
function readHeader(req, name) {
    const value = req.headers[name.toLowerCase()];
    return typeof value === 'string' ? value : undefined;
}

/**
 * @param {unknown[]} errors
 * @returns {(res: import('node:http').ServerResponse, statusCode: number, error: { error: string; error_description: string }) => void}
 */
function captureTransportErrors(errors) {
    return (_res, statusCode, error) => {
        errors.push({ statusCode, error });
    };
}

const initializeBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'unit-test', version: '1.0.0' },
    },
};

describe('MCP HTTP stateful auth binding', () => {
    it('rejects session reuse when the bearer binding changes', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        const errors = [];
        let handled = 0;

        await handleStatefulMcpHttpRequest({
            req: fakeReq('POST'),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: initializeBody,
            authContext: { bearerToken: 'token-a', headers: {}, method: 'POST', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
            createServer: () => ({ async connect() {}, async close() {} }),
            createTransport: (transportOptions) =>
                /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport} */ ({
                    async handleRequest() {
                        transportOptions.onsessioninitialized?.('session-auth');
                    },
                    async close() {},
                }),
        });

        await handleStatefulMcpHttpRequest({
            req: fakeReq('POST', { 'mcp-session-id': 'session-auth' }),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
            authContext: { bearerToken: 'token-b', headers: {}, method: 'POST', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
            createTransport: () =>
                /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport} */ ({
                    async handleRequest() {
                        handled += 1;
                    },
                    async close() {},
                }),
        });

        assert.equal(handled, 0);
        assert.equal(/** @type {{ statusCode?: number }[]} */ (errors).at(-1)?.statusCode, 403);
        assert.equal(JSON.stringify(runtime.snapshot()).includes('token-a'), false);
        assert.equal(JSON.stringify(runtime.snapshot()).includes('token-b'), false);
    });
});
