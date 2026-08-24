// @ts-check
/** Exact Cloudflare public membrane: config. */

export {
    DEFAULT_CLOUDFLARE_PUBLIC_URL,
    DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS,
    buildManagedTunnelArgs,
    buildQuickTunnelArgs,
    buildTemporaryConnectorUrl,
    extractTryCloudflareUrl,
    normalizeOriginUrl,
    normalizePublicHostname,
    normalizeStaleAfterMs,
    normalizeStateFile,
    normalizeTransportProtocol,
    normalizeTunnelMode,
    readCloudflareTunnelConfig,
    validateConfiguredPublicUrl,
} from '../config.js';
/** @typedef {import('../config.js').CloudflareTunnelConfig} CloudflareTunnelConfig */
