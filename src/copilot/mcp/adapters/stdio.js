// @ts-check
/**
 * Stdio adapter for local MCP clients.
 *
 * @module copilot/mcp/adapters/stdio
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logMcp } from '../control-plane/audit.js';
import { createCopilotMcpServer } from '../server.js';

/**
 * @returns {Promise<void>}
 */
export async function startStdioMcpServer() {
    const server = createCopilotMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logMcp('INFO', 'MCP stdio server connected.');
}

