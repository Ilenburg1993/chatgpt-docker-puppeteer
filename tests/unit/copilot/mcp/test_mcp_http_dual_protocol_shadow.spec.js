// @ts-check
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, describe, it, vi } from 'vitest';

import { MCP_PROTOCOL_MODERN_VERSION } from '#copilot/mcp/public/protocol/version';
import { createMcpHttpProtocolState } from '#copilot/testing/mcp/adapters/http-protocol';
import { createMcpHttpRequestHandler } from '#copilot/testing/mcp/adapters/http-shared';

afterEach(() => {
    vi.unstubAllEnvs();
});

/**
 * @param {URL} url
 * @param {'legacy' | 'modern'} era
 */
async function probe(url, era) {
    const client = new Client(
        { name: `dual-protocol-shadow-${era}`, version: '1.0.0' },
        {
            versionNegotiation: era === 'modern' ? { mode: { pin: MCP_PROTOCOL_MODERN_VERSION } } : { mode: 'legacy' },
        },
    );
    const transport = new StreamableHTTPClientTransport(url);
    try {
        await client.connect(transport);
        const tools = await client.listTools();
        return {
            era: client.getProtocolEra(),
            protocolVersion: client.getNegotiatedProtocolVersion(),
            toolNames: tools.tools.map((tool) => tool.name),
        };
    } finally {
        await client.close().catch(() => {});
    }
}

describe('MCP HTTP dual protocol shadow', () => {
    it('serves modern 2026 and compatibility 2025 clients from one composed HTTP handler', async () => {
        vi.stubEnv('COPILOT_MCP_AUTH_MODE', 'none-dev');
        vi.stubEnv('COPILOT_MCP_HTTP_STATEFUL_SESSIONS', 'false');

        const protocolState = createMcpHttpProtocolState('http1');
        const requestHandler = createMcpHttpRequestHandler({
            host: '127.0.0.1',
            port: 0,
            protocolState,
            publicScheme: 'http',
        });
        const server = createServer((req, res) => {
            void requestHandler(req, res);
        });

        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => resolve(undefined));
        });
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const mcpUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);

        try {
            const health = await fetch(new URL('/health', mcpUrl));
            const modern = await probe(mcpUrl, 'modern');
            const legacy = await probe(mcpUrl, 'legacy');

            assert.equal(health.status, 200);
            assert.equal(modern.era, 'modern');
            assert.equal(modern.protocolVersion, MCP_PROTOCOL_MODERN_VERSION);
            assert.equal(legacy.era, 'legacy');
            assert.equal(legacy.protocolVersion, '2025-11-25');
            assert.equal(modern.toolNames.length, 131);
            assert.equal(legacy.toolNames.length, 131);
            assert.deepEqual(new Set(modern.toolNames), new Set(legacy.toolNames));
        } finally {
            await requestHandler.close();
            await new Promise((resolve) => server.close(resolve));
        }
    });
});
