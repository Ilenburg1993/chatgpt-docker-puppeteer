// @ts-check
/**
 * Public barrel for MCP transports and HTTP protocol helpers.
 *
 * @module copilot/mcp/adapters
 */

export * from './http-protocol.js';
export {
    configureHttp1ServerTiming,
    configureHttp2ServerTiming,
    createMcpHttpRequestHandler,
    MCP_PATH,
    notifyMcpHttpStarted,
    readHeader,
    readMcpHttpCorsPolicy,
    readMcpHttpServerTimingPolicy,
    readMcpHttpSessionPolicy,
    readMcpHttpSessionRuntimeState,
    readMcpHttpTransportPolicy,
    writeJson,
} from './http-shared.js';
export { startHttpMcpServer } from './http.js';
export { readMcpHttp2ServerPolicy, startHttp2McpServer } from './http2.js';
export { startStdioMcpServer } from './stdio.js';
