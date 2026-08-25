// @ts-check
/**
 * Cloudflare local metrics MCP tool.
 *
 * @module copilot/mcp/tools/cloudflare-metrics
 */

import { readCloudflaredMetricsSnapshot } from '#copilot/mcp/public/cloudflare/observability';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolCloudflareConfig } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpCloudflareMetricsSnapshotTool = defineMcpRawTool({
    name: 'mcp_cloudflare_metrics_snapshot',
    title: 'Cloudflare metrics snapshot',
    description:
        'Read the local cloudflared Prometheus metrics endpoint and return a compact operational snapshot for the MCP tunnel.',
    inputSchema: {
        timeoutMs: z.number().int().min(500).max(10000).optional()['describe']('Fetch timeout in milliseconds.'),
        includeMetricNames: z
            .boolean()
            .optional()
            ['describe']('Include the full metric name list. Defaults to false for faster, compact responses.'),
    },

    handler: async (input = {}, operationContext) => {
        const options = /** @type {Record<string, unknown>} */ (input);
        return okResult(
            await readCloudflaredMetricsSnapshot(
                {
                    ...(typeof options['timeoutMs'] === 'number' ? { timeoutMs: options['timeoutMs'] } : {}),
                    includeMetricNames: options['includeMetricNames'] === true,
                },
                requireMcpToolCloudflareConfig(operationContext),
            ),
        );
    },
});
