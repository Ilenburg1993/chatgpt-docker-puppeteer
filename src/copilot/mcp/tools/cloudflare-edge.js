// @ts-check
/**
 * Cloudflare edge/rulesets audit tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge
 */

import { auditCloudflareEdgeRulesets } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareEdgeAuditTool = {
    name: 'mcp_cloudflare_edge_audit',
    title: 'Cloudflare edge audit',
    description:
        'Read Cloudflare zone rulesets for the MCP hostname and report sanitized cache, WAF, rate-limit and transform risks for remote MCP clients.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await auditCloudflareEdgeRulesets()),
};
