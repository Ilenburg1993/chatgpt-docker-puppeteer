// @ts-check
/**
 * Consolidated fixed-external Cloudflare read surface.
 *
 * Every view dispatches directly to its existing owner. The default overview retains the historical
 * snapshot cost; opt-in views do not run implicitly.
 *
 * @module copilot/mcp/tools/cloudflare-edge-snapshot
 */

import {
    auditCloudflareEdgeRulesets,
    buildCloudflareEdgePolicyPlan,
    buildCloudflareEdgeSnapshot,
    diffCloudflareEdgePolicy,
} from '#copilot/mcp/public/cloudflare/edge';
import {
    auditCloudflareConfigPosture,
    auditCloudflarePlanCapabilities,
    auditCloudflareSkipPosture,
    diffCloudflareMcpPassthroughPlan,
    runCloudflarePostChangeGates,
} from '#copilot/mcp/public/cloudflare/posture';
import { auditCloudflareRemoteTunnel, compactCloudflareRemoteAudit } from '#copilot/mcp/public/cloudflare/remote';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolCloudflareConfig,
    requireMcpToolCloudflareEnvironmentAuthority,
} from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

const CLOUDFLARE_READ_VIEWS = [
    'overview',
    'remote',
    'edge',
    'policy-plan',
    'policy-diff',
    'config',
    'capabilities',
    'skip',
    'passthrough-diff',
    'post-change',
];

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpCloudflareEdgeSnapshotTool = defineMcpRawTool({
    name: 'mcp_cloudflare_edge_snapshot',
    title: 'Cloudflare read snapshot',
    description:
        'Read one fixed-external Cloudflare projection: overview snapshot, compact remote tunnel, edge/config/capability/skip audits, policy/passthrough plans and diffs, or post-change gates.',
    inputSchema: {
        view: z.enum(CLOUDFLARE_READ_VIEWS).optional()['describe']('Cloudflare read projection. Default: overview.'),
        forceRefresh: z
            .boolean()
            .optional()
            ['describe']('view=edge|config only: bypass the short in-process audit cache. Default: false.'),
        cacheTtlMs: z
            .number()
            .int()
            .min(0)
            .max(60000)
            .optional()
            ['describe']('view=edge|config only: override the short cache TTL in milliseconds.'),
        includeDetails: z
            .boolean()
            .optional()
            ['describe']('view=post-change only: include full tunnel, remote audit and metrics objects.'),
    },

    handler: async ({ view, forceRefresh, cacheTtlMs, includeDetails }, operationContext) => {
        const projection = view ?? 'overview';
        const hasCacheFields = forceRefresh !== undefined || cacheTtlMs !== undefined;
        if (hasCacheFields && projection !== 'edge' && projection !== 'config') {
            return errorResult('forceRefresh/cacheTtlMs are valid only with view=edge or view=config.', {
                code: 'ERR_CLOUDFLARE_READ_VIEW_FIELDS',
                view: projection,
            });
        }
        if (includeDetails !== undefined && projection !== 'post-change') {
            return errorResult('includeDetails is valid only with view=post-change.', {
                code: 'ERR_CLOUDFLARE_READ_VIEW_FIELDS',
                view: projection,
            });
        }

        const authority = requireMcpToolCloudflareEnvironmentAuthority(operationContext);
        if (projection === 'remote') {
            return okResult(compactCloudflareRemoteAudit(await auditCloudflareRemoteTunnel({ authority })));
        }
        if (projection === 'edge') {
            return okResult(
                await auditCloudflareEdgeRulesets({
                    authority,
                    forceRefresh: forceRefresh === true,
                    ...(typeof cacheTtlMs === 'number' ? { cacheTtlMs } : {}),
                }),
            );
        }
        if (projection === 'policy-plan') return okResult(await buildCloudflareEdgePolicyPlan({ authority }));
        if (projection === 'policy-diff') return okResult(await diffCloudflareEdgePolicy({ authority }));
        if (projection === 'config') {
            return okResult(
                await auditCloudflareConfigPosture({
                    authority,
                    forceRefresh: forceRefresh === true,
                    ...(typeof cacheTtlMs === 'number' ? { cacheTtlMs } : {}),
                }),
            );
        }
        if (projection === 'capabilities') return okResult(await auditCloudflarePlanCapabilities({ authority }));
        if (projection === 'skip') return okResult(await auditCloudflareSkipPosture({ authority }));
        if (projection === 'passthrough-diff') return okResult(await diffCloudflareMcpPassthroughPlan({ authority }));
        if (projection === 'post-change') {
            return okResult(
                await runCloudflarePostChangeGates(
                    { includeDetails: includeDetails === true },
                    {
                        config: requireMcpToolCloudflareConfig(operationContext),
                        authority,
                    },
                ),
            );
        }
        return okResult(await buildCloudflareEdgeSnapshot({ authority }));
    },
});
