// @ts-check
/**
 * Canonical MCP tool registry for ChatGPT connector.
 *
 * @module copilot/mcp/registry
 */

import { gitReadTools } from './tools/git-read.js';
import { appendMcpAuditEvent } from './control-plane/audit.js';
import { connectionTools } from './tools/connection.js';
import { copilotSessionTools } from './tools/copilot-session.js';
import { jobTools } from './tools/jobs.js';
import { projectDoctorTool } from './tools/project-doctor.js';
import { repoReadTools } from './tools/repo-read.js';
import { repoWriteTools } from './tools/repo-write.js';

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
    return [
        ...repoReadTools,
        ...gitReadTools,
        projectDoctorTool,
        ...jobTools,
        ...connectionTools,
        ...repoWriteTools,
        ...copilotSessionTools,
    ];
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
            async (args) => {
                const startedAt = Date.now();
                await appendMcpAuditEvent({
                    event: 'tool_call_started',
                    tool: tool.name,
                    readOnly: tool.annotations.readOnlyHint === true,
                });
                try {
                    const result = await tool.handler(args);
                    await appendMcpAuditEvent({
                        event: 'tool_call_completed',
                        tool: tool.name,
                        durationMs: Date.now() - startedAt,
                        isError: result.isError === true,
                    });
                    return result;
                } catch (error) {
                    await appendMcpAuditEvent({
                        event: 'tool_call_failed',
                        tool: tool.name,
                        durationMs: Date.now() - startedAt,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    throw error;
                }
            },
        );
    }
    return tools;
}
