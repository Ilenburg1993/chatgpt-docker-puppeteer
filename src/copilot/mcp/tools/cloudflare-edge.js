// @ts-check
/**
 * Cloudflare edge/rulesets audit tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge
 */

import { auditCloudflareEdgeRulesets } from '#copilot/mcp/public/cloudflare/edge';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolCloudflareEnvironmentAuthority } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpCloudflareEdgeAuditTool = defineMcpRawTool({
    name: 'mcp_cloudflare_edge_audit',
    title: 'Cloudflare edge audit',
    description:
        'Read Cloudflare zone rulesets for the MCP hostname and report sanitized cache, WAF, rate-limit and transform risks for remote MCP clients.',
    inputSchema: {
        forceRefresh: z.boolean().optional()['describe']('Bypass the short in-process audit cache. Default: false.'),
        cacheTtlMs: z
            .number()
            .int()
            .min(0)
            .max(60000)
            .optional()
            ['describe']('Override the short cache TTL in milliseconds. Default: 5000.'),
    },

    handler: async (input = {}, operationContext) => {
        /** @type {{ forceRefresh: boolean; cacheTtlMs?: number; authority: import('#copilot/mcp/public/cloudflare/environment-authority').CloudflareEnvironmentAuthority }} */
        const options = {
            forceRefresh: input['forceRefresh'] === true,
            authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
        };
        if (typeof input['cacheTtlMs'] === 'number') options['cacheTtlMs'] = input['cacheTtlMs'];
        return okResult(await auditCloudflareEdgeRulesets(options));
    },
});
