// @ts-check
/**
 * Cloudflare remote tunnel audit tools.
 *
 * @module copilot/mcp/tools/cloudflare-remote
 */

import { auditCloudflareRemoteTunnel } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareRemoteAuditTool = {
    name: 'mcp_cloudflare_remote_audit',
    title: 'Cloudflare remote tunnel audit',
    description:
        'Read the remotely-managed Cloudflare tunnel configuration via the official Cloudflare API and report sanitized drift for the MCP connector.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await auditCloudflareRemoteTunnel()),
};
