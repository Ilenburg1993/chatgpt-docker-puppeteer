// @ts-check
/**
 * Cloudflare edge snapshot tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge-snapshot
 */

import { buildCloudflareEdgeSnapshot } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/**
 * @type {import('../registry.js').McpToolDefinition}
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
