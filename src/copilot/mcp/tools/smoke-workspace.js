// @ts-check
/**
 * mcp_smoke_workspace MCP wire adapter.
 *
 * @module copilot/mcp/tools/smoke-workspace
 */

import { runMcpWorkspaceSmoke } from '#copilot/mcp/public/diagnostics/workspace-smoke';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    okResult,
    requireMcpToolCloudflareConfig,
    requireMcpToolGitConfig,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpSmokeWorkspaceTool = defineMcpRawTool({
    name: 'mcp_smoke_workspace',
    title: 'MCP workspace smoke',
    description: 'Run a read-only end-to-end smoke suite over the workspace MCP surface.',
    inputSchema: {},

    handler: async (_args, operationContext) =>
        okResult(
            await runMcpWorkspaceSmoke(
                requireMcpToolWorkspace(operationContext),
                requireMcpToolCloudflareConfig(operationContext),
                {
                    gitConfig: requireMcpToolGitConfig(operationContext),
                    ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                },
            ),
        ),
});
