// @ts-check
/**
 * MCP runtime health and metrics tools.
 *
 * @module copilot/mcp/tools/runtime-health
 */

import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { readCloudflareTunnelConfig } from '../cloudflare/config.js';
import { readQuickTunnelState, summarizeQuickTunnelState } from '../cloudflare/state.js';
import { readMcpMetricsSnapshot } from '../control-plane/metrics.js';
import { getMcpWorkspaceRoot } from '../control-plane/paths.js';
import { okResult } from '../control-plane/result.js';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpRuntimeHealthTool = {
    name: 'mcp_runtime_health',
    title: 'MCP runtime health',
    description: 'Return MCP runtime health, workspace root, uptime and per-tool metrics.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const metrics = readMcpMetricsSnapshot();
        const tunnelConfig = readCloudflareTunnelConfig();
        const tunnelState = await readQuickTunnelState(tunnelConfig.stateFile);
        return okResult({
            success: true,
            ok: true,
            workspaceRoot: getMcpWorkspaceRoot(),
            metrics,
            tunnel: summarizeQuickTunnelState(tunnelState, Date.now(), tunnelConfig.staleAfterMs),
        });
    },
};
