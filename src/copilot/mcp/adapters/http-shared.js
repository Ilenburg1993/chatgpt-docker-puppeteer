// @ts-check
/**
 * Protocol-neutral Streamable HTTP route handler for the Copilot MCP endpoint.
 *
 * Canonical hardened replacement for the shared HTTP adapter. It accepts Node HTTP/1.1 requests and Node HTTP/2
 * compatibility requests, keeps the MCP body unread before delegating to the MCP SDK, and centralizes the HTTP surface
 * hardening needed by the OAuth/MCP/Cloudflare roadmap:
 *
 * - OAuth authorization endpoint is deliberately excluded from CORS.
 * - MCP protected resource discovery is exposed through RFC 9728-style metadata and WWW-Authenticate challenges.
 * - Cloudflare/HTTP/2+ response hygiene is improved with deterministic headers and no-transform on live MCP responses.
 * - CORS is route-specific, origin-restricted and never wildcarded for browser origins.
 * - HTTP/2 compatibility requests use :authority/:scheme when Host is absent.
 *
 * @module copilot/mcp/adapters/http-shared
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHash } from 'node:crypto';
import { buildChatGptConnectorProfile } from '../connection/profile.js';
import { logMcp } from '../control-plane/audit.js';
import { buildProtectedResourceMetadata, parseBearerToken, readMcpAuthConfig } from '../control-plane/auth.js';
import { handleBuiltInDevOAuthRequest } from '../control-plane/dev-oauth.js';
import { readMcpIndexAutoBuildState, startMcpIndexAutoBuildInBackground } from '../control-plane/index-auto-build.js';
import { readMcpMetricsSnapshot } from '../control-plane/metrics.js';
import { createCopilotMcpServer } from '../server.js';
import { buildMcpHttpProtocolReport, setMcpHttpProtocolResponseHeaders } from './http-protocol.js';

export const MCP_PATH = '/mcp';

const DEFAULT_ALLOWED_ORIGINS = /** @type {const} */ ([
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://platform.openai.com',
    'https://claude.ai',
    'https://www.claude.ai',
    'http://localhost',
    'http://127.0.0.1',
]);

const DEFAULT_CORS_ALLOWED_HEADERS = /** @type {const} */ ([
    'accept',
    'authorization',
    'content-type',
    'mcp-session-id',
    'mcp-protocol-version',
    'x-requested-with',
]);

const DEFAULT_CORS_EXPOSED_HEADERS = /** @type {const} */ ([
    'Mcp-Session-Id',
    'MCP-Protocol-Version',
    'WWW-Authenticate',
    'X-MCP-Origin-Protocol-Mode',
    'X-MCP-Origin-HTTP-Version',
    'X-MCP-Origin-ALPN',
]);

const DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS = 90_000;
const DEFAULT_HTTP_HEADERS_TIMEOUT_MS = 95_000;
const DEFAULT_HTTP_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MCP_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_MCP_SESSIONS = 32;
const DEFAULT_HSTS_MAX_AGE_SECONDS = 31_536_000;
const PUBLIC_METADATA_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';
const NO_STORE_CACHE_CONTROL = 'no-store, no-transform';
const STATEFUL_SESSION_DISABLED_REASON =
    'stateful-session-body-replay-disabled; production adapter is stateless to preserve MCP SDK JSON-RPC compatibility';

/**
 * @typedef {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} McpHttpRequest
 *
 * @typedef {import('node:http').ServerResponse | import('node:http2').Http2ServerResponse} McpHttpResponse
 *
 * @typedef {import('./http-protocol.js').McpHttpProtocolState} McpHttpProtocolState
 *
 * @typedef {{
 *     methods: string[];
 *     allowHeaders: string[];
 *     exposeHeaders: string[];
 *     maxAgeSeconds: number;
 *     jsonRpcErrors?: boolean;
 * }} CorsRoutePolicy
 */

/** @type {Record<string, CorsRoutePolicy>} */
const CORS_ROUTE_POLICIES = {
    '/': buildCorsPolicy(['GET']),
    '/health': buildCorsPolicy(['GET']),
    [MCP_PATH]: buildCorsPolicy(['POST', 'GET', 'DELETE'], { jsonRpcErrors: true }),
    '/chatgpt-connector.json': buildCorsPolicy(['GET']),
    '/.well-known/oauth-protected-resource': buildCorsPolicy(['GET']),
    '/.well-known/oauth-protected-resource/mcp': buildCorsPolicy(['GET']),
    '/.well-known/oauth-authorization-server': buildCorsPolicy(['GET']),
    '/.well-known/openid-configuration': buildCorsPolicy(['GET']),
    '/.well-known/oauth-client/codex-smoke.json': buildCorsPolicy(['GET']),
    '/oauth/jwks.json': buildCorsPolicy(['GET']),
    '/oauth/register': buildCorsPolicy(['POST']),
    '/oauth/token': buildCorsPolicy(['POST']),
    '/oauth/revoke': buildCorsPolicy(['POST']),
    '/oauth/userinfo': buildCorsPolicy(['GET']),
};

/** @type {Record<string, string[]>} */
const KNOWN_ROUTE_METHODS = {
    '/': ['GET'],
    '/health': ['GET'],
    [MCP_PATH]: ['POST', 'GET', 'DELETE'],
    '/chatgpt-connector.json': ['GET'],
    '/.well-known/oauth-protected-resource': ['GET'],
    '/.well-known/oauth-protected-resource/mcp': ['GET'],
    '/.well-known/oauth-authorization-server': ['GET'],
    '/.well-known/openid-configuration': ['GET'],
    '/.well-known/oauth-client/codex-smoke.json': ['GET'],
    '/oauth/authorize': ['GET'],
    '/oauth/jwks.json': ['GET'],
    '/oauth/register': ['POST'],
    '/oauth/token': ['POST'],
    '/oauth/revoke': ['POST'],
    '/oauth/userinfo': ['GET'],
};

/**
 * @param {string[]} methods
 * @param {{ jsonRpcErrors?: boolean }} [options]
 * @returns {CorsRoutePolicy}
 */
function buildCorsPolicy(methods, options = {}) {
    /** @type {CorsRoutePolicy} */
    const policy = {
        methods,
        allowHeaders: [...DEFAULT_CORS_ALLOWED_HEADERS],
        exposeHeaders: [...DEFAULT_CORS_EXPOSED_HEADERS],
        maxAgeSeconds: 600,
    };
    if (typeof options.jsonRpcErrors === 'boolean') policy.jsonRpcErrors = options.jsonRpcErrors;
    return policy;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ keepAliveTimeoutMs: number; headersTimeoutMs: number; requestTimeoutMs: number }}
 */
export function readMcpHttpServerTimingPolicy(env = process.env) {
    const keepAliveTimeoutMs = readPositiveIntegerEnv(
        env,
        'COPILOT_MCP_HTTP_KEEP_ALIVE_TIMEOUT_MS',
        DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS,
        1_000,
    );
    const headersTimeoutMs = readPositiveIntegerEnv(
        env,
        'COPILOT_MCP_HTTP_HEADERS_TIMEOUT_MS',
        Math.max(DEFAULT_HTTP_HEADERS_TIMEOUT_MS, keepAliveTimeoutMs + 5_000),
        keepAliveTimeoutMs + 1_000,
    );
    const requestTimeoutMs = readPositiveIntegerEnv(
        env,
        'COPILOT_MCP_HTTP_REQUEST_TIMEOUT_MS',
        DEFAULT_HTTP_REQUEST_TIMEOUT_MS,
        1_000,
    );
    return { keepAliveTimeoutMs, headersTimeoutMs, requestTimeoutMs };
}

/**
 * Kept for config/tests/health visibility. Runtime session persistence is intentionally disabled in production because
 * the SDK owns request-body parsing and does not expose a safe pre-parse hook for initialize detection here.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ enabled: boolean; requested: boolean; ttlMs: number; maxSessions: number; reason: string }}
 */
export function readMcpHttpSessionPolicy(env = process.env) {
    const raw = String(env['COPILOT_MCP_HTTP_STATEFUL_SESSIONS'] ?? '')
        .trim()
        .toLowerCase();
    const requested = raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on' || raw === 'experimental';
    return {
        enabled: false,
        requested,
        ttlMs: readPositiveIntegerEnv(env, 'COPILOT_MCP_HTTP_SESSION_TTL_MS', DEFAULT_MCP_SESSION_TTL_MS, 10_000),
        maxSessions: readPositiveIntegerEnv(env, 'COPILOT_MCP_HTTP_MAX_SESSIONS', DEFAULT_MAX_MCP_SESSIONS, 1),
        reason: STATEFUL_SESSION_DISABLED_REASON,
    };
}

/**
 * @returns {{ activeSessions: number; enabled: boolean; requested: boolean; reason: string }}
 */
export function readMcpHttpSessionRuntimeState() {
    const policy = readMcpHttpSessionPolicy();
    return {
        activeSessions: 0,
        enabled: policy.enabled,
        requested: policy.requested,
        reason: policy.reason,
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *     minimumOriginProtocol: 'HTTP/2+';
 *     nodeHandlerMode: 'http1-and-http2-compat';
 *     cloudflareHttp2ToOriginExpected: true;
 *     statelessMcpTransport: true;
 * }}
 */
export function readMcpHttpTransportPolicy(env = process.env) {
    void env;
    return {
        minimumOriginProtocol: 'HTTP/2+',
        nodeHandlerMode: 'http1-and-http2-compat',
        cloudflareHttp2ToOriginExpected: true,
        statelessMcpTransport: true,
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ allowedOrigins: string[]; routeCount: number; authorizationEndpointCors: false }}
 */
export function readMcpHttpCorsPolicy(env = process.env) {
    return {
        allowedOrigins: readAllowedOrigins(env),
        routeCount: Object.keys(CORS_ROUTE_POLICIES).length,
        authorizationEndpointCors: false,
    };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @returns {number}
 */
function readPositiveIntegerEnv(env, name, fallback, minimum) {
    const parsed = Number(env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

/**
 * @param {import('node:http').Server} httpServer
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ keepAliveTimeoutMs: number; headersTimeoutMs: number; requestTimeoutMs: number }}
 */
export function configureHttp1ServerTiming(httpServer, env = process.env) {
    const policy = readMcpHttpServerTimingPolicy(env);
    httpServer.keepAliveTimeout = policy.keepAliveTimeoutMs;
    httpServer.headersTimeout = policy.headersTimeoutMs;
    httpServer.requestTimeout = policy.requestTimeoutMs;
    httpServer.maxRequestsPerSocket = 0;
    return policy;
}

/**
 * @param {import('node:http2').Http2SecureServer} http2Server
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ keepAliveTimeoutMs: number; headersTimeoutMs: number; requestTimeoutMs: number }}
 */
export function configureHttp2ServerTiming(http2Server, env = process.env) {
    const policy = readMcpHttpServerTimingPolicy(env);
    const server =
        /** @type {import('node:http2').Http2SecureServer & { requestTimeout?: number; timeout?: number }} */ (
            http2Server
        );
    server.requestTimeout = policy.requestTimeoutMs;
    server.timeout = policy.keepAliveTimeoutMs;
    server.setTimeout(policy.keepAliveTimeoutMs);
    return policy;
}

/**
 * @param {{ host: string; port: number; protocolState: McpHttpProtocolState; publicScheme?: 'http' | 'https' }} options
 * @returns {(req: McpHttpRequest, res: McpHttpResponse) => Promise<void>}
 */
export function createMcpHttpRequestHandler(options) {
    return async (req, res) => {
        try {
            setDefaultSecurityHeaders(req, res, options);
            const protocolSample = options.protocolState.lastRequest;
            if (protocolSample) setMcpHttpProtocolResponseHeaders(res, protocolSample);

            const url = buildRequestUrl(req, options);
            const corsPolicy = readCorsRoutePolicy(url.pathname);
            const requestOrigin = readHeader(req, 'origin');

            if (corsPolicy) {
                if (requestOrigin && !isAllowedOrigin(requestOrigin)) {
                    writeCorsForbidden(res, corsPolicy);
                    return;
                }
                setCorsHeaders(res, requestOrigin, corsPolicy);
            }

            if (req.method === 'OPTIONS') {
                if (corsPolicy) {
                    writeEmpty(res, 204);
                    return;
                }
                if (url.pathname === '/oauth/authorize') {
                    writeMethodNotAllowed(res, KNOWN_ROUTE_METHODS['/oauth/authorize'] ?? ['GET']);
                    return;
                }
                writeText(res, 404, 'Not Found');
                return;
            }

            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
                writeJson(res, 200, buildHealthPayload(options.protocolState));
                return;
            }

            if (req.method === 'GET' && url.pathname === '/chatgpt-connector.json') {
                const publicMcpUrl = url.searchParams.get('publicMcpUrl') ?? undefined;
                writeJson(
                    res,
                    200,
                    buildChatGptConnectorProfile(publicMcpUrl === undefined ? {} : { publicMcpUrl }),
                    PUBLIC_METADATA_CACHE_CONTROL,
                );
                return;
            }

            if (
                req.method === 'GET' &&
                (url.pathname === '/.well-known/oauth-protected-resource' ||
                    url.pathname === '/.well-known/oauth-protected-resource/mcp')
            ) {
                const config = readMcpAuthConfig();
                const resource = url.pathname.endsWith('/mcp') ? `${config.resource}/mcp` : config.resource;
                writeJson(
                    res,
                    200,
                    buildProtectedResourceMetadata(config, { resource }),
                    PUBLIC_METADATA_CACHE_CONTROL,
                );
                return;
            }

            if (
                await handleBuiltInDevOAuthRequest(
                    /** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)),
                    /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)),
                    url,
                    readMcpAuthConfig(),
                )
            ) {
                return;
            }

            if (url.pathname === MCP_PATH) {
                const mcpMethods = KNOWN_ROUTE_METHODS[MCP_PATH] ?? ['POST', 'GET', 'DELETE'];
                if (!req.method || !mcpMethods.includes(req.method)) {
                    writeMethodNotAllowed(res, mcpMethods);
                    return;
                }
                if (rejectAccessTokenInUri(url, res)) return;

                const authConfig = readMcpAuthConfig();
                if (shouldIssueMcpUnauthorizedChallenge(req, authConfig)) {
                    writeMcpUnauthorizedChallenge(res, authConfig);
                    return;
                }

                setNoStoreResponseHeaders(res);
                try {
                    await handleMcpRequest(req, res);
                } catch (error) {
                    logMcp('ERROR', 'Error handling MCP HTTP request.', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    if (!res.headersSent) {
                        writeText(res, 500, 'Internal server error');
                    }
                }
                return;
            }

            const allowedMethods = KNOWN_ROUTE_METHODS[url.pathname];
            if (allowedMethods && req.method && !allowedMethods.includes(req.method)) {
                writeMethodNotAllowed(res, allowedMethods);
                return;
            }

            writeText(res, 404, 'Not Found');
        } catch (error) {
            logMcp('ERROR', 'Unhandled MCP HTTP adapter error.', {
                error: error instanceof Error ? error.message : String(error),
            });
            if (!res.headersSent) {
                writeText(res, 400, 'Bad Request');
            } else {
                safeEnd(res);
            }
        }
    };
}

/**
 * @returns {void}
 */
export function notifyMcpHttpStarted() {
    startMcpIndexAutoBuildInBackground({ reason: 'mcp-http-start' });
}

/**
 * @param {McpHttpProtocolState} protocolState
 * @returns {Record<string, unknown>}
 */
function buildHealthPayload(protocolState) {
    return {
        ok: true,
        name: 'copilot-mcp',
        mcpPath: MCP_PATH,
        metrics: readMcpMetricsSnapshot(),
        indexAutoBuild: readMcpIndexAutoBuildState(),
        http: {
            timingPolicy: readMcpHttpServerTimingPolicy(),
            sessionRuntime: readMcpHttpSessionRuntimeState(),
            transportPolicy: readMcpHttpTransportPolicy(),
            corsPolicy: readMcpHttpCorsPolicy(),
            protocol: buildMcpHttpProtocolReport(protocolState),
        },
    };
}

/**
 * @param {McpHttpRequest} req
 * @param {{ host: string; port: number; publicScheme?: 'http' | 'https' }} options
 * @returns {URL}
 */
function buildRequestUrl(req, options) {
    const scheme = options.publicScheme ?? readHeader(req, ':scheme') ?? 'http';
    const authority = readRequestAuthority(req, options);
    return new URL(req.url ?? '/', `${scheme}://${authority}`);
}

/**
 * @param {McpHttpRequest} req
 * @param {{ host: string; port: number }} options
 * @returns {string}
 */
function readRequestAuthority(req, options) {
    const authority = readHeader(req, ':authority') ?? readHeader(req, 'host');
    if (authority && isSyntacticallySafeAuthority(authority)) return authority;
    return `${options.host}:${options.port}`;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isSyntacticallySafeAuthority(value) {
    return /^[A-Za-z0-9.:[\]-]+(?::\d{1,5})?$/u.test(value) && !value.includes('..:');
}

/**
 * @param {McpHttpResponse} res
 * @param {string | undefined} origin
 * @param {CorsRoutePolicy} policy
 * @returns {void}
 */
function setCorsHeaders(res, origin, policy) {
    if (origin && isAllowedOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', [...new Set([...policy.methods, 'OPTIONS'])].join(', '));
    res.setHeader('Access-Control-Allow-Headers', policy.allowHeaders.join(', '));
    res.setHeader('Access-Control-Expose-Headers', policy.exposeHeaders.join(', '));
    res.setHeader('Access-Control-Max-Age', String(policy.maxAgeSeconds));
    appendVaryHeader(res, ['Origin']);
}

/**
 * @param {McpHttpResponse} res
 * @param {CorsRoutePolicy} policy
 * @returns {void}
 */
function writeCorsForbidden(res, policy) {
    if (policy.jsonRpcErrors) {
        writeJson(res, 403, { jsonrpc: '2.0', error: { code: -32000, message: 'Origin is not allowed.' } });
        return;
    }
    writeJson(res, 403, { error: 'forbidden', error_description: 'Origin is not allowed.' });
}

/**
 * @param {string} pathname
 * @returns {CorsRoutePolicy | undefined}
 */
function readCorsRoutePolicy(pathname) {
    return CORS_ROUTE_POLICIES[pathname];
}

/**
 * @param {string | undefined} origin
 * @returns {boolean}
 */
function isAllowedOrigin(origin) {
    if (!origin) return true;
    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;

    const allowed = readAllowedOrigins();
    return allowed.some((candidate) => originMatchesAllowedCandidate(parsed, origin, candidate));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function readAllowedOrigins(env = process.env) {
    const configured = String(env['COPILOT_MCP_ALLOWED_ORIGINS'] ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return configured.length > 0 ? configured : [...DEFAULT_ALLOWED_ORIGINS];
}

/**
 * @param {URL} originUrl
 * @param {string} origin
 * @param {string} candidate
 * @returns {boolean}
 */
function originMatchesAllowedCandidate(originUrl, origin, candidate) {
    if (origin === candidate) return true;
    try {
        const candidateUrl = new URL(candidate);
        if (!isLoopbackHostname(originUrl.hostname) || !isLoopbackHostname(candidateUrl.hostname)) return false;
        if (originUrl.protocol !== candidateUrl.protocol) return false;
        if (originUrl.hostname !== candidateUrl.hostname) return false;
        return !candidateUrl.port || originUrl.port === candidateUrl.port;
    } catch {
        return false;
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
 * @param {McpHttpRequest} req
 * @param {McpHttpResponse} res
 * @param {{ publicScheme?: 'http' | 'https' }} options
 * @returns {void}
 */
function setDefaultSecurityHeaders(req, res, options) {
    setHeaderIfAbsent(res, 'X-Content-Type-Options', 'nosniff');
    setHeaderIfAbsent(res, 'Referrer-Policy', 'no-referrer');
    setHeaderIfAbsent(res, 'X-Frame-Options', 'DENY');
    setHeaderIfAbsent(res, 'Cross-Origin-Resource-Policy', 'same-site');
    setHeaderIfAbsent(res, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (shouldEmitHsts(req, options)) {
        setHeaderIfAbsent(res, 'Strict-Transport-Security', buildHstsHeader());
    }
}

/**
 * @param {McpHttpRequest} req
 * @param {{ publicScheme?: 'http' | 'https' }} options
 * @returns {boolean}
 */
function shouldEmitHsts(req, options) {
    const raw = String(process.env['COPILOT_MCP_HTTP_HSTS_ENABLED'] ?? 'true')
        .trim()
        .toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return (
        options.publicScheme === 'https' ||
        readHeader(req, ':scheme') === 'https' ||
        firstForwardedProto(req) === 'https'
    );
}

/**
 * @returns {string}
 */
function buildHstsHeader() {
    const maxAge = readPositiveIntegerEnv(
        process.env,
        'COPILOT_MCP_HTTP_HSTS_MAX_AGE_SECONDS',
        DEFAULT_HSTS_MAX_AGE_SECONDS,
        0,
    );
    const includeSubDomains = readBooleanEnv(process.env, 'COPILOT_MCP_HTTP_HSTS_INCLUDE_SUBDOMAINS', false);
    const preload = readBooleanEnv(process.env, 'COPILOT_MCP_HTTP_HSTS_PRELOAD', false);
    return [
        `max-age=${maxAge}`,
        ...(includeSubDomains ? ['includeSubDomains'] : []),
        ...(preload ? ['preload'] : []),
    ].join('; ');
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
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {McpHttpRequest} req
 * @returns {string | undefined}
 */
function firstForwardedProto(req) {
    const value = readHeader(req, 'x-forwarded-proto');
    return value?.split(',')[0]?.trim().toLowerCase() || undefined;
}

/**
 * @param {McpHttpResponse} res
 * @returns {void}
 */
function setNoStoreResponseHeaders(res) {
    res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');
    appendVaryHeader(res, ['Origin', 'Accept', 'Accept-Encoding']);
}

/**
 * @param {URL} url
 * @param {McpHttpResponse} res
 * @returns {boolean}
 */
function rejectAccessTokenInUri(url, res) {
    if (!url.searchParams.has('access_token')) return false;
    writeJson(res, 400, {
        error: 'invalid_request',
        error_description: 'Bearer tokens must be sent with the Authorization header, not in the URI.',
    });
    return true;
}

/**
 * @param {McpHttpRequest} req
 * @param {import('../control-plane/auth.js').McpAuthConfig} config
 * @returns {boolean}
 */
function shouldIssueMcpUnauthorizedChallenge(req, config) {
    if (config.mode !== 'oauth') return false;
    return !parseBearerToken(readHeader(req, 'authorization'));
}

/**
 * @param {McpHttpResponse} res
 * @param {import('../control-plane/auth.js').McpAuthConfig} config
 * @returns {void}
 */
function writeMcpUnauthorizedChallenge(res, config) {
    const resource = `${config.resource}/mcp`;
    const metadataUrl = `${config.resource}/.well-known/oauth-protected-resource/mcp`;
    /** @type {[string, string][]} */
    const params = [
        ['realm', resource],
        ['resource_metadata', metadataUrl],
        ...(Array.isArray(config.scopesSupported) && config.scopesSupported.length > 0
            ? /** @type {[string, string][]} */ ([['scope', config.scopesSupported.join(' ')]])
            : []),
    ];
    res.setHeader(
        'WWW-Authenticate',
        `Bearer ${params.map(([name, value]) => `${name}=${quoteAuthParam(value)}`).join(', ')}`,
    );
    writeJson(res, 401, {
        error: 'unauthorized',
        error_description: 'Bearer token is required for MCP requests.',
        resource_metadata: metadataUrl,
    });
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteAuthParam(value) {
    return `"${String(value).replace(/["\\]/gu, '\\$&')}"`;
}

/**
 * @param {McpHttpResponse} res
 * @param {string} name
 * @param {string} value
 * @returns {void}
 */
function setHeaderIfAbsent(res, name, value) {
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    if (!response.hasHeader(name)) response.setHeader(name, value);
}

/**
 * @param {McpHttpResponse} res
 * @param {string[]} values
 * @returns {void}
 */
function appendVaryHeader(res, values) {
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    const existing = response.getHeader('Vary');
    const current = Array.isArray(existing)
        ? existing.flatMap((item) => String(item).split(','))
        : String(existing ?? '')
              .split(',')
              .filter(Boolean);
    const normalized = new Map();
    for (const value of [...current, ...values]) {
        const trimmed = String(value).trim();
        if (trimmed) normalized.set(trimmed.toLowerCase(), trimmed);
    }
    if (normalized.size > 0) response.setHeader('Vary', [...normalized.values()].join(', '));
}

/**
 * @param {McpHttpResponse} res
 * @param {string[]} methods
 * @returns {void}
 */
function writeMethodNotAllowed(res, methods) {
    res.setHeader('Allow', methods.join(', '));
    writeJson(res, 405, { error: 'method_not_allowed', allowed_methods: methods });
}

/**
 * @param {McpHttpRequest} req
 * @param {string} name
 * @returns {string | undefined}
 */
export function readHeader(req, name) {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
    return typeof value === 'string' ? value : undefined;
}

/**
 * @param {McpHttpRequest} req
 * @returns {import('../control-plane/auth.js').McpAuthContext}
 */
function buildAuthContext(req) {
    const authorizationHeader = readHeader(req, 'authorization');
    return {
        bearerToken: parseBearerToken(authorizationHeader),
        headers: req.headers,
    };
}

/**
 * @param {McpHttpRequest} req
 * @param {McpHttpResponse} res
 * @returns {Promise<void>}
 */
async function handleMcpRequest(req, res) {
    const server = createCopilotMcpServer({ authContext: buildAuthContext(req) });
    const transport = new StreamableHTTPServerTransport(
        /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransportOptions} */ (
            /** @type {unknown} */ ({ sessionIdGenerator: undefined, enableJsonResponse: true })
        ),
    );
    let closed = false;
    const closeOnce = () => {
        if (closed) return;
        closed = true;
        void transport.close();
        void server.close();
    };
    res.on('close', closeOnce);
    try {
        await server.connect(
            /** @type {import('@modelcontextprotocol/sdk/shared/transport.js').Transport} */ (transport),
        );
        await transport.handleRequest(
            /** @type {import('node:http').IncomingMessage} */ (req),
            /** @type {import('node:http').ServerResponse} */ (res),
        );
    } finally {
        if (res.writableEnded) closeOnce();
    }
}

/**
 * @param {McpHttpResponse} res
 * @param {number} statusCode
 * @param {unknown} payload
 * @param {string} [cacheControl]
 * @returns {void}
 */
export function writeJson(res, statusCode, payload, cacheControl = NO_STORE_CACHE_CONTROL) {
    const body = JSON.stringify(payload);
    const headers = {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': cacheControl,
        ...(cacheControl.includes('no-store') ? { pragma: 'no-cache', 'surrogate-control': 'no-store' } : {}),
        ...(cacheControl.includes('no-store') ? {} : { etag: buildWeakJsonEtag(body) }),
        'x-content-type-options': 'nosniff',
    };
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    response.writeHead(statusCode, headers);
    response.end(body);
}

/**
 * @param {McpHttpResponse} res
 * @param {number} statusCode
 * @returns {void}
 */
function writeEmpty(res, statusCode) {
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    response.writeHead(statusCode, {
        'content-length': '0',
        'cache-control': NO_STORE_CACHE_CONTROL,
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
    });
    response.end();
}

/**
 * @param {McpHttpResponse} res
 * @param {number} statusCode
 * @param {string} body
 * @returns {void}
 */
function writeText(res, statusCode, body) {
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    response.writeHead(statusCode, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': NO_STORE_CACHE_CONTROL,
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
    });
    response.end(body);
}

/**
 * @param {McpHttpResponse} res
 * @returns {void}
 */
function safeEnd(res) {
    try {
        res.end();
    } catch {
        // Best-effort termination only.
    }
}

/**
 * @param {string} body
 * @returns {string}
 */
function buildWeakJsonEtag(body) {
    return `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 16)}"`;
}
