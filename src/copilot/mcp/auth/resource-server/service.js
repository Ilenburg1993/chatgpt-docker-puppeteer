// @ts-check
import { createTtlCache } from '#copilot/infra/public/cache/ttl';
import { calculateJwkThumbprint, createRemoteJWKSet, importJWK, jwtVerify } from 'jose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { OAUTH_REPLAY_NAMESPACES } from '../persistence/replay-store.js';
import {
    getMcpAuthDecisionCacheStats,
    readCachedMcpAuthorizationDecision,
    readMcpAuthDecisionCachePolicy,
    rememberMcpAuthorizationDecision,
    resetMcpAuthDecisionCache,
} from './decision-cache.js';

/**
 * Canonical MCP auth metadata, tool-scope planning and resource-server token verification.
 *
 * This module is intentionally transport-neutral: HTTP adapters decide when to emit HTTP 401 challenges, while the MCP
 * registry uses this module to decide whether each tool call is allowed and which `_meta["mcp/www_authenticate"]`
 * challenge ChatGPT should receive. The implementation is aligned with the MCP Authorization 2025-11-25 profile, RFC
 * 9728 Protected Resource Metadata, OpenAI Apps SDK authentication guidance, and the local built-in dev OAuth issuer.
 *
 * @module copilot/mcp/auth/resource-server
 */

/**
 * @typedef {'none-dev' | 'mixed-auth' | 'oauth' | 'secure-mcp-tunnel'} McpAuthMode
 *
 * @typedef {'off' | 'read' | 'write' | 'validate' | 'admin' | 'all'} McpAuthEnforcementMode
 *
 * @typedef {'repo:read' | 'repo:write' | 'repo:validate' | 'repo:admin'} McpAuthScope
 *
 * @typedef {'max-autonomy' | 'least-privilege' | 'custom'} McpOauthInitialScopeProfile
 *
 * @typedef {object} McpAuthConfig
 * @property {McpAuthMode} mode
 * @property {string} resource
 * @property {string} protectedResourceMetadataUrl
 * @property {string[]} authorizationServers
 * @property {McpAuthScope[]} scopesSupported
 * @property {McpAuthScope[]} initialScopes
 * @property {McpOauthInitialScopeProfile} initialScopeProfile
 * @property {boolean} stepUpPreferred
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
 * @property {string[]} tokenEndpointAuthMethodsSupported
 * @property {string} implementationName
 * @property {string} implementationVersion
 * @property {boolean} staticBearerConfigured
 * @property {boolean} staticBearerEnabled
 * @property {boolean} requireResourceClaim
 * @property {boolean} publicOauthDiagnosticsEnabled
 *
 * @typedef {Readonly<{ staticBearerToken?: string }>} McpAuthRuntimeSecrets
 *
 * @typedef {Readonly<{
 *     config: McpAuthConfig;
 *     secrets: McpAuthRuntimeSecrets;
 *     decisionCache: import('./decision-cache.js').McpAuthDecisionCachePolicy;
 * }>} McpAuthRuntimeConfig
 *
 * @typedef {object} McpAuthContext
 * @property {string | null | undefined} bearerToken
 * @property {Record<string, string | string[] | undefined>} [headers]
 * @property {string} [method]
 * @property {string} [url]
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
 *
 * @typedef {object} McpSessionAuthBinding
 * @property {'oauth' | 'mixed-auth' | 'none-dev' | 'secure-mcp-tunnel' | string} mode
 * @property {string} issuerHash
 * @property {string} subjectHash
 * @property {string} clientIdHash
 * @property {string} resource
 * @property {string} audience
 * @property {string[]} scopes
 *
 * @typedef {{ ok: true; binding: McpSessionAuthBinding; verified: boolean }
 *     | { ok: false; statusCode: number; error: { error: string; error_description: string }; challenge?: string }} McpSessionAuthBindingResolution
 */

export const MCP_AUTH_SCOPES = /** @type {const} */ ({
    read: 'repo:read',
    write: 'repo:write',
    validate: 'repo:validate',
    admin: 'repo:admin',
});

export const MCP_AUTH_IMPLEMENTATION_VERSION = '1.3.0';
export const MCP_AUTH_IMPLEMENTATION_NAME = 'copilot-mcp-auth';

/**
 * ChatGPT Apps SDK and the MCP 2025-11-25 authorization profile both require the resource server to advertise and
 * enforce OAuth in a way that is compatible with CIMD, DCR, PKCE and Resource Indicators. These token-endpoint methods
 * mirror the built-in dev issuer and are also surfaced as a compatibility hint in PRM.
 */
const DEFAULT_TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED = /** @type {const} */ (['none', 'private_key_jwt']);

const DEFAULT_RESOURCE = 'https://mcp.aurelin.org';
const DEFAULT_RESOURCE_NAME = 'Copilot Workspace MCP';
const DEFAULT_RESOURCE_DOCUMENTATION = 'https://mcp.aurelin.org/oauth/status';
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
const JWT_CLOCK_TOLERANCE_SECONDS = 60;
const MAX_TOKEN_AGE_SECONDS = 24 * 60 * 60;
const DEFAULT_JWT_ALGORITHMS = /** @type {const} */ (['RS256', 'ES256']);
const HEADER_BEARER_METHODS = /** @type {const} */ (['header']);
const DPOP_SIGNING_ALGORITHMS = /** @type {const} */ (['ES256', 'RS256']);
const DPOP_MAX_TTL_SECONDS = 5 * 60;
const DPOP_CLOCK_TOLERANCE_SECONDS = 30;
const DPOP_REPLAY_CACHE_MAX_ENTRIES = 2000;
const MAX_DPOP_PROOF_LENGTH = 16 * 1024;
const PUBLIC_OAUTH_DIAGNOSTIC_TOOLS = Object.freeze(['mcp_oauth_friction_audit', 'mcp_oauth_issuer_diagnostics']);

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function publicOauthDiagnosticsEnabled(env = process.env) {
    return readBooleanEnv(env, 'COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS', true);
}

/**
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} tool
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isPublicOauthDiagnosticTool(tool, env = process.env) {
    return isPublicOauthDiagnosticToolEnabled(tool, publicOauthDiagnosticsEnabled(env));
}

/**
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} tool
 * @param {boolean} enabled
 */
function isPublicOauthDiagnosticToolEnabled(tool, enabled) {
    return enabled && PUBLIC_OAUTH_DIAGNOSTIC_TOOLS.includes(String(tool.name ?? ''));
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
    const staticBearerEnabled = readBooleanEnv(env, 'COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED', false);
    const tokenEndpointAuthMethodsSupported = normalizeTokenEndpointAuthMethods(
        env['COPILOT_MCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED'],
    );
    const configuredInitialScopeProfile = normalizeMcpOauthInitialScopeProfile(
        env['COPILOT_MCP_OAUTH_INITIAL_SCOPE_PROFILE'],
    );
    const explicitInitialScopes = readExplicitConfiguredScopes(env['COPILOT_MCP_OAUTH_INITIAL_SCOPES']);
    /** @type {McpOauthInitialScopeProfile} */
    const initialScopeProfile = explicitInitialScopes ? 'custom' : configuredInitialScopeProfile;
    const initialScopes = explicitInitialScopes ?? defaultInitialScopesForProfile(configuredInitialScopeProfile);
    const config = {
        mode,
        resource,
        protectedResourceMetadataUrl: `${resource}/.well-known/oauth-protected-resource`,
        authorizationServers,
        scopesSupported: [MCP_AUTH_SCOPES.read, MCP_AUTH_SCOPES.write, MCP_AUTH_SCOPES.validate, MCP_AUTH_SCOPES.admin],
        initialScopes,
        initialScopeProfile,
        stepUpPreferred: initialScopeProfile === 'least-privilege',
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
        tokenEndpointAuthMethodsSupported,
        implementationName: MCP_AUTH_IMPLEMENTATION_NAME,
        implementationVersion: MCP_AUTH_IMPLEMENTATION_VERSION,
        staticBearerConfigured: readStaticBearerToken(env) !== undefined,
        staticBearerEnabled,
        requireResourceClaim: readBooleanEnv(env, 'COPILOT_MCP_OAUTH_REQUIRE_RESOURCE_CLAIM', true),
        publicOauthDiagnosticsEnabled: publicOauthDiagnosticsEnabled(env),
    };
    return config;
}

/**
 * Capture the auth resource-server projection used by one process generation without retaining the ambient environment.
 * The public/diagnostic config and secret authority are intentionally separate.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpAuthRuntimeConfig}
 */
export function readMcpAuthRuntimeConfig(env = process.env) {
    return Object.freeze({
        config: readMcpAuthConfig(env),
        secrets: readMcpAuthRuntimeSecrets(env),
        decisionCache: readMcpAuthDecisionCachePolicy(env),
    });
}

/** @param {NodeJS.ProcessEnv} env @returns {McpAuthRuntimeSecrets} */
function readMcpAuthRuntimeSecrets(env) {
    const staticBearerToken = readStaticBearerToken(env);
    return Object.freeze(staticBearerToken === undefined ? {} : { staticBearerToken });
}

/** @returns {Record<string, unknown>} */
export function readMcpAuthConfigCacheStats() {
    return { enabled: false, reason: 'process-config-snapshot-is-authoritative', size: 0 };
}

/**
 * @param {string | undefined} value
 * @returns {McpAuthScope[] | null}
 */
function readExplicitConfiguredScopes(value) {
    if (!String(value ?? '').trim()) return null;
    const allowed = new Set(Object.values(MCP_AUTH_SCOPES));
    const scopes = uniqueStrings(splitCsv(value, MAX_SCOPE_TOKENS), MAX_SCOPE_TOKENS).filter((scope) =>
        allowed.has(/** @type {McpAuthScope} */ (scope)),
    );
    return scopes.length > 0 ? /** @type {McpAuthScope[]} */ (scopes) : null;
}

/**
 * @param {unknown} value
 * @returns {Exclude<McpOauthInitialScopeProfile, 'custom'>}
 */
function normalizeMcpOauthInitialScopeProfile(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (['least-privilege', 'least_privilege', 'least', 'minimal'].includes(normalized)) return 'least-privilege';
    // Broad authority is the workspace operational default: it avoids reauthorization round-trips and preserves
    // maximum tool freedom. The older chatgpt-compatibility spelling remains an accepted input alias, but the
    // normalized profile name describes the actual policy rather than one host-specific compatibility posture.
    return 'max-autonomy';
}

/**
 * @param {Exclude<McpOauthInitialScopeProfile, 'custom'>} profile
 * @returns {McpAuthScope[]}
 */
function defaultInitialScopesForProfile(profile) {
    if (profile === 'least-privilege') return [MCP_AUTH_SCOPES.read];
    return [MCP_AUTH_SCOPES.read, MCP_AUTH_SCOPES.write, MCP_AUTH_SCOPES.validate, MCP_AUTH_SCOPES.admin];
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
 * @param {string | undefined} value
 * @returns {string[]}
 */
function normalizeTokenEndpointAuthMethods(value) {
    const allowed = new Set(['none', 'private_key_jwt', 'client_secret_basic', 'client_secret_post']);
    const configured = splitCsv(value, 8)
        .map((item) => item.toLowerCase())
        .filter((item) => allowed.has(item));
    return configured.length > 0 ? uniqueStrings(configured, 8) : [...DEFAULT_TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED];
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
    const base = uniqueStrings(
        [expectedAudience, resource, `${resource}/mcp`, ...configured].filter(Boolean),
        MAX_AUDIENCES,
    );
    const withSlashVariants = [];
    for (const audience of base) {
        withSlashVariants.push(audience);
        if (audience.startsWith('https://') || audience.startsWith('http://')) {
            withSlashVariants.push(audience.replace(/\/+$/u, ''));
            withSlashVariants.push(`${audience.replace(/\/+$/u, '')}/`);
        }
    }
    return uniqueStrings(withSlashVariants.filter(Boolean), MAX_AUDIENCES);
}

/**
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} tool
 * @returns {McpAuthScope[]}
 */
export function scopesForMcpTool(tool) {
    const callerScope = tool.contract?.authority.callerScope;
    if (!callerScope) throw new Error(`MCP tool ${tool.name} has no semantic caller-scope contract.`);
    switch (callerScope) {
        case 'read':
            return [MCP_AUTH_SCOPES.read];
        case 'write':
            return [MCP_AUTH_SCOPES.write];
        case 'validate':
            return [MCP_AUTH_SCOPES.validate];
        case 'admin':
            return [MCP_AUTH_SCOPES.admin];
        default:
            throw new Error(`MCP tool ${tool.name} has unsupported caller scope=${String(callerScope)}.`);
    }
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
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} tool
 * @param {McpAuthConfig} [config]
 * @returns {({ type: 'noauth' } | { type: 'oauth2'; scopes: string[] })[]}
 */
export function securitySchemesForMcpTool(tool, config = readMcpAuthConfig()) {
    const oauth = { type: /** @type {const} */ ('oauth2'), scopes: scopesForMcpTool(tool) };
    if (config.mode === 'oauth' && isPublicOauthDiagnosticToolEnabled(tool, config.publicOauthDiagnosticsEnabled))
        return [{ type: 'noauth' }, oauth];
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
        // Non-standard compatibility hints retained for ChatGPT/MCP diagnostics. Authorization server metadata remains
        // canonical for token endpoint client authentication; RFC 9728 clients ignore unknown metadata safely.
        token_endpoint_auth_methods_supported: [...config.tokenEndpointAuthMethodsSupported],
        mcp_auth_implementation: config.implementationName,
        mcp_auth_implementation_version: config.implementationVersion,
    });
}

/**
 * @param {string} resource
 * @param {McpAuthConfig} [config]
 * @returns {string}
 */
export function protectedResourceMetadataUrlForResource(resource, config = readMcpAuthConfig()) {
    const normalized = normalizeResourceIdentifier(resource, config.resource, {
        allowHttpLocalhost: true,
        allowedPaths: ['', '/mcp'],
    });
    const base = config.protectedResourceMetadataUrl.replace(/\/+$/u, '');
    return normalized.endsWith('/mcp') ? `${base}/mcp` : base;
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
    const defaultResourceMetadataUrl = protectedResourceMetadataUrlForResource(
        options.realm ?? config.expectedAudience,
        config,
    );
    const resourceMetadataUrl = normalizeMetadataUrl(options.resourceMetadataUrl, defaultResourceMetadataUrl, {
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
 * Build a redacted MCP HTTP session binding from a JWT payload that has already passed signature, issuer,
 * audience/resource and DPoP validation. This helper deliberately stores hashes for actor identifiers and preserves
 * only non-secret resource/audience/scope metadata.
 *
 * @param {import('jose').JWTPayload} payload
 * @param {{ config?: McpAuthConfig; tokenResource?: string; resourceUrl?: string }} [options]
 * @returns {McpSessionAuthBinding}
 */
export function buildMcpSessionAuthBindingFromVerifiedJwtPayload(payload, options = {}) {
    const config = options.config ?? readMcpAuthConfig();
    const audienceValues = normalizeAudienceClaim(payload.aud);
    const audience =
        audienceValues.find((value) => audienceMatchesAnyAccepted(value, config.acceptedAudiences)) ??
        config.expectedAudience ??
        '';
    const tokenResource =
        typeof payload['resource'] === 'string'
            ? normalizeAudience(payload['resource'], '')
            : (options.tokenResource ?? '');
    const clientId = firstStringClaim(payload, ['client_id', 'azp', 'cid']);
    const subject =
        firstStringClaim(payload, ['sub', 'uid', 'user_id']) || clientId || firstStringClaim(payload, ['jti']);
    const scopes = uniqueStrings(
        [...normalizeScopeClaim(payload['scope']), ...normalizeScopeClaim(payload['scp'])]
            .filter((scope) => config.scopesSupported.includes(/** @type {McpAuthScope} */ (scope)))
            .sort(),
        MAX_SCOPE_TOKENS,
    );
    return {
        mode: 'oauth',
        issuerHash: hashSessionAuthComponent(firstStringClaim(payload, ['iss'])),
        subjectHash: hashSessionAuthComponent(subject),
        clientIdHash: hashSessionAuthComponent(clientId),
        resource:
            tokenResource || normalizeAudience(options.resourceUrl, '') || config.expectedAudience || config.resource,
        audience: normalizeAudience(audience, config.expectedAudience || config.resource),
        scopes,
    };
}

/**
 * Resolve a per-request MCP HTTP session binding. OAuth/JWT bearer tokens are verified before claims become part of the
 * binding; static bearer fallback is represented only as a token hash and should remain an operational fallback, not
 * the preferred production path.
 *
 * @param {McpAuthContext} context
 * @param {string} resourceUrl
 * @param {McpAuthConfig} [config]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {McpAuthRuntimeSecrets} [runtimeSecrets]
 * @param {McpAuthResourceServerState} [runtime]
 * @returns {Promise<McpSessionAuthBindingResolution>}
 */
export async function resolveMcpSessionAuthBinding(
    context,
    resourceUrl,
    config = readMcpAuthConfig(),
    env = process.env,
    runtimeSecrets = readMcpAuthRuntimeSecrets(env),
    runtime = createEphemeralMcpAuthResourceServerState(),
) {
    const bearerToken = context.bearerToken;
    if (!bearerToken) {
        if (config.mode === 'oauth' && config.enforcement !== 'off') {
            return {
                ok: false,
                statusCode: 401,
                error: {
                    error: 'invalid_token',
                    error_description: 'Bearer token is required before creating or reusing an MCP session.',
                },
                challenge: buildWwwAuthenticateChallenge(config.initialScopes, config, {
                    error: 'invalid_token',
                    errorDescription: 'Bearer token is required before creating or reusing an MCP session.',
                    realm: resourceUrl,
                }),
            };
        }
        return {
            ok: true,
            verified: false,
            binding: {
                mode: 'none-dev',
                issuerHash: '',
                subjectHash: '',
                clientIdHash: '',
                resource: normalizeAudience(resourceUrl, config.resource),
                audience: config.expectedAudience || config.resource,
                scopes: [],
            },
        };
    }

    const staticBearerToken = runtimeSecrets.staticBearerToken;
    if (config.staticBearerEnabled && staticBearerToken && safeEqualString(bearerToken, staticBearerToken)) {
        return {
            ok: true,
            verified: true,
            binding: {
                mode: 'secure-mcp-tunnel',
                issuerHash: hashSessionAuthComponent(config.expectedIssuer || config.resource),
                subjectHash: hashSessionAuthComponent(bearerToken),
                clientIdHash: '',
                resource: normalizeAudience(resourceUrl, config.resource),
                audience: config.expectedAudience || config.resource,
                scopes: [...config.scopesSupported].sort(),
            },
        };
    }

    if (
        !config.jwksUri ||
        !config.expectedIssuer ||
        !config.expectedAudience ||
        config.acceptedAudiences.length === 0
    ) {
        return {
            ok: false,
            statusCode: 401,
            error: {
                error: 'invalid_token',
                error_description: 'OAuth bearer validation is not fully configured for MCP session binding.',
            },
            challenge: buildWwwAuthenticateChallenge(config.initialScopes, config, {
                error: 'invalid_token',
                errorDescription: 'OAuth bearer validation is not fully configured.',
                realm: resourceUrl,
            }),
        };
    }

    try {
        const jwks = getRemoteJwks(runtime, config.jwksUri);
        const verified = await jwtVerify(bearerToken, jwks, {
            issuer: config.expectedIssuer,
            audience: config.acceptedAudiences,
            algorithms: config.jwtAlgorithms,
            clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
            maxTokenAge: `${MAX_TOKEN_AGE_SECONDS}s`,
        });
        const payload = verified.payload;
        const dpopDecision = await validateDpopConfirmationForResource(runtime, payload, context, [], config);
        if (dpopDecision) {
            return {
                ok: false,
                statusCode: 401,
                error: {
                    error: 'invalid_token',
                    error_description:
                        dpopDecision.hint ?? dpopDecision.message ?? 'DPoP-bound token validation failed.',
                },
                ...(dpopDecision.challenge ? { challenge: dpopDecision.challenge } : {}),
            };
        }
        const audienceValues = normalizeAudienceClaim(payload.aud);
        const tokenResource = typeof payload['resource'] === 'string' ? normalizeAudience(payload['resource'], '') : '';
        if (tokenResource && !audienceMatchesAnyAccepted(tokenResource, config.acceptedAudiences)) {
            return sessionBindingInvalidToken(
                config,
                resourceUrl,
                'Bearer token resource claim does not match this MCP resource.',
            );
        }
        if (config.requireResourceClaim && !tokenResource) {
            return sessionBindingInvalidToken(
                config,
                resourceUrl,
                'Bearer token is missing the required resource claim.',
            );
        }
        if (audienceValues.length === 0) {
            return sessionBindingInvalidToken(config, resourceUrl, 'Bearer token is missing an audience claim.');
        }
        return {
            ok: true,
            verified: true,
            binding: buildMcpSessionAuthBindingFromVerifiedJwtPayload(payload, { config, tokenResource, resourceUrl }),
        };
    } catch (error) {
        const classification = classifyBearerVerificationError(error);
        return {
            ok: false,
            statusCode: 401,
            error: {
                error: classification.wwwAuthenticateError,
                error_description: classification.errorDescription,
            },
            challenge: buildWwwAuthenticateChallenge(config.initialScopes, config, {
                error: classification.wwwAuthenticateError,
                errorDescription: classification.errorDescription,
                realm: resourceUrl,
            }),
        };
    }
}

/**
 * @param {McpAuthConfig} config
 * @param {string} resourceUrl
 * @param {string} errorDescription
 * @returns {McpSessionAuthBindingResolution}
 */
function sessionBindingInvalidToken(config, resourceUrl, errorDescription) {
    return {
        ok: false,
        statusCode: 401,
        error: { error: 'invalid_token', error_description: errorDescription },
        challenge: buildWwwAuthenticateChallenge(config.initialScopes, config, {
            error: 'invalid_token',
            errorDescription,
            realm: resourceUrl,
        }),
    };
}

/**
 * @param {import('jose').JWTPayload} payload
 * @param {string[]} names
 * @returns {string}
 */
function firstStringClaim(payload, names) {
    for (const name of names) {
        const value = payload[name];
        if (typeof value === 'string' && value.trim() && !hasAsciiControlChars(value)) return value.trim();
    }
    return '';
}

/**
 * @param {string} value
 * @returns {string}
 */
function hashSessionAuthComponent(value) {
    const normalized = String(value ?? '').trim();
    return normalized ? createHash('sha256').update(normalized).digest('hex') : '';
}

/**
 * @param {string} value
 * @param {string[]} accepted
 * @returns {boolean}
 */
function audienceMatchesAnyAccepted(value, accepted) {
    const normalized = normalizeAudience(value, '');
    if (!normalized) return false;
    const variants = new Set([normalized, normalized.replace(/\/+$/u, ''), `${normalized.replace(/\/+$/u, '')}/`]);
    return accepted.some((audience) => variants.has(audience) || variants.has(audience.replace(/\/+$/u, '')));
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
    if (normalized.includes('max token age') || normalized.includes('iat')) {
        return {
            code: 'MCP_AUTH_TOKEN_TOO_OLD',
            message: 'Bearer token is too old or has an invalid issued-at time.',
            hint: message,
            wwwAuthenticateError: 'invalid_token',
            errorDescription: 'Bearer token is too old or has an invalid issued-at time; reauthorize.',
        };
    }
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
 * @typedef {Readonly<{
 *   remoteJwksCache: import('#copilot/infra/public/cache/ttl').TtlCache<ReturnType<typeof createRemoteJWKSet>>;
 *   dpopReplayCache: Map<string, number>;
 *   replay: Pick<ReturnType<typeof import('../persistence/replay-store.js').createOAuthReplayCapability>, 'remember' | 'status'>;
 * }>} McpAuthResourceServerState
 */

/**
 * @param {Pick<ReturnType<typeof import('../persistence/replay-store.js').createOAuthReplayCapability>, 'remember' | 'status'>} replay
 */
export function createMcpAuthResourceServerRuntime(replay) {
    if (!replay || typeof replay.remember !== 'function' || typeof replay.status !== 'function') {
        throw new TypeError('MCP auth resource-server runtime requires an OAuth replay capability.');
    }
    /** @type {McpAuthResourceServerState} */
    const state = Object.freeze({
        remoteJwksCache: createTtlCache({
            name: `oauth-remote-jwks-${Math.random().toString(36).slice(2, 10)}`,
            ttlMs: JWKS_CACHE_MAX_AGE_MS,
            maxEntries: MAX_JWKS_CACHE_ENTRIES,
        }),
        dpopReplayCache: new Map(),
        replay,
    });
    return Object.freeze({
        authorize: (
            /** @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} */ tool,
            /** @type {McpAuthContext | undefined} */ context,
            /** @type {McpAuthConfig} */ config,
            /** @type {McpAuthRuntimeSecrets} */ secrets,
            /** @type {import('./decision-cache.js').McpAuthDecisionCachePolicy} */ decisionCache,
        ) => authorizeMcpToolCall(tool, context, config, {}, secrets, decisionCache, state),
        resolveSessionBinding: (
            /** @type {McpAuthContext} */ context,
            /** @type {string} */ resourceUrl,
            /** @type {McpAuthConfig} */ config,
            /** @type {McpAuthRuntimeSecrets} */ secrets,
        ) => resolveMcpSessionAuthBinding(context, resourceUrl, config, {}, secrets, state),
        warmRemoteJwks: (/** @type {{ env?: NodeJS.ProcessEnv; config?: McpAuthConfig }} */ options = {}) =>
            warmMcpRemoteJwks({ ...options, runtime: state }),
        resetForTests() {
            state.remoteJwksCache.clear();
            state.dpopReplayCache.clear();
            resetMcpAuthDecisionCache();
        },
        readState: () => ({
            remoteJwks: state.remoteJwksCache.stats(),
            dpopReplayEntries: state.dpopReplayCache.size,
            replay: state.replay.status(),
        }),
    });
}

function createUnavailableReplayCapability() {
    return Object.freeze({
        remember: () => ({
            replay: false,
            stored: false,
            available: false,
            pruned: 0,
            evicted: 0,
            error: 'OAuth replay capability unavailable.',
        }),
        status: () => ({
            available: false,
            entries: null,
            maxEntriesPerNamespace: 0,
            error: 'OAuth replay capability unavailable.',
        }),
    });
}

/** @returns {McpAuthResourceServerState} */
function createEphemeralMcpAuthResourceServerState() {
    return Object.freeze({
        remoteJwksCache: createTtlCache({
            name: `oauth-remote-jwks-ephemeral-${Math.random().toString(36).slice(2, 10)}`,
            ttlMs: JWKS_CACHE_MAX_AGE_MS,
            maxEntries: MAX_JWKS_CACHE_ENTRIES,
        }),
        dpopReplayCache: new Map(),
        replay: createUnavailableReplayCapability(),
    });
}

/**
 * @param {McpAuthResourceServerState} runtime
 * @param {string} jwksUri
 * @returns {ReturnType<typeof createRemoteJWKSet>}
 */
function getRemoteJwks(runtime, jwksUri) {
    const cached = runtime.remoteJwksCache.get(jwksUri);
    if (cached) return cached;
    return runtime.remoteJwksCache.set(
        jwksUri,
        createRemoteJWKSet(new URL(jwksUri), {
            timeoutDuration: JWKS_TIMEOUT_MS,
            cooldownDuration: JWKS_COOLDOWN_MS,
            cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
        }),
    );
}

/**
 * Preloads the configured remote JWKS without requiring a bearer token.
 *
 * `jose` de-duplicates concurrent reloads internally, while `REMOTE_JWKS_CACHE` keeps a single resolver per URI for
 * subsequent authorization calls.
 *
 * @param {{ env?: NodeJS.ProcessEnv; config?: McpAuthConfig; runtime?: McpAuthResourceServerState }} [options]
 * @returns {Promise<{
 *     ok: true;
 *     skipped: boolean;
 *     reason: string | null;
 *     jwksUri: string | null;
 *     source: 'disabled' | 'cache' | 'remote';
 *     keyCount: number | null;
 *     durationMs: number;
 * }>}
 */
export async function warmMcpRemoteJwks(options = {}) {
    const startedAt = performance.now();
    const runtime = options.runtime ?? createEphemeralMcpAuthResourceServerState();
    const config = options.config ?? readMcpAuthConfig(options.env);
    if (config.mode === 'none-dev' || config.enforcement === 'off') {
        return {
            ok: true,
            skipped: true,
            reason: 'auth-not-enforced',
            jwksUri: config.jwksUri || null,
            source: 'disabled',
            keyCount: null,
            durationMs: Math.round(performance.now() - startedAt),
        };
    }
    if (!config.jwksUri) {
        return {
            ok: true,
            skipped: true,
            reason: 'jwks-uri-not-configured',
            jwksUri: null,
            source: 'disabled',
            keyCount: null,
            durationMs: Math.round(performance.now() - startedAt),
        };
    }

    const jwks = getRemoteJwks(runtime, config.jwksUri);
    const alreadyFresh = jwks.fresh;
    if (!alreadyFresh) await jwks.reload();
    const keyCount = jwks.jwks()?.keys.length ?? null;
    return {
        ok: true,
        skipped: false,
        reason: null,
        jwksUri: config.jwksUri,
        source: alreadyFresh ? 'cache' : 'remote',
        keyCount,
        durationMs: Math.round(performance.now() - startedAt),
    };
}

/**
 * Clear in-memory auth caches. Intended for focused tests and local diagnostics.
 *
 * @returns {void}
 */
export function resetMcpAuthRuntimeForTests() {
    resetMcpAuthDecisionCache();
}

/**
 * @returns {Record<string, unknown>}
 */
export function readMcpAuthDecisionCacheStats() {
    return getMcpAuthDecisionCacheStats();
}

/**
 * @param {McpAuthResourceServerState} runtime
 * @param {import('jose').JWTPayload} payload
 * @param {McpAuthContext} context
 * @param {McpAuthScope[]} requiredScopes
 * @param {McpAuthConfig} config
 * @returns {Promise<McpAuthorizationDecision | undefined>}
 */
async function validateDpopConfirmationForResource(runtime, payload, context, requiredScopes, config) {
    const cnf = payload['cnf'];
    const expectedJkt =
        cnf && typeof cnf === 'object' && !Array.isArray(cnf)
            ? String(/** @type {Record<string, unknown>} */ (cnf)['jkt'] ?? '')
            : '';
    if (!expectedJkt) return undefined;
    const proof = firstAuthContextHeader(context.headers, 'dpop');
    if (!proof) {
        return authInvalidTokenDecision(
            requiredScopes,
            config,
            'DPoP-bound access token requires a DPoP proof.',
            'MCP_AUTH_DPOP_REQUIRED',
        );
    }
    const verified = await verifyResourceDpopProof(runtime, proof, expectedJkt, context);
    if (verified.ok) return undefined;
    return authInvalidTokenDecision(requiredScopes, config, verified.error, 'MCP_AUTH_DPOP_INVALID');
}

/**
 * @param {McpAuthResourceServerState} runtime
 * @param {string | undefined} proof
 * @param {string} expectedJkt
 * @param {McpAuthContext} context
 * @returns {Promise<{ ok: true } | { ok: false; error: string }>}
 */
async function verifyResourceDpopProof(runtime, proof, expectedJkt, context) {
    if (!proof || proof.length > MAX_DPOP_PROOF_LENGTH || hasAsciiControlChars(proof)) {
        return { ok: false, error: 'DPoP proof is missing or too large.' };
    }
    try {
        const header = decodeJwtHeader(proof);
        const jwk = header['jwk'];
        const alg = String(header['alg'] ?? '');
        if (!DPOP_SIGNING_ALGORITHMS.includes(/** @type {'ES256' | 'RS256'} */ (alg))) {
            return { ok: false, error: 'DPoP proof uses an unsupported signing algorithm.' };
        }
        if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
            return { ok: false, error: 'DPoP proof is missing an embedded public JWK.' };
        }
        if (hasPrivateJwkFields(/** @type {Record<string, unknown>} */ (jwk))) {
            return { ok: false, error: 'DPoP proof JWK must be public.' };
        }
        const publicJwk = /** @type {Record<string, unknown>} */ ({ ...jwk });
        for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) delete publicJwk[privateField];
        const jkt = await calculateJwkThumbprint(publicJwk);
        if (jkt !== expectedJkt)
            return { ok: false, error: 'DPoP proof key thumbprint does not match the access token cnf claim.' };
        const key = await importJWK(publicJwk, alg);
        const verified = await jwtVerify(proof, key, {
            algorithms: [...DPOP_SIGNING_ALGORITHMS],
            clockTolerance: DPOP_CLOCK_TOLERANCE_SECONDS,
            maxTokenAge: `${DPOP_MAX_TTL_SECONDS}s`,
        });
        const method = String(context.method ?? '').toUpperCase();
        const url = normalizeDpopHtu(String(context.url ?? ''));
        const htm = String(verified.payload['htm'] ?? '').toUpperCase();
        const htu = normalizeDpopHtu(String(verified.payload['htu'] ?? ''));
        const jti = typeof verified.payload.jti === 'string' ? verified.payload.jti : '';
        if (!method || !url) return { ok: false, error: 'Resource request method/url context is required for DPoP.' };
        if (htm !== method) return { ok: false, error: 'DPoP proof htm does not match the MCP request method.' };
        if (htu !== url) return { ok: false, error: 'DPoP proof htu does not match the MCP request URL.' };
        if (!jti || jti.length > 256 || hasAsciiControlChars(jti))
            return { ok: false, error: 'DPoP proof jti is missing or invalid.' };
        pruneDpopReplayCache(runtime);
        const replayKey = `${jkt}:${jti}`;
        if (runtime.dpopReplayCache.has(replayKey)) return { ok: false, error: 'DPoP proof replay detected.' };
        const expMs = Number(verified.payload.exp)
            ? Number(verified.payload.exp) * 1000
            : Date.now() + DPOP_MAX_TTL_SECONDS * 1000;
        const persistentReplay = runtime.replay.remember(OAUTH_REPLAY_NAMESPACES.resourceDpop, replayKey, expMs);
        if (!persistentReplay.available) {
            return { ok: false, error: 'Persistent DPoP replay protection is unavailable.' };
        }
        if (persistentReplay.replay) return { ok: false, error: 'DPoP proof replay detected.' };
        runtime.dpopReplayCache.set(replayKey, expMs);
        trimDpopReplayCache(runtime, DPOP_REPLAY_CACHE_MAX_ENTRIES);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'DPoP proof could not be verified.' };
    }
}

/**
 * @param {Record<string, string | string[] | undefined> | undefined} headers
 * @param {string} name
 * @returns {string | undefined}
 */
function firstAuthContextHeader(headers, name) {
    const value = headers?.[name.toLowerCase()] ?? headers?.[name];
    if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
    return typeof value === 'string' ? value : undefined;
}

/**
 * @param {Record<string, unknown>} jwk
 * @returns {boolean}
 */
function hasPrivateJwkFields(jwk) {
    return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((field) => Object.prototype.hasOwnProperty.call(jwk, field));
}

/**
 * @param {string} jwt
 * @returns {Record<string, unknown>}
 */
function decodeJwtHeader(jwt) {
    const [encoded] = jwt.split('.', 1);
    if (!encoded) throw new Error('JWT header is missing.');
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeDpopHtu(value) {
    try {
        const url = new URL(value);
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

/**
 * @param {McpAuthResourceServerState} runtime
 * @param {number} [nowMs]
 * @returns {number}
 */
function pruneDpopReplayCache(runtime, nowMs = Date.now()) {
    let removed = 0;
    for (const [key, expiresAt] of runtime.dpopReplayCache) {
        if (expiresAt <= nowMs) {
            runtime.dpopReplayCache.delete(key);
            removed += 1;
        }
    }
    return removed;
}

/**
 * @param {McpAuthResourceServerState} runtime
 * @param {number} maxSize
 * @returns {void}
 */
function trimDpopReplayCache(runtime, maxSize) {
    if (runtime.dpopReplayCache.size <= maxSize) return;
    const oldest = [...runtime.dpopReplayCache.entries()].sort((left, right) => left[1] - right[1]);
    for (const [key] of oldest) {
        if (runtime.dpopReplayCache.size <= maxSize) break;
        runtime.dpopReplayCache.delete(key);
    }
}

/**
 * @param {string} token
 * @param {McpAuthScope[]} requiredScopes
 * @param {McpAuthConfig} config
 * @param {string | undefined} staticBearerToken
 * @param {McpAuthContext} [context]
 * @param {import('./decision-cache.js').McpAuthDecisionCachePolicy} [decisionCachePolicy]
 * @param {McpAuthResourceServerState} [runtime]
 * @returns {Promise<McpAuthorizationDecision>}
 */
async function verifyBearerToken(
    token,
    requiredScopes,
    config,
    staticBearerToken,
    context = { bearerToken: undefined },
    decisionCachePolicy = readMcpAuthDecisionCachePolicy(),
    runtime = createEphemeralMcpAuthResourceServerState(),
) {
    if (!token || token.length > MAX_BEARER_TOKEN_LENGTH) {
        return authInvalidTokenDecision(requiredScopes, config, 'Bearer token is malformed or too large.');
    }
    if (config.staticBearerEnabled && staticBearerToken && safeEqualString(token, staticBearerToken)) {
        return {
            allowed: true,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            method: 'static-bearer',
        };
    }
    const cachedDecision = readCachedMcpAuthorizationDecision(
        token,
        requiredScopes,
        config,
        context,
        decisionCachePolicy,
    );
    if (cachedDecision) return cachedDecision;
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
        const jwks = getRemoteJwks(runtime, config.jwksUri);
        const verified = await jwtVerify(token, jwks, {
            issuer: config.expectedIssuer,
            audience: config.acceptedAudiences,
            algorithms: config.jwtAlgorithms,
            clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
            maxTokenAge: `${MAX_TOKEN_AGE_SECONDS}s`,
        });
        const payload = verified.payload;
        const dpopDecision = await validateDpopConfirmationForResource(
            runtime,
            payload,
            context,
            requiredScopes,
            config,
        );
        if (dpopDecision) return dpopDecision;
        const audienceValues = normalizeAudienceClaim(payload.aud);
        const tokenResource = typeof payload['resource'] === 'string' ? normalizeAudience(payload['resource'], '') : '';
        if (tokenResource && !audienceMatchesAnyAccepted(tokenResource, config.acceptedAudiences)) {
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
        const decision = {
            allowed: true,
            required: true,
            enforcement: config.enforcement,
            requiredScopes,
            method: 'oauth-jwks',
        };
        rememberMcpAuthorizationDecision(
            token,
            requiredScopes,
            config,
            context,
            payload,
            decision,
            decisionCachePolicy,
        );
        return decision;
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
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} tool
 * @param {McpAuthContext} [context]
 * @param {McpAuthConfig} [config]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {McpAuthRuntimeSecrets} [runtimeSecrets]
 * @param {import('./decision-cache.js').McpAuthDecisionCachePolicy} [decisionCachePolicy]
 * @param {McpAuthResourceServerState} [runtime]
 * @returns {Promise<McpAuthorizationDecision>}
 */
export async function authorizeMcpToolCall(
    tool,
    context = { bearerToken: undefined },
    config = readMcpAuthConfig(),
    env = process.env,
    runtimeSecrets = readMcpAuthRuntimeSecrets(env),
    decisionCachePolicy = readMcpAuthDecisionCachePolicy(env),
    runtime = createEphemeralMcpAuthResourceServerState(),
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
    if (config.mode === 'oauth' && isPublicOauthDiagnosticToolEnabled(tool, config.publicOauthDiagnosticsEnabled)) {
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
    return verifyBearerToken(
        context.bearerToken,
        requiredScopes,
        config,
        runtimeSecrets.staticBearerToken,
        context,
        decisionCachePolicy,
        runtime,
    );
}
