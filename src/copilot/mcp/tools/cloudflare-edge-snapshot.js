// @ts-check
/**
 * Cloudflare edge snapshot tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge-snapshot
 */

import { buildCloudflareEdgeSnapshot } from '#copilot/mcp/public/cloudflare/edge';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolCloudflareEnvironmentAuthority } from '#copilot/mcp/public/protocol/tools';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpCloudflareEdgeSnapshotTool = defineMcpRawTool({
    name: 'mcp_cloudflare_edge_snapshot',
    title: 'Cloudflare edge snapshot',
    description:
        'Return a consolidated read-only Cloudflare snapshot with tunnel, DNS, edge rulesets and policy diff for rollback planning.',
    inputSchema: {},

    handler: async (_input, operationContext) =>
        okResult(
            await buildCloudflareEdgeSnapshot({
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
            }),
        ),
});
