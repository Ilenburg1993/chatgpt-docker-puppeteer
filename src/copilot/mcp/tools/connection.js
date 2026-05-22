// @ts-check
/**
 * ChatGPT connection helper MCP tools.
 *
 * @module copilot/mcp/tools/connection
 */

import { z } from 'zod';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';
import {
    buildChatGptConnectorProfile,
    buildCloudflareTunnelRunbook,
    buildSecureTunnelRunbook,
    validatePublicConnectorUrl,
} from '../connection/profile.js';

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const connectionTools = [
    {
        name: 'chatgpt_connector_profile',
        title: 'ChatGPT connector profile',
        description:
            'Return the canonical ChatGPT connector form values, tunnel checklist, and smoke prompts for this repo MCP server.',
        inputSchema: {
            publicMcpUrl: z
                .string()
                .optional()
                .describe('Optional public HTTPS /mcp URL from Cloudflare Tunnel or Secure MCP Tunnel.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ publicMcpUrl }) => {
            const profile = buildChatGptConnectorProfile({ publicMcpUrl });
            const runbook = buildSecureTunnelRunbook({ publicMcpUrl });
            const cloudflareRunbook = buildCloudflareTunnelRunbook({ publicMcpUrl });
            return okResult({ success: true, profile, runbook, cloudflareRunbook });
        },
    },
    {
        name: 'chatgpt_connector_url_check',
        title: 'Check ChatGPT connector URL',
        description: 'Validate that a candidate ChatGPT connector URL is HTTPS and ends with /mcp.',
        inputSchema: {
            publicMcpUrl: z.string().min(1).describe('Candidate public connector URL.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ publicMcpUrl }) => {
            const validation = validatePublicConnectorUrl(publicMcpUrl);
            return okResult({
                success: validation.ok,
                url: publicMcpUrl,
                validation,
            });
        },
    },
];
