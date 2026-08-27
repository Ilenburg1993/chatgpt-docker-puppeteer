// @ts-check
/** Thin MCP exposure for Cloudflare tunnel status, connector smoke refresh and post-restart readiness. */

import { readCloudflareTunnelStatus } from '#copilot/mcp/public/cloudflare/tunnel';
import {
    formatChatGptConnectorAuthentication,
    readMcpPostRestartReadiness,
    refreshMcpConnectorSmoke,
} from '#copilot/mcp/public/connection';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolAuthConfig,
    requireMcpToolCloudflareConfig,
    requireMcpToolCloudflareEnvironmentAuthority,
    requireMcpToolSurface,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpTunnelStatusTool = defineMcpRawTool({
    name: 'mcp_tunnel_status',
    title: 'MCP tunnel status',
    description:
        'Return the current Cloudflare tunnel mode, permanent connector URL, temporary fallback state and recovery guidance.',
    inputSchema: {},
    handler: async (_input, operationContext) => {
        const status = await readCloudflareTunnelStatus(requireMcpToolCloudflareConfig(operationContext));
        const connectorUrl = status['connectorUrl'] ?? null;
        return okResult({
            ...status,
            chatgpt: {
                mcpServerUrl: connectorUrl,
                preferredMcpServerUrl: connectorUrl,
                authentication: formatChatGptConnectorAuthentication(requireMcpToolAuthConfig(operationContext)),
            },
        });
    },
});

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpConnectorSmokeRefreshTool = defineMcpRawTool({
    name: 'mcp_connector_smoke_refresh',
    title: 'Refresh MCP connector smoke',
    description:
        'Run the canonical Cloudflare/OAuth connector smoke for the permanent MCP URL and persist the compact readiness state.',
    inputSchema: {
        includeRemoteToolNames: z
            .boolean()
            .optional()
            ['describe']('Include the full remote tool-name list in the response. This implies detailed output.'),
        includeDetails: z
            .boolean()
            .optional()
            ['describe'](
                'Include the full smoke report. Default: false; compact decision summary plus post-restart readiness is returned.',
            ),
    },
    handler: async (input, operationContext) => {
        const toolSurface = requireMcpToolSurface(operationContext);
        const outcome = await refreshMcpConnectorSmoke(input, {
            config: requireMcpToolCloudflareConfig(operationContext),
            authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
            localToolNames: toolSurface.names,
            ...(toolSurface.toolDescriptorFingerprints
                ? { localToolFingerprints: toolSurface.toolDescriptorFingerprints }
                : {}),
            workspace: requireMcpToolWorkspace(operationContext),
            authConfig: requireMcpToolAuthConfig(operationContext),
        });
        return outcome.ok ? okResult(outcome.value) : errorResult(outcome.message, outcome.details);
    },
});

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpPostRestartReadinessTool = defineMcpRawTool({
    name: 'mcp_post_restart_readiness',
    title: 'MCP post-restart readiness',
    description:
        'Return a compact post-restart readiness snapshot for the permanent Cloudflare MCP connector before ChatGPT starts heavier work.',
    inputSchema: {},
    handler: async (_args, operationContext) =>
        okResult(
            await readMcpPostRestartReadiness(
                requireMcpToolWorkspace(operationContext),
                requireMcpToolCloudflareConfig(operationContext),
                requireMcpToolAuthConfig(operationContext),
                { includeDiagnostics: true },
            ),
        ),
});
