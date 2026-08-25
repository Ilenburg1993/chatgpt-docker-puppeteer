// @ts-check
/**
 * Cloudflare MCP passthrough plan/diff tools.
 *
 * @module copilot/mcp/tools/cloudflare-passthrough
 */

import {
    applyCloudflareMcpPassthroughPlan,
    buildCloudflareMcpPassthroughPlan,
    diffCloudflareMcpPassthroughPlan,
} from '#copilot/mcp/public/cloudflare/posture';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolCloudflareEnvironmentAuthority } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpCloudflareMcpPassthroughPlanTool = defineMcpRawTool({
    name: 'mcp_cloudflare_mcp_passthrough_plan',
    title: 'Cloudflare MCP passthrough plan',
    description:
        'Return the read-only desired http_config_settings rule for MCP/OAuth passthrough without applying Cloudflare changes.',
    inputSchema: {},

    handler: async (_input, operationContext) =>
        okResult(
            await buildCloudflareMcpPassthroughPlan({
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
            }),
        ),
});

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpCloudflareMcpPassthroughDiffTool = defineMcpRawTool({
    name: 'mcp_cloudflare_mcp_passthrough_diff',
    title: 'Cloudflare MCP passthrough diff',
    description:
        'Compare the desired MCP passthrough http_config_settings rule with current Cloudflare config audit results without applying changes.',
    inputSchema: {},

    handler: async (_input, operationContext) =>
        okResult(
            await diffCloudflareMcpPassthroughPlan({
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
            }),
        ),
});

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpCloudflareMcpPassthroughApplyTool = defineMcpRawTool({
    name: 'mcp_cloudflare_mcp_passthrough_apply',
    title: 'Cloudflare MCP passthrough apply',
    description:
        'Plan or apply the single scoped MCP passthrough http_config_settings rule. Defaults to dryRun and requires confirmApply=true for real mutation.',
    inputSchema: {
        dryRun: z.boolean().optional()['describe']('Plan only. Default: true.'),
        confirmApply: z
            .boolean()
            .optional()
            ['describe']('Required together with dryRun=false to mutate Cloudflare rulesets. Default: false.'),
    },

    handler: async ({ dryRun, confirmApply }, operationContext) =>
        okResult(
            await applyCloudflareMcpPassthroughPlan({
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
                ...(typeof dryRun === 'boolean' ? { dryRun } : {}),
                ...(typeof confirmApply === 'boolean' ? { confirmApply } : {}),
            }),
        ),
});
