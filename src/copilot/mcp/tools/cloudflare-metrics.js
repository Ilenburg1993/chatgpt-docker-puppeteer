// @ts-check
/**
 * Cloudflare local metrics MCP tool.
 *
 * @module copilot/mcp/tools/cloudflare-metrics
 */

import { z } from 'zod';
import { readCloudflaredMetricsSnapshot } from '../cloudflare/metrics.js';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareMetricsSnapshotTool = {
    name: 'mcp_cloudflare_metrics_snapshot',
    title: 'Cloudflare metrics snapshot',
    description:
        'Read the local cloudflared Prometheus metrics endpoint and return a compact operational snapshot for the MCP tunnel.',
    inputSchema: {
        timeoutMs: z.number().int().min(500).max(10000).optional().describe('Fetch timeout in milliseconds.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({ timeoutMs }) => okResult(await readCloudflaredMetricsSnapshot({ timeoutMs })),
};
