// @ts-check
/**
 * Cloudflare edge/rulesets audit tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge
 */

import { auditCloudflareEdgeRulesets } from '../cloudflare/edge-audit.js';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

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
