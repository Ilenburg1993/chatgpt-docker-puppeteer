// @ts-check
/**
 * Cloudflare edge policy planning tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge-policy
 */

import { buildCloudflareEdgePolicyPlan } from '#copilot/mcp/public/cloudflare/edge';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolCloudflareEnvironmentAuthority } from '#copilot/mcp/public/protocol/tools';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpCloudflareEdgePolicyPlanTool = defineMcpRawTool({
    name: 'mcp_cloudflare_edge_policy_plan',
    title: 'Cloudflare edge policy plan',
    description:
        'Return the plan-only desired Cloudflare edge policy for MCP cache bypass, OAuth token protection, anonymous MCP protection and non-interference invariants.',
    inputSchema: {},

    handler: async (_input, operationContext) =>
        okResult(
            await buildCloudflareEdgePolicyPlan({
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
            }),
        ),
});
