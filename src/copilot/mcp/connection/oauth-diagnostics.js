// @ts-check
/**
 * OAuth discovery, metadata validation and auth-profile diagnostics for MCP connector readiness.
 *
 * Owns bounded remote metadata fetching and SSRF/DNS safety. Wire tools only validate their input schema and frame the
 * returned report.
 *
 * @module copilot/mcp/connection/oauth-diagnostics
 */

import { buildProtectedResourceMetadata, buildWwwAuthenticateChallenge } from '#copilot/mcp/public/auth';
import { mcpFetchText } from '#copilot/mcp/public/integrations/http';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

const OAUTH_METADATA_PATHS = /** @type {const} */ ([
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
]);
const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 3000;
const MIN_DIAGNOSTIC_TIMEOUT_MS = 500;
const MAX_DIAGNOSTIC_TIMEOUT_MS = 10_000;
const MAX_DIAGNOSTIC_RESPONSE_BYTES = 64 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_SUMMARY_ITEMS = 64;
const DEFAULT_REPO_SCOPES = /** @type {const} */ (['repo:read', 'repo:write', 'repo:validate', 'repo:admin']);
const OIDC_SCOPES = /** @type {const} */ (['openid', 'profile', 'email']);
const REQUIRED_AUTHORIZATION_SERVER_FIELDS = /** @type {const} */ ([
    'issuer',
    'authorization_endpoint',
    'token_endpoint',
]);
const RECOMMENDED_AUTHORIZATION_SERVER_FIELDS = /** @type {const} */ ([
    'jwks_uri',
    'registration_endpoint',
    'revocation_endpoint',
    'userinfo_endpoint',
    'scopes_supported',
    'response_types_supported',
    'grant_types_supported',
    'token_endpoint_auth_methods_supported',
    'code_challenge_methods_supported',
    'client_id_metadata_document_supported',
    'resource_parameter_supported',
    'authorization_response_iss_parameter_supported',
]);

export const MCP_CONNECTION_DIAGNOSTIC_LIMITS = Object.freeze({
    minTimeoutMs: MIN_DIAGNOSTIC_TIMEOUT_MS,
    maxTimeoutMs: MAX_DIAGNOSTIC_TIMEOUT_MS,
    maxUrlLength: MAX_URL_LENGTH,
});

/**
 * @typedef {{ ok: true; url: string } | { ok: false; reason: string }} NormalizedUrlResult
 * @typedef {{ ok: boolean; url: string; status?: number; metadata?: Record<string, unknown>; error?: string; contentType?: string; bytesRead?: number; redirected?: boolean }} MetadataProbeResult
 */

/**
 * @param {string | undefined} value
 * @param {{ allowLoopback?: boolean }} [options]
 * @returns {NormalizedUrlResult}
 */
function normalizeIssuerUrl(value, options = {}) {
    const raw = String(value ?? '')
        .trim()
        .replace(/\/+$/u, '');
    if (!raw) return { ok: false, reason: 'Issuer URL is empty.' };
    if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: 'Issuer URL is too long.' };
    if (raw.includes('<') || raw.includes('>') || hasAsciiControlChars(raw)) {
        return { ok: false, reason: 'Issuer URL contains unsupported characters.' };
    }
    try {
        const url = new URL(raw);
        if (
            url.protocol !== 'https:' &&
            !(options.allowLoopback === true && url.protocol === 'http:' && isLoopbackHostname(url.hostname))
        ) {
            return { ok: false, reason: 'Issuer URL must use HTTPS for remote connector diagnostics.' };
        }
        if (url.username || url.password || url.hash || url.search) {
            return { ok: false, reason: 'Issuer URL must not contain credentials, query, or fragment.' };
        }
        url.pathname = url.pathname.replace(/\/+$/u, '');
        if (url.pathname && url.pathname !== '/') {
            return { ok: false, reason: 'Issuer URL must be a base issuer URL without a path.' };
        }
        url.pathname = '';
        return { ok: true, url: url.toString().replace(/\/+$/u, '') };
    } catch {
        return { ok: false, reason: 'Issuer URL is not a valid absolute URL.' };
    }
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return uniqueStrings(value.filter((item) => typeof item === 'string').map(String), MAX_SUMMARY_ITEMS);
}

/**
 * @param {string[]} values
 * @param {number} [maxItems]
 * @returns {string[]}
 */
function uniqueStrings(values, maxItems = MAX_SUMMARY_ITEMS) {
    const seen = new Set();
    const output = [];
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
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeOptionalString(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized && !hasAsciiControlChars(normalized) ? normalized.slice(0, 512) : null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isJsonContentType(value) {
    const contentType = String(value ?? '').toLowerCase();
    return contentType.includes('application/json') || contentType.includes('+json');
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
 * @param {number | undefined} value
 * @returns {number}
 */
function normalizeDiagnosticTimeoutMs(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DIAGNOSTIC_TIMEOUT_MS;
    return Math.max(MIN_DIAGNOSTIC_TIMEOUT_MS, Math.min(MAX_DIAGNOSTIC_TIMEOUT_MS, Math.floor(value)));
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @param {boolean} allowLoopback
 * @returns {Promise<MetadataProbeResult>}
 */
async function fetchOAuthMetadata(url, timeoutMs, allowLoopback) {
    const parsed = new URL(url);
    const hostCheck = await assertFetchHostAllowed(parsed, allowLoopback);
    if (!hostCheck.ok) {
        return {
            ok: false,
            url,
            error: hostCheck.reason,
        };
    }

    try {
        const result = await mcpFetchText(url, {
            cache: 'no-store',
            redirect: 'manual',
            headers: {
                accept: 'application/json, application/oauth-authz-server+json, application/json; q=0.9',
                'user-agent': 'copilot-mcp-oauth-diagnostics/1.0',
            },
            timeoutMs,
            maxBytes: MAX_DIAGNOSTIC_RESPONSE_BYTES,
        });
        const contentType = result.headers['content-type'] ?? '';
        const contentLength = Number(result.headers['content-length'] ?? '0');
        if (result.status >= 300 && result.status < 400) {
            return {
                ok: false,
                url,
                status: result.status,
                contentType,
                redirected: true,
                error: 'Redirects are not followed during OAuth metadata diagnostics.',
            };
        }
        if (Number.isFinite(contentLength) && contentLength > MAX_DIAGNOSTIC_RESPONSE_BYTES) {
            return {
                ok: false,
                url,
                status: result.status,
                contentType,
                error: `Response is too large (${contentLength} bytes).`,
            };
        }
        if (result.error) {
            return {
                ok: false,
                url,
                status: result.status,
                contentType,
                error: result.error,
            };
        }
        if (!isJsonContentType(contentType)) {
            return {
                ok: false,
                url,
                status: result.status,
                contentType,
                error: 'Response content-type is not JSON.',
            };
        }
        const body = asObject(JSON.parse(result.rawBody));
        return {
            ok: result.ok && body !== null,
            url,
            status: result.status,
            contentType,
            bytesRead: Buffer.byteLength(result.rawBody, 'utf8'),
            ...(body ? { metadata: body } : {}),
            ...(!result.ok ? { error: `HTTP ${result.status}` } : {}),
            ...(result.ok && body === null ? { error: 'Response is not a JSON object.' } : {}),
        };
    } catch (error) {
        return {
            ok: false,
            url,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * @param {URL} url
 * @param {boolean} allowLoopback
 * @returns {Promise<{ ok: true } | { ok: false; reason: string }>}
 */
async function assertFetchHostAllowed(url, allowLoopback) {
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowLoopback && isLoopbackHostname(url.hostname))) {
        return { ok: false, reason: 'Only HTTPS metadata endpoints are allowed by default.' };
    }
    if (url.username || url.password) return { ok: false, reason: 'Metadata URL must not contain credentials.' };
    if (isLocalOrPrivateHostname(url.hostname))
        return { ok: false, reason: 'Metadata host is local, private, multicast, or otherwise unsafe.' };
    try {
        const records = await lookup(url.hostname, { all: true, verbatim: false });
        if (records.length === 0) return { ok: false, reason: 'Metadata host did not resolve.' };
        if (records.some((record) => isLocalOrPrivateAddress(record.address))) {
            return { ok: false, reason: 'Metadata host resolves to a local or private address.' };
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
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
 * @param {string} hostname
 * @returns {boolean}
 */
function isLocalOrPrivateHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/\.$/u, '');
    if (
        normalized === 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized.endsWith('.local') ||
        normalized.endsWith('.internal') ||
        normalized.endsWith('.home.arpa')
    ) {
        return true;
    }
    return isLocalOrPrivateAddress(normalized.replace(/^\[/u, '').replace(/\]$/u, ''));
}

/**
 * @param {string} address
 * @returns {boolean}
 */
function isLocalOrPrivateAddress(address) {
    const normalized = String(address ?? '')
        .toLowerCase()
        .replace(/^\[/u, '')
        .replace(/\]$/u, '');
    if (!normalized) return true;
    if (net.isIP(normalized) === 4) {
        const ipv4 = parseIpv4Address(normalized);
        if (!ipv4) return true;
        const [first, second] = ipv4;
        return (
            first === 0 ||
            first === 10 ||
            first === 127 ||
            (first === 100 && second >= 64 && second <= 127) ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) ||
            (first === 198 && (second === 18 || second === 19)) ||
            first >= 224
        );
    }
    if (net.isIP(normalized) === 6) {
        return (
            normalized === '::1' ||
            normalized === '::' ||
            normalized.startsWith('fc') ||
            normalized.startsWith('fd') ||
            normalized.startsWith('fe80') ||
            normalized.startsWith('::ffff:127.') ||
            normalized.startsWith('::ffff:10.') ||
            normalized.startsWith('::ffff:192.168.')
        );
    }
    return false;
}

/**
 * @param {string} value
 * @returns {[number, number, number, number] | null}
 */
function parseIpv4Address(value) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value);
    if (!match) return null;
    const octets = match.slice(1).map((item) => Number(item));
    if (octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null;
    return /** @type {[number, number, number, number]} */ (octets);
}

/**
 * @param {import('./config.js').McpConnectionConfig | undefined} connectionConfig
 * @returns {import('./config.js').McpConnectionConfig}
 */
function requireConnectionConfig(connectionConfig) {
    if (!connectionConfig) throw new TypeError('MCP OAuth connection diagnostics require a process-scoped config.');
    return connectionConfig;
}

/**
 * @param {Record<string, unknown> | undefined} metadata
 * @param {string[]} requiredScopes
 * @param {string} expectedIssuer
 * @param {boolean} allowLoopback
 * @returns {{
 *     ready: boolean;
 *     missingFields: string[];
 *     warnings: string[];
 *     blockers: string[];
 *     summary: Record<string, unknown>;
 * }}
 */
function summarizeOAuthMetadata(metadata, requiredScopes, expectedIssuer, allowLoopback) {
    /** @type {string[]} */
    const missingFields = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const blockers = [];
    if (!metadata) {
        return { ready: false, missingFields: ['metadata'], warnings, blockers: ['metadata-unavailable'], summary: {} };
    }

    for (const field of REQUIRED_AUTHORIZATION_SERVER_FIELDS) {
        if (typeof metadata[field] !== 'string' || !String(metadata[field]).trim()) missingFields.push(field);
    }

    const issuer = normalizeOptionalString(metadata['issuer']);
    if (issuer && expectedIssuer && issuer.replace(/\/+$/u, '') !== expectedIssuer.replace(/\/+$/u, '')) {
        blockers.push('issuer-mismatch');
    }

    const tokenMethods = normalizeStringArray(metadata['token_endpoint_auth_methods_supported']);
    const codeChallengeMethods = normalizeStringArray(metadata['code_challenge_methods_supported']);
    const scopesSupported = normalizeStringArray(metadata['scopes_supported']);
    const responseTypes = normalizeStringArray(metadata['response_types_supported']);
    const grantTypes = normalizeStringArray(metadata['grant_types_supported']);
    const missingRecommendedFields = RECOMMENDED_AUTHORIZATION_SERVER_FIELDS.filter((field) => !(field in metadata));

    if (tokenMethods.length === 0) warnings.push('token_endpoint_auth_methods_supported is not advertised.');
    if (!tokenMethods.includes('none'))
        warnings.push('token_endpoint_auth_methods_supported does not include none for public OAuth clients.');
    if (!codeChallengeMethods.includes('S256'))
        warnings.push('code_challenge_methods_supported does not advertise S256.');
    if (!responseTypes.includes('code')) warnings.push('response_types_supported does not include code.');
    if (!grantTypes.includes('authorization_code'))
        warnings.push('grant_types_supported does not include authorization_code.');
    if (metadata['client_id_metadata_document_supported'] !== true) {
        warnings.push(
            'client_id_metadata_document_supported is not true; MCP 2026-07-28 prefers Client ID Metadata Documents and DCR should be treated only as compatibility fallback.',
        );
    }
    if (grantTypes.includes('refresh_token') && !scopesSupported.includes('offline_access')) {
        blockers.push('offline-access-not-advertised');
        warnings.push(
            'Refresh tokens are advertised but scopes_supported does not include offline_access; current ChatGPT OAuth setup may reject or fail to preserve connector refresh connectivity.',
        );
    }
    if (metadata['resource_parameter_supported'] !== true) {
        warnings.push(
            'resource_parameter_supported is not true; ensure the authorization server echoes the resource parameter into the token audience/resource claim.',
        );
    }
    if (metadata['authorization_response_iss_parameter_supported'] !== true) {
        warnings.push(
            'authorization_response_iss_parameter_supported is not true; RFC 9207 issuer identification is not advertised.',
        );
    }

    const missingScopes = requiredScopes.filter((scope) => !scopesSupported.includes(scope));
    if (missingScopes.length > 0) warnings.push(`scopes_supported is missing: ${missingScopes.join(', ')}.`);

    const endpointFields = [
        'authorization_endpoint',
        'token_endpoint',
        'registration_endpoint',
        'revocation_endpoint',
        'userinfo_endpoint',
        'jwks_uri',
    ];
    const endpointWarnings = [];
    for (const field of endpointFields) {
        const raw = normalizeOptionalString(metadata[field]);
        if (!raw) continue;
        const validation = normalizeEndpointUrl(raw, allowLoopback);
        if (!validation.ok) endpointWarnings.push(`${field}: ${validation.reason}`);
    }

    return {
        ready: missingFields.length === 0 && blockers.length === 0,
        missingFields,
        warnings: [...warnings, ...endpointWarnings],
        blockers,
        summary: {
            issuer: issuer ?? null,
            authorizationEndpointConfigured: typeof metadata['authorization_endpoint'] === 'string',
            tokenEndpointConfigured: typeof metadata['token_endpoint'] === 'string',
            jwksUriConfigured: typeof metadata['jwks_uri'] === 'string',
            userinfoEndpointConfigured: typeof metadata['userinfo_endpoint'] === 'string',
            registrationEndpointConfigured: typeof metadata['registration_endpoint'] === 'string',
            revocationEndpointConfigured: typeof metadata['revocation_endpoint'] === 'string',
            clientIdMetadataDocumentSupported: metadata['client_id_metadata_document_supported'] === true,
            resourceParameterSupported: metadata['resource_parameter_supported'] === true,
            authorizationResponseIssParameterSupported:
                metadata['authorization_response_iss_parameter_supported'] === true,
            tokenEndpointAuthMethodsSupported: tokenMethods,
            codeChallengeMethodsSupported: codeChallengeMethods,
            responseTypesSupported: responseTypes,
            grantTypesSupported: grantTypes,
            oidcScopesSupported: OIDC_SCOPES.filter((scope) => scopesSupported.includes(scope)),
            offlineAccessSupported: scopesSupported.includes('offline_access'),
            scopesSupported,
            missingRequiredScopes: missingScopes,
            missingRecommendedFields,
        },
    };
}

/**
 * @param {string} value
 * @param {boolean} allowLoopback
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
function normalizeEndpointUrl(value, allowLoopback) {
    try {
        const url = new URL(value);
        if (
            url.protocol !== 'https:' &&
            !(allowLoopback && url.protocol === 'http:' && isLoopbackHostname(url.hostname))
        ) {
            return { ok: false, reason: 'endpoint must use HTTPS except explicit loopback diagnostics.' };
        }
        if (url.username || url.password || url.hash)
            return { ok: false, reason: 'endpoint must not contain credentials or fragment.' };
        if (isLocalOrPrivateHostname(url.hostname) && !allowLoopback) {
            return { ok: false, reason: 'endpoint host is local or private.' };
        }
        return { ok: true };
    } catch {
        return { ok: false, reason: 'endpoint is not a valid absolute URL.' };
    }
}

/**
 * @param {Record<string, unknown> | undefined} metadata
 * @param {string} expectedClientId
 * @param {boolean} allowLoopback
 * @returns {{
 *     ready: boolean;
 *     missingFields: string[];
 *     warnings: string[];
 *     blockers: string[];
 *     summary: Record<string, unknown>;
 * }}
 */
function summarizeClientMetadataDocument(metadata, expectedClientId, allowLoopback) {
    /** @type {string[]} */
    const missingFields = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const blockers = [];
    if (!metadata)
        return { ready: false, missingFields: ['metadata'], warnings, blockers: ['metadata-unavailable'], summary: {} };
    if (metadata['client_id'] !== expectedClientId) blockers.push('client_id-mismatch');
    if (typeof metadata['client_name'] !== 'string' || !metadata['client_name']) missingFields.push('client_name');

    const redirectUris = normalizeStringArray(metadata['redirect_uris']);
    if (redirectUris.length === 0) missingFields.push('redirect_uris');
    for (const redirectUri of redirectUris) {
        const validation = normalizeEndpointUrl(redirectUri, allowLoopback);
        if (!validation.ok) warnings.push(`redirect_uri ${redirectUri}: ${validation.reason}`);
    }

    const tokenEndpointAuthMethod = String(metadata['token_endpoint_auth_method'] ?? 'none');
    if (tokenEndpointAuthMethod !== 'none') warnings.push('token_endpoint_auth_method is not none.');

    return {
        ready: missingFields.length === 0 && blockers.length === 0,
        missingFields,
        warnings,
        blockers,
        summary: {
            clientId: metadata['client_id'] ?? null,
            clientName: metadata['client_name'] ?? null,
            redirectUris,
            tokenEndpointAuthMethod,
            grantTypes: normalizeStringArray(metadata['grant_types']),
            responseTypes: normalizeStringArray(metadata['response_types']),
        },
    };
}

/**
 * @param {import('#copilot/mcp/public/auth').McpAuthConfig} config
 * @returns {Record<string, Record<string, string>>}
 */
function buildAuthEnvironmentTemplates(config) {
    const permanentMcpUrl = `${config.resource}/mcp`;
    return {
        permanentTunnelOAuthHttp2Plus: {
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            COPILOT_MCP_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
            COPILOT_MCP_CLOUDFLARE_PROTOCOL: 'quic',
            TUNNEL_TRANSPORT_PROTOCOL: 'quic',
            COPILOT_MCP_ORIGIN_TRANSPORT: 'http2',
            COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN: 'true',
            COPILOT_MCP_OAUTH_ISSUER: config.resource,
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: config.resource,
            COPILOT_MCP_OAUTH_AUDIENCE: config.resource,
            COPILOT_MCP_OAUTH_ACCEPTED_AUDIENCES: `${config.resource},${config.resource}/mcp`,
            COPILOT_MCP_OAUTH_JWKS_URI: `${config.resource}/oauth/jwks.json`,
            COPILOT_MCP_OAUTH_REQUIRE_RESOURCE_CLAIM: 'true',
            COPILOT_MCP_DEV_OAUTH_ENABLED: 'true',
            COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS: '36000',
            COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS: '2592000',
            COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS: 'true',
            COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED: 'false',
        },
        permanentTunnelNoAuthFallback: {
            COPILOT_MCP_AUTH_MODE: 'none-dev',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'off',
            COPILOT_MCP_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
            COPILOT_MCP_CLOUDFLARE_PROTOCOL: 'quic',
            TUNNEL_TRANSPORT_PROTOCOL: 'quic',
        },
        temporaryTunnelNoAuth: {
            COPILOT_MCP_AUTH_MODE: 'none-dev',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'off',
            COPILOT_MCP_PUBLIC_URL: 'https://<trycloudflare-host>/mcp',
            COPILOT_MCP_CLOUDFLARE_MODE: 'temporary-quick',
            COPILOT_MCP_CLOUDFLARE_PROTOCOL: 'auto',
            TUNNEL_TRANSPORT_PROTOCOL: 'auto',
        },
        mixedAuthWriteTest: {
            COPILOT_MCP_AUTH_MODE: 'mixed-auth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'write',
            COPILOT_MCP_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED: 'true',
            COPILOT_MCP_STATIC_BEARER_TOKEN: '<local-dev-token-not-committed>',
        },
        externalOauthJwks: {
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            COPILOT_MCP_PUBLIC_URL: permanentMcpUrl,
            COPILOT_MCP_OAUTH_ISSUER: 'https://<issuer>',
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: 'https://<issuer>',
            COPILOT_MCP_OAUTH_AUDIENCE: config.resource,
            COPILOT_MCP_OAUTH_ACCEPTED_AUDIENCES: `${config.resource},${config.resource}/mcp`,
            COPILOT_MCP_OAUTH_JWKS_URI: 'https://<issuer>/.well-known/jwks.json',
            COPILOT_MCP_OAUTH_REQUIRE_RESOURCE_CLAIM: 'true',
        },
    };
}

/**
 * @param {import('#copilot/mcp/public/auth').McpAuthConfig} config
 * @returns {Record<string, unknown>}
 */
export function buildConnectionAuthReadiness(config) {
    const protectedResource = buildProtectedResourceMetadata(config);
    const protectedResourceMcp = buildProtectedResourceMetadata(config, { resource: `${config.resource}/mcp` });
    const challenge = buildWwwAuthenticateChallenge([...DEFAULT_REPO_SCOPES], config, {
        error: 'invalid_token',
        errorDescription: 'Bearer token is required for this MCP tool.',
    });
    /** @type {string[]} */
    const warnings = [];
    if (config.authorizationServers.length === 0) warnings.push('No authorization server is configured.');
    if (!config.expectedIssuer) warnings.push('Expected issuer is not configured.');
    if (!config.expectedAudience) warnings.push('Expected audience is not configured.');
    if (!config.jwksUri) warnings.push('JWKS URI is not configured.');
    if (config.staticBearerConfigured)
        warnings.push('Static bearer fallback is configured; keep it disabled for the public Cloudflare endpoint.');
    return {
        mode: config.mode,
        enforcement: config.enforcement,
        protectedResourceMetadataUrl: config.protectedResourceMetadataUrl,
        protectedResourceMetadata: protectedResource,
        protectedResourceMetadataMcp: protectedResourceMcp,
        authorizationServersConfigured: config.authorizationServers.length > 0,
        authorizationServers: config.authorizationServers,
        scopesSupported: config.scopesSupported,
        initialScopes: config.initialScopes,
        expectedIssuerConfigured: Boolean(config.expectedIssuer),
        expectedIssuer: config.expectedIssuer || null,
        expectedAudience: config.expectedAudience || null,
        acceptedAudiences: config.acceptedAudiences,
        jwksUriConfigured: Boolean(config.jwksUri),
        jwksUri: config.jwksUri || null,
        staticBearerConfigured: config.staticBearerConfigured,
        challengePreview: challenge,
        warnings,
    };
}

/**
 * @param {{ scopes?: string[] | undefined }} [input]
 * @param {import('./config.js').McpConnectionConfig | undefined} [connectionConfig]
 */
export function readMcpConnectionAuthProfile(input = {}, connectionConfig) {
    const config = requireConnectionConfig(connectionConfig).auth;
    const challengeScopes =
        Array.isArray(input.scopes) && input.scopes.length > 0
            ? uniqueStrings(input.scopes, 16)
            : [...DEFAULT_REPO_SCOPES];
    const auth = buildConnectionAuthReadiness(config);
    return {
        success: true,
        ...auth,
        challengePreview: buildWwwAuthenticateChallenge(challengeScopes, config, {
            error: 'invalid_token',
            errorDescription: 'Bearer token is required or invalid for this MCP tool.',
        }),
        requestedChallengeScopes: challengeScopes,
        environmentTemplates: buildAuthEnvironmentTemplates(config),
        rolloutGates: [
            'Protected Resource Metadata is published at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp.',
            'Authorization Server Metadata publishes authorization_endpoint, token_endpoint, PKCE S256, JWKS, scopes, and public-client auth method none.',
            'OAuth token validation checks issuer, audience/resource, expiration, signature and scopes before every tool call.',
            '401 Unauthorized responses and MCP tool error metadata include WWW-Authenticate with resource_metadata, error and error_description.',
            'Public OAuth diagnostic tools are enabled by default for low-friction connector debugging and limited to read-only OAuth diagnostics; set COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS=false for hardened windows.',
            'HTTP/2+ Cloudflare/origin state is synchronized before restart.',
        ],
        nextSteps:
            config.enforcement === 'off'
                ? [
                      'Use OAuth as the default for the permanent Cloudflare endpoint.',
                      'Use No authentication only with COPILOT_MCP_AUTH_MODE=none-dev for controlled fallback testing.',
                  ]
                : [
                      'Confirm the authorization server publishes OAuth metadata.',
                      'Run mcp_oauth_issuer_diagnostics.',
                      'Run chatgpt_connector_current_url_status.',
                      'Confirm ChatGPT receives the protected resource metadata URL and returns scoped bearer tokens.',
                  ],
    };
}

/**
 * @param {{ issuer?: string | undefined; timeoutMs?: number | undefined }} [input]
 * @param {import('./config.js').McpConnectionConfig | undefined} [connectionConfig]
 */
export async function diagnoseMcpOAuthIssuer(input = {}, connectionConfig) {
    const ownerConfig = requireConnectionConfig(connectionConfig);
    const config = ownerConfig.auth;
    const allowLoopback = ownerConfig.oauthDiagnosticsAllowLoopback;
    const timeout = normalizeDiagnosticTimeoutMs(input.timeoutMs);
    const normalized = normalizeIssuerUrl(input.issuer ?? config.expectedIssuer, { allowLoopback });
    if (!normalized.ok) {
        return {
            success: true,
            ready: false,
            issuer: null,
            reason: normalized.reason,
            requiredForCurrentMode: config.enforcement !== 'off',
            checkedUrls: [],
            protectedResourceMetadata: buildProtectedResourceMetadata(config),
            nextSteps: [
                'Configure an HTTPS OAuth issuer base URL.',
                'Keep Authentication as No authentication only for controlled temporary fallback testing.',
                'For local loopback diagnostics only, explicitly set COPILOT_MCP_OAUTH_DIAGNOSTICS_ALLOW_LOOPBACK=true.',
            ],
        };
    }
    const checked = [];
    for (const metadataPath of OAUTH_METADATA_PATHS) {
        checked.push(await fetchOAuthMetadata(normalized.url + metadataPath, timeout, allowLoopback));
        if (checked[checked.length - 1]?.ok === true) break;
    }
    const firstOk = checked.find((candidate) => candidate.ok);
    const summary = summarizeOAuthMetadata(firstOk?.metadata, config.scopesSupported, normalized.url, allowLoopback);
    const clientMetadataUrl =
        firstOk &&
        firstOk.metadata?.['client_id_metadata_document_supported'] === true &&
        normalized.url === config.resource
            ? normalized.url + '/.well-known/oauth-client/codex-smoke.json'
            : null;
    const clientMetadataProbe = clientMetadataUrl
        ? await fetchOAuthMetadata(clientMetadataUrl, timeout, allowLoopback)
        : null;
    const clientMetadataSummary = clientMetadataProbe
        ? summarizeClientMetadataDocument(clientMetadataProbe.metadata, clientMetadataUrl ?? '', allowLoopback)
        : null;
    const warnings = [
        ...summary.warnings,
        ...(clientMetadataSummary?.warnings ?? []),
        ...(clientMetadataSummary?.blockers ?? []).map((blocker) => 'client metadata blocker: ' + blocker),
    ];
    const blockers = [...summary.blockers, ...(clientMetadataSummary?.blockers ?? [])];
    return {
        success: true,
        ready: Boolean(firstOk && summary.ready && (clientMetadataSummary?.ready ?? true)),
        issuer: normalized.url,
        requiredForCurrentMode: config.enforcement !== 'off',
        timeoutMs: timeout,
        checkedUrls: checked.map(({ url, ok, status, error, contentType, bytesRead, redirected }) => ({
            url,
            ok,
            status: status ?? null,
            contentType: contentType ?? null,
            bytesRead: bytesRead ?? null,
            redirected: redirected === true,
            error: error ?? null,
        })),
        selectedMetadataUrl: firstOk?.url ?? null,
        metadataSummary: summary.summary,
        protectedResourceMetadata: buildProtectedResourceMetadata(config),
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
                      blockers: clientMetadataSummary.blockers,
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
        blockers,
        warnings,
        nextSteps:
            firstOk && summary.ready && (clientMetadataSummary?.ready ?? true)
                ? [
                      'Run mcp_auth_profile and verify accepted audiences/resource claim policy.',
                      'Run make copilot-mcp-oauth-smoke or the repo OAuth smoke command.',
                      'Create/reconnect the ChatGPT connector with Authentication=OAuth.',
                  ]
                : [
                      'Publish .well-known/oauth-authorization-server or .well-known/openid-configuration on the issuer.',
                      'Ensure authorization_endpoint, token_endpoint, PKCE S256, JWKS, repo scopes and public client auth method none are advertised.',
                      'Ensure ChatGPT resource parameter is echoed into aud or resource claim.',
                  ],
    };
}
