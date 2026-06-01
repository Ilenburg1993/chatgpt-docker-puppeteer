// @ts-check
/**
 * Cloudflare MCP skip/non-interference audit tool.
 *
 * @module copilot/mcp/tools/cloudflare-skip
 */

import { auditCloudflareSkipPosture } from '../cloudflare/skip-audit.js';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

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
