// @ts-check
/**
 * Streamable HTTP adapter for ChatGPT and MCP Inspector.
 *
 * @module copilot/mcp/adapters/http
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { buildChatGptConnectorProfile } from '../connection/profile.js';
import { logMcp } from '../control-plane/audit.js';
import { readMcpMetricsSnapshot } from '../control-plane/metrics.js';
import { createCopilotMcpServer } from '../server.js';

const MCP_PATH = '/mcp';

/**
 * @param {import('node:http').ServerResponse} res
 * @returns {void}
 */
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

/**
 * @param {{ host?: string; port?: number }} [opts]
 * @returns {Promise<import('node:http').Server>}
 */
export async function startHttpMcpServer(opts = {}) {
    const host = opts.host ?? process.env['COPILOT_MCP_HOST'] ?? '127.0.0.1';
    const port = opts.port ?? Number(process.env['COPILOT_MCP_PORT'] ?? 3333);

    const httpServer = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);

        if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
            setCorsHeaders(res);
            res.writeHead(204).end();
            return;
        }

        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, name: 'copilot-mcp', mcpPath: MCP_PATH, metrics: readMcpMetricsSnapshot() }));
            return;
        }

        if (req.method === 'GET' && url.pathname === '/chatgpt-connector.json') {
            const publicMcpUrl = url.searchParams.get('publicMcpUrl') ?? undefined;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
                JSON.stringify(
                    buildChatGptConnectorProfile(publicMcpUrl === undefined ? {} : { publicMcpUrl }),
                    null,
                    2,
                ),
            );
            return;
        }

        const mcpMethods = new Set(['POST', 'GET', 'DELETE']);
        if (url.pathname === MCP_PATH && req.method && mcpMethods.has(req.method)) {
            setCorsHeaders(res);
            const server = createCopilotMcpServer();
            const transport = new StreamableHTTPServerTransport(
                /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransportOptions} */ (
                    /** @type {unknown} */ ({
                        sessionIdGenerator: undefined,
                        enableJsonResponse: true,
                    })
                ),
            );
            res.on('close', () => {
                void transport.close();
                void server.close();
            });
            try {
                await server.connect(/** @type {import('@modelcontextprotocol/sdk/shared/transport.js').Transport} */ (transport));
                await transport.handleRequest(req, res);
            } catch (error) {
                logMcp('ERROR', 'Error handling MCP HTTP request.', {
                    error: error instanceof Error ? error.message : String(error),
                });
                if (!res.headersSent) {
                    res.writeHead(500).end('Internal server error');
                }
            }
            return;
        }

        res.writeHead(404).end('Not Found');
    });

    await new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve(undefined));
    });
    logMcp('INFO', 'MCP HTTP server listening.', { url: `http://${host}:${port}${MCP_PATH}` });
    return httpServer;
}
