// @ts-check
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, vi } from 'vitest';

import { MCP_PROTOCOL_MODERN_VERSION } from '#copilot/mcp/public/protocol/version';
import {
    classifyMcpCompatibilityContinuity,
    createMcpHttpProtocolState,
    createMcpHttpRequestHandler,
} from '#copilot/testing/mcp/adapters/http';
import { createMcpAuditCapability, readMcpAuditProcessConfig } from '#copilot/testing/mcp/observability';

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

        const auditDir = await mkdtemp(path.join(tmpdir(), 'mcp-dual-protocol-audit-'));
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({
                COPILOT_MCP_AUDIT_FILE: path.join(auditDir, 'audit.jsonl'),
                COPILOT_MCP_AUDIT_SYNC: 'true',
            }),
        );
        const protocolState = createMcpHttpProtocolState('http1');
        const requestHandler = createMcpHttpRequestHandler({
            host: '127.0.0.1',
            port: 0,
            protocolState,
            publicScheme: 'http',
            toolCapabilities: { audit },
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
            assert.equal(modern.toolNames.length, 89);
            assert.equal(legacy.toolNames.length, 89);
            assert.deepEqual(new Set(modern.toolNames), new Set(legacy.toolNames));

            const summary = await audit.readCompatibilitySummary({ tailBytes: 256 * 1024, maxEvents: 1000 });
            assert.ok(summary.protocol.byEra['2026'] > 0);
            assert.ok(summary.protocol.byEra['2025'] > 0);
            assert.ok(summary.protocol.byTransportMode['modern-2026'] > 0);
            assert.ok(summary.protocol.byTransportMode['stateless-fallback'] > 0);
            assert.ok(summary.protocol.byRpcClass.initialize > 0);
            assert.ok(summary.protocol.byRpcClass['tools-list'] > 0);
            assert.equal(
                classifyMcpCompatibilityContinuity({
                    protocolEra: '2025',
                    httpMethod: 'GET',
                    rpcMethod: null,
                    lastEventIdPresent: true,
                }),
                'legacy-stream-resume',
            );
        } finally {
            await requestHandler.close();
            await audit.flush();
            await new Promise((resolve) => server.close(resolve));
            await rm(auditDir, { recursive: true, force: true });
        }
    });
});
