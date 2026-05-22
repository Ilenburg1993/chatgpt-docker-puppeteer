// @ts-check
/**
 * Canonical MCP tool registry for ChatGPT connector.
 *
 * @module copilot/mcp/registry
 */

import { gitReadTools } from './tools/git-read.js';
import { projectDoctorTool } from './tools/project-doctor.js';
import { repoReadTools } from './tools/repo-read.js';

/**
 * @typedef {object} McpToolDefinition
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {Record<string, import('zod').ZodTypeAny>} inputSchema
 * @property {import('@modelcontextprotocol/sdk/types.js').ToolAnnotations} annotations
 * @property {(args: any) => Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult> | import('@modelcontextprotocol/sdk/types.js').CallToolResult} handler
 */

/**
 * @returns {McpToolDefinition[]}
 */
export function getCanonicalMcpTools() {
    return [...repoReadTools, ...gitReadTools, projectDoctorTool];
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @returns {McpToolDefinition[]}
 */
export function registerCanonicalMcpTools(server) {
    const tools = getCanonicalMcpTools();
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: tool.annotations,
            },
            tool.handler,
        );
    }
    return tools;
}

