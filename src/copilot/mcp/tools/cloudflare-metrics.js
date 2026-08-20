// @ts-check
/**
 * Cloudflare local metrics MCP tool.
 *
 * @module copilot/mcp/tools/cloudflare-metrics
 */

import { z } from 'zod';
import { readCloudflaredMetricsSnapshot } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareMetricsSnapshotTool = {
    name: 'mcp_cloudflare_metrics_snapshot',
    title: 'Cloudflare metrics snapshot',
    description:
        'Read the local cloudflared Prometheus metrics endpoint and return a compact operational snapshot for the MCP tunnel.',
    inputSchema: {
        timeoutMs: z.number().int().min(500).max(10000).optional()['describe']('Fetch timeout in milliseconds.'),
        includeMetricNames: z.boolean().optional()['describe']('Include the full metric name list. Defaults to false for faster, compact responses.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async (input = {}) => {
        const options = /** @type {Record<string, unknown>} */ (input);
        return okResult(await readCloudflaredMetricsSnapshot({
            ...(typeof options['timeoutMs'] === 'number' ? { timeoutMs: options['timeoutMs'] } : {}),
            includeMetricNames: options['includeMetricNames'] === true,
        }));
    },
};
