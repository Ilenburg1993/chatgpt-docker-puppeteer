// @ts-check
/**
 * Cloudflare MCP passthrough plan/diff tools.
 *
 * @module copilot/mcp/tools/cloudflare-passthrough
 */

import { z } from 'zod';
import {
    applyCloudflareMcpPassthroughPlan,
    buildCloudflareMcpPassthroughPlan,
    diffCloudflareMcpPassthroughPlan,
} from '#copilot/mcp/cloudflare';
import { boundedWriteAnnotations, okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpCloudflareMcpPassthroughPlanTool = {
    name: 'mcp_cloudflare_mcp_passthrough_plan',
    title: 'Cloudflare MCP passthrough plan',
    description:
        'Return the read-only desired http_config_settings rule for MCP/OAuth passthrough without applying Cloudflare changes.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await buildCloudflareMcpPassthroughPlan()),
};

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpCloudflareMcpPassthroughDiffTool = {
    name: 'mcp_cloudflare_mcp_passthrough_diff',
    title: 'Cloudflare MCP passthrough diff',
    description:
        'Compare the desired MCP passthrough http_config_settings rule with current Cloudflare config audit results without applying changes.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await diffCloudflareMcpPassthroughPlan()),
};

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpCloudflareMcpPassthroughApplyTool = {
    name: 'mcp_cloudflare_mcp_passthrough_apply',
    title: 'Cloudflare MCP passthrough apply',
    description:
        'Plan or apply the single scoped MCP passthrough http_config_settings rule. Defaults to dryRun and requires confirmApply=true for real mutation.',
    inputSchema: {
        dryRun: z.boolean().optional().describe('Plan only. Default: true.'),
        confirmApply: z
            .boolean()
            .optional()
            .describe('Required together with dryRun=false to mutate Cloudflare rulesets. Default: false.'),
    },
    annotations: boundedWriteAnnotations(),
    handler: async ({ dryRun, confirmApply }) =>
        okResult(
            await applyCloudflareMcpPassthroughPlan({
                ...(typeof dryRun === 'boolean' ? { dryRun } : {}),
                ...(typeof confirmApply === 'boolean' ? { confirmApply } : {}),
            }),
        ),
};
