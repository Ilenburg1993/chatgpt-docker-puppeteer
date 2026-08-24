// @ts-check
/**
 * Cloudflare edge/rulesets audit tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge
 */

import { auditCloudflareEdgeRulesets } from '#copilot/mcp/public/cloudflare/edge-audit';

import { okResult, readOnlyAnnotations } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition}
 */
export const mcpCloudflareEdgeAuditTool = {
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
    annotations: readOnlyAnnotations(),
    handler: async (input = {}) => {
        /** @type {{ forceRefresh: boolean; cacheTtlMs?: number }} */
        const options = { forceRefresh: input['forceRefresh'] === true };
        if (typeof input['cacheTtlMs'] === 'number') options['cacheTtlMs'] = input['cacheTtlMs'];
        return okResult(await auditCloudflareEdgeRulesets(options));
    },
};
