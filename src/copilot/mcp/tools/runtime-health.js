// @ts-check
/** MCP wire adapter for aggregated runtime health. */

import { readMcpRuntimeHealth } from '#copilot/mcp/public/diagnostics/runtime-health';
import { okResult, readOnlyAnnotations, requireMcpToolWorkspace } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} */
export const mcpRuntimeHealthTool = {
    name: 'mcp_runtime_health',
    title: 'MCP runtime health',
    description: 'Return MCP runtime health, workspace root, uptime and per-tool metrics.',
    inputSchema: {
        includeDetails: z
            .boolean()
            .optional()
            ['describe'](
                'Include verbose index, temporary fallback tunnel and full per-tool metrics. Defaults to false.',
            ),
    },
    annotations: readOnlyAnnotations(),
    handler: async (input = {}, operationContext) =>
        okResult(
            await readMcpRuntimeHealth(requireMcpToolWorkspace(operationContext), {
                includeDetails: /** @type {{ includeDetails?: boolean }} */ (input).includeDetails,
            }),
        ),
};
