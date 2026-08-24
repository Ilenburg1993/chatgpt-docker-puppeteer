// @ts-check
/**
 * Cloudflare edge snapshot tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge-snapshot
 */

import { buildCloudflareEdgeSnapshot } from '#copilot/mcp/public/cloudflare/edge-snapshot';

import { okResult, readOnlyAnnotations } from '#copilot/mcp/public/protocol/tools';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition}
 */
export const mcpCloudflareEdgeSnapshotTool = {
    name: 'mcp_cloudflare_edge_snapshot',
    title: 'Cloudflare edge snapshot',
    description:
        'Return a consolidated read-only Cloudflare snapshot with tunnel, DNS, edge rulesets and policy diff for rollback planning.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await buildCloudflareEdgeSnapshot()),
};
