// @ts-check
/**
 * Cloudflare edge policy apply tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge-apply
 */

import { applyCloudflareEdgePolicy } from '#copilot/mcp/public/cloudflare/edge-apply';

import { boundedWriteAnnotations, okResult } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition}
 */
export const mcpCloudflareEdgePolicyApplyTool = {
    name: 'mcp_cloudflare_edge_policy_apply',
    title: 'Cloudflare edge policy apply',
    description:
        'Plan or apply the canonical Cloudflare edge policy with mandatory backup. Defaults to dryRun and requires confirmApply=true for real mutation.',
    inputSchema: {
        dryRun: z.boolean().optional()['describe']('Plan only. Default: true.'),
        confirmApply: z
            .boolean()
            .optional()
            ['describe']('Required together with dryRun=false to mutate Cloudflare rulesets. Default: false.'),
        phases: z
            .array(z.enum(['http_request_cache_settings', 'http_ratelimit']))
            .optional()
            ['describe']('Optional phases to include. Default: cache settings and rate limiting.'),
        ruleRefs: z
            .array(z.string().min(1))
            .optional()
            ['describe']('Optional rule refs to include. Required for targeted rate-limit apply.'),
    },
    annotations: boundedWriteAnnotations(),
    handler: async ({ dryRun, confirmApply, phases, ruleRefs }) =>
        okResult(
            await applyCloudflareEdgePolicy({
                ...(typeof dryRun === 'boolean' ? { dryRun } : {}),
                ...(typeof confirmApply === 'boolean' ? { confirmApply } : {}),
                ...(Array.isArray(phases) ? { phases } : {}),
                ...(Array.isArray(ruleRefs) ? { ruleRefs } : {}),
            }),
        ),
};
