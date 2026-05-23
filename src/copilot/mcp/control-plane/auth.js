// @ts-check
import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * MCP auth metadata and scope planning.
 *
 * This module prepares Apps SDK/OAuth metadata for the canonical ChatGPT MCP connector.
 *
 * @module copilot/mcp/control-plane/auth
 */

/**
 * @typedef {'none-dev' | 'mixed-auth' | 'oauth' | 'secure-mcp-tunnel'} McpAuthMode
 *
 * @typedef {'off' | 'read' | 'write' | 'validate' | 'admin' | 'all'} McpAuthEnforcementMode
 *
 * @typedef {'repo:read' | 'repo:write' | 'repo:validate' | 'repo:admin'} McpAuthScope
 *
 * @typedef {object} McpAuthConfig
 * @property {McpAuthMode} mode
 * @property {string} resource
 * @property {string} protectedResourceMetadataUrl
 * @property {string[]} authorizationServers
 * @property {McpAuthScope[]} scopesSupported
 * @property {McpAuthScope[]} initialScopes
 * @property {string} resourceDocumentation
 * @property {McpAuthEnforcementMode} enforcement
 * @property {string} expectedIssuer
 * @property {string} expectedAudience
 * @property {string} jwksUri
 * @property {boolean} staticBearerConfigured
 *
 * @typedef {object} McpAuthContext
 * @property {string | undefined} bearerToken
 * @property {Record<string, string | string[] | undefined>} [headers]
 *
 * @typedef {object} McpAuthorizationDecision
 * @property {boolean} allowed
 * @property {boolean} required
 * @property {McpAuthEnforcementMode} enforcement
 * @property {McpAuthScope[]} requiredScopes
 * @property {string} [method]
 * @property {string} [code]
 * @property {string} [message]
 * @property {string} [hint]
 * @property {string} [challenge]
 */

export const MCP_AUTH_SCOPES = /** @type {const} */ ({
    read: 'repo:read',
    write: 'repo:write',
    validate: 'repo:validate',
    admin: 'repo:admin',
});

/** @type {Map<string, ReturnType<typeof createRemoteJWKSet>>} */
const REMOTE_JWKS_CACHE = new Map();

/**
 * @param {string | undefined} value
 * @param {McpAuthScope[]} fallback
 * @returns {McpAuthScope[]}
 */
function normalizeConfiguredScopes(value, fallback) {
    const allowed = new Set(Object.values(MCP_AUTH_SCOPES));
    const scopes = splitCsv(value).filter((scope) => allowed.has(/** @type {McpAuthScope} */ (scope)));
    return scopes.length > 0 ? /** @type {McpAuthScope[]} */ (scopes) : fallback;
}

/**
 * @param {string | undefined} value
 * @returns {McpAuthMode}
 */
export function normalizeMcpAuthMode(value) {
    const normalized = String(value ?? 'oauth')
        .trim()
        .toLowerCase();
    if (normalized === 'oauth' || normalized === 'team-oauth') return 'oauth';
    if (normalized === 'mixed' || normalized === 'mixed-auth' || normalized === 'dev-mixed-auth') return 'mixed-auth';
    if (normalized === 'secure-mcp-tunnel') return 'secure-mcp-tunnel';
    if (normalized === 'none' || normalized === 'noauth' || normalized === 'none-dev' || normalized === 'dev-noauth') {
        return 'none-dev';
    }
    return 'oauth';
}

/**
 * @param {string | undefined} value
 * @param {McpAuthMode} mode
 * @returns {McpAuthEnforcementMode}
 */
export function normalizeMcpAuthEnforcement(value, mode) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (normalized === 'off' || normalized === 'none' || normalized === 'metadata-only') return 'off';
    if (normalized === 'read' || normalized === 'reads') return 'read';
    if (normalized === 'write' || normalized === 'writes') return 'write';
    if (normalized === 'validate' || normalized === 'validators' || normalized === 'validation') return 'validate';
    if (normalized === 'admin' || normalized === 'destructive') return 'admin';
    if (normalized === 'all' || normalized === 'required' || normalized === 'strict') return 'all';
    return mode === 'oauth' ? 'all' : 'off';
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeResourceUrl(value) {
    const raw = String(value ?? 'https://mcp.aurelin.org')
        .trim()
        .replace(/\/+$/, '');
    return raw.endsWith('/mcp') ? raw.slice(0, -'/mcp'.length) : raw;
}

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function splitCsv(value) {
    return String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpAuthConfig}
 */
export function readMcpAuthConfig(env = process.env) {
    const mode = normalizeMcpAuthMode(env['COPILOT_MCP_AUTH_MODE'] ?? env['COPILOT_MCP_CHATGPT_AUTH_MODE']);
    const resource = normalizeResourceUrl(env['COPILOT_MCP_PUBLIC_URL'] ?? env['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL']);
    const configuredAuthorizationServers = splitCsv(
        env['COPILOT_MCP_OAUTH_AUTHORIZATION_SERVERS'] ?? env['COPILOT_MCP_OAUTH_ISSUER'],
    );
    const authorizationServers =
        configuredAuthorizationServers.length > 0
            ? configuredAuthorizationServers
            : mode === 'oauth' || mode === 'mixed-auth'
              ? [resource]
              : [];
    const expectedIssuer = env['COPILOT_MCP_OAUTH_EXPECTED_ISSUER'] ?? authorizationServers[0] ?? '';
    const expectedAudience = env['COPILOT_MCP_OAUTH_AUDIENCE'] ?? resource;
    const defaultJwksUri = expectedIssuer
        ? expectedIssuer === resource
            ? `${resource}/oauth/jwks.json`
            : `${expectedIssuer}/.well-known/jwks.json`
        : '';
    return {
        mode,
        resource,
        protectedResourceMetadataUrl: `${resource}/.well-known/oauth-protected-resource`,
        authorizationServers,
        scopesSupported: [MCP_AUTH_SCOPES.read, MCP_AUTH_SCOPES.write, MCP_AUTH_SCOPES.validate, MCP_AUTH_SCOPES.admin],
        initialScopes: normalizeConfiguredScopes(env['COPILOT_MCP_OAUTH_INITIAL_SCOPES'], [
            MCP_AUTH_SCOPES.read,
            MCP_AUTH_SCOPES.validate,
        ]),
        resourceDocumentation:
            env['COPILOT_MCP_RESOURCE_DOCUMENTATION'] ?? 'https://developers.openai.com/apps-sdk/build/auth',
        enforcement: normalizeMcpAuthEnforcement(env['COPILOT_MCP_AUTH_ENFORCEMENT'], mode),
        expectedIssuer,
        expectedAudience,
        jwksUri: env['COPILOT_MCP_OAUTH_JWKS_URI'] ?? defaultJwksUri,
        staticBearerConfigured: typeof env['COPILOT_MCP_STATIC_BEARER_TOKEN'] === 'string' && env['COPILOT_MCP_STATIC_BEARER_TOKEN'].length > 0,
    };
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {McpAuthScope[]}
 */
export function scopesForMcpTool(tool) {
    if (tool.name === 'job_cancel' || tool.name === 'repo_remove_file') return [MCP_AUTH_SCOPES.admin];
    if (tool.name.startsWith('run_') || tool.name.includes('validation') || tool.name.includes('validator')) {
        return [MCP_AUTH_SCOPES.validate];
    }
    if (tool.annotations.readOnlyHint === true) return [MCP_AUTH_SCOPES.read];
    return [MCP_AUTH_SCOPES.write];
}

/**
 * @param {McpAuthScope[]} scopes
 * @param {McpAuthEnforcementMode} enforcement
 * @returns {boolean}
 */
function scopesRequireAuth(scopes, enforcement) {
    if (enforcement === 'off') return false;
    if (enforcement === 'all') return true;
    if (enforcement === 'read') return true;
    if (enforcement === 'write') return scopes.some((scope) => scope !== MCP_AUTH_SCOPES.read);
    if (enforcement === 'validate') {
        return scopes.some((scope) => scope === MCP_AUTH_SCOPES.validate || scope === MCP_AUTH_SCOPES.admin);
    }
    if (enforcement === 'admin') return scopes.some((scope) => scope === MCP_AUTH_SCOPES.admin);
    return false;
}

/**
 * @param {string | undefined} header
 * @returns {string | undefined}
 */
export function parseBearerToken(header) {
    const raw = String(header ?? '').trim();
    const match = /^Bearer\s+(.+)$/iu.exec(raw);
    return match?.[1]?.trim() || undefined;
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @param {McpAuthConfig} [config]
 * @returns {({ type: 'noauth' } | { type: 'oauth2'; scopes: string[] })[]}
 */
export function securitySchemesForMcpTool(tool, config = readMcpAuthConfig()) {
    const oauth = { type: /** @type {const} */ ('oauth2'), scopes: scopesForMcpTool(tool) };
    if (config.mode === 'oauth') return [oauth];
    if (config.mode === 'mixed-auth') return [{ type: 'noauth' }, oauth];
    return [{ type: 'noauth' }];
}

/**
 * @param {McpAuthConfig} [config]
 * @returns {Record<string, unknown>}
 */
export function buildProtectedResourceMetadata(config = readMcpAuthConfig()) {
    return {
        resource: config.resource,
        authorization_servers: [...config.authorizationServers],
        scopes_supported: [...config.initialScopes],
        resource_documentation: config.resourceDocumentation,
        token_endpoint_auth_methods_supported: ['none', 'private_key_jwt', 'client_secret_post', 'client_secret_basic'],
    };
}

/**
 * @param {string[]} scopes
 * @param {McpAuthConfig} [config]
 * @param {{ error?: string; errorDescription?: string }} [options]
 * @returns {string}
 */
export function buildWwwAuthenticateChallenge(scopes, config = readMcpAuthConfig(), options = {}) {
    const scopeValue = scopes.filter(Boolean).join(' ');
    const params = [
        ['resource_metadata', config.protectedResourceMetadataUrl],
        ...(options.error ? [['error', options.error]] : []),
        ...(options.errorDescription ? [['error_description', options.errorDescription]] : []),
        ...(scopeValue ? [['scope', scopeValue]] : []),
    ];
    return `Bearer ${params.map(([key, value]) => `${key}="${escapeChallengeValue(String(value ?? ''))}"`).join(', ')}`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeChallengeValue(value) {
    return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeScopeClaim(value) {
    if (typeof value === 'string') return value.split(/\s+/u).map((item) => item.trim()).filter(Boolean);
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).map(String);
    return [];
}

/**
 * @param {string} token
 * @param {McpAuthScope[]} requiredScopes
 * @param {McpAuthConfig} config
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<McpAuthorizationDecision>}
 */
async function verifyBearerToken(token, requiredScopes, config, env) {
    if (env['COPILOT_MCP_STATIC_BEARER_TOKEN'] && token === env['COPILOT_MCP_STATIC_BEARER_TOKEN']) {
        return {
            allowed: true,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            method: 'static-bearer',
        };
    }
    if (!config.jwksUri || !config.expectedIssuer || !config.expectedAudience) {
        return {
            allowed: false,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            code: 'MCP_AUTH_VALIDATOR_NOT_CONFIGURED',
            message: 'OAuth bearer validation is enabled, but issuer, audience or JWKS URI is not configured.',
            hint: 'Set COPILOT_MCP_OAUTH_EXPECTED_ISSUER, COPILOT_MCP_OAUTH_AUDIENCE and COPILOT_MCP_OAUTH_JWKS_URI, or use none-dev for temporary tunnel testing.',
            challenge: buildWwwAuthenticateChallenge(requiredScopes, config, {
                error: 'invalid_token',
                errorDescription: 'OAuth bearer validation is not fully configured.',
            }),
        };
    }
    try {
        let jwks = REMOTE_JWKS_CACHE.get(config.jwksUri);
        if (!jwks) {
            jwks = createRemoteJWKSet(new URL(config.jwksUri));
            REMOTE_JWKS_CACHE.set(config.jwksUri, jwks);
        }
        const verified = await jwtVerify(token, jwks, {
            issuer: config.expectedIssuer,
            audience: config.expectedAudience,
        });
        const tokenScopes = new Set([
            ...normalizeScopeClaim(verified.payload['scope']),
            ...normalizeScopeClaim(verified.payload['scp']),
        ]);
        const missingScopes = requiredScopes.filter((scope) => !tokenScopes.has(scope));
        if (missingScopes.length > 0) {
            return {
                allowed: false,
                required: true,
                enforcement: config.enforcement,
                requiredScopes,
                code: 'MCP_AUTH_SCOPE_MISSING',
                message: `Bearer token is missing required scope(s): ${missingScopes.join(', ')}.`,
                hint: 'Request the connector OAuth flow with the scopes reported by mcp_auth_profile.',
                challenge: buildWwwAuthenticateChallenge(requiredScopes, config, {
                    error: 'insufficient_scope',
                    errorDescription: `Missing required scope(s): ${missingScopes.join(', ')}.`,
                }),
            };
        }
        return {
            allowed: true,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            method: 'oauth-jwks',
        };
    } catch (error) {
        return {
            allowed: false,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            code: 'MCP_AUTH_TOKEN_INVALID',
            message: 'Bearer token could not be verified.',
            hint: error instanceof Error ? error.message : String(error),
            challenge: buildWwwAuthenticateChallenge(requiredScopes, config, {
                error: 'invalid_token',
                errorDescription: 'Bearer token could not be verified.',
            }),
        };
    }
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @param {McpAuthContext} [context]
 * @param {McpAuthConfig} [config]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<McpAuthorizationDecision>}
 */
export async function authorizeMcpToolCall(tool, context = { bearerToken: undefined }, config = readMcpAuthConfig(), env = process.env) {
    const requiredScopes = scopesForMcpTool(tool);
    const required = scopesRequireAuth(requiredScopes, config.enforcement);
    if (!required) {
        return {
            allowed: true,
            required: false,
            enforcement: config.enforcement,
            requiredScopes,
            method: 'not-required',
        };
    }
    if (!context.bearerToken) {
        return {
            allowed: false,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            code: 'MCP_AUTH_REQUIRED',
            message: 'MCP OAuth bearer token is required for this tool.',
            hint: 'Use mcp_auth_profile to inspect the current auth mode and required scopes.',
            challenge: buildWwwAuthenticateChallenge(requiredScopes, config, {
                error: 'invalid_token',
                errorDescription: 'Bearer token is required for this tool.',
            }),
        };
    }
    return verifyBearerToken(context.bearerToken, requiredScopes, config, env);
}
