// @ts-check
/**
 * Pure HTTP host policy parsing for one MCP process generation.
 *
 * Environment access is confined to parser defaults. `McpProcessConfig` supplies an explicit environment at process
 * composition time, so request handling consumes immutable snapshots and never rediscovers ambient configuration.
 *
 * @module copilot/mcp/adapters/http/config
 */

import {
    MCP_PROTOCOL_LEGACY_DEFAULT_VERSION,
    MCP_PROTOCOL_LEGACY_SUPPORTED_VERSIONS,
    MCP_PROTOCOL_MODERN_VERSION,
} from '#copilot/mcp/public/protocol/version';
import { readMcpHttpStatefulSessionPolicy } from '#copilot/mcp/public/transport/http/stateful/config';
import { CORS_ROUTE_POLICIES } from './route-policy.js';

const DEFAULT_ALLOWED_ORIGINS = /** @type {const} */ ([
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://platform.openai.com',
    'https://claude.ai',
    'https://www.claude.ai',
    'http://localhost',
    'http://127.0.0.1',
]);
const DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS = 90_000;
const DEFAULT_HTTP_HEADERS_TIMEOUT_MS = 95_000;
const DEFAULT_HTTP_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_HSTS_MAX_AGE_SECONDS = 31_536_000;
const DEFAULT_MAX_MCP_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_ANONYMOUS_MCP_RATE_LIMIT_WINDOW_MS = 10_000;
const DEFAULT_ANONYMOUS_MCP_RATE_LIMIT_REQUESTS = 40;
const DEFAULT_ANONYMOUS_MCP_RATE_LIMIT_MAX_BUCKETS = 10_000;
const PROTOCOL_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** @param {unknown} value */
export function isMcpProtocolVersion(value) {
    return PROTOCOL_VERSION_PATTERN.test(String(value ?? ''));
}

/** @param {NodeJS.ProcessEnv} [env] */
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

/** @param {NodeJS.ProcessEnv} [env] */
export function readMcpHttpSessionPolicy(env = process.env) {
    return readMcpHttpStatefulSessionPolicy(env);
}

/** @param {NodeJS.ProcessEnv} [env] @param {ReturnType<typeof readMcpHttpSessionPolicy>} [sessionPolicy] */
export function readMcpHttpTransportPolicy(env = process.env, sessionPolicy = readMcpHttpSessionPolicy(env)) {
    return {
        minimumOriginProtocol: /** @type {const} */ ('HTTP/2+'),
        nodeHandlerMode: /** @type {const} */ ('http1-and-http2-compat'),
        cloudflareHttp2ToOriginExpected: /** @type {const} */ (true),
        statelessMcpTransport: !sessionPolicy.enabled,
        statefulSessionRuntime: sessionPolicy.enabled,
        protocolMode: /** @type {const} */ ('dual-era'),
        modernProtocolVersion: MCP_PROTOCOL_MODERN_VERSION,
        legacyDefaultProtocolVersion: MCP_PROTOCOL_LEGACY_DEFAULT_VERSION,
        legacySupportedProtocolVersions: readSupportedLegacyMcpProtocolVersions(env),
        supportedProtocolVersions: [MCP_PROTOCOL_MODERN_VERSION, ...readSupportedLegacyMcpProtocolVersions(env)],
        strictAcceptHeaders: readStrictMcpAcceptHeaders(env),
        strictContentType: readStrictMcpContentType(env),
        maxRequestBodyBytes: readMaxMcpRequestBodyBytes(env),
        originValidation: /** @type {const} */ ('all-incoming-connections'),
    };
}

/** @param {NodeJS.ProcessEnv} [env] */
export function readMcpHttpCorsPolicy(env = process.env) {
    return {
        allowedOrigins: readAllowedOrigins(env),
        routeCount: Object.keys(CORS_ROUTE_POLICIES).length,
        authorizationEndpointCors: /** @type {const} */ (false),
    };
}

/**
 * Pure rate-limit configuration. Runtime bucket counts belong to the listener-generation rate-limiter instance, not
 * to process configuration.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function readMcpAnonymousRateLimitPolicy(env = process.env) {
    return {
        enabled: readBooleanEnv(env, 'COPILOT_MCP_ANONYMOUS_RATE_LIMIT_ENABLED', true),
        windowMs: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_ANONYMOUS_RATE_LIMIT_WINDOW_MS',
            DEFAULT_ANONYMOUS_MCP_RATE_LIMIT_WINDOW_MS,
            1_000,
        ),
        requestsPerWindow: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_ANONYMOUS_RATE_LIMIT_REQUESTS',
            DEFAULT_ANONYMOUS_MCP_RATE_LIMIT_REQUESTS,
            1,
        ),
        maxBuckets: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_ANONYMOUS_RATE_LIMIT_MAX_BUCKETS',
            DEFAULT_ANONYMOUS_MCP_RATE_LIMIT_MAX_BUCKETS,
            16,
        ),
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ statefulConfig?: import('#copilot/mcp/public/transport/http/stateful/config').McpHttpStatefulProcessConfig }} [options]
 */
export function readMcpHttpRequestPolicy(env = process.env, options = {}) {
    const session = options.statefulConfig?.policy ?? readMcpHttpSessionPolicy(env);
    return {
        timing: readMcpHttpServerTimingPolicy(env),
        session,
        transport: readMcpHttpTransportPolicy(env, session),
        cors: readMcpHttpCorsPolicy(env),
        anonymousRateLimit: readMcpAnonymousRateLimitPolicy(env),
        enforcePostSessionContract:
            options.statefulConfig?.postSessionContractEnforced ?? readMcpPostSessionContractEnforcement(env),
        hsts: {
            enabled: readBooleanEnv(env, 'COPILOT_MCP_HTTP_HSTS_ENABLED', true),
            maxAgeSeconds: readPositiveIntegerEnv(
                env,
                'COPILOT_MCP_HTTP_HSTS_MAX_AGE_SECONDS',
                DEFAULT_HSTS_MAX_AGE_SECONDS,
                0,
            ),
            includeSubDomains: readBooleanEnv(env, 'COPILOT_MCP_HTTP_HSTS_INCLUDE_SUBDOMAINS', false),
            preload: readBooleanEnv(env, 'COPILOT_MCP_HTTP_HSTS_PRELOAD', false),
        },
        proxy: {
            trustProxyHeaders: readProxyTrustMode(env['COPILOT_MCP_HTTP_TRUST_PROXY_HEADERS']),
            trustXForwardedFor: readBooleanEnv(env, 'COPILOT_MCP_HTTP_TRUST_X_FORWARDED_FOR', false),
        },
    };
}

/** @param {unknown} value @returns {'always' | 'never' | 'loopback'} */
function readProxyTrustMode(value) {
    const raw = String(value ?? 'loopback')
        .trim()
        .toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on' || raw === 'always') return 'always';
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off' || raw === 'never') return 'never';
    return 'loopback';
}

/** @param {NodeJS.ProcessEnv} env @param {string} name @param {number} fallback @param {number} minimum */
function readPositiveIntegerEnv(env, name, fallback, minimum) {
    const parsed = Number(env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

/** @param {NodeJS.ProcessEnv} env @param {string} name @param {boolean} fallback */
function readBooleanEnv(env, name, fallback) {
    const raw = String(env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** @param {NodeJS.ProcessEnv} [env] @returns {string[]} */
function readAllowedOrigins(env = process.env) {
    const configured = String(env['COPILOT_MCP_ALLOWED_ORIGINS'] ?? '')
        .split(',')
        .map((item) => normalizeAllowedOriginCandidate(item))
        .filter(Boolean);
    return configured.length > 0
        ? /** @type {string[]} */ ([...new Set(configured)])
        : /** @type {string[]} */ ([
              ...new Set(DEFAULT_ALLOWED_ORIGINS.map((item) => normalizeAllowedOriginCandidate(item)).filter(Boolean)),
          ]);
}

/** @param {string} value */
function normalizeAllowedOriginCandidate(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '*') return '';
    try {
        const parsed = new URL(raw);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
        return parsed.origin;
    } catch {
        return '';
    }
}

/** @param {NodeJS.ProcessEnv} [env] */
function readSupportedLegacyMcpProtocolVersions(env = process.env) {
    const configured = String(env['COPILOT_MCP_SUPPORTED_PROTOCOL_VERSIONS'] ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => isMcpProtocolVersion(item));
    return configured.length > 0 ? [...new Set(configured)] : [...MCP_PROTOCOL_LEGACY_SUPPORTED_VERSIONS];
}

/** @param {NodeJS.ProcessEnv} [env] */
function readStrictMcpAcceptHeaders(env = process.env) {
    return readBooleanEnv(env, 'COPILOT_MCP_STRICT_ACCEPT_HEADERS', true);
}

/** @param {NodeJS.ProcessEnv} [env] */
function readMaxMcpRequestBodyBytes(env = process.env) {
    return readPositiveIntegerEnv(env, 'COPILOT_MCP_MAX_REQUEST_BODY_BYTES', DEFAULT_MAX_MCP_REQUEST_BODY_BYTES, 1024);
}

/** @param {NodeJS.ProcessEnv} [env] */
function readStrictMcpContentType(env = process.env) {
    return readBooleanEnv(env, 'COPILOT_MCP_STRICT_CONTENT_TYPE', true);
}

/** @param {NodeJS.ProcessEnv} [env] */
function readMcpPostSessionContractEnforcement(env = process.env) {
    return readBooleanEnv(env, 'COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT', false);
}
