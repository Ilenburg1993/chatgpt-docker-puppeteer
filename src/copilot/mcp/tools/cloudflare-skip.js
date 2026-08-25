// @ts-check
/**
 * Cloudflare MCP skip/non-interference audit tool.
 *
 * @module copilot/mcp/tools/cloudflare-skip
 */

import { auditCloudflareSkipPosture } from '#copilot/mcp/public/cloudflare/posture';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolCloudflareEnvironmentAuthority } from '#copilot/mcp/public/protocol/tools';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpCloudflareSkipAuditTool = defineMcpRawTool({
    name: 'mcp_cloudflare_skip_audit',
    title: 'Cloudflare MCP skip audit',
    description:
        'Read Cloudflare skip and config posture for MCP/OAuth routes, reporting whether a skip rule is needed or a narrower configuration rule should be preferred.',
    inputSchema: {},

    handler: async (_input, operationContext) =>
        okResult(
            await auditCloudflareSkipPosture({
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
            }),
        ),
});
