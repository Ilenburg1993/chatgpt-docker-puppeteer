// @ts-check
/**
 * mcp_smoke_workspace MCP wire adapter.
 *
 * @module copilot/mcp/tools/smoke-workspace
 */

import { runMcpWorkspaceSmoke } from '#copilot/mcp/public/diagnostics/workspace-smoke';
import { okResult, readOnlyAnnotations, requireMcpToolWorkspace } from '#copilot/mcp/public/protocol/tools';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition}
 */
export const mcpSmokeWorkspaceTool = {
    name: 'mcp_smoke_workspace',
    title: 'MCP workspace smoke',
    description: 'Run a read-only end-to-end smoke suite over the workspace MCP surface.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async (_args, operationContext) =>
        okResult(await runMcpWorkspaceSmoke(requireMcpToolWorkspace(operationContext))),
};
