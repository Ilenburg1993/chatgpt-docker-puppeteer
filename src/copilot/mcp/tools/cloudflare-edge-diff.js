// @ts-check
/**
 * Cloudflare edge policy diff tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge-diff
 */

import { diffCloudflareEdgePolicy } from '#copilot/mcp/public/cloudflare/edge';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolCloudflareEnvironmentAuthority } from '#copilot/mcp/public/protocol/tools';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpCloudflareEdgePolicyDiffTool = defineMcpRawTool({
    name: 'mcp_cloudflare_edge_policy_diff',
    title: 'Cloudflare edge policy diff',
    description:
        'Compare the actual Cloudflare edge ruleset audit with the desired plan-only MCP edge policy and return non-mutating gaps.',
    inputSchema: {},

    handler: async (_input, operationContext) =>
        okResult(
            await diffCloudflareEdgePolicy({
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
            }),
        ),
});
