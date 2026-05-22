// @ts-check
/**
 * Cloudflare Tunnel configuration helpers for the Copilot MCP endpoint.
 *
 * @module copilot/mcp/cloudflare/config
 */

import { normalizeMcpUrl, validatePublicConnectorUrl } from '../connection/profile.js';

export const DEFAULT_CLOUDFLARE_ORIGIN_URL = 'http://127.0.0.1:3333';
export const DEFAULT_QUICK_TUNNEL_STATE_FILE = 'src/copilot/.ai/cloudflare/quick-tunnel.json';
export const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com\b/i;

/**
 * @typedef {object} CloudflareTunnelConfig
 * @property {string} originUrl
 * @property {string} healthUrl
 * @property {string} localMcpUrl
 * @property {string | undefined} publicMcpUrl
 * @property {boolean} hasTunnelToken
 * @property {'auto' | 'http2' | 'quic'} transportProtocol
 * @property {string} stateFile
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {CloudflareTunnelConfig}
 */
export function readCloudflareTunnelConfig(env = process.env) {
    const originUrl = normalizeOriginUrl(env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL']);
    const publicInput = env['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL'] ?? env['COPILOT_MCP_PUBLIC_URL'];
    return {
        originUrl,
        healthUrl: `${originUrl}/health`,
        localMcpUrl: `${originUrl}/mcp`,
        publicMcpUrl: publicInput ? normalizeMcpUrl(publicInput) : undefined,
        hasTunnelToken: Boolean(env['CLOUDFLARE_TUNNEL_TOKEN']?.trim()),
        transportProtocol: normalizeTransportProtocol(
            env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'] ?? env['TUNNEL_TRANSPORT_PROTOCOL'],
        ),
        stateFile: normalizeStateFile(env['COPILOT_MCP_CLOUDFLARE_STATE_FILE']),
    };
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
    return ['tunnel', '--url', config.originUrl, '--no-autoupdate'];
}

/**
 * @param {string | undefined} token
 * @returns {string[]}
 */
export function buildManagedTunnelArgs(token) {
    const trimmed = String(token ?? '').trim();
    if (!trimmed) {
        throw new Error('CLOUDFLARE_TUNNEL_TOKEN is required to run a remotely-managed Cloudflare Tunnel.');
    }
    return ['tunnel', '--no-autoupdate', 'run', '--token', trimmed];
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
