// @ts-check
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';

/**
 * Canonical MCP auth metadata, tool-scope planning and resource-server token verification.
 *
 * This module is intentionally transport-neutral: HTTP adapters decide when to emit HTTP 401 challenges, while the MCP
 * registry uses this module to decide whether each tool call is allowed and which `_meta["mcp/www_authenticate"]`
 * challenge ChatGPT should receive. The implementation is aligned with the MCP Authorization 2025-06-18 profile, RFC
 * 9728 Protected Resource Metadata, OpenAI Apps SDK authentication guidance, and the local built-in dev OAuth issuer.
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
 * @property {string} resourceName
 * @property {string} resourcePolicyUri
 * @property {string} resourceTermsOfServiceUri
 * @property {McpAuthEnforcementMode} enforcement
 * @property {string} expectedIssuer
 * @property {string} expectedAudience
 * @property {string[]} acceptedAudiences
 * @property {string} jwksUri
 * @property {string[]} jwtAlgorithms
 * @property {string[]} bearerMethodsSupported
 * @property {boolean} staticBearerConfigured
 * @property {boolean} staticBearerEnabled
 * @property {boolean} requireResourceClaim
 * @property {boolean} publicOauthDiagnosticsEnabled
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

const DEFAULT_RESOURCE = 'https://mcp.aurelin.org';
const DEFAULT_RESOURCE_NAME = 'Copilot Workspace MCP';
const DEFAULT_RESOURCE_DOCUMENTATION = 'https://developers.openai.com/apps-sdk/build/auth';
const MAX_AUTHORIZATION_SERVERS = 5;
const MAX_AUDIENCES = 12;
const MAX_JWKS_CACHE_ENTRIES = 16;
const MAX_BEARER_TOKEN_LENGTH = 8192;
const MAX_SCOPE_TOKENS = 64;
const MAX_SCOPE_TOKEN_LENGTH = 128;
const MAX_CHALLENGE_TEXT_LENGTH = 240;
const MAX_RESOURCE_NAME_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
const JWKS_TIMEOUT_MS = 5000;
const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const JWKS_COOLDOWN_MS = 30 * 1000;
const DEFAULT_JWT_ALGORITHMS = /** @type {const} */ (['RS256', 'ES256']);
const HEADER_BEARER_METHODS = /** @type {const} */ (['header']);

/** @type {Map<string, ReturnType<typeof createRemoteJWKSet>>} */
const REMOTE_JWKS_CACHE = new Map();

const PUBLIC_OAUTH_DIAGNOSTIC_TOOLS = new Set(['mcp_oauth_friction_audit']);

const ADMIN_TOOL_NAMES = new Set([
    'job_cancel',
    'repo_remove_file',
    'repo_restore_quarantined_file',
    'mcp_cloudflare_edge_policy_apply',
    'mcp_cloudflare_mcp_passthrough_apply',
]);

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function publicOauthDiagnosticsEnabled(env = process.env) {
    return readBooleanEnv(env, 'COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS', false);
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isPublicOauthDiagnosticTool(tool, env = process.env) {
    return publicOauthDiagnosticsEnabled(env) && PUBLIC_OAUTH_DIAGNOSTIC_TOOLS.has(String(tool.name ?? ''));
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
    if (normalized === 'secure-mcp-tunnel' || normalized === 'secure-tunnel') return 'secure-mcp-tunnel';
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
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpAuthConfig}
 */
export function readMcpAuthConfig(env = process.env) {
    const mode = normalizeMcpAuthMode(env['COPILOT_MCP_AUTH_MODE'] ?? env['COPILOT_MCP_CHATGPT_AUTH_MODE']);
    const resource = normalizeResourceBaseUrl(
        env['COPILOT_MCP_PUBLIC_URL'] ?? env['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL'],
    );
    const configuredAuthorizationServers = splitCsv(
        env['COPILOT_MCP_OAUTH_AUTHORIZATION_SERVERS'] ?? env['COPILOT_MCP_OAUTH_ISSUER'],
        MAX_AUTHORIZATION_SERVERS,
    )
        .map((value) => normalizeIssuerUrl(value, '', { allowHttpLocalhost: true }))
        .filter(Boolean);
    const authorizationServers =
        configuredAuthorizationServers.length > 0
            ? uniqueStrings(configuredAuthorizationServers, MAX_AUTHORIZATION_SERVERS)
            : mode === 'oauth' || mode === 'mixed-auth'
              ? [resource]
              : [];
    const rawExpectedIssuer = env['COPILOT_MCP_OAUTH_EXPECTED_ISSUER'] ?? authorizationServers[0] ?? '';
    const expectedIssuer = rawExpectedIssuer
        ? normalizeIssuerUrl(rawExpectedIssuer, authorizationServers[0] ?? '', { allowHttpLocalhost: true })
        : '';
    const expectedAudience = normalizeAudience(env['COPILOT_MCP_OAUTH_AUDIENCE'] ?? resource, resource);
    const defaultJwksUri = expectedIssuer
        ? expectedIssuer === resource
            ? `${resource}/oauth/jwks.json`
            : `${expectedIssuer}/.well-known/jwks.json`
        : '';
    const jwksUri = normalizeMetadataUrl(env['COPILOT_MCP_OAUTH_JWKS_URI'], defaultJwksUri, {
        allowHttpLocalhost: true,
    });
    const staticBearerEnabled = readBooleanEnv(env, 'COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED', true);
    return {
        mode,
        resource,
        protectedResourceMetadataUrl: `${resource}/.well-known/oauth-protected-resource`,
        authorizationServers,
        scopesSupported: [MCP_AUTH_SCOPES.read, MCP_AUTH_SCOPES.write, MCP_AUTH_SCOPES.validate, MCP_AUTH_SCOPES.admin],
        initialScopes: normalizeConfiguredScopes(env['COPILOT_MCP_OAUTH_INITIAL_SCOPES'], [
            MCP_AUTH_SCOPES.read,
            MCP_AUTH_SCOPES.write,
            MCP_AUTH_SCOPES.validate,
            MCP_AUTH_SCOPES.admin,
        ]),
        resourceDocumentation: normalizeMetadataUrl(
            env['COPILOT_MCP_RESOURCE_DOCUMENTATION'],
            DEFAULT_RESOURCE_DOCUMENTATION,
            { allowHttpLocalhost: false },
        ),
        resourceName: normalizeDisplayText(
            env['COPILOT_MCP_RESOURCE_NAME'],
            DEFAULT_RESOURCE_NAME,
            MAX_RESOURCE_NAME_LENGTH,
        ),
        resourcePolicyUri: normalizeOptionalHttpsUrl(env['COPILOT_MCP_RESOURCE_POLICY_URI']),
        resourceTermsOfServiceUri: normalizeOptionalHttpsUrl(env['COPILOT_MCP_RESOURCE_TOS_URI']),
        enforcement: normalizeMcpAuthEnforcement(env['COPILOT_MCP_AUTH_ENFORCEMENT'], mode),
        expectedIssuer,
        expectedAudience,
        acceptedAudiences: buildAcceptedAudiences(expectedAudience, resource, env),
        jwksUri,
        jwtAlgorithms: normalizeJwtAlgorithms(env['COPILOT_MCP_OAUTH_JWT_ALGORITHMS']),
        bearerMethodsSupported: [...HEADER_BEARER_METHODS],
        staticBearerConfigured: readStaticBearerToken(env) !== undefined,
        staticBearerEnabled,
        requireResourceClaim: readBooleanEnv(env, 'COPILOT_MCP_OAUTH_REQUIRE_RESOURCE_CLAIM', false),
        publicOauthDiagnosticsEnabled: publicOauthDiagnosticsEnabled(env),
    };
}

/**
 * @param {string | undefined} value
 * @param {McpAuthScope[]} fallback
 * @returns {McpAuthScope[]}
 */
function normalizeConfiguredScopes(value, fallback) {
    const allowed = new Set(Object.values(MCP_AUTH_SCOPES));
    const scopes = uniqueStrings(splitCsv(value, MAX_SCOPE_TOKENS), MAX_SCOPE_TOKENS).filter((scope) =>
        allowed.has(/** @type {McpAuthScope} */ (scope)),
    );
    return scopes.length > 0 ? /** @type {McpAuthScope[]} */ (scopes) : fallback;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeResourceBaseUrl(value) {
    return normalizeResourceIdentifier(value, DEFAULT_RESOURCE, {
        allowHttpLocalhost: true,
        allowedPaths: ['', '/mcp'],
        stripMcpPath: true,
    });
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {{ allowHttpLocalhost?: boolean; allowedPaths?: string[]; stripMcpPath?: boolean }} [options]
 * @returns {string}
 */
function normalizeResourceIdentifier(value, fallback, options = {}) {
    const raw = String(value ?? fallback).trim() || fallback;
    if (!raw || raw.length > MAX_URL_LENGTH || hasAsciiControlChars(raw)) return fallback;
    try {
        const url = new URL(raw);
        if (url.username || url.password || url.hash || url.search) return fallback;
        if (
            url.protocol !== 'https:' &&
            !(options.allowHttpLocalhost === true && url.protocol === 'http:' && isLoopbackHostname(url.hostname))
        ) {
            return fallback;
        }
        url.pathname = stripTrailingSlashes(url.pathname);
        if (options.stripMcpPath === true && url.pathname === '/mcp') url.pathname = '';
        const pathName = url.pathname === '/' ? '' : url.pathname;
        const allowedPaths = options.allowedPaths ?? [''];
        if (!allowedPaths.includes(pathName)) return fallback;
        url.pathname = pathName;
        return url.toString().replace(/\/+$/u, '');
    } catch {
        return fallback;
    }
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {{ allowHttpLocalhost?: boolean }} [options]
 * @returns {string}
 */
function normalizeIssuerUrl(value, fallback, options = {}) {
    return normalizeResourceIdentifier(value, fallback, {
        allowHttpLocalhost: options.allowHttpLocalhost === true,
        allowedPaths: [''],
    });
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {{ allowHttpLocalhost?: boolean }} [options]
 * @returns {string}
 */
function normalizeMetadataUrl(value, fallback, options = {}) {
    const raw = String(value ?? fallback).trim() || fallback;
    if (!raw || raw.length > MAX_URL_LENGTH || hasAsciiControlChars(raw)) return fallback;
    try {
        const url = new URL(raw);
        if (url.username || url.password || url.hash) return fallback;
        if (
            url.protocol !== 'https:' &&
            !(options.allowHttpLocalhost === true && url.protocol === 'http:' && isLoopbackHostname(url.hostname))
        ) {
            return fallback;
        }
        return url.toString();
    } catch {
        return fallback;
    }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeOptionalHttpsUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return normalizeMetadataUrl(raw, '', { allowHttpLocalhost: false });
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {number} maxLength
 * @returns {string}
 */
function normalizeDisplayText(value, fallback, maxLength) {
    const normalized = replaceAsciiControlChars(String(value ?? ''), ' ')
        .trim()
        .replace(/\s+/gu, ' ');
    return (normalized || fallback).slice(0, maxLength);
}

/**
 * @param {string} pathname
 * @returns {string}
 */
function stripTrailingSlashes(pathname) {
    const stripped = pathname.replace(/\/+$/u, '');
    return stripped || '';
}

/**
 * @param {string | undefined} value
 * @param {number} [maxItems]
 * @returns {string[]}
 */
function splitCsv(value, maxItems = 64) {
    return String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maxItems);
}

/**
 * @param {string[]} values
 * @param {number} [maxItems]
 * @returns {string[]}
 */
function uniqueStrings(values, maxItems = 64) {
    /** @type {string[]} */
    const output = [];
    const seen = new Set();
    for (const value of values) {
        const normalized = String(value).trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(normalized);
        if (output.length >= maxItems) break;
    }
    return output;
}

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function normalizeJwtAlgorithms(value) {
    const allowed = new Set(['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']);
    const configured = splitCsv(value, 8)
        .map((item) => item.toUpperCase())
        .filter((item) => allowed.has(item));
    return configured.length > 0 ? uniqueStrings(configured, 8) : [...DEFAULT_JWT_ALGORITHMS];
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeAudience(value, fallback) {
    const raw = String(value ?? fallback).trim();
    if (!raw || hasAsciiControlChars(raw) || raw.length > 512) return fallback;
    return raw.replace(/\/+$/u, '');
}

/**
 * @param {string} expectedAudience
 * @param {string} resource
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function buildAcceptedAudiences(expectedAudience, resource, env = process.env) {
    const configured = splitCsv(env['COPILOT_MCP_OAUTH_ACCEPTED_AUDIENCES'], MAX_AUDIENCES).map((audience) =>
        normalizeAudience(audience, ''),
    );
    return uniqueStrings([expectedAudience, resource, `${resource}/mcp`, ...configured].filter(Boolean), MAX_AUDIENCES);
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {McpAuthScope[]}
 */
export function scopesForMcpTool(tool) {
    const name = String(tool.name ?? '');
    if (ADMIN_TOOL_NAMES.has(name)) return [MCP_AUTH_SCOPES.admin];
    if (tool.annotations?.destructiveHint === true) return [MCP_AUTH_SCOPES.admin];
    if (
        name.startsWith('mcp_cloudflare_') &&
        (name.includes('_apply') || name.includes('backup_create') || name.includes('policy_apply'))
    ) {
        return [MCP_AUTH_SCOPES.admin];
    }
    if (name.startsWith('run_') || name.includes('validation') || name.includes('validator')) {
        return [MCP_AUTH_SCOPES.validate];
    }
    if (tool.annotations?.readOnlyHint === true) return [MCP_AUTH_SCOPES.read];
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
 * @param {string | string[] | undefined} header
 * @returns {string | undefined}
 */
export function parseBearerToken(header) {
    if (Array.isArray(header)) return undefined;
    const raw = String(header ?? '').trim();
    if (!raw || raw.length > MAX_BEARER_TOKEN_LENGTH || hasAsciiControlChars(raw)) return undefined;
    const match = /^Bearer\s+([^\s,]+)$/iu.exec(raw);
    const token = match?.[1]?.trim();
    if (!token || token.length > MAX_BEARER_TOKEN_LENGTH || hasAsciiControlChars(token)) return undefined;
    return token;
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @param {McpAuthConfig} [config]
 * @returns {({ type: 'noauth' } | { type: 'oauth2'; scopes: string[] })[]}
 */
export function securitySchemesForMcpTool(tool, config = readMcpAuthConfig()) {
    const oauth = { type: /** @type {const} */ ('oauth2'), scopes: scopesForMcpTool(tool) };
    if (config.mode === 'oauth' && isPublicOauthDiagnosticTool(tool)) return [{ type: 'noauth' }, oauth];
    if (config.mode === 'oauth') return [oauth];
    if (config.mode === 'mixed-auth') return [{ type: 'noauth' }, oauth];
    return [{ type: 'noauth' }];
}

/**
 * @param {McpAuthConfig} [config]
 * @param {{ resource?: string }} [options]
 * @returns {Record<string, unknown>}
 */
export function buildProtectedResourceMetadata(config = readMcpAuthConfig(), options = {}) {
    const resource =
        typeof options.resource === 'string'
            ? normalizeResourceIdentifier(options.resource, config.resource, {
                  allowHttpLocalhost: true,
                  allowedPaths: ['', '/mcp'],
              })
            : config.resource;
    return omitEmptyMetadata({
        resource,
        authorization_servers: [...config.authorizationServers],
        scopes_supported: [...config.scopesSupported],
        bearer_methods_supported: [...config.bearerMethodsSupported],
        resource_name: config.resourceName,
        resource_documentation: config.resourceDocumentation,
        ...(config.resourcePolicyUri ? { resource_policy_uri: config.resourcePolicyUri } : {}),
        ...(config.resourceTermsOfServiceUri ? { resource_tos_uri: config.resourceTermsOfServiceUri } : {}),
        // Non-standard compatibility hint retained for existing diagnostics. Authorization server metadata remains the
        // canonical place for this value, but RFC 9728 allows unrecognized metadata parameters to be ignored.
        token_endpoint_auth_methods_supported: ['none'],
    });
}

/**
 * @param {Record<string, unknown>} metadata
 * @returns {Record<string, unknown>}
 */
function omitEmptyMetadata(metadata) {
    /** @type {Record<string, unknown>} */
    const output = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (Array.isArray(value) && value.length === 0) continue;
        if (typeof value === 'string' && !value) continue;
        output[key] = value;
    }
    return output;
}

/**
 * @param {string[]} scopes
 * @param {McpAuthConfig} [config]
 * @param {{ error?: string; errorDescription?: string; resourceMetadataUrl?: string; realm?: string }} [options]
 * @returns {string}
 */
export function buildWwwAuthenticateChallenge(scopes, config = readMcpAuthConfig(), options = {}) {
    const allowed = new Set(config.scopesSupported);
    const scopeValue = uniqueStrings(
        scopes.filter((scope) => allowed.has(/** @type {McpAuthScope} */ (scope))),
        MAX_SCOPE_TOKENS,
    ).join(' ');
    const error = normalizeChallengeToken(options.error);
    const errorDescription = normalizeChallengeText(options.errorDescription);
    const realm = normalizeChallengeText(options.realm ?? config.resource);
    const resourceMetadataUrl = normalizeMetadataUrl(options.resourceMetadataUrl, config.protectedResourceMetadataUrl, {
        allowHttpLocalhost: true,
    });
    const params = [
        ...(realm ? [['realm', realm]] : []),
        ['resource_metadata', resourceMetadataUrl],
        ...(error ? [['error', error]] : []),
        ...(errorDescription ? [['error_description', errorDescription]] : []),
        ...(scopeValue ? [['scope', scopeValue]] : []),
    ];
    return `Bearer ${params.map(([key, value]) => `${key}="${escapeChallengeValue(String(value ?? ''))}"`).join(', ')}`;
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeChallengeToken(value) {
    const normalized = String(value ?? '').trim();
    return /^[a-z_][a-z0-9_.-]{0,63}$/iu.test(normalized) ? normalized : '';
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeChallengeText(value) {
    return replaceAsciiControlChars(String(value ?? ''), ' ')
        .trim()
        .slice(0, MAX_CHALLENGE_TEXT_LENGTH);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function hasAsciiControlChars(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) return true;
    }
    return false;
}

/**
 * @param {string} value
 * @param {string} replacement
 * @returns {string}
 */
function replaceAsciiControlChars(value, replacement) {
    let output = '';
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) {
            if (!output) output = value.slice(0, index);
            output += replacement;
        } else if (output) {
            output += value[index];
        }
    }
    return output || value;
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
    const rawScopes =
        typeof value === 'string'
            ? value.split(/\s+/u)
            : Array.isArray(value)
              ? value.filter((item) => typeof item === 'string')
              : [];
    return uniqueStrings(
        rawScopes
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0 && item.length <= MAX_SCOPE_TOKEN_LENGTH && !hasAsciiControlChars(item)),
        MAX_SCOPE_TOKENS,
    );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeAudienceClaim(value) {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').map(String);
    return [];
}

/**
 * @param {unknown} error
 * @returns {{ code: string; message: string; hint: string; wwwAuthenticateError: string; errorDescription: string }}
 */
function classifyBearerVerificationError(error) {
    const metadata = error && typeof error === 'object' ? /** @type {Record<string, unknown>} */ (error) : {};
    const joseCode = typeof metadata['code'] === 'string' ? metadata['code'] : '';
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    const normalized = `${joseCode} ${name} ${message}`.toLowerCase();
    if (normalized.includes('expired')) {
        return {
            code: 'MCP_AUTH_TOKEN_EXPIRED',
            message: 'Bearer token has expired.',
            hint: message,
            wwwAuthenticateError: 'invalid_token',
            errorDescription: 'Bearer token has expired; reauthorize or use a renewed token.',
        };
    }
    if (normalized.includes('aud') || normalized.includes('audience')) {
        return {
            code: 'MCP_AUTH_AUDIENCE_INVALID',
            message: 'Bearer token audience does not match this MCP resource.',
            hint: message,
            wwwAuthenticateError: 'invalid_token',
            errorDescription: 'Bearer token audience does not match this MCP resource.',
        };
    }
    if (normalized.includes('issuer') || normalized.includes('iss')) {
        return {
            code: 'MCP_AUTH_ISSUER_INVALID',
            message: 'Bearer token issuer does not match the configured OAuth issuer.',
            hint: message,
            wwwAuthenticateError: 'invalid_token',
            errorDescription: 'Bearer token issuer does not match the configured OAuth issuer.',
        };
    }
    if (normalized.includes('algorithm') || normalized.includes('alg')) {
        return {
            code: 'MCP_AUTH_ALGORITHM_INVALID',
            message: 'Bearer token signature algorithm is not allowed.',
            hint: message,
            wwwAuthenticateError: 'invalid_token',
            errorDescription: 'Bearer token signature algorithm is not allowed.',
        };
    }
    if (normalized.includes('jwks') || normalized.includes('jwk') || normalized.includes('key')) {
        return {
            code: 'MCP_AUTH_JWKS_ERROR',
            message: 'Bearer token could not be verified with the configured JWKS.',
            hint: message,
            wwwAuthenticateError: 'invalid_token',
            errorDescription: 'Bearer token could not be verified with the configured JWKS.',
        };
    }
    return {
        code: 'MCP_AUTH_TOKEN_INVALID',
        message: 'Bearer token could not be verified.',
        hint: message,
        wwwAuthenticateError: 'invalid_token',
        errorDescription: 'Bearer token could not be verified.',
    };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
function readStaticBearerToken(env) {
    const value = String(env['COPILOT_MCP_STATIC_BEARER_TOKEN'] ?? '');
    if (!value || value.length > MAX_BEARER_TOKEN_LENGTH || hasAsciiControlChars(value)) return undefined;
    return value;
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function safeEqualString(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * @param {string} jwksUri
 * @returns {ReturnType<typeof createRemoteJWKSet>}
 */
function getRemoteJwks(jwksUri) {
    let jwks = REMOTE_JWKS_CACHE.get(jwksUri);
    if (jwks) return jwks;
    pruneRemoteJwksCache();
    jwks = createRemoteJWKSet(new URL(jwksUri), {
        timeoutDuration: JWKS_TIMEOUT_MS,
        cooldownDuration: JWKS_COOLDOWN_MS,
        cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    });
    REMOTE_JWKS_CACHE.set(jwksUri, jwks);
    return jwks;
}

/**
 * @returns {void}
 */
function pruneRemoteJwksCache() {
    while (REMOTE_JWKS_CACHE.size >= MAX_JWKS_CACHE_ENTRIES) {
        const oldestKey = REMOTE_JWKS_CACHE.keys().next().value;
        if (typeof oldestKey !== 'string') return;
        REMOTE_JWKS_CACHE.delete(oldestKey);
    }
}

/**
 * Clear in-memory auth caches. Intended for focused tests and local diagnostics.
 *
 * @returns {void}
 */
export function resetMcpAuthRuntimeForTests() {
    REMOTE_JWKS_CACHE.clear();
}

/**
 * @param {string} token
 * @param {McpAuthScope[]} requiredScopes
 * @param {McpAuthConfig} config
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<McpAuthorizationDecision>}
 */
async function verifyBearerToken(token, requiredScopes, config, env) {
    if (!token || token.length > MAX_BEARER_TOKEN_LENGTH) {
        return authInvalidTokenDecision(requiredScopes, config, 'Bearer token is malformed or too large.');
    }
    const staticBearerToken = readStaticBearerToken(env);
    if (config.staticBearerEnabled && staticBearerToken && safeEqualString(token, staticBearerToken)) {
        return {
            allowed: true,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            method: 'static-bearer',
        };
    }
    if (
        !config.jwksUri ||
        !config.expectedIssuer ||
        !config.expectedAudience ||
        config.acceptedAudiences.length === 0
    ) {
        return {
            allowed: false,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            code: 'MCP_AUTH_VALIDATOR_NOT_CONFIGURED',
            message: 'OAuth bearer validation is enabled, but issuer, audience or JWKS URI is not configured.',
            hint: 'Set COPILOT_MCP_OAUTH_EXPECTED_ISSUER, COPILOT_MCP_OAUTH_AUDIENCE and COPILOT_MCP_OAUTH_JWKS_URI, or use none-dev only for controlled local fallback testing.',
            challenge: buildWwwAuthenticateChallenge(requiredScopes, config, {
                error: 'invalid_token',
                errorDescription: 'OAuth bearer validation is not fully configured.',
            }),
        };
    }
    try {
        const jwks = getRemoteJwks(config.jwksUri);
        const verified = await jwtVerify(token, jwks, {
            issuer: config.expectedIssuer,
            audience: config.acceptedAudiences,
            algorithms: config.jwtAlgorithms,
        });
        const payload = verified.payload;
        const audienceValues = normalizeAudienceClaim(payload.aud);
        const tokenResource = typeof payload['resource'] === 'string' ? normalizeAudience(payload['resource'], '') : '';
        if (tokenResource && !config.acceptedAudiences.includes(tokenResource)) {
            return authInvalidTokenDecision(
                requiredScopes,
                config,
                'Bearer token resource claim does not match this MCP resource.',
                'MCP_AUTH_RESOURCE_INVALID',
            );
        }
        if (config.requireResourceClaim && !tokenResource) {
            return authInvalidTokenDecision(
                requiredScopes,
                config,
                'Bearer token is missing the required resource claim.',
                'MCP_AUTH_RESOURCE_MISSING',
            );
        }
        if (audienceValues.length === 0) {
            return authInvalidTokenDecision(
                requiredScopes,
                config,
                'Bearer token is missing an audience claim.',
                'MCP_AUTH_AUDIENCE_MISSING',
            );
        }
        const tokenScopes = new Set([...normalizeScopeClaim(payload['scope']), ...normalizeScopeClaim(payload['scp'])]);
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
        const classification = classifyBearerVerificationError(error);
        return {
            allowed: false,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            code: classification.code,
            message: classification.message,
            hint: classification.hint,
            challenge: buildWwwAuthenticateChallenge(requiredScopes, config, {
                error: classification.wwwAuthenticateError,
                errorDescription: classification.errorDescription,
            }),
        };
    }
}

/**
 * @param {McpAuthScope[]} requiredScopes
 * @param {McpAuthConfig} config
 * @param {string} errorDescription
 * @param {string} [code]
 * @returns {McpAuthorizationDecision}
 */
function authInvalidTokenDecision(requiredScopes, config, errorDescription, code = 'MCP_AUTH_TOKEN_INVALID') {
    return {
        allowed: false,
        required: true,
        enforcement: config.enforcement,
        requiredScopes,
        code,
        message: 'Bearer token could not be verified.',
        hint: errorDescription,
        challenge: buildWwwAuthenticateChallenge(requiredScopes, config, {
            error: 'invalid_token',
            errorDescription,
        }),
    };
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/\.$/u, '');
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1';
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanEnv(env, name, fallback) {
    const raw = String(env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @param {McpAuthContext} [context]
 * @param {McpAuthConfig} [config]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<McpAuthorizationDecision>}
 */
export async function authorizeMcpToolCall(
    tool,
    context = { bearerToken: undefined },
    config = readMcpAuthConfig(),
    env = process.env,
) {
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
    if (config.mode === 'oauth' && isPublicOauthDiagnosticTool(tool, env)) {
        return {
            allowed: true,
            required: false,
            enforcement: config.enforcement,
            requiredScopes,
            method: 'public-diagnostic',
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
