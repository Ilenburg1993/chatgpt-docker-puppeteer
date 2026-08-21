// @ts-check
/**
 * Cloudflare Tunnel configuration helpers for the Copilot MCP endpoint.
 *
 * This module is intentionally small and dependency-light because it is imported by CLI commands, connector profiles
 * and MCP diagnostic tools. It normalizes only Cloudflare/MCP transport configuration and never reads token file
 * contents.
 *
 * Canonical 2026 posture:
 *
 * - Public MCP URL is HTTPS and path-specific at /mcp.
 * - Cloudflare named tunnel is the default operating mode.
 * - cloudflared edge transport defaults to Cloudflare auto transport for UDP-first operation with TCP fallback.
 * - MCP origin transport is explicit through COPILOT_MCP_ORIGIN_TRANSPORT and defaults to HTTPS/HTTP2.
 *
 * @module copilot/mcp/cloudflare/config
 */

import { normalizeMcpUrl, validatePublicConnectorUrl } from '#copilot/mcp/connection';

export const DEFAULT_CLOUDFLARE_ORIGIN_URL = 'http://127.0.0.1:3333';
export const DEFAULT_CLOUDFLARE_H2_ORIGIN_URL = 'https://127.0.0.1:3333';
export const DEFAULT_CLOUDFLARE_TUNNEL_NAME = 'workspace-mcp-dev';
export const DEFAULT_CLOUDFLARE_ZONE = 'aurelin.org';
export const DEFAULT_CLOUDFLARE_PUBLIC_LABEL = 'mcp';
export const DEFAULT_CLOUDFLARE_PUBLIC_HOSTNAME = `${DEFAULT_CLOUDFLARE_PUBLIC_LABEL}.${DEFAULT_CLOUDFLARE_ZONE}`;
export const DEFAULT_CLOUDFLARE_PUBLIC_URL = `https://${DEFAULT_CLOUDFLARE_PUBLIC_HOSTNAME}/mcp`;
export const DEFAULT_QUICK_TUNNEL_STATE_FILE = 'src/copilot/.ai/cloudflare/quick-tunnel.json';
export const DEFAULT_CONNECTOR_SMOKE_STATE_FILE = 'src/copilot/.ai/cloudflare/connector-smoke.json';
export const DEFAULT_MANAGED_TUNNEL_PID_FILE = 'src/copilot/.ai/cloudflare/cloudflared.pid';
export const DEFAULT_MCP_HTTP_PID_FILE = 'src/copilot/.ai/cloudflare/mcp-http.pid';
export const DEFAULT_MANAGED_TUNNEL_LOG_FILE = 'src/copilot/.ai/cloudflare/cloudflared.log';
export const DEFAULT_MCP_HTTP_LOG_FILE = 'src/copilot/.ai/cloudflare/mcp-http.log';
export const DEFAULT_CLOUDFLARE_TUNNEL_TOKEN_FILE = 'src/copilot/.ai/cloudflare/workspace-mcp-dev.token';
export const DEFAULT_CLOUDFLARE_EDGE_BACKUP_DIR = 'src/copilot/.ai/cloudflare/edge-snapshots';
export const DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CLOUDFLARE_METRICS_ADDR = '127.0.0.1:60123';
export const DEFAULT_CLOUDFLARE_LOGLEVEL = 'info';
export const DEFAULT_CLOUDFLARE_TRANSPORT_PROTOCOL = 'auto';
export const DEFAULT_MCP_ORIGIN_TRANSPORT = 'http2';

/**
 * Matches trycloudflare URLs in stdout/stderr without capturing path, query or fragment.
 *
 * @type {RegExp}
 */
export const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com\b/i;

/**
 * @typedef {'named-permanent' | 'temporary-quick'} CloudflareTunnelMode
 *
 * @typedef {'auto' | 'http2' | 'quic'} CloudflareTunnelTransportProtocol
 *
 * @typedef {'http' | 'http2'} McpOriginTransport
 *
 * @typedef {'debug' | 'info' | 'warn' | 'error' | 'fatal'} CloudflareLogLevel
 *
 * @typedef {object} CloudflareTunnelConfig
 * @property {string} originUrl
 * @property {McpOriginTransport} originTransport
 * @property {boolean} http2OriginRequested
 * @property {string | undefined} originServerName
 * @property {string} healthUrl
 * @property {string} localMcpUrl
 * @property {string | undefined} publicMcpUrl
 * @property {CloudflareTunnelMode} mode
 * @property {string} tunnelName
 * @property {string} zone
 * @property {string} publicHostname
 * @property {boolean} hasTunnelToken
 * @property {boolean} hasTunnelTokenFile
 * @property {string | undefined} tunnelTokenFile
 * @property {CloudflareTunnelTransportProtocol} transportProtocol
 * @property {string | undefined} metricsAddr
 * @property {CloudflareLogLevel} loglevel
 * @property {string} stateFile
 * @property {string} smokeStateFile
 * @property {string} managedTunnelPidFile
 * @property {string} mcpHttpPidFile
 * @property {string} managedTunnelLogFile
 * @property {string} mcpHttpLogFile
 * @property {number} staleAfterMs
 * @property {{
 *     http2PlusDefault: true;
 *     edgeTransportDefault: CloudflareTunnelTransportProtocol;
 *     originTransportDefault: McpOriginTransport;
 *     remoteOriginMustMatchLocalOrigin: true;
 *     canonicalPublicPath: '/mcp';
 * }} http2Plus
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {CloudflareTunnelConfig}
 */
export function readCloudflareTunnelConfig(env = process.env) {
    const mode = normalizeTunnelMode(env['COPILOT_MCP_CLOUDFLARE_MODE']);
    const originTransport = normalizeOriginTransport(
        env['COPILOT_MCP_ORIGIN_TRANSPORT'],
        env['COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN'],
    );
    const originUrl = normalizeOriginUrl(env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL'], { originTransport });
    const tunnelName = normalizeTunnelName(env['COPILOT_MCP_CLOUDFLARE_TUNNEL_NAME']);
    const zone = normalizeZone(env['COPILOT_MCP_CLOUDFLARE_ZONE']);
    const publicHostname = normalizePublicHostname(env['COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME'], tunnelName, zone);
    const defaultPublicUrl = mode === 'named-permanent' ? `https://${publicHostname}/mcp` : undefined;
    const publicInput = env['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL'] ?? env['COPILOT_MCP_PUBLIC_URL'] ?? defaultPublicUrl;
    const publicMcpUrl = publicInput ? normalizePublicMcpUrl(publicInput, mode, publicHostname) : undefined;
    const tunnelTokenFile = normalizeOptionalPath(
        env['CLOUDFLARE_TUNNEL_TOKEN_FILE'] ?? DEFAULT_CLOUDFLARE_TUNNEL_TOKEN_FILE,
    );
    const config = {
        originUrl,
        originTransport,
        http2OriginRequested: originTransport === 'http2',
        originServerName: normalizeOriginServerName(
            env['COPILOT_MCP_CLOUDFLARE_ORIGIN_SERVER_NAME'],
            originUrl,
            publicHostname,
        ),
        healthUrl: `${originUrl}/health`,
        localMcpUrl: `${originUrl}/mcp`,
        publicMcpUrl,
        mode,
        tunnelName,
        zone,
        publicHostname,
        hasTunnelToken: Boolean(String(env['CLOUDFLARE_TUNNEL_TOKEN'] ?? '').trim()),
        hasTunnelTokenFile: Boolean(tunnelTokenFile),
        tunnelTokenFile,
        transportProtocol: normalizeTransportProtocol(
            env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'] ?? env['TUNNEL_TRANSPORT_PROTOCOL'],
        ),
        metricsAddr: normalizeMetricsAddr(env['COPILOT_MCP_CLOUDFLARE_METRICS_ADDR']),
        loglevel: normalizeLogLevel(env['COPILOT_MCP_CLOUDFLARE_LOGLEVEL']),
        stateFile: normalizeStateFile(env['COPILOT_MCP_CLOUDFLARE_STATE_FILE'], DEFAULT_QUICK_TUNNEL_STATE_FILE),
        smokeStateFile: normalizeStateFile(
            env['COPILOT_MCP_CLOUDFLARE_SMOKE_STATE_FILE'],
            DEFAULT_CONNECTOR_SMOKE_STATE_FILE,
        ),
        managedTunnelPidFile: normalizeStateFile(
            env['COPILOT_MCP_CLOUDFLARE_PID_FILE'],
            DEFAULT_MANAGED_TUNNEL_PID_FILE,
        ),
        mcpHttpPidFile: normalizeStateFile(env['COPILOT_MCP_HTTP_PID_FILE'], DEFAULT_MCP_HTTP_PID_FILE),
        managedTunnelLogFile: DEFAULT_MANAGED_TUNNEL_LOG_FILE,
        mcpHttpLogFile: DEFAULT_MCP_HTTP_LOG_FILE,
        staleAfterMs: normalizeStaleAfterMs(env['COPILOT_MCP_CLOUDFLARE_STALE_AFTER_MS']),
        http2Plus: {
            http2PlusDefault: /** @type {const} */ (true),
            edgeTransportDefault: /** @type {CloudflareTunnelTransportProtocol} */ (
                DEFAULT_CLOUDFLARE_TRANSPORT_PROTOCOL
            ),
            originTransportDefault: /** @type {McpOriginTransport} */ (DEFAULT_MCP_ORIGIN_TRANSPORT),
            remoteOriginMustMatchLocalOrigin: /** @type {const} */ (true),
            canonicalPublicPath: /** @type {const} */ ('/mcp'),
        },
    };
    assertConsistentCloudflareConfig(config);
    return config;
}

/**
 * @param {CloudflareTunnelConfig} config
 * @returns {void}
 */
function assertConsistentCloudflareConfig(config) {
    if (config.mode === 'named-permanent' && !config.publicMcpUrl) {
        throw new Error('Cloudflare named-permanent mode requires a public MCP URL.');
    }
    if (config.originTransport === 'http2' && !config.originUrl.startsWith('https://')) {
        throw new Error('HTTP/2 origin transport requires an HTTPS origin URL.');
    }
    if (config.originTransport === 'http' && !config.originUrl.startsWith('http://')) {
        throw new Error('HTTP origin transport requires an HTTP origin URL.');
    }
}

/**
 * @param {string | undefined} value
 * @returns {CloudflareTunnelMode}
 */
export function normalizeTunnelMode(value) {
    const mode = normalizeToken(value, 'named-permanent');
    if (mode === 'quick' || mode === 'temporary' || mode === 'temporary-quick' || mode === 'trycloudflare') {
        return 'temporary-quick';
    }
    if (mode === 'named' || mode === 'permanent' || mode === 'named-permanent' || mode === 'managed') {
        return 'named-permanent';
    }
    throw new Error('Cloudflare MCP tunnel mode must be named-permanent or temporary-quick.');
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
export function normalizeTunnelName(value) {
    const name = String(value ?? DEFAULT_CLOUDFLARE_TUNNEL_NAME)
        .trim()
        .toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/u.test(name)) {
        throw new Error('Cloudflare tunnel name must be a DNS-friendly label of 1-63 characters.');
    }
    return name;
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
export function normalizeZone(value) {
    const zone = normalizeHostname(value ?? DEFAULT_CLOUDFLARE_ZONE);
    if (!isPublicDnsHostname(zone) || !zone.includes('.')) {
        throw new Error('Cloudflare zone must be a valid public domain such as aurelin.org.');
    }
    return zone;
}

/**
 * @param {string | undefined} value
 * @param {string} tunnelName
 * @param {string} zone
 * @returns {string}
 */
export function normalizePublicHostname(value, tunnelName, zone) {
    void tunnelName;
    const hostname = normalizeHostname(value ?? `${DEFAULT_CLOUDFLARE_PUBLIC_LABEL}.${zone}`);
    if (hostname !== zone && !hostname.endsWith(`.${zone}`)) {
        throw new Error('Cloudflare public hostname must be the configured zone or a subdomain of it.');
    }
    if (!isPublicDnsHostname(hostname)) {
        throw new Error('Cloudflare public hostname must be a valid public DNS hostname.');
    }
    return hostname;
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function normalizeOptionalPath(value) {
    const filePath = String(value ?? '').trim();
    if (!filePath) return undefined;
    if (filePath.includes('\0')) throw new Error('Cloudflare token file path must not contain null bytes.');
    if (/[\r\n]/u.test(filePath)) throw new Error('Cloudflare token file path must be single-line.');
    return filePath;
}

/**
 * @param {string | undefined} value
 * @param {string} originUrl
 * @param {string} publicHostname
 * @returns {string | undefined}
 */
export function normalizeOriginServerName(value, originUrl, publicHostname) {
    if (!originUrl.startsWith('https://')) return undefined;
    const serverName = normalizeHostname(value ?? publicHostname);
    if (!isPublicDnsHostname(serverName) && !isLoopbackHostname(serverName)) {
        throw new Error(
            'Cloudflare HTTPS origin server name must be a DNS hostname covered by the origin certificate.',
        );
    }
    return serverName;
}

/**
 * Cloudflare defaults to auto/QUIC. This project defaults cloudflared to TCP HTTP/2 because Dev Containers and
 * corporate networks frequently have stricter UDP egress than HTTPS/TCP egress.
 *
 * @param {string | undefined} value
 * @returns {CloudflareTunnelTransportProtocol}
 */
export function normalizeTransportProtocol(value) {
    const protocol = normalizeToken(value, DEFAULT_CLOUDFLARE_TRANSPORT_PROTOCOL);
    if (protocol === 'auto' || protocol === 'http2' || protocol === 'quic') return protocol;
    throw new Error('Cloudflare tunnel protocol must be auto, http2, or quic.');
}

/**
 * @param {string | undefined} transportValue
 * @param {string | undefined} http2OriginValue
 * @returns {McpOriginTransport}
 */
export function normalizeOriginTransport(transportValue, http2OriginValue) {
    const explicit = normalizeToken(transportValue, '');
    if (explicit === 'http' || explicit === 'http1' || explicit === 'http1.1') return 'http';
    if (explicit === 'http2' || explicit === 'h2' || explicit === 'https-h2') return 'http2';
    if (explicit) throw new Error('MCP origin transport must be http or http2.');

    return readBooleanFlag(http2OriginValue, false) ? 'http2' : DEFAULT_MCP_ORIGIN_TRANSPORT;
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
export function normalizeMetricsAddr(value) {
    const raw = String(value ?? DEFAULT_CLOUDFLARE_METRICS_ADDR)
        .trim()
        .toLowerCase();
    if (!raw || raw === 'off' || raw === 'false' || raw === '0' || raw === 'none') return undefined;
    const parsed = parseHostPort(raw);
    if (!parsed || !isLocalMetricsHost(parsed.host)) {
        throw new Error('Cloudflare metrics address must be local host:port, for example 127.0.0.1:60123.');
    }
    if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) {
        throw new Error('Cloudflare metrics port must be between 1 and 65535.');
    }
    return `${parsed.host}:${parsed.port}`;
}

/**
 * @param {string | undefined} value
 * @returns {CloudflareLogLevel}
 */
export function normalizeLogLevel(value) {
    const raw = normalizeToken(value, DEFAULT_CLOUDFLARE_LOGLEVEL);
    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'fatal') return raw;
    throw new Error('Cloudflare loglevel must be debug, info, warn, error, or fatal.');
}

/**
 * @param {string | undefined} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeStateFile(value, fallback = DEFAULT_QUICK_TUNNEL_STATE_FILE) {
    const stateFile = String(value ?? fallback).trim();
    if (!stateFile) return fallback;
    if (stateFile.includes('\0')) throw new Error('Cloudflare state file path must not contain null bytes.');
    if (/[\r\n]/u.test(stateFile)) throw new Error('Cloudflare state file path must be single-line.');
    return stateFile;
}

/**
 * @param {string | undefined} value
 * @returns {number}
 */
export function normalizeStaleAfterMs(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 60_000 || parsed > 7 * 24 * 60 * 60 * 1000) {
        throw new Error('Cloudflare quick tunnel stale window must be between 60000 and 604800000 ms.');
    }
    return Math.round(parsed);
}

/**
 * @param {string | undefined} value
 * @param {{ originTransport?: McpOriginTransport }} [options]
 * @returns {string}
 */
export function normalizeOriginUrl(value, options = {}) {
    const originTransport = options.originTransport ?? inferOriginTransportFromEnv();
    const fallback = originTransport === 'http2' ? DEFAULT_CLOUDFLARE_H2_ORIGIN_URL : DEFAULT_CLOUDFLARE_ORIGIN_URL;
    const raw = String(value ?? fallback).trim();
    if (!raw) return fallback;
    if (/[\r\n\0]/u.test(raw)) throw new Error('Cloudflare origin URL must be single-line.');
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('Cloudflare origin URL must be a valid http:// or https:// URL.');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('Cloudflare origin URL must not include credentials, query string or fragment.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Cloudflare origin URL must start with http:// or https://.');
    }
    url.pathname = url.pathname.replace(/\/+$/u, '');
    if (url.pathname === '/mcp') url.pathname = '';
    if (url.pathname && url.pathname !== '/') {
        throw new Error('Cloudflare origin URL must point to the origin root, not a path.');
    }
    url.pathname = '';
    const normalized = url.toString().replace(/\/+$/u, '');
    if (originTransport === 'http2' && !normalized.startsWith('https://')) {
        throw new Error('HTTP/2 origin transport requires COPILOT_MCP_CLOUDFLARE_ORIGIN_URL to be https://.');
    }
    if (originTransport === 'http' && !normalized.startsWith('http://')) {
        throw new Error('HTTP origin transport requires COPILOT_MCP_CLOUDFLARE_ORIGIN_URL to be http://.');
    }
    if (!isAllowedOriginHostname(url.hostname)) {
        throw new Error(
            'Cloudflare origin hostname must be loopback, localhost or an explicitly configured HTTPS origin.',
        );
    }
    return normalized;
}

/**
 * @param {CloudflareTunnelConfig} config
 * @returns {string[]}
 */
export function buildQuickTunnelArgs(config) {
    return ['tunnel', ...buildCloudflaredRunFlags(config), '--url', config.originUrl];
}

/**
 * @param {string | undefined} token
 * @param {string | undefined} [tokenFile]
 * @param {CloudflareTunnelConfig} [config]
 * @returns {string[]}
 */
export function buildManagedTunnelArgs(token, tokenFile, config) {
    const trimmed = String(token ?? '').trim();
    const normalizedTokenFile = normalizeOptionalPath(tokenFile);
    const flags = config ? buildCloudflaredRunFlags(config) : ['--no-autoupdate'];
    if (normalizedTokenFile) {
        return ['tunnel', ...flags, 'run', '--token-file', normalizedTokenFile];
    }
    if (!trimmed) {
        throw new Error(
            'CLOUDFLARE_TUNNEL_TOKEN or CLOUDFLARE_TUNNEL_TOKEN_FILE is required to run a remotely-managed Cloudflare Tunnel.',
        );
    }
    if (/[\r\n\0]/u.test(trimmed)) {
        throw new Error('CLOUDFLARE_TUNNEL_TOKEN must be a single-line token.');
    }
    return ['tunnel', ...flags, 'run', '--token', trimmed];
}

/**
 * @param {CloudflareTunnelConfig} config
 * @returns {string[]}
 */
function buildCloudflaredRunFlags(config) {
    const flags = ['--no-autoupdate', '--loglevel', config.loglevel, '--protocol', config.transportProtocol];
    if (config.metricsAddr) flags.push('--metrics', config.metricsAddr);
    if (config.originServerName) flags.push('--origin-server-name', config.originServerName);
    return flags;
}

/**
 * @param {CloudflareTunnelConfig} config
 * @returns {{ ok: true } | { ok: false; reason: string } | undefined}
 */
export function validateConfiguredPublicUrl(config) {
    if (!config.publicMcpUrl) return undefined;
    return validatePublicConnectorUrl(config.publicMcpUrl);
}

/**
 * @param {string} text
 * @returns {string | undefined}
 */
export function extractTryCloudflareUrl(text) {
    const match = String(text).match(TRYCLOUDFLARE_URL_PATTERN);
    return match?.[0]?.replace(/\/+$/u, '');
}

/**
 * @param {string} publicBaseUrl
 * @returns {string}
 */
export function buildTemporaryConnectorUrl(publicBaseUrl) {
    const raw = String(publicBaseUrl || '').trim();
    if (/[\r\n\0]/u.test(raw)) throw new Error('Temporary Cloudflare connector URL must be single-line.');
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('Temporary Cloudflare connector URL must be a valid trycloudflare HTTPS URL.');
    }
    const hostname = normalizeHostname(url.hostname);
    if (url.protocol !== 'https:' || !hostname.endsWith('.trycloudflare.com')) {
        throw new Error('Temporary Cloudflare connector URL must use a trycloudflare.com HTTPS hostname.');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('Temporary Cloudflare connector URL must not include credentials, query string or fragment.');
    }
    url.pathname = url.pathname.replace(/\/+$/u, '');
    if (url.pathname && url.pathname !== '/' && url.pathname !== '/mcp') {
        throw new Error('Temporary Cloudflare connector URL must point to the root or /mcp.');
    }
    url.pathname = '';
    return normalizeMcpUrl(url.toString());
}

/**
 * @param {string | undefined} value
 * @param {CloudflareTunnelMode} mode
 * @param {string} publicHostname
 * @returns {string}
 */
function normalizePublicMcpUrl(value, mode, publicHostname) {
    const normalized = normalizeMcpUrl(value ?? '');
    const validation = validatePublicConnectorUrl(normalized);
    if (!validation.ok) throw new Error(validation.reason);
    const url = new URL(normalized);
    if (mode === 'named-permanent' && normalizeHostname(url.hostname) !== publicHostname) {
        throw new Error('Named Cloudflare tunnel public URL must use the configured public hostname.');
    }
    if (mode === 'temporary-quick' && !normalizeHostname(url.hostname).endsWith('.trycloudflare.com')) {
        throw new Error('Temporary Cloudflare tunnel public URL must use a trycloudflare.com hostname.');
    }
    return normalized;
}

/**
 * @returns {McpOriginTransport}
 */
function inferOriginTransportFromEnv() {
    return normalizeOriginTransport(
        process.env['COPILOT_MCP_ORIGIN_TRANSPORT'],
        process.env['COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN'],
    );
}

/**
 * @param {string | undefined} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeToken(value, fallback) {
    return String(value ?? fallback)
        .trim()
        .toLowerCase();
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeHostname(value) {
    const hostname = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//u, '')
        .replace(/\/.*$/u, '')
        .replace(/\.+$/u, '');
    if (!hostname || /[\s\0]/u.test(hostname) || hostname.length > 253) {
        throw new Error('Hostname must be a non-empty DNS name.');
    }
    return hostname;
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isPublicDnsHostname(hostname) {
    if (isLoopbackHostname(hostname)) return false;
    if (hostname.includes('..')) return false;
    const labels = hostname.split('.');
    return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHostname(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isAllowedOriginHostname(hostname) {
    const normalized = hostname.toLowerCase();
    return isLoopbackHostname(normalized) || normalized === '0.0.0.0';
}

/**
 * @param {string} host
 * @returns {boolean}
 */
function isLocalMetricsHost(host) {
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '0.0.0.0';
}

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanFlag(value, fallback) {
    const raw = normalizeToken(value, '');
    if (!raw) return fallback;
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {string} value
 * @returns {{ host: string; port: number } | null}
 */
function parseHostPort(value) {
    const bracketedIpv6 = /^\[(::1)\]:(\d{1,5})$/u.exec(value);
    if (bracketedIpv6?.[1] && bracketedIpv6[2]) {
        return { host: `[${bracketedIpv6[1]}]`, port: Number(bracketedIpv6[2]) };
    }
    const match = /^(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{1,5})$/u.exec(value);
    if (!match?.[1] || !match[2]) return null;
    return { host: match[1], port: Number(match[2]) };
}
