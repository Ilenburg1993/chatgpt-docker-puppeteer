// @ts-check
/**
 * Process-scoped configuration projection for the MCP connection owner.
 *
 * The connection owner consumes normalized auth and Cloudflare configuration plus a small connector-profile projection.
 * Secret material is deliberately absent: auth credentials remain owned by the auth runtime and are never propagated to
 * tool handlers through this contract.
 *
 * @module copilot/mcp/connection/config
 */

import { readMcpAuthConfig } from '#copilot/mcp/public/auth';
import { DEFAULT_PUBLIC_MCP_URL, MCP_PATH, normalizeMcpUrl } from './url.js';

const DEFAULT_LOCAL_HTTP_ORIGIN_URL = 'http://127.0.0.1:3333';
const DEFAULT_LOCAL_HTTP2_ORIGIN_URL = 'https://127.0.0.1:3333';
const DEFAULT_TUNNEL_ID_PLACEHOLDER = 'tunnel_<preencher>';
const MAX_TUNNEL_ID_LENGTH = 160;

export const MCP_CONNECTION_PROFILE_DEFAULTS = Object.freeze({
    localHttpOriginUrl: DEFAULT_LOCAL_HTTP_ORIGIN_URL,
    localHttp2OriginUrl: DEFAULT_LOCAL_HTTP2_ORIGIN_URL,
    localHttpMcpUrl: `${DEFAULT_LOCAL_HTTP_ORIGIN_URL}${MCP_PATH}`,
    localHttp2McpUrl: `${DEFAULT_LOCAL_HTTP2_ORIGIN_URL}${MCP_PATH}`,
    tunnelIdPlaceholder: DEFAULT_TUNNEL_ID_PLACEHOLDER,
});

/**
 * @typedef {'none-dev' | 'mixed-auth' | 'oauth' | 'secure-mcp-tunnel'} ChatGptAuthMode
 *
 * @typedef {Readonly<{
 *     chatGptAuthMode: ChatGptAuthMode;
 *     tunnelId: string;
 *     publicMcpUrl: string;
 *     localMcpUrl: string;
 *     originTransport: 'http' | 'http2';
 *     cloudflareTunnelTransport: 'auto' | 'http2' | 'quic';
 *     cloudflareHttp2OriginRequested: boolean;
 *     cloudflareOriginUrl: string;
 * }>} McpConnectionProfileConfig
 *
 * @typedef {Readonly<{
 *     auth: import('#copilot/mcp/public/auth').McpAuthConfig;
 *     profile: McpConnectionProfileConfig;
 *     oauthDiagnosticsAllowLoopback: boolean;
 * }>} McpConnectionConfig
 *
 * @typedef {Readonly<{
 *     owner: McpConnectionConfig;
 *     cloudflare: import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig;
 * }>} McpConnectionRuntimeConfig
 */

/**
 * Capture one immutable connection-owner configuration generation.
 *
 * `dependencies` exists so composition can reuse auth/Cloudflare projections already parsed from the same environment
 * generation instead of reparsing them. Standalone callers retain an explicit-env fallback for tests and CLI helpers.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ authConfig?: import('#copilot/mcp/public/auth').McpAuthConfig }} [dependencies]
 * @returns {McpConnectionConfig}
 */
export function readMcpConnectionConfig(env = process.env, dependencies = {}) {
    const auth = dependencies.authConfig ?? readMcpAuthConfig(env);
    const originTransport = resolveProfileOriginTransport(env);
    const cloudflareHttp2OriginRequested = readBooleanEnv(env['COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN'], false);
    const cloudflareOriginUrl = readProfileCloudflareOriginUrl(env, originTransport, cloudflareHttp2OriginRequested);
    const localMcpUrl = normalizeMcpUrl(
        env['COPILOT_MCP_LOCAL_URL'] ??
            (originTransport === 'http2'
                ? MCP_CONNECTION_PROFILE_DEFAULTS.localHttp2McpUrl
                : MCP_CONNECTION_PROFILE_DEFAULTS.localHttpMcpUrl),
    );
    const publicMcpUrl = normalizeMcpUrl(
        env['COPILOT_MCP_PUBLIC_URL'] ?? env['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL'] ?? DEFAULT_PUBLIC_MCP_URL,
    );

    return Object.freeze({
        auth,
        profile: Object.freeze({
            chatGptAuthMode: normalizeChatGptAuthMode(env['COPILOT_MCP_CHATGPT_AUTH_MODE']),
            tunnelId: normalizeTunnelId(env['OPENAI_MCP_TUNNEL_ID']),
            publicMcpUrl,
            localMcpUrl,
            originTransport,
            cloudflareTunnelTransport: resolveProfileCloudflareTunnelTransport(env),
            cloudflareHttp2OriginRequested,
            cloudflareOriginUrl,
        }),
        oauthDiagnosticsAllowLoopback: readBooleanEnv(env['COPILOT_MCP_OAUTH_DIAGNOSTICS_ALLOW_LOOPBACK'], false),
    });
}

/**
 * Compose the connection owner config with the separately-owned Cloudflare projection. This function performs no
 * environment reads and introduces no connection -> Cloudflare runtime dependency; composition supplies both values.
 *
 * @param {McpConnectionConfig} owner
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} cloudflare
 * @returns {McpConnectionRuntimeConfig}
 */
export function createMcpConnectionRuntimeConfig(owner, cloudflare) {
    return Object.freeze({ owner, cloudflare });
}

/**
 * Require the connection projection from a composition-created tool operation context.
 *
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext | undefined} operationContext
 * @returns {McpConnectionRuntimeConfig}
 */
export function requireMcpToolConnectionConfig(operationContext) {
    const config = operationContext?.config.connection;
    if (!config) throw new TypeError('MCP connection tool execution requires a connection configuration projection.');
    return config;
}

/**
 * Resolve caller profile overrides against one immutable process generation.
 *
 * @param {{ publicMcpUrl?: string; localMcpUrl?: string; authMode?: ChatGptAuthMode; tunnelId?: string }} options
 * @param {McpConnectionConfig} config
 */
export function resolveMcpConnectionProfileOptions(options, config) {
    return Object.freeze({
        publicMcpUrl: normalizeMcpUrl(options.publicMcpUrl ?? config.profile.publicMcpUrl),
        localMcpUrl: normalizeMcpUrl(options.localMcpUrl ?? config.profile.localMcpUrl),
        authMode: normalizeChatGptAuthMode(options.authMode ?? config.profile.chatGptAuthMode),
        tunnelId: normalizeTunnelId(options.tunnelId ?? config.profile.tunnelId),
    });
}

/** @param {string | undefined} value @returns {ChatGptAuthMode} */
function normalizeChatGptAuthMode(value) {
    const raw = String(value ?? 'oauth')
        .trim()
        .toLowerCase();
    if (raw === 'oauth' || raw === 'team-oauth') return 'oauth';
    if (raw === 'mixed' || raw === 'mixed-auth' || raw === 'dev-mixed-auth') return 'mixed-auth';
    if (raw === 'secure-mcp-tunnel') return 'secure-mcp-tunnel';
    if (raw === 'none' || raw === 'noauth' || raw === 'none-dev' || raw === 'dev-noauth') return 'none-dev';
    return 'oauth';
}

/** @param {string | undefined} value */
function normalizeTunnelId(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed || hasAsciiControlChars(trimmed) || trimmed.length > MAX_TUNNEL_ID_LENGTH) {
        return DEFAULT_TUNNEL_ID_PLACEHOLDER;
    }
    return trimmed;
}

/** @param {NodeJS.ProcessEnv} env @returns {'http' | 'http2'} */
function resolveProfileOriginTransport(env) {
    const explicit = String(env['COPILOT_MCP_ORIGIN_TRANSPORT'] ?? '')
        .trim()
        .toLowerCase();
    if (explicit === 'http' || explicit === 'http2') return explicit;
    if (readBooleanEnv(env['COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN'], false)) return 'http2';
    const originUrl = String(env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL'] ?? '')
        .trim()
        .toLowerCase();
    return originUrl.startsWith('https://') ? 'http2' : 'http';
}

/** @param {NodeJS.ProcessEnv} env @returns {'auto' | 'http2' | 'quic'} */
function resolveProfileCloudflareTunnelTransport(env) {
    const raw = String(env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'] ?? env['TUNNEL_TRANSPORT_PROTOCOL'] ?? 'auto')
        .trim()
        .toLowerCase();
    if (raw === 'auto' || raw === 'http2' || raw === 'quic') return raw;
    return 'http2';
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {'http' | 'http2'} originTransport
 * @param {boolean} cloudflareHttp2OriginRequested
 */
function readProfileCloudflareOriginUrl(env, originTransport, cloudflareHttp2OriginRequested) {
    const fallback =
        originTransport === 'http2' || cloudflareHttp2OriginRequested
            ? DEFAULT_LOCAL_HTTP2_ORIGIN_URL
            : DEFAULT_LOCAL_HTTP_ORIGIN_URL;
    const raw = String(env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL'] ?? fallback)
        .trim()
        .replace(/\/+$/u, '');
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
        if (parsed.username || parsed.password || parsed.search || parsed.hash) return fallback;
        parsed.pathname = parsed.pathname.replace(/\/mcp$/u, '').replace(/\/+$/u, '');
        return parsed.toString().replace(/\/+$/u, '');
    } catch {
        return fallback;
    }
}

/** @param {string | undefined} value @param {boolean} fallback */
function readBooleanEnv(value, fallback) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/** @param {string} value */
function hasAsciiControlChars(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) return true;
    }
    return false;
}
