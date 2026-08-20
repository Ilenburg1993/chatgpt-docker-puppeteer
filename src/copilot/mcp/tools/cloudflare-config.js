// @ts-check
/**
 * Cloudflare MCP config/product posture audit tool.
 *
 * @module copilot/mcp/tools/cloudflare-config
 */

import { z } from 'zod';
import { auditCloudflareConfigPosture } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareConfigAuditTool = {
    name: 'mcp_cloudflare_config_audit',
    title: 'Cloudflare MCP config audit',
    description:
        'Read Cloudflare zone settings and config rules for the MCP hostname, reporting browser/security/product settings that may interfere with OAuth, JSON-RPC or streaming MCP clients.',
    inputSchema: {
        forceRefresh: z.boolean().optional()['describe']('Bypass the short in-process audit cache. Default: false.'),
        cacheTtlMs: z.number().int().min(0).max(60000).optional()['describe']('Override the short cache TTL in milliseconds. Default: 5000.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async (input = {}) => {
        /** @type {{ forceRefresh: boolean; cacheTtlMs?: number }} */
        const options = { forceRefresh: input['forceRefresh'] === true };
        if (typeof input['cacheTtlMs'] === 'number') options['cacheTtlMs'] = input['cacheTtlMs'];
        return okResult(await auditCloudflareConfigPosture(options));
    },
};

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflarePlanCapabilitiesAuditTool = {
    name: 'mcp_cloudflare_plan_capabilities_audit',
    title: 'Cloudflare plan capabilities audit',
    description: 'Read-only Cloudflare plan capabilities audit for MCP edge policy changes.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const modulePath = '../cloudflare/' + 'plan-capabilities-audit.js';
        const mod = await import(modulePath);
        return okResult(await mod.auditCloudflarePlanCapabilities());
    },
};
