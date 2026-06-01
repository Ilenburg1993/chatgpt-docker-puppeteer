// @ts-check
/**
 * Cloudflare MCP skip/non-interference audit tool.
 *
 * @module copilot/mcp/tools/cloudflare-skip
 */

import { auditCloudflareSkipPosture } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareSkipAuditTool = {
    name: 'mcp_cloudflare_skip_audit',
    title: 'Cloudflare MCP skip audit',
    description:
        'Read Cloudflare skip and config posture for MCP/OAuth routes, reporting whether a skip rule is needed or a narrower configuration rule should be preferred.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await auditCloudflareSkipPosture()),
};
