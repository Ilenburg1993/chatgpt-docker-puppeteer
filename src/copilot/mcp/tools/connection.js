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

const OAUTH_METADATA_PATHS = ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'];

/**
 * @param {string | undefined} value
 * @returns {string | null}
 */
function normalizeIssuerUrl(value) {
    const trimmed = String(value ?? '')
        .trim()
        .replace(/\/+$/u, '');
    if (!trimmed || trimmed.includes('<') || trimmed.includes('>')) return null;
    if (!/^https:\/\//u.test(trimmed)) return null;
    return trimmed;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean; url: string; status?: number; metadata?: Record<string, unknown>; error?: string }>}
 */
async function fetchOAuthMetadata(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: { accept: 'application/json' },
            signal: controller.signal,
        });
        const contentType = response.headers.get('content-type') ?? '';
        const body = contentType.includes('application/json') ? asObject(await response.json()) : null;
        return {
            ok: response.ok && body !== null,
            url,
            status: response.status,
            ...(body ? { metadata: body } : {}),
            ...(!response.ok ? { error: `HTTP ${response.status}` } : {}),
            ...(response.ok && body === null ? { error: 'Response is not a JSON object.' } : {}),
        };
    } catch (error) {
        return {
            ok: false,
            url,
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * @param {Record<string, unknown> | undefined} metadata
 * @param {string[]} requiredScopes
 * @returns {{ ready: boolean; missingFields: string[]; warnings: string[]; summary: Record<string, unknown> }}
 */
function summarizeOAuthMetadata(metadata, requiredScopes) {
    const missingFields = [];
    const warnings = [];
    if (!metadata) {
        return { ready: false, missingFields: ['metadata'], warnings: [], summary: {} };
    }
    for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint']) {
        if (typeof metadata[field] !== 'string' || !String(metadata[field]).trim()) missingFields.push(field);
    }
    const tokenMethods = Array.isArray(metadata['token_endpoint_auth_methods_supported'])
        ? /** @type {unknown[]} */ (metadata['token_endpoint_auth_methods_supported']).filter((item) => typeof item === 'string')
        : [];
    const codeChallengeMethods = Array.isArray(metadata['code_challenge_methods_supported'])
        ? /** @type {unknown[]} */ (metadata['code_challenge_methods_supported']).filter((item) => typeof item === 'string')
        : [];
    const scopesSupported = Array.isArray(metadata['scopes_supported'])
        ? /** @type {unknown[]} */ (metadata['scopes_supported']).filter((item) => typeof item === 'string')
        : [];
    if (tokenMethods.length === 0) warnings.push('token_endpoint_auth_methods_supported is not advertised.');
    if (!codeChallengeMethods.includes('S256')) warnings.push('code_challenge_methods_supported does not advertise S256.');
    if (metadata['client_id_metadata_document_supported'] !== true) {
        warnings.push('client_id_metadata_document_supported is not true; ChatGPT will fall back to DCR.');
    }
    const missingScopes = requiredScopes.filter((scope) => !scopesSupported.includes(scope));
    if (missingScopes.length > 0) warnings.push(`scopes_supported is missing: ${missingScopes.join(', ')}.`);
    return {
        ready: missingFields.length === 0,
        missingFields,
        warnings,
        summary: {
            issuer: metadata['issuer'] ?? null,
            authorizationEndpointConfigured: typeof metadata['authorization_endpoint'] === 'string',
            tokenEndpointConfigured: typeof metadata['token_endpoint'] === 'string',
            userinfoEndpointConfigured: typeof metadata['userinfo_endpoint'] === 'string',
            registrationEndpointConfigured: typeof metadata['registration_endpoint'] === 'string',
            clientIdMetadataDocumentSupported: metadata['client_id_metadata_document_supported'] === true,
            tokenEndpointAuthMethodsSupported: tokenMethods,
            codeChallengeMethodsSupported: codeChallengeMethods,
            oidcScopesSupported: ['openid', 'profile', 'email'].filter((scope) => scopesSupported.includes(scope)),
            scopesSupported,
            missingRequiredScopes: missingScopes,
        },
    };
}

/**
 * @param {Record<string, unknown> | undefined} metadata
 * @param {string} expectedClientId
 * @returns {{ ready: boolean; missingFields: string[]; warnings: string[]; summary: Record<string, unknown> }}
 */
function summarizeClientMetadataDocument(metadata, expectedClientId) {
    /** @type {string[]} */
    const missingFields = [];
    /** @type {string[]} */
    const warnings = [];
    if (!metadata) return { ready: false, missingFields: ['metadata'], warnings, summary: {} };
    if (metadata['client_id'] !== expectedClientId) missingFields.push('client_id');
    if (typeof metadata['client_name'] !== 'string' || !metadata['client_name']) missingFields.push('client_name');
    const redirectUris = Array.isArray(metadata['redirect_uris'])
        ? /** @type {unknown[]} */ (metadata['redirect_uris']).filter((item) => typeof item === 'string')
        : [];
    if (redirectUris.length === 0) missingFields.push('redirect_uris');
    if (redirectUris.some((redirectUri) => !String(redirectUri).startsWith('https://'))) {
        warnings.push('redirect_uris contains a non-HTTPS redirect URI.');
    }
    return {
        ready: missingFields.length === 0,
        missingFields,
        warnings,
        summary: {
            clientId: metadata['client_id'] ?? null,
            clientName: metadata['client_name'] ?? null,
            redirectUris,
            tokenEndpointAuthMethod: metadata['token_endpoint_auth_method'] ?? null,
        },
    };
}

/**
 * @param {ReturnType<typeof readMcpAuthConfig>} config
 * @returns {Record<string, Record<string, string>>}
 */
function buildAuthEnvironmentTemplates(config) {
    const permanentMcpUrl = `${config.resource}/mcp`;
    return {
        permanentTunnelOAuth: {
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            COPILOT_MCP_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
            COPILOT_MCP_OAUTH_ISSUER: config.resource,
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: config.resource,
            COPILOT_MCP_OAUTH_AUDIENCE: config.resource,
            COPILOT_MCP_OAUTH_JWKS_URI: `${config.resource}/oauth/jwks.json`,
            COPILOT_MCP_DEV_OAUTH_ENABLED: 'true',
        },
        permanentTunnelNoAuthFallback: {
            COPILOT_MCP_AUTH_MODE: 'none-dev',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'off',
            COPILOT_MCP_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
        },
        temporaryTunnelNoAuth: {
            COPILOT_MCP_AUTH_MODE: 'none-dev',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'off',
            COPILOT_MCP_PUBLIC_URL: 'https://<trycloudflare-host>/mcp',
            COPILOT_MCP_CLOUDFLARE_MODE: 'temporary-quick',
        },
        mixedAuthWriteTest: {
            COPILOT_MCP_AUTH_MODE: 'mixed-auth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'write',
            COPILOT_MCP_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_STATIC_BEARER_TOKEN: '<local-dev-token-not-committed>',
        },
        oauthJwks: {
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            COPILOT_MCP_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_OAUTH_ISSUER: 'https://<issuer>',
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: 'https://<issuer>',
            COPILOT_MCP_OAUTH_AUDIENCE: config.resource,
            COPILOT_MCP_OAUTH_JWKS_URI: 'https://<issuer>/.well-known/jwks.json',
        },
    };
}

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
            const authConfig = readMcpAuthConfig();
            const state = await readQuickTunnelState(config.stateFile);
            const temporaryTunnel = summarizeQuickTunnelState(state, Date.now(), config.staleAfterMs);
            const currentUrl = config.publicMcpUrl ?? temporaryTunnel.connectorUrl ?? null;
            const validation = currentUrl
                ? validatePublicConnectorUrl(currentUrl)
                : (validateConfiguredPublicUrl(config) ?? { ok: false, reason: 'No public MCP URL is configured.' });
            const source = config.publicMcpUrl
                ? 'permanent-config'
                : temporaryTunnel.connectorUrl
                  ? 'quick-tunnel-state'
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
                    authentication: authConfig.mode === 'oauth' || authConfig.mode === 'mixed-auth' ? 'OAuth' : 'No authentication',
                },
                auth: {
                    mode: authConfig.mode,
                    enforcement: authConfig.enforcement,
                    protectedResourceMetadataUrl: authConfig.protectedResourceMetadataUrl,
                    authorizationServersConfigured: authConfig.authorizationServers.length > 0,
                },
                temporaryTunnel,
                permanentTunnel: {
                    mode: config.mode,
                    tunnelName: config.tunnelName,
                    zone: config.zone,
                    publicHostname: config.publicHostname,
                    tokenPresent: config.hasTunnelToken,
                    tokenFilePresent: config.hasTunnelTokenFile,
                },
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
                environmentTemplates: buildAuthEnvironmentTemplates(config),
                nextSteps:
                    config.enforcement === 'off'
                        ? [
                              'Use OAuth as the default for the permanent Cloudflare endpoint.',
                              'Use No authentication only with COPILOT_MCP_AUTH_MODE=none-dev for controlled fallback testing.',
                          ]
                        : [
                              'Confirm the authorization server publishes OAuth metadata.',
                              'Set COPILOT_MCP_OAUTH_EXPECTED_ISSUER, COPILOT_MCP_OAUTH_AUDIENCE and COPILOT_MCP_OAUTH_JWKS_URI.',
                              'Confirm ChatGPT receives the protected resource metadata URL and returns scoped bearer tokens.',
                          ],
            });
        },
    },
    {
        name: 'mcp_oauth_issuer_diagnostics',
        title: 'MCP OAuth issuer diagnostics',
        description:
            'Check OAuth authorization server well-known metadata readiness for ChatGPT without requiring a fixed domain or exposing secrets.',
        inputSchema: {
            issuer: z
                .string()
                .optional()
                .describe('Optional HTTPS OAuth issuer base URL. Defaults to COPILOT_MCP_OAUTH_EXPECTED_ISSUER or COPILOT_MCP_OAUTH_ISSUER.'),
            timeoutMs: z.number().int().min(500).max(10000).optional().describe('Per-request timeout in milliseconds.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ issuer, timeoutMs }) => {
            const config = readMcpAuthConfig();
            const normalizedIssuer = normalizeIssuerUrl(issuer ?? config.expectedIssuer);
            const effectiveTimeoutMs = typeof timeoutMs === 'number' ? timeoutMs : 3000;
            if (!normalizedIssuer) {
                return okResult({
                    success: true,
                    ready: false,
                    issuer: null,
                    reason: 'No HTTPS OAuth issuer is configured.',
                    requiredForCurrentMode: config.enforcement !== 'off',
                    checkedUrls: [],
                    nextSteps: [
                        'Keep Authentication as No authentication while using temporary Cloudflare tunnel with COPILOT_MCP_AUTH_ENFORCEMENT=off.',
                        'When testing OAuth, set COPILOT_MCP_OAUTH_ISSUER to an HTTPS issuer that publishes OAuth or OIDC metadata.',
                    ],
                });
            }
            const checked = [];
            for (const path of OAUTH_METADATA_PATHS) {
                checked.push(await fetchOAuthMetadata(`${normalizedIssuer}${path}`, effectiveTimeoutMs));
                if (checked[checked.length - 1]?.ok === true) break;
            }
            const firstOk = checked.find((candidate) => candidate.ok);
            const summary = summarizeOAuthMetadata(firstOk?.metadata, config.scopesSupported);
            const clientMetadataUrl =
                firstOk && firstOk.metadata?.['client_id_metadata_document_supported'] === true && normalizedIssuer === config.resource
                    ? `${normalizedIssuer}/.well-known/oauth-client/codex-smoke.json`
                    : null;
            const clientMetadataProbe = clientMetadataUrl
                ? await fetchOAuthMetadata(clientMetadataUrl, effectiveTimeoutMs)
                : null;
            const clientMetadataSummary = clientMetadataProbe
                ? summarizeClientMetadataDocument(clientMetadataProbe.metadata, clientMetadataUrl ?? '')
                : null;
            return okResult({
                success: true,
                ready: Boolean(firstOk && summary.ready && (clientMetadataSummary?.ready ?? true)),
                issuer: normalizedIssuer,
                requiredForCurrentMode: config.enforcement !== 'off',
                checkedUrls: checked.map(({ url, ok, status, error }) => ({ url, ok, status: status ?? null, error: error ?? null })),
                selectedMetadataUrl: firstOk?.url ?? null,
                metadataSummary: summary.summary,
                clientMetadata:
                    clientMetadataProbe && clientMetadataSummary
                        ? {
                              checkedUrl: clientMetadataProbe.url,
                              ok: clientMetadataProbe.ok,
                              status: clientMetadataProbe.status ?? null,
                              error: clientMetadataProbe.error ?? null,
                              summary: clientMetadataSummary.summary,
                              missingFields: clientMetadataSummary.missingFields,
                              warnings: clientMetadataSummary.warnings,
                          }
                        : {
                              checkedUrl: clientMetadataUrl,
                              ok: clientMetadataUrl === null ? null : false,
                              reason:
                                  clientMetadataUrl === null
                                      ? 'Skipped because CIMD is not advertised or issuer differs from the MCP resource.'
                                      : 'Client metadata probe did not run.',
                          },
                missingFields: summary.missingFields,
                warnings: [...summary.warnings, ...(clientMetadataSummary?.warnings ?? [])],
                nextSteps:
                    firstOk && summary.ready && (clientMetadataSummary?.ready ?? true)
                        ? [
                              'Set COPILOT_MCP_OAUTH_JWKS_URI if it differs from the issuer default JWKS URL.',
                              'Run mcp_auth_profile and then test ChatGPT connector with Authentication=OAuth.',
                          ]
                        : [
                              'Publish .well-known/oauth-authorization-server or .well-known/openid-configuration on the issuer.',
                              'Ensure authorization_endpoint, token_endpoint, PKCE S256 and repo scopes are advertised.',
                          ],
            });
        },
    },
];
