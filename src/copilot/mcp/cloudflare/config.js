// @ts-check
/**
 * Cloudflare Tunnel configuration helpers for the Copilot MCP endpoint.
 *
 * @module copilot/mcp/cloudflare/config
 */

import { normalizeMcpUrl, validatePublicConnectorUrl } from '../connection/profile.js';

export const DEFAULT_CLOUDFLARE_ORIGIN_URL = 'http://127.0.0.1:3333';

/**
 * @typedef {object} CloudflareTunnelConfig
 * @property {string} originUrl
 * @property {string} healthUrl
 * @property {string} localMcpUrl
 * @property {string | undefined} publicMcpUrl
 * @property {boolean} hasTunnelToken
 * @property {'auto' | 'http2' | 'quic'} transportProtocol
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
