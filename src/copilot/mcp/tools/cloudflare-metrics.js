// @ts-check
/** Consolidated local Cloudflare observability/planning read owner. */

import { readCloudflaredMetricsSnapshot } from '#copilot/mcp/public/cloudflare/observability';
import { buildCloudflareTransportBenchmarkPlan } from '#copilot/mcp/public/cloudflare/transport-benchmark';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { errorResult, okResult, requireMcpToolCloudflareConfig } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpCloudflareMetricsSnapshotTool = defineMcpRawTool({
    name: 'mcp_cloudflare_metrics_snapshot',
    title: 'Cloudflare local observability',
    description:
        'Read one local Cloudflare projection: cloudflared Prometheus metrics or the controlled transport benchmark plan and last persisted comparison. Default: metrics.',
    inputSchema: {
        view: z.enum(['metrics', 'transport-plan']).optional()['describe']('Local projection. Default: metrics.'),
        timeoutMs: z
            .number()
            .int()
            .min(500)
            .max(10000)
            .optional()
            ['describe']('Metrics fetch timeout; also used by an optional transport-plan metrics baseline.'),
        includeMetricNames: z
            .boolean()
            .optional()
            ['describe']('view=metrics only: include the full metric-name list. Default: false.'),
        includeMetricsBaseline: z
            .boolean()
            .optional()
            ['describe']('view=transport-plan only: include a current metrics baseline. Default: false.'),
    },

    handler: async ({ view, timeoutMs, includeMetricNames, includeMetricsBaseline }, operationContext) => {
        const projection = view ?? 'metrics';
        if (projection === 'metrics' && includeMetricsBaseline !== undefined) {
            return errorResult('includeMetricsBaseline is valid only with view=transport-plan.', {
                code: 'ERR_CLOUDFLARE_LOCAL_VIEW_FIELDS',
                view: projection,
            });
        }
        if (projection === 'transport-plan' && includeMetricNames !== undefined) {
            return errorResult('includeMetricNames is valid only with view=metrics.', {
                code: 'ERR_CLOUDFLARE_LOCAL_VIEW_FIELDS',
                view: projection,
            });
        }
        const config = requireMcpToolCloudflareConfig(operationContext);
        if (projection === 'transport-plan') {
            return okResult(
                await buildCloudflareTransportBenchmarkPlan(
                    {
                        ...(includeMetricsBaseline === undefined ? {} : { includeMetricsBaseline }),
                        ...(timeoutMs === undefined ? {} : { timeoutMs }),
                    },
                    config,
                ),
            );
        }
        return okResult(
            await readCloudflaredMetricsSnapshot(
                {
                    ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
                    includeMetricNames: includeMetricNames === true,
                },
                config,
            ),
        );
    },
});
