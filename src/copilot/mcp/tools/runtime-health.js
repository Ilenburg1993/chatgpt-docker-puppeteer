// @ts-check
/** MCP wire adapter for aggregated runtime health. */

import { readMcpRuntimeHealth } from '#copilot/mcp/public/diagnostics/runtime-health';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    okResult,
    requireMcpToolAiArtifactsCapability,
    requireMcpToolCloudflareConfig,
    requireMcpToolGitConfig,
    requireMcpToolIndexAutoBuildConfig,
    requireMcpToolInfraHealthCapability,
    requireMcpToolRepositoryReadCacheConfig,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpRuntimeHealthTool = defineMcpRawTool({
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

    handler: async (input = {}, operationContext) =>
        okResult(
            await readMcpRuntimeHealth(
                requireMcpToolWorkspace(operationContext),
                requireMcpToolRepositoryReadCacheConfig(operationContext),
                requireMcpToolIndexAutoBuildConfig(operationContext),
                requireMcpToolGitConfig(operationContext),
                requireMcpToolInfraHealthCapability(operationContext),
                operationContext?.capabilities.httpSessionRuntime,
                requireMcpToolAiArtifactsCapability(operationContext),
                requireMcpToolCloudflareConfig(operationContext),
                {
                    ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                    includeDetails: /** @type {{ includeDetails?: boolean }} */ (input).includeDetails,
                },
            ),
        ),
});
