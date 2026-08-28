// @ts-check
/** Consolidated guarded Cloudflare mutation owner. */

import { applyCloudflareEdgePolicy } from '#copilot/mcp/public/cloudflare/edge';
import { applyCloudflareMcpPassthroughPlan } from '#copilot/mcp/public/cloudflare/posture';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolCloudflareEnvironmentAuthority,
} from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpCloudflareEdgePolicyApplyTool = defineMcpRawTool({
    name: 'mcp_cloudflare_edge_policy_apply',
    title: 'Cloudflare edge apply',
    description:
        'Plan or apply one guarded Cloudflare mutation target: canonical edge policy or the scoped MCP passthrough config rule. Defaults to edge-policy and dryRun; real mutation requires confirmApply=true and creates a mandatory backup immediately before mutation.',
    inputSchema: {
        target: z.enum(['edge-policy', 'passthrough']).optional()['describe']('Mutation target. Default: edge-policy.'),
        dryRun: z.boolean().optional()['describe']('Plan only. Default: true.'),
        confirmApply: z
            .boolean()
            .optional()
            ['describe']('Required together with dryRun=false to mutate Cloudflare rulesets. Default: false.'),
        phases: z
            .array(z.enum(['http_request_cache_settings', 'http_ratelimit']))
            .optional()
            ['describe'](
                'target=edge-policy only: optional phases to include. Default: cache settings and rate limiting.',
            ),
        ruleRefs: z
            .array(z.string().min(1))
            .optional()
            ['describe']('target=edge-policy only: optional rule refs. Required for targeted rate-limit apply.'),
    },

    handler: async ({ target, dryRun, confirmApply, phases, ruleRefs }, operationContext) => {
        const selectedTarget = target ?? 'edge-policy';
        if (selectedTarget === 'passthrough' && (phases !== undefined || ruleRefs !== undefined)) {
            return errorResult('phases/ruleRefs are valid only with target=edge-policy.', {
                code: 'ERR_CLOUDFLARE_APPLY_TARGET_FIELDS',
                target: selectedTarget,
            });
        }
        const authority = requireMcpToolCloudflareEnvironmentAuthority(operationContext);
        if (selectedTarget === 'passthrough') {
            return okResult(
                await applyCloudflareMcpPassthroughPlan({
                    authority,
                    ...(typeof dryRun === 'boolean' ? { dryRun } : {}),
                    ...(typeof confirmApply === 'boolean' ? { confirmApply } : {}),
                }),
            );
        }
        return okResult(
            await applyCloudflareEdgePolicy({
                authority,
                ...(typeof dryRun === 'boolean' ? { dryRun } : {}),
                ...(typeof confirmApply === 'boolean' ? { confirmApply } : {}),
                ...(Array.isArray(phases) ? { phases } : {}),
                ...(Array.isArray(ruleRefs) ? { ruleRefs } : {}),
            }),
        );
    },
});
