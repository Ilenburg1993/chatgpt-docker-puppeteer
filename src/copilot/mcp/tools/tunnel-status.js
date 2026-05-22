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
        const quickTunnel = summarizeQuickTunnelState(state);
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
            chatgpt: {
                mcpServerUrl: quickTunnel.connectorUrl ?? config.publicMcpUrl ?? null,
                authentication: 'none-dev',
            },
        });
    },
};
