// @ts-check
/**
 * Cloudflare edge policy diff tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge-diff
 */

import { diffCloudflareEdgePolicy } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareEdgePolicyDiffTool = {
    name: 'mcp_cloudflare_edge_policy_diff',
    title: 'Cloudflare edge policy diff',
    description:
        'Compare the actual Cloudflare edge ruleset audit with the desired plan-only MCP edge policy and return non-mutating gaps.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await diffCloudflareEdgePolicy()),
};
