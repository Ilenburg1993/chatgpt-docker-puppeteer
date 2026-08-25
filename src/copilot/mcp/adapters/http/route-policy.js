// @ts-check
/**
 * Static HTTP route/CORS policy for the Node host adapters.
 *
 * This module is immutable lookup data plus a small policy constructor. It owns no process/runtime state and performs
 * no environment discovery.
 *
 * @module copilot/mcp/adapters/http/route-policy
 */

export const MCP_PATH = '/mcp';

const DEFAULT_CORS_ALLOWED_HEADERS = /** @type {const} */ ([
    'accept',
    'authorization',
    'content-type',
    'dpop',
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

/**
 * @typedef {{
 *     methods: string[];
 *     allowHeaders: string[];
 *     exposeHeaders: string[];
 *     maxAgeSeconds: number;
 *     jsonRpcErrors?: boolean;
 * }} CorsRoutePolicy
 */

/** @param {string[]} methods @param {{ jsonRpcErrors?: boolean }} [options] @returns {CorsRoutePolicy} */
export function buildCorsPolicy(methods, options = {}) {
    /** @type {CorsRoutePolicy} */
    const policy = {
        methods,
        allowHeaders: [...DEFAULT_CORS_ALLOWED_HEADERS],
        exposeHeaders: [...DEFAULT_CORS_EXPOSED_HEADERS],
        maxAgeSeconds: 600,
    };
    if (options.jsonRpcErrors !== undefined) policy.jsonRpcErrors = options.jsonRpcErrors;
    return policy;
}

/** @type {Readonly<Record<string, CorsRoutePolicy>>} */
export const CORS_ROUTE_POLICIES = Object.freeze({
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
    '/oauth/par': buildCorsPolicy(['POST']),
    '/oauth/token': buildCorsPolicy(['POST']),
    '/oauth/revoke': buildCorsPolicy(['POST']),
    '/oauth/introspect': buildCorsPolicy(['POST']),
    '/oauth/userinfo': buildCorsPolicy(['GET']),
});

/** @type {Readonly<Record<string, readonly string[]>>} */
export const KNOWN_ROUTE_METHODS = Object.freeze({
    '/': Object.freeze(['GET']),
    '/health': Object.freeze(['GET']),
    [MCP_PATH]: Object.freeze(['POST', 'GET', 'DELETE']),
    '/chatgpt-connector.json': Object.freeze(['GET']),
    '/.well-known/oauth-protected-resource': Object.freeze(['GET']),
    '/.well-known/oauth-protected-resource/mcp': Object.freeze(['GET']),
    '/.well-known/oauth-authorization-server': Object.freeze(['GET']),
    '/.well-known/openid-configuration': Object.freeze(['GET']),
    '/.well-known/oauth-client/codex-smoke.json': Object.freeze(['GET']),
    '/oauth/authorize': Object.freeze(['GET']),
    '/oauth/jwks.json': Object.freeze(['GET']),
    '/oauth/register': Object.freeze(['POST']),
    '/oauth/par': Object.freeze(['POST']),
    '/oauth/token': Object.freeze(['POST']),
    '/oauth/revoke': Object.freeze(['POST']),
    '/oauth/introspect': Object.freeze(['POST']),
    '/oauth/userinfo': Object.freeze(['GET']),
});

/** @param {string} pathname @returns {CorsRoutePolicy | undefined} */
export function readCorsRoutePolicy(pathname) {
    return CORS_ROUTE_POLICIES[pathname];
}
