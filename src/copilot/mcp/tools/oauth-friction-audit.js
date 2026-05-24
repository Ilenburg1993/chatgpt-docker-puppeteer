// @ts-check
/**
 * OAuth friction audit for the ChatGPT MCP connector.
 *
 * @module copilot/mcp/tools/oauth-friction-audit
 */

import { readOnlyAnnotations } from '../control-plane/annotations.js';
import {
    buildProtectedResourceMetadata,
    readMcpAuthConfig,
    scopesForMcpTool,
    securitySchemesForMcpTool,
} from '../control-plane/auth.js';
import {
    buildBuiltInDevOAuthMetadata,
    isBuiltInDevOAuthEnabled,
    readDevOAuthPersistenceStatus,
    readDevOAuthTokenLifetimePolicy,
} from '../control-plane/dev-oauth.js';
import { okResult } from '../control-plane/result.js';

/** @type {() => import('../registry.js').McpToolDefinition[]} */
let toolsProvider = () => [];

/**
 * @param {() => import('../registry.js').McpToolDefinition[]} provider
 * @returns {void}
 */
export function bindMcpOAuthFrictionAuditProvider(provider) {
    toolsProvider = provider;
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpOAuthFrictionAuditTool = {
    name: 'mcp_oauth_friction_audit',
    title: 'MCP OAuth friction audit',
    description:
        'Diagnose OAuth reauthentication risk, metadata alignment, token lifetime policy, and host approval boundaries for this MCP server.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const config = readMcpAuthConfig();
        const protectedResource = buildProtectedResourceMetadata(config);
        const builtInIssuerEnabled = isBuiltInDevOAuthEnabled(config);
        const issuerMetadata = builtInIssuerEnabled ? buildBuiltInDevOAuthMetadata(config) : null;
        const protectedMethods = asSortedStringArray(protectedResource['token_endpoint_auth_methods_supported']);
        const issuerMethods = asSortedStringArray(issuerMetadata?.['token_endpoint_auth_methods_supported']);
        const issuerGrants = asSortedStringArray(issuerMetadata?.['grant_types_supported']);
        const issuerScopes = asSortedStringArray(issuerMetadata?.['scopes_supported']);
        const lifetime = readDevOAuthTokenLifetimePolicy();
        const persistence = builtInIssuerEnabled ? await readDevOAuthPersistenceStatus() : null;
        const tools = toolsProvider();
        const toolScopes = summarizeToolScopes(tools);
        const warnings = [];
        const critical = [];

        const resourceMatchesAudience = config.resource === config.expectedAudience;
        const issuerMatchesResource = config.expectedIssuer === config.resource;
        if (config.mode === 'oauth' && config.enforcement === 'off') {
            warnings.push('OAuth mode is configured but enforcement is off; this is only appropriate for fallback testing.');
        }
        if (!resourceMatchesAudience) critical.push('Configured OAuth audience differs from protected resource.');
        if (config.mode === 'oauth' && !config.jwksUri) critical.push('OAuth mode is enabled but JWKS URI is missing.');
        if (config.mode === 'oauth' && config.authorizationServers.length === 0) {
            critical.push('Protected resource metadata has no authorization server.');
        }
        if (issuerMetadata && protectedMethods.join('|') !== issuerMethods.join('|')) {
            warnings.push('Protected resource metadata and issuer metadata advertise different token endpoint auth methods.');
        }
        if (issuerMetadata && !issuerGrants.includes('authorization_code')) {
            critical.push('Issuer metadata does not advertise authorization_code.');
        }
        if (issuerMetadata && !issuerGrants.includes('refresh_token')) {
            critical.push('Issuer metadata does not advertise refresh_token.');
        }
        if (issuerMetadata && !asSortedStringArray(issuerMetadata['code_challenge_methods_supported']).includes('S256')) {
            critical.push('Issuer metadata does not advertise PKCE S256.');
        }
        for (const scope of config.initialScopes) {
            if (issuerMetadata && !issuerScopes.includes(scope)) {
                critical.push(`Issuer metadata does not advertise initial scope ${scope}.`);
            }
        }
        if (!issuerMatchesResource) {
            warnings.push('Issuer differs from resource; this is valid for external IdPs but increases configuration risk.');
        }
        if (lifetime.accessTokenTtlSeconds < lifetime.defaults.accessTokenTtlSeconds) {
            warnings.push('Access-token TTL is below the max-autonomy default of 24 hours.');
        }
        if (lifetime.refreshTokenTtlSeconds < lifetime.defaults.refreshTokenTtlSeconds) {
            warnings.push('Refresh-token TTL is below the max-autonomy default of 30 days.');
        }
        if (persistence?.lastPersistenceError) {
            warnings.push(`Refresh-token persistence has a recent error: ${persistence.lastPersistenceError}`);
        }

        return okResult({
            success: true,
            timestamp: new Date().toISOString(),
            oauth: {
                mode: config.mode,
                enforcement: config.enforcement,
                resource: config.resource,
                expectedAudience: config.expectedAudience,
                expectedIssuer: config.expectedIssuer,
                protectedResourceMetadataUrl: config.protectedResourceMetadataUrl,
                authorizationServers: [...config.authorizationServers],
                jwksUriConfigured: Boolean(config.jwksUri),
                initialScopes: [...config.initialScopes],
                publicDiagnostic: true,
            },
            metadataAlignment: {
                resourceMatchesAudience,
                issuerMatchesResource,
                builtInIssuerEnabled,
                protectedResourceTokenEndpointAuthMethods: protectedMethods,
                issuerTokenEndpointAuthMethods: issuerMethods,
                issuerGrantTypes: issuerGrants,
                issuerScopes,
                cimdSupported: issuerMetadata?.['client_id_metadata_document_supported'] === true,
                pkceS256Advertised: asSortedStringArray(issuerMetadata?.['code_challenge_methods_supported']).includes(
                    'S256',
                ),
                protectedResourceAuthorizationServers: asSortedStringArray(
                    protectedResource['authorization_servers'],
                ),
            },
            tokenLifetimePolicy: {
                accessTokenTtlSeconds: lifetime.accessTokenTtlSeconds,
                refreshTokenTtlSeconds: lifetime.refreshTokenTtlSeconds,
                defaults: lifetime.defaults,
                refreshTokenRotation: persistence?.rotation ?? 'external-issuer-or-disabled',
                refreshTokenPersistence: persistence
                    ? {
                          enabled: persistence.persistenceEnabled,
                          refreshTokenFile: persistence.refreshTokenFile,
                          loaded: persistence.loaded,
                          loadedFromFile: persistence.loadedFromFile,
                          tokenCount: persistence.tokenCount,
                          lastLoadedAt: persistence.lastLoadedAt,
                          lastPersistedAt: persistence.lastPersistedAt,
                          lastPersistenceError: persistence.lastPersistenceError,
                          storesOnlyTokenHashes: persistence.storesOnlyTokenHashes,
                          dynamicClientCount: persistence.dynamicClientCount,
                          clientStore: persistence.clientStore,
                      }
                    : null,
                note: 'Longer token lifetimes reduce OAuth reauthentication, but do not disable ChatGPT host tool-call approvals.',
            },
            toolScopes,
            reauthRisk: critical.length > 0 ? 'high' : warnings.length > 0 ? 'medium' : 'low',
            approvalImpact:
                'OAuth grants scoped repository authority to ChatGPT. Host write/destructive confirmations are controlled by ChatGPT host policy and must be reduced through accurate annotations, plan tools, batched writes, and remembered approvals.',
            warnings,
            critical,
            recommendedFixes: buildRecommendedFixes({ warnings, critical }),
        });
    },
};

/**
 * @param {import('../registry.js').McpToolDefinition[]} tools
 * @returns {{
 *     count: number;
 *     readOnlyCount: number;
 *     boundedWriteCount: number;
 *     destructiveCount: number;
 *     adminScopeTools: string[];
 *     validateScopeTools: string[];
 *     publicDiagnosticTools: string[];
 *     maxPowerScopesAdvertisedByDefault: boolean;
 * }}
 */
function summarizeToolScopes(tools) {
    const rows = tools
        .filter((tool) => tool.name !== 'mcp_oauth_friction_audit')
        .map((tool) => {
            const scopes = scopesForMcpTool(tool);
            const securitySchemes = /** @type {{ type?: string; scopes?: string[] }[]} */ (
                securitySchemesForMcpTool(tool)
            );
            return {
                name: tool.name,
                readOnly: tool.annotations.readOnlyHint === true,
                destructive: tool.annotations.destructiveHint === true,
                scopes,
                securitySchemes,
            };
        });
    return {
        count: rows.length,
        readOnlyCount: rows.filter((row) => row.readOnly).length,
        boundedWriteCount: rows.filter((row) => !row.readOnly && !row.destructive).length,
        destructiveCount: rows.filter((row) => row.destructive).length,
        adminScopeTools: rows.filter((row) => row.scopes.includes('repo:admin')).map((row) => row.name).sort(),
        validateScopeTools: rows.filter((row) => row.scopes.includes('repo:validate')).map((row) => row.name).sort(),
        publicDiagnosticTools: ['mcp_oauth_friction_audit'],
        maxPowerScopesAdvertisedByDefault: ['repo:read', 'repo:write', 'repo:validate', 'repo:admin'].every(
            (scope) =>
                rows.some(
                    (row) =>
                        row.scopes.map(String).includes(scope) ||
                        row.securitySchemes.some(
                            (scheme) =>
                                scheme.type === 'oauth2' &&
                                Array.isArray(scheme.scopes) &&
                                scheme.scopes.includes(scope),
                        ),
                ),
        ),
    };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asSortedStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string').map(String).sort() : [];
}

/**
 * @param {{ warnings: string[]; critical: string[] }} input
 * @returns {string[]}
 */
function buildRecommendedFixes(input) {
    if (input.critical.length === 0 && input.warnings.length === 0) {
        return [
            'Keep OAuth metadata stable, refresh-token rotation enabled, and max-power scopes advertised for ChatGPT.',
            'Continue reducing write confirmation count with plan tools, repo_apply_file_batch, and remembered approvals when offered by chatgpt.com.',
        ];
    }
    return [
        'Keep protected resource metadata, issuer metadata, audience, issuer and resource values aligned.',
        'Prefer CIMD with PKCE S256 and a single stable resource URL for the permanent Cloudflare hostname.',
        'Keep authorization_code and refresh_token advertised and test both flows after every OAuth or tunnel change.',
        'Remember that OAuth changes reduce 401/linking friction, not ChatGPT host approval prompts for write/destructive tools.',
    ];
}
