// @ts-check
/**
 * Cloudflare MCP config/product posture audit tool.
 *
 * @module copilot/mcp/tools/cloudflare-config
 */

import { auditCloudflareConfigPosture, auditCloudflarePlanCapabilities } from '#copilot/mcp/public/cloudflare/posture';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';

import { okResult, requireMcpToolCloudflareEnvironmentAuthority } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

export const mcpCloudflareConfigAuditTool = defineMcpRawTool({
    name: 'mcp_cloudflare_config_audit',
    title: 'Cloudflare MCP config audit',
    description:
        'Read Cloudflare zone settings and config rules for the MCP hostname, reporting browser/security/product settings that may interfere with OAuth, JSON-RPC or streaming MCP clients.',
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
        return okResult(await auditCloudflareConfigPosture(options));
    },
});

export const mcpCloudflarePlanCapabilitiesAuditTool = defineMcpRawTool({
    name: 'mcp_cloudflare_plan_capabilities_audit',
    title: 'Cloudflare plan capabilities audit',
    description: 'Read-only Cloudflare plan capabilities audit for MCP edge policy changes.',
    inputSchema: {},

    handler: async (_input, operationContext) =>
        okResult(
            await auditCloudflarePlanCapabilities({
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
            }),
        ),
});
