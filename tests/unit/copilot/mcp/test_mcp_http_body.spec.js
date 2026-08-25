// @ts-check
/**
 * Tests for bounded MCP JSON body handling and Faixa 1 initialize/session classification.
 */

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'vitest';

import {
    classifyMcpPostSessionRequirement,
    isMcpInitializeRequestBody,
    normalizeMcpSessionId,
} from '#copilot/mcp/public/transport/http/stateful/request-contract';
import { readMcpHttpJsonBody } from '#copilot/testing/mcp/adapters/http';

/**
 * @param {string | Buffer} body
 * @param {Record<string, string>} [headers]
 * @returns {import('node:http').IncomingMessage}
 */
function requestWithBody(body, headers = {}) {
    const req = Readable.from([body]);
    return /** @type {import('node:http').IncomingMessage} */ (
        Object.assign(req, {
            headers,
            method: 'POST',
        })
    );
}

describe('MCP HTTP JSON body helpers', () => {
    it('parses initialize requests with the official SDK classifier', async () => {
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'unit-test', version: '1.0.0' },
            },
        });

        const result = await readMcpHttpJsonBody(
            requestWithBody(body, { 'content-length': String(Buffer.byteLength(body)) }),
        );

        assert.equal(result.ok, true);
        assert.equal(result.ok ? isMcpInitializeRequestBody(result.body) : false, true);
    });

    it('rejects empty POST bodies', async () => {
        const result = await readMcpHttpJsonBody(requestWithBody(''));

        assert.equal(result.ok, false);
        assert.equal(result.ok ? null : result.statusCode, 400);
        assert.equal(
            result.ok ? null : result.error.error_description,
            'MCP POST requests must include a JSON request body.',
        );
    });

    it('rejects invalid JSON without echoing payload content', async () => {
        const result = await readMcpHttpJsonBody(requestWithBody('{"jsonrpc":"2.0", bad'));

        assert.equal(result.ok, false);
        assert.equal(result.ok ? null : result.statusCode, 400);
        assert.equal(result.ok ? null : result.error.error, 'invalid_request');
        assert.equal(result.ok ? '' : result.error.error_description.includes('bad'), false);
    });

    it('rejects invalid UTF-8 before JSON parsing', async () => {
        const result = await readMcpHttpJsonBody(
            requestWithBody(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])),
        );

        assert.equal(result.ok, false);
        assert.equal(result.ok ? null : result.statusCode, 400);
        assert.equal(result.ok ? null : result.error.error_description, 'Invalid JSON request body.');
    });

    it('rejects Content-Length above the configured limit before reading', async () => {
        const result = await readMcpHttpJsonBody(requestWithBody('{"jsonrpc":"2.0"}', { 'content-length': '100' }), {
            maxBytes: 10,
        });

        assert.equal(result.ok, false);
        assert.equal(result.ok ? null : result.statusCode, 413);
        assert.equal(result.ok ? null : result.bytesRead, 0);
    });

    it('rejects streaming bodies that exceed the configured limit', async () => {
        const result = await readMcpHttpJsonBody(requestWithBody('{"jsonrpc":"2.0"}'), { maxBytes: 5 });

        assert.equal(result.ok, false);
        assert.equal(result.ok ? null : result.statusCode, 413);
        assert.equal(result.ok ? 0 : result.bytesRead > 5, true);
    });

    it('classifies initialize without session as the only valid sessionless POST form', () => {
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

        assert.deepEqual(classifyMcpPostSessionRequirement({ method: 'POST', body: initializeBody }), {
            ok: true,
            kind: 'initialize',
            sessionId: null,
            initializeRequest: true,
        });
    });

    it('classifies non-initialize POST without session as a stateful-contract violation', () => {
        const classification = classifyMcpPostSessionRequirement({
            method: 'POST',
            body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        });

        assert.equal(classification.ok, false);
        assert.equal(classification.ok ? null : classification.kind, 'missing-session');
        assert.equal(classification.ok ? null : classification.statusCode, 400);
    });

    it('classifies initialize with an existing session as a stateful-contract violation', () => {
        const classification = classifyMcpPostSessionRequirement({
            method: 'POST',
            sessionId: 'session-1',
            body: {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-11-25',
                    capabilities: {},
                    clientInfo: { name: 'unit-test', version: '1.0.0' },
                },
            },
        });

        assert.equal(classification.ok, false);
        assert.equal(classification.ok ? null : classification.kind, 'initialize-with-session');
        assert.equal(classification.ok ? null : classification.statusCode, 400);
    });

    it('normalizes blank session IDs to null', () => {
        assert.equal(normalizeMcpSessionId('   '), null);
        assert.equal(normalizeMcpSessionId(' abc '), 'abc');
    });
});
