// @ts-check
/**
 * MCP wire adapters for DevContainer network/DNS posture diagnostics.
 *
 * @module copilot/mcp/tools/devcontainer-network-posture
 */

import {
    auditDevcontainerNetworkPosture,
    refreshDevcontainerNetworkControlPlaneState,
} from '#copilot/mcp/public/diagnostics/devcontainer-network';
import {
    boundedWriteAnnotations,
    errorResult,
    okResult,
    readOnlyAnnotations,
} from '#copilot/mcp/public/protocol/tools';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} */
export const mcpDevcontainerNetworkPostureAuditTool = {
    name: 'mcp_devcontainer_network_posture_audit',
    title: 'DevContainer network posture audit',
    description:
        'Read-only audit of DevContainer DNS/network artifacts relevant to MCP Cloudflare Tunnel latency and reliability.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await auditDevcontainerNetworkPosture()),
};

/** @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} */
export const mcpDevcontainerNetworkControlPlaneRefreshTool = {
    name: 'mcp_devcontainer_network_control_plane_refresh',
    title: 'Refresh DevContainer network state',
    description:
        'Run only the canonical passive network-control-plane summary action with fixed arguments, timeout and output bounds, then return a fresh posture audit. It performs no external network probes and accepts no caller command or path.',
    inputSchema: {},
    annotations: boundedWriteAnnotations(),
    handler: async (_args, operationContext) => {
        const result = await refreshDevcontainerNetworkControlPlaneState({
            ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
        });
        if (result['success'] !== true) {
            return errorResult(
                String(result['error'] ?? 'Passive DevContainer network control-plane refresh failed.'),
                {
                    ...result,
                },
            );
        }
        return okResult(
            result,
            'Refreshed passive DevContainer network control-plane state and returned a fresh posture audit.',
        );
    },
};
