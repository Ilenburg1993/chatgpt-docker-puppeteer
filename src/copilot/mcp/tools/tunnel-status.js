// @ts-check
/**
 * Tunnel status MCP tool for temporary Cloudflare sessions.
 *
 * @module copilot/mcp/tools/tunnel-status
 */

import { readCloudflareTunnelConfig, validateConfiguredPublicUrl } from '../cloudflare/config.js';
import { readQuickTunnelState, summarizeQuickTunnelState } from '../cloudflare/state.js';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpTunnelStatusTool = {
    name: 'mcp_tunnel_status',
    title: 'MCP tunnel status',
    description:
        'Return the current temporary Cloudflare tunnel state, ChatGPT connector URL, age and recovery guidance.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const config = readCloudflareTunnelConfig();
        const state = await readQuickTunnelState(config.stateFile);
        const quickTunnel = summarizeQuickTunnelState(state, Date.now(), config.staleAfterMs);
        return okResult({
            success: true,
            mode: quickTunnel.mode,
            temporaryTunnel: quickTunnel,
            configuredPublicUrl: config.publicMcpUrl ?? null,
            configuredPublicUrlValidation: validateConfiguredPublicUrl(config) ?? null,
            originUrl: config.originUrl,
            localMcpUrl: config.localMcpUrl,
            stateFile: config.stateFile,
            transportProtocol: config.transportProtocol,
            stalePolicy: {
                staleAfterMs: config.staleAfterMs,
                staleAfterMinutes: Math.round(config.staleAfterMs / 60000),
            },
            chatgpt: {
                mcpServerUrl: quickTunnel.connectorUrl ?? config.publicMcpUrl ?? null,
                authentication: 'none-dev',
            },
        });
    },
};
