// @ts-check
/** HTTP admission/security policy application for the MCP Node host adapters. */

import { parseBearerToken } from '#copilot/mcp/public/auth';
import { chooseMcpProtocolVersion } from './envelope.js';
import { firstForwardedProto, readHeader } from './request-identity.js';
import { appendVaryHeader, setHeaderIfAbsent, writeJson } from './response.js';

/** @typedef {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} McpHttpRequest */
/** @typedef {import('node:http').ServerResponse | import('node:http2').Http2ServerResponse} McpHttpResponse */

/**
 * @param {McpHttpResponse} res
 * @param {string | undefined} origin
 * @param {import('./route-policy.js').CorsRoutePolicy} policy
 * @param {readonly string[]} allowedOrigins
 */
export function setCorsHeaders(res, origin, policy, allowedOrigins) {
    if (origin && isAllowedOrigin(origin, allowedOrigins)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', [...new Set([...policy.methods, 'OPTIONS'])].join(', '));
    res.setHeader('Access-Control-Allow-Headers', policy.allowHeaders.join(', '));
    res.setHeader('Access-Control-Expose-Headers', policy.exposeHeaders.join(', '));
    res.setHeader('Access-Control-Max-Age', String(policy.maxAgeSeconds));
    appendVaryHeader(res, ['Origin']);
}

/** @param {McpHttpResponse} res @param {import('./route-policy.js').CorsRoutePolicy} policy */
export function writeCorsForbidden(res, policy) {
    if (policy.jsonRpcErrors) {
        writeJson(res, 403, { jsonrpc: '2.0', error: { code: -32000, message: 'Origin is not allowed.' } });
        return;
    }
    writeJson(res, 403, { error: 'forbidden', error_description: 'Origin is not allowed.' });
}

/** @param {string | undefined} origin @param {readonly string[]} allowedOrigins */
export function isAllowedOrigin(origin, allowedOrigins) {
    if (!origin) return true;
    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    return allowedOrigins.some((candidate) => originMatchesAllowedCandidate(parsed, origin, candidate));
}

/**
 * @param {McpHttpRequest} req
 * @param {McpHttpResponse} res
 * @param {{ publicScheme?: 'http' | 'https' }} options
 * @param {ReturnType<typeof import('./config.js').readMcpHttpRequestPolicy>} requestPolicy
 */
export function setDefaultSecurityHeaders(req, res, options, requestPolicy) {
    setHeaderIfAbsent(res, 'MCP-Protocol-Version', chooseMcpProtocolVersion(req, requestPolicy.transport));
    setHeaderIfAbsent(res, 'X-Content-Type-Options', 'nosniff');
    setHeaderIfAbsent(res, 'Referrer-Policy', 'no-referrer');
    setHeaderIfAbsent(res, 'X-Frame-Options', 'DENY');
    setHeaderIfAbsent(res, 'Cross-Origin-Resource-Policy', 'same-site');
    setHeaderIfAbsent(res, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (shouldEmitHsts(req, options, requestPolicy)) {
        setHeaderIfAbsent(res, 'Strict-Transport-Security', buildHstsHeader(requestPolicy.hsts));
    }
}

/** @param {URL} url @param {McpHttpResponse} res */
export function rejectAccessTokenInUri(url, res) {
    if (!url.searchParams.has('access_token')) return false;
    writeJson(res, 400, {
        error: 'invalid_request',
        error_description: 'Bearer tokens must be sent with the Authorization header, not in the URI.',
    });
    return true;
}

/** @param {McpHttpResponse} res @param {number} retryAfterSeconds */
export function writeMcpRateLimited(res, retryAfterSeconds) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    writeJson(res, 429, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Too many anonymous MCP requests. Retry after the indicated delay.' },
    });
}

/** @param {McpHttpRequest} req @param {import('#copilot/mcp/public/auth').McpAuthConfig} config */
export function shouldIssueMcpUnauthorizedChallenge(req, config) {
    if (config.mode !== 'oauth') return false;
    return !parseBearerToken(readHeader(req, 'authorization'));
}

/** @param {McpHttpResponse} res @param {import('#copilot/mcp/public/auth').McpAuthConfig} config */
export function writeMcpUnauthorizedChallenge(res, config) {
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
 * @param {McpHttpRequest} req
 * @param {{ publicScheme?: 'http' | 'https' }} options
 * @param {ReturnType<typeof import('./config.js').readMcpHttpRequestPolicy>} requestPolicy
 */
function shouldEmitHsts(req, options, requestPolicy) {
    if (!requestPolicy.hsts.enabled) return false;
    return (
        options.publicScheme === 'https' ||
        readHeader(req, ':scheme') === 'https' ||
        firstForwardedProto(req, requestPolicy.proxy) === 'https'
    );
}

/** @param {ReturnType<typeof import('./config.js').readMcpHttpRequestPolicy>['hsts']} hstsPolicy */
function buildHstsHeader(hstsPolicy) {
    return [
        `max-age=${hstsPolicy.maxAgeSeconds}`,
        ...(hstsPolicy.includeSubDomains ? ['includeSubDomains'] : []),
        ...(hstsPolicy.preload ? ['preload'] : []),
    ].join('; ');
}

/** @param {URL} originUrl @param {string} origin @param {string} candidate */
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

/** @param {string} hostname */
function isLoopbackHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/\.$/u, '');
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1';
}

/** @param {string} value */
function quoteAuthParam(value) {
    return `"${String(value).replace(/["\\]/gu, '\\$&')}"`;
}
