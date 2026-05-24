// @ts-check
/**
 * Cloudflare Tunnel configuration helpers for the Copilot MCP endpoint.
 *
 * @module copilot/mcp/cloudflare/config
 */

import { normalizeMcpUrl, validatePublicConnectorUrl } from '../connection/profile.js';

export const DEFAULT_CLOUDFLARE_ORIGIN_URL = 'http://127.0.0.1:3333';
export const DEFAULT_CLOUDFLARE_TUNNEL_NAME = 'workspace-mcp-dev';
export const DEFAULT_CLOUDFLARE_ZONE = 'aurelin.org';
export const DEFAULT_CLOUDFLARE_PUBLIC_LABEL = 'mcp';
export const DEFAULT_CLOUDFLARE_PUBLIC_HOSTNAME = `${DEFAULT_CLOUDFLARE_PUBLIC_LABEL}.${DEFAULT_CLOUDFLARE_ZONE}`;
export const DEFAULT_CLOUDFLARE_PUBLIC_URL = `https://${DEFAULT_CLOUDFLARE_PUBLIC_HOSTNAME}/mcp`;
export const DEFAULT_QUICK_TUNNEL_STATE_FILE = 'src/copilot/.ai/cloudflare/quick-tunnel.json';
export const DEFAULT_CONNECTOR_SMOKE_STATE_FILE = 'src/copilot/.ai/cloudflare/connector-smoke.json';
export const DEFAULT_MANAGED_TUNNEL_PID_FILE = 'src/copilot/.ai/cloudflare/cloudflared.pid';
export const DEFAULT_MCP_HTTP_PID_FILE = 'src/copilot/.ai/cloudflare/mcp-http.pid';
export const DEFAULT_CLOUDFLARE_EDGE_BACKUP_DIR = 'src/copilot/.ai/cloudflare/edge-snapshots';
export const DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_CLOUDFLARE_METRICS_ADDR = '127.0.0.1:60123';
export const DEFAULT_CLOUDFLARE_LOGLEVEL = 'info';
export const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com\b/i;

/**
 * @typedef {object} CloudflareTunnelConfig
 * @property {string} originUrl
 * @property {string} healthUrl
 * @property {string} localMcpUrl
 * @property {string | undefined} publicMcpUrl
 * @property {'named-permanent' | 'temporary-quick'} mode
 * @property {string} tunnelName
 * @property {string} zone
 * @property {string} publicHostname
 * @property {boolean} hasTunnelToken
 * @property {boolean} hasTunnelTokenFile
 * @property {string | undefined} tunnelTokenFile
 * @property {'auto' | 'http2' | 'quic'} transportProtocol
 * @property {string | undefined} metricsAddr
 * @property {'debug' | 'info' | 'warn' | 'error' | 'fatal'} loglevel
 * @property {string} stateFile
 * @property {string} smokeStateFile
 * @property {string} managedTunnelPidFile
 * @property {string} mcpHttpPidFile
 * @property {number} staleAfterMs
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {CloudflareTunnelConfig}
 */
export function readCloudflareTunnelConfig(env = process.env) {
    const mode = normalizeTunnelMode(env['COPILOT_MCP_CLOUDFLARE_MODE']);
    const originUrl = normalizeOriginUrl(env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL']);
    const tunnelName = normalizeTunnelName(env['COPILOT_MCP_CLOUDFLARE_TUNNEL_NAME']);
    const zone = normalizeZone(env['COPILOT_MCP_CLOUDFLARE_ZONE']);
    const publicHostname = normalizePublicHostname(env['COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME'], tunnelName, zone);
    const defaultPublicUrl = mode === 'named-permanent' ? `https://${publicHostname}/mcp` : undefined;
    const publicInput = env['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL'] ?? env['COPILOT_MCP_PUBLIC_URL'] ?? defaultPublicUrl;
    const tunnelTokenFile = normalizeOptionalPath(env['CLOUDFLARE_TUNNEL_TOKEN_FILE']);
    return {
        originUrl,
        healthUrl: `${originUrl}/health`,
        localMcpUrl: `${originUrl}/mcp`,
        publicMcpUrl: publicInput ? normalizeMcpUrl(publicInput) : undefined,
        mode,
        tunnelName,
        zone,
        publicHostname,
        hasTunnelToken: Boolean(env['CLOUDFLARE_TUNNEL_TOKEN']?.trim()),
        hasTunnelTokenFile: Boolean(tunnelTokenFile),
        tunnelTokenFile,
        transportProtocol: normalizeTransportProtocol(
            env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'] ?? env['TUNNEL_TRANSPORT_PROTOCOL'],
        ),
        metricsAddr: normalizeMetricsAddr(env['COPILOT_MCP_CLOUDFLARE_METRICS_ADDR']),
        loglevel: normalizeLogLevel(env['COPILOT_MCP_CLOUDFLARE_LOGLEVEL']),
        stateFile: normalizeStateFile(env['COPILOT_MCP_CLOUDFLARE_STATE_FILE']),
        smokeStateFile: normalizeStateFile(env['COPILOT_MCP_CLOUDFLARE_SMOKE_STATE_FILE'] ?? DEFAULT_CONNECTOR_SMOKE_STATE_FILE),
        managedTunnelPidFile: normalizeStateFile(env['COPILOT_MCP_CLOUDFLARE_PID_FILE'] ?? DEFAULT_MANAGED_TUNNEL_PID_FILE),
        mcpHttpPidFile: normalizeStateFile(env['COPILOT_MCP_HTTP_PID_FILE'] ?? DEFAULT_MCP_HTTP_PID_FILE),
        staleAfterMs: normalizeStaleAfterMs(env['COPILOT_MCP_CLOUDFLARE_STALE_AFTER_MS']),
    };
}

/**
 * @param {string | undefined} value
 * @returns {'named-permanent' | 'temporary-quick'}
 */
export function normalizeTunnelMode(value) {
    const mode = String(value ?? 'named-permanent')
        .trim()
        .toLowerCase();
    if (mode === 'quick' || mode === 'temporary' || mode === 'temporary-quick') return 'temporary-quick';
    if (mode === 'named' || mode === 'permanent' || mode === 'named-permanent') return 'named-permanent';
    throw new Error('Cloudflare MCP tunnel mode must be named-permanent or temporary-quick.');
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
export function normalizeTunnelName(value) {
    const name = String(value ?? DEFAULT_CLOUDFLARE_TUNNEL_NAME).trim();
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(name)) {
        throw new Error('Cloudflare tunnel name must be a DNS-friendly label.');
    }
    return name;
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
export function normalizeZone(value) {
    const zone = String(value ?? DEFAULT_CLOUDFLARE_ZONE)
        .trim()
        .toLowerCase()
        .replace(/\.+$/u, '');
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/u.test(zone)) {
        throw new Error('Cloudflare zone must be a valid domain such as aurelin.org.');
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
    const hostname = String(value ?? `${DEFAULT_CLOUDFLARE_PUBLIC_LABEL}.${zone}`)
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//u, '')
        .replace(/\/.*$/u, '')
        .replace(/\.+$/u, '');
    if (!hostname.endsWith(zone)) throw new Error('Cloudflare public hostname must live under the configured zone.');
    return hostname;
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function normalizeOptionalPath(value) {
    const path = String(value ?? '').trim();
    if (!path) return undefined;
    if (path.includes('\0')) throw new Error('Cloudflare token file path must not contain null bytes.');
    return path;
}

/**
 * Cloudflare defaults to auto/QUIC. The wrapper uses TCP HTTP/2 by default because
 * Dev Containers commonly have stricter UDP egress than HTTPS/TCP egress.
 *
 * @param {string | undefined} value
 * @returns {'auto' | 'http2' | 'quic'}
 */
export function normalizeTransportProtocol(value) {
    const protocol = String(value ?? 'http2').trim().toLowerCase();
    if (protocol === 'auto' || protocol === 'http2' || protocol === 'quic') return protocol;
    throw new Error('Cloudflare tunnel protocol must be auto, http2, or quic.');
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
export function normalizeMetricsAddr(value) {
    const raw = String(value ?? DEFAULT_CLOUDFLARE_METRICS_ADDR).trim();
    if (!raw || raw === 'off' || raw === 'false' || raw === '0') return undefined;
    if (!/^(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):\d{2,5}$/u.test(raw)) {
        throw new Error('Cloudflare metrics address must be localhost-style host:port, for example 127.0.0.1:60123.');
    }
    const port = Number(raw.slice(raw.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Cloudflare metrics port must be between 1 and 65535.');
    }
    return raw;
}

/**
 * @param {string | undefined} value
 * @returns {'debug' | 'info' | 'warn' | 'error' | 'fatal'}
 */
export function normalizeLogLevel(value) {
    const raw = String(value ?? DEFAULT_CLOUDFLARE_LOGLEVEL)
        .trim()
        .toLowerCase();
    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'fatal') return raw;
    throw new Error('Cloudflare loglevel must be debug, info, warn, error, or fatal.');
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
export function normalizeStateFile(value) {
    const stateFile = String(value ?? DEFAULT_QUICK_TUNNEL_STATE_FILE).trim();
    if (!stateFile) return DEFAULT_QUICK_TUNNEL_STATE_FILE;
    if (stateFile.includes('\0')) throw new Error('Cloudflare state file path must not contain null bytes.');
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
 * @returns {string}
 */
export function normalizeOriginUrl(value) {
    const raw = String(value ?? DEFAULT_CLOUDFLARE_ORIGIN_URL).trim().replace(/\/+$/, '');
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        throw new Error('Cloudflare origin URL must start with http:// or https://.');
    }
    return raw.replace(/\/mcp$/, '');
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
        throw new Error('CLOUDFLARE_TUNNEL_TOKEN or CLOUDFLARE_TUNNEL_TOKEN_FILE is required to run a remotely-managed Cloudflare Tunnel.');
    }
    return ['tunnel', ...flags, 'run', '--token', trimmed];
}

/**
 * @param {CloudflareTunnelConfig} config
 * @returns {string[]}
 */
function buildCloudflaredRunFlags(config) {
    const flags = ['--no-autoupdate', '--loglevel', config.loglevel];
    if (config.metricsAddr) flags.push('--metrics', config.metricsAddr);
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
    return match?.[0]?.replace(/\/+$/, '');
}

/**
 * @param {string} publicBaseUrl
 * @returns {string}
 */
export function buildTemporaryConnectorUrl(publicBaseUrl) {
    const base = String(publicBaseUrl || '').trim().replace(/\/+$/, '');
    if (!base.endsWith('.trycloudflare.com') && !base.includes('.trycloudflare.com/')) {
        throw new Error('Temporary Cloudflare connector URL must use a trycloudflare.com hostname.');
    }
    return normalizeMcpUrl(base);
}
