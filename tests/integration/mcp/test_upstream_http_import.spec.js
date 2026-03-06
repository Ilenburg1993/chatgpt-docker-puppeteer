// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

import { ToolRegistry } from '../../../src/integration/tool-registry.mjs';
import { registerUpstreams, shutdownUpstreams } from '../../../src/integration/mcp/upstream-manager.mjs';

/**
 * @returns {Promise<{ server: http.Server, url: string }>}
 */
function startFakeMcpHttpServer() {
    const server = http.createServer(async (req, res) => {
        try {
            if (req.method !== 'POST' || req.url !== '/mcp') {
                res.statusCode = 404;
                res.end('not found');
                return;
            }

            let body = '';
            req.setEncoding('utf8');
            req.on('data', chunk => (body += chunk));
            await once(req, 'end');

            const msg = JSON.parse(body);
            const id = msg?.id ?? 1;
            const method = msg?.method;
            const params = msg?.params || {};

            /** @type {any} */
            let result;
            if (method === 'tools/list') {
                result = {
                    tools: [
                        {
                            name: 'hello',
                            description: 'Say hello',
                            inputSchema: {
                                type: 'object',
                                properties: { name: { type: 'string' } },
                                required: ['name'],
                            },
                        },
                    ],
                };
            } else if (method === 'tools/call') {
                if (params?.name !== 'hello') {
                    res.statusCode = 200;
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown tool' } }));
                    return;
                }
                const who = String(params?.arguments?.name || 'world');
                result = { content: [{ type: 'text', text: `Hello ${who}` }] };
            } else {
                res.statusCode = 200;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }));
                return;
            }

            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
        } catch (/** @type {any} */ err) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: err?.message || String(err) }));
        }
    });

    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1');
        server.once('listening', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') return reject(new Error('Unexpected server address'));
            resolve({ server, url: `http://127.0.0.1:${addr.port}/mcp` });
        });
        server.once('error', reject);
    });
}

test('imports tools from HTTP upstream and proxies calls', async () => {
    const { server, url } = await startFakeMcpHttpServer();
    const registry = new ToolRegistry();

    try {
        const env = {
            MCP_UPSTREAMS_JSON: JSON.stringify([{ alias: 'core', transport: 'http', url, toolPrefix: 'mcp_core__' }]),
            MCP_UPSTREAM_REFRESH: 'true',
        };

        const st = await registerUpstreams(registry, { env });
        assert.equal(st.upstreams.length, 1);
        assert.equal(st.upstreams[0].alias, 'core');
        assert.equal(st.upstreams[0].ready, true);
        assert.equal(st.upstreams[0].registeredCount, 1);

        assert.equal(registry.has('mcp_core__hello'), true);

        const out = /** @type {any} */ (await registry.execute('mcp_core__hello', { name: 'MCP' }));
        assert.equal(out?.content?.[0]?.text, 'Hello MCP');
    } finally {
        await shutdownUpstreams().catch(() => {});
        await new Promise(r => server.close(() => r(null)));
    }
});
