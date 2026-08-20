// @ts-check
/**
 * Tests for MCP HTTP stateful session auth binding.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { handleStatefulMcpHttpRequest } from '#copilot/mcp/adapters';
import { createMcpHttpSessionRuntime } from '#copilot/mcp/control-plane';
import {
    createMcpTransportErrorCollector,
    fakeMcpRequest as fakeReq,
    fakeMcpResponse as fakeRes,
    fakeMcpTransport,
    readFakeMcpHeader as readHeader,
} from './helpers/http-fakes.js';



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
        const { errors, writeTransportError } = createMcpTransportErrorCollector();
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
            writeTransportError,
            createServer: () => ({ async connect() {}, async close() {} }),
            createTransport: (transportOptions) =>
                fakeMcpTransport({
                    handleRequest() {
                        transportOptions.onsessioninitialized?.('session-auth');
                    },
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
            writeTransportError,
            createTransport: () =>
                fakeMcpTransport({
                    handleRequest() {
                        handled += 1;
                    },
                }),
        });

        assert.equal(handled, 0);
        assert.equal(errors.at(-1)?.statusCode, 403);
        assert.equal(JSON.stringify(runtime.snapshot()).includes('token-a'), false);
        assert.equal(JSON.stringify(runtime.snapshot()).includes('token-b'), false);
    });
});
