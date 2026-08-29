// @ts-check
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { MCP_PROTOCOL_MODERN_VERSION } from '#copilot/mcp/public/protocol/version';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import { createCopilotMcpServer } from '#copilot/mcp/public/server';
import { createMcpModernHttpHandler } from '#copilot/mcp/public/transport/http/modern';

/**
 * Build a fetch adapter that routes the official HTTP client directly into the official modern
 * server handler. No TCP socket, Cloudflare route or live MCP process is involved.
 *
 * @param {import('@modelcontextprotocol/server').McpHttpHandler} handler
 * @returns {typeof fetch}
 */
function createInMemoryMcpFetch(handler) {
    return async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        return handler.fetch(request);
    };
}

describe('MCP 2026 modern HTTP protocol', () => {
    it('negotiates 2026-07-28 and preserves the canonical 88-tool surface in memory', async () => {
        const handler = createMcpModernHttpHandler(() => createCopilotMcpServer(), { keepAliveMs: 0 });
        const client = new Client(
            { name: 'workspace-modern-protocol-test', version: '1.0.0' },
            { versionNegotiation: { mode: { pin: MCP_PROTOCOL_MODERN_VERSION } } },
        );
        const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
            fetch: createInMemoryMcpFetch(handler),
        });

        try {
            await client.connect(transport);

            assert.equal(client.getProtocolEra(), 'modern');
            assert.equal(client.getNegotiatedProtocolVersion(), MCP_PROTOCOL_MODERN_VERSION);
            assert.deepEqual(client.getDiscoverResult()?.supportedVersions, [MCP_PROTOCOL_MODERN_VERSION]);

            const wireTools = await client.listTools();
            const expectedNames = new Set(getCanonicalMcpTools().map((tool) => tool.name));

            assert.equal(wireTools.tools.length, 88);
            assert.equal(expectedNames.size, 88);
            assert.deepEqual(new Set(wireTools.tools.map((tool) => tool.name)), expectedNames);
        } finally {
            await client.close().catch(() => {});
            await handler.close();
        }
    });
});
