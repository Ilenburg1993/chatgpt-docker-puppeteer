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
        const tunnel = summarizeQuickTunnelState(tunnelState, Date.now(), tunnelConfig.staleAfterMs);
        const warnings = [];
        const critical = [];
        if (tunnel.stale) warnings.push('Temporary Cloudflare tunnel is stale; run cloudflare smoke before reuse.');
        if (tunnel.lastSmokeOk === false) critical.push('Last Cloudflare smoke failed.');
        for (const [toolName, metric] of Object.entries(metrics.tools)) {
            const calls = Number(metric.calls ?? 0);
            const errors = Number(metric.errors ?? 0);
            if (calls >= 3 && errors / calls >= 0.5) {
                warnings.push(`High MCP error rate for ${toolName}.`);
            }
        }
        const status = critical.length > 0 ? 'failed' : warnings.length > 0 ? 'degraded' : 'ok';
        return okResult({
            success: true,
            ok: true,
            status,
            warnings,
            critical,
            workspaceRoot: getMcpWorkspaceRoot(),
            metrics,
            tunnel,
        });
    },
};
