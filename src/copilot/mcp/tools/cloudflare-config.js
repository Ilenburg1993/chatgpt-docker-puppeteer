// @ts-check
/**
 * Cloudflare MCP config/product posture audit tool.
 *
 * @module copilot/mcp/tools/cloudflare-config
 */

import { auditCloudflareConfigPosture } from '../cloudflare/config-audit.js';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareConfigAuditTool = {
    name: 'mcp_cloudflare_config_audit',
    title: 'Cloudflare MCP config audit',
    description:
        'Read Cloudflare zone settings and config rules for the MCP hostname, reporting browser/security/product settings that may interfere with OAuth, JSON-RPC or streaming MCP clients.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await auditCloudflareConfigPosture()),
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
