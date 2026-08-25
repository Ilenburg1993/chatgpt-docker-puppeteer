// @ts-check
/** Thin MCP exposure for Cloudflare transport benchmark planning. */

import { buildCloudflareTransportBenchmarkPlan } from '#copilot/mcp/public/cloudflare/transport-benchmark';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolCloudflareConfig } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpCloudflareTransportBenchmarkPlanTool = defineMcpRawTool({
    name: 'mcp_cloudflare_transport_benchmark_plan',
    title: 'Cloudflare transport benchmark plan',
    description:
        'Build a read-only plan for a controlled Cloudflare Tunnel transport benchmark across quic, auto and http2 profiles.',
    inputSchema: {
        includeMetricsBaseline: z.boolean().optional()['describe']('Include a current cloudflared metrics baseline.'),
        timeoutMs: z
            .number()
            .int()
            .min(500)
            .max(10000)
            .optional()
            ['describe']('Metrics fetch timeout in milliseconds.'),
    },
    handler: async ({ includeMetricsBaseline, timeoutMs }, operationContext) =>
        okResult(
            await buildCloudflareTransportBenchmarkPlan(
                {
                    ...(includeMetricsBaseline === undefined ? {} : { includeMetricsBaseline }),
                    ...(timeoutMs === undefined ? {} : { timeoutMs }),
                },
                requireMcpToolCloudflareConfig(operationContext),
            ),
        ),
});
