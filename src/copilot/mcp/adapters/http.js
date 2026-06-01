// @ts-check
/**
 * HTTP/1.1 Streamable HTTP adapter for ChatGPT and MCP Inspector.
 *
 * Production remains deliberately stateless. The route handler is shared with the experimental HTTP/2 adapter and never
 * pre-reads request bodies before delegating to the MCP SDK.
 *
 * @module copilot/mcp/adapters/http
 */

import { createServer } from 'node:http';
import {
    MCP_PATH,
    configureHttp1ServerTiming,
    createMcpHttpRequestHandler,
    notifyMcpHttpStarted,
    readMcpHttpServerTimingPolicy,
    readMcpHttpSessionPolicy,
    readMcpHttpSessionRuntimeState,
} from './http-shared.js';
import { createMcpHttpProtocolState, recordMcpHttpProtocolRequest } from './http-protocol.js';
import { logMcp } from '#copilot/mcp/control-plane';

export { readMcpHttpServerTimingPolicy, readMcpHttpSessionPolicy, readMcpHttpSessionRuntimeState };

/**
 * @param {{ host?: string; port?: number }} [opts]
 * @returns {Promise<import('node:http').Server>}
 */
export async function startHttpMcpServer(opts = {}) {
    const host = opts.host ?? process.env['COPILOT_MCP_HOST'] ?? '127.0.0.1';
    const port = opts.port ?? Number(process.env['COPILOT_MCP_PORT'] ?? 3333);

    const protocolState = createMcpHttpProtocolState('http1');
    const requestHandler = createMcpHttpRequestHandler({ host, port, protocolState, publicScheme: 'http' });
    const httpServer = createServer(async (req, res) => {
        recordMcpHttpProtocolRequest(protocolState, req);
        await requestHandler(req, res);
    });

    const timingPolicy = configureHttp1ServerTiming(httpServer);
    await new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve(undefined));
    });
    logMcp('INFO', 'MCP HTTP server listening.', {
        url: `http://${host}:${port}${MCP_PATH}`,
        timingPolicy,
        sessionRuntime: readMcpHttpSessionRuntimeState(),
        protocol: 'http1',
    });
    notifyMcpHttpStarted();
    return httpServer;
}
