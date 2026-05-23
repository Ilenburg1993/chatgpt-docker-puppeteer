// @ts-check
/**
 * ChatGPT connection helper MCP tools.
 *
 * @module copilot/mcp/tools/connection
 */

import { z } from 'zod';
import { readCloudflareTunnelConfig, validateConfiguredPublicUrl } from '../cloudflare/config.js';
import { readQuickTunnelState, summarizeQuickTunnelState } from '../cloudflare/state.js';
import {
    buildChatGptConnectorProfile,
    buildCloudflareTunnelRunbook,
    buildSecureTunnelRunbook,
    validatePublicConnectorUrl,
} from '../connection/profile.js';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import {
    buildProtectedResourceMetadata,
    buildWwwAuthenticateChallenge,
    readMcpAuthConfig,
} from '../control-plane/auth.js';
import { okResult } from '../control-plane/result.js';

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
    {
        name: 'chatgpt_connector_current_url_status',
        title: 'Current ChatGPT connector URL status',
        description:
            'Return the currently saved ChatGPT connector URL, validation, tunnel age and recovery guidance without requiring the client to pass a public URL.',
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        handler: async () => {
            const config = readCloudflareTunnelConfig();
            const state = await readQuickTunnelState(config.stateFile);
            const temporaryTunnel = summarizeQuickTunnelState(state, Date.now(), config.staleAfterMs);
            const currentUrl = temporaryTunnel.connectorUrl ?? config.publicMcpUrl ?? null;
            const validation = currentUrl
                ? validatePublicConnectorUrl(currentUrl)
                : (validateConfiguredPublicUrl(config) ?? { ok: false, reason: 'No public MCP URL is configured.' });
            const source = temporaryTunnel.connectorUrl
                ? 'quick-tunnel-state'
                : config.publicMcpUrl
                  ? 'environment'
                  : 'missing';

            return okResult({
                success: validation.ok === true,
                currentUrl,
                source,
                validation,
                chatgptForm: {
                    name: 'LLM-B Workspace MCP',
                    description: 'Repo-scoped MCP connector for src/copilot development in this workspace.',
                    mcpServerUrl: currentUrl,
                    authentication: 'No authentication',
                },
                temporaryTunnel,
                originUrl: config.originUrl,
                localMcpUrl: config.localMcpUrl,
                stateFile: config.stateFile,
                recovery: temporaryTunnel.recovery,
            });
        },
    },
    {
        name: 'mcp_auth_profile',
        title: 'MCP auth profile',
        description:
            'Return the current MCP auth mode, OAuth protected resource metadata, supported scopes and WWW-Authenticate challenge preview.',
        inputSchema: {
            scopes: z
                .array(z.string().min(1))
                .optional()
                .describe('Optional scopes to include in the challenge preview.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ scopes }) => {
            const config = readMcpAuthConfig();
            const challengeScopes =
                Array.isArray(scopes) && scopes.length > 0 ? scopes : ['repo:read', 'repo:write', 'repo:validate'];
            return okResult({
                success: true,
                mode: config.mode,
                protectedResourceMetadata: buildProtectedResourceMetadata(config),
                protectedResourceMetadataUrl: config.protectedResourceMetadataUrl,
                authorizationServersConfigured: config.authorizationServers.length > 0,
                enforcement: config.enforcement,
                expectedIssuerConfigured: Boolean(config.expectedIssuer),
                expectedAudience: config.expectedAudience,
                jwksUriConfigured: Boolean(config.jwksUri),
                staticBearerConfigured: config.staticBearerConfigured,
                challengePreview: buildWwwAuthenticateChallenge(challengeScopes, config),
                nextSteps:
                    config.enforcement === 'off'
                        ? [
                              'Keep ChatGPT connector authentication as No authentication for controlled temporary-tunnel development.',
                              'Set COPILOT_MCP_AUTH_MODE=mixed-auth and COPILOT_MCP_AUTH_ENFORCEMENT=write when testing scoped write auth.',
                          ]
                        : [
                              'Confirm the authorization server publishes OAuth metadata.',
                              'Set COPILOT_MCP_OAUTH_EXPECTED_ISSUER, COPILOT_MCP_OAUTH_AUDIENCE and COPILOT_MCP_OAUTH_JWKS_URI.',
                              'Confirm ChatGPT receives the protected resource metadata URL and returns scoped bearer tokens.',
                          ],
            });
        },
    },
];
