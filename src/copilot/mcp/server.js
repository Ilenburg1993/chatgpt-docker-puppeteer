// @ts-check
/**
 * MCP server factory for ChatGPT workspace connector.
 *
 * @module copilot/mcp/server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCanonicalMcpTools } from './registry.js';

export const COPILOT_MCP_SERVER_INFO = Object.freeze({
    name: 'chatgpt-docker-puppeteer-copilot-mcp',
    version: '0.1.0',
});

/**
 * @param {import('./registry.js').RegisterCanonicalMcpToolsOptions} [options]
 * @returns {McpServer}
 */
export function createCopilotMcpServer(options = {}) {
    const server = new McpServer(COPILOT_MCP_SERVER_INFO);
    registerCanonicalMcpTools(server, options);
    return server;
}
