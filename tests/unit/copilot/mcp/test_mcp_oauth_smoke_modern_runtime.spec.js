// @ts-check

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import { createMcpModernHttpHandler } from '#copilot/mcp/public/transport/http/modern';
import { runModernMcpRuntimeChecks } from '#copilot/testing/mcp/diagnostics/oauth-smoke';

const originalFetch = globalThis.fetch;

function createFixtureHandler() {
    return createMcpModernHttpHandler(
        () => {
            const server = new McpServer(
                { name: 'oauth-smoke-modern-fixture', version: '1.0.0' },
                { capabilities: { tools: { listChanged: true } } },
            );
            server.registerTool(
                'mcp_runtime_health',
                { description: 'Fixture runtime health.', inputSchema: {} },
                async () => ({ content: [{ type: 'text', text: 'ok' }] }),
            );
            return server;
        },
        { keepAliveMs: 0 },
    );
}

describe('MCP OAuth modern runtime smoke engine', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        globalThis.fetch = originalFetch;
    });

    it('uses the official 2026 client for discover, subscription, tools/list and tools/call without sessions', async () => {
        const handler = createFixtureHandler();
        /** @type {Request[]} */
        const requests = [];
        vi.stubGlobal('fetch', async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            requests.push(request.clone());
            return handler.fetch(request);
        });

        try {
            const result = await runModernMcpRuntimeChecks({
                mcpUrl: 'https://mcp.test/mcp',
                accessToken: 'test-access-token',
                timeoutMs: 5_000,
            });

            assert.equal(result.protocolEra, '2026');
            assert.equal(result.protocolVersion, '2026-07-28');
            assert.equal(result.discovery.ok, true);
            assert.equal(result.subscription.ok, true);
            assert.equal(result.subscriptionClose.ok, true);
            assert.equal(result.subscriptionClose.outcome, 'local');
            assert.equal(result.authenticatedToolsList.ok, true);
            assert.equal(result.runtimeHealth.ok, true);
            const methods = result.requestEvidence.map((row) => row.method).filter((method) => method !== null);
            assert.deepEqual(methods.slice(0, 4), [
                'server/discover',
                'subscriptions/listen',
                'tools/list',
                'tools/call',
            ]);
            assert.equal(
                result.requestEvidence.some((row) => row.name === 'mcp_runtime_health'),
                true,
            );
            assert.equal(
                requests.every((request) => request.headers.get('mcp-session-id') === null),
                true,
            );
            assert.equal(
                requests.every((request) => request.headers.get('authorization') === 'Bearer test-access-token'),
                true,
            );
        } finally {
            await handler.close();
        }
    });

    it('classifies an unexpected subscription drop as remote and re-listens only when the client explicitly asks', async () => {
        const handler = createFixtureHandler();
        let dropFirstSubscription = true;
        /** @type {(string | null)[]} */
        const methods = [];
        const fetchAdapter = async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const method = request.headers.get('mcp-method');
            methods.push(method);
            const response = await handler.fetch(request);
            if (method !== 'subscriptions/listen' || !dropFirstSubscription || !response.body) return response;

            dropFirstSubscription = false;
            const reader = response.body.getReader();
            let forwardedFirstChunk = false;
            const interruptedBody = new ReadableStream({
                async pull(controller) {
                    const { value, done } = await reader.read();
                    if (done) {
                        controller.close();
                        return;
                    }
                    controller.enqueue(value);
                    if (!forwardedFirstChunk) {
                        forwardedFirstChunk = true;
                        await reader.cancel('synthetic remote subscription drop').catch(() => {});
                        controller.close();
                    }
                },
            });
            return new Response(interruptedBody, { status: response.status, headers: response.headers });
        };
        const client = new Client(
            { name: 'oauth-smoke-modern-relisten-fixture', version: '1.0.0' },
            {
                versionNegotiation: { mode: { pin: '2026-07-28' } },
                listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged() {} } },
            },
        );
        const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), { fetch: fetchAdapter });

        try {
            await client.connect(transport);
            const first = client.autoOpenedSubscription;
            assert.ok(first);
            assert.equal(await first.closed, 'remote');
            assert.equal(methods.filter((method) => method === 'subscriptions/listen').length, 1);

            const second = await client.listen({ toolsListChanged: true });
            assert.equal(second.honoredFilter.toolsListChanged, true);
            assert.equal(methods.filter((method) => method === 'subscriptions/listen').length, 2);
            await second.close();
            assert.equal(await second.closed, 'local');
        } finally {
            await client.close().catch(() => {});
            await handler.close();
        }
    });
});
