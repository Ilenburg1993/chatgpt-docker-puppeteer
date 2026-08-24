// @ts-check
/**
 * Side-effect-free MCP connector URL contract.
 *
 * This leaf module intentionally has no dependency on Cloudflare, auth, readiness or process configuration so lower
 * transport/config owners can validate connector URLs without creating dependency cycles.
 *
 * @module copilot/mcp/connection/url
 */

export const DEFAULT_PUBLIC_MCP_URL = 'https://mcp.aurelin.org/mcp';
export const MCP_PATH = '/mcp';
const MAX_URL_LENGTH = 2048;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_PATH_LENGTH = 256;

/**
 * Normalize a candidate MCP URL into an absolute URL ending in /mcp. This helper is intentionally forgiving because it
 * is used for form helpers; use validatePublicConnectorUrl for strict public connector checks.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeMcpUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed || trimmed.length > MAX_URL_LENGTH || hasAsciiControlChars(trimmed)) return DEFAULT_PUBLIC_MCP_URL;
    try {
        const parsed = new URL(trimmed);
        if (parsed.username || parsed.password) return DEFAULT_PUBLIC_MCP_URL;
        parsed.hash = '';
        parsed.search = '';
        parsed.pathname = normalizeMcpPath(parsed.pathname);
        return parsed
            .toString()
            .replace(/\/+$/u, '')
            .replace(/\/mcp$/u, MCP_PATH);
    } catch {
        const withoutTrailingSlash = trimmed.replace(/\/+$/u, '');
        return `${withoutTrailingSlash}${withoutTrailingSlash.endsWith(MCP_PATH) ? '' : MCP_PATH}`;
    }
}

/**
 * @param {string} url
 * @returns {{ ok: true; normalizedUrl: string; resource: string } | { ok: false; reason: string; normalizedUrl: string }}
 */
export function validatePublicConnectorUrl(url) {
    const normalized = normalizeMcpUrl(url);
    if (normalized.length > MAX_URL_LENGTH)
        return { ok: false, reason: 'Connector URL is too long.', normalizedUrl: normalized };
    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        return { ok: false, reason: 'Connector URL must be an absolute URL.', normalizedUrl: normalized };
    }
    if (parsed.protocol !== 'https:') {
        return { ok: false, reason: 'ChatGPT connector URL must be HTTPS.', normalizedUrl: normalized };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, reason: 'Connector URL must not contain credentials.', normalizedUrl: normalized };
    }
    if (parsed.search || parsed.hash) {
        return {
            ok: false,
            reason: 'Connector URL must not contain query string or fragment.',
            normalizedUrl: normalized,
        };
    }
    if (!isValidHostname(parsed.hostname)) {
        return { ok: false, reason: 'Connector URL hostname is invalid.', normalizedUrl: normalized };
    }
    if (isLocalHostname(parsed.hostname)) {
        return {
            ok: false,
            reason: 'Public ChatGPT connector URL must not use localhost or loopback.',
            normalizedUrl: normalized,
        };
    }
    if (parsed.pathname !== MCP_PATH) {
        return { ok: false, reason: 'ChatGPT connector URL must end exactly with /mcp.', normalizedUrl: normalized };
    }
    return { ok: true, normalizedUrl: normalized, resource: buildResourceFromMcpUrl(normalized) };
}

/** @param {string} pathname */
function normalizeMcpPath(pathname) {
    const normalized = String(pathname || '/').replace(/\/+$/u, '');
    if (!normalized || normalized === '/') return MCP_PATH;
    if (normalized === MCP_PATH || normalized.endsWith(MCP_PATH)) return normalized;
    const next = `${normalized}${MCP_PATH}`;
    return next.length <= MAX_PATH_LENGTH ? next : MCP_PATH;
}

/** @param {string} mcpUrl */
export function buildResourceFromMcpUrl(mcpUrl) {
    try {
        const parsed = new URL(normalizeMcpUrl(mcpUrl));
        parsed.pathname = parsed.pathname.replace(/\/mcp$/u, '').replace(/\/+$/u, '');
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/+$/u, '');
    } catch {
        return DEFAULT_PUBLIC_MCP_URL.replace(/\/mcp$/u, '');
    }
}

/** @param {string} hostname */
function isValidHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/\.+$/u, '');
    if (!normalized || normalized.length > MAX_HOSTNAME_LENGTH || normalized.includes('_')) return false;
    if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized)) return true;
    return normalized.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

/** @param {string} hostname */
function isLocalHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/\.+$/u, '');
    return (
        normalized === 'localhost' ||
        normalized === '127.0.0.1' ||
        normalized === '::1' ||
        normalized === '[::1]' ||
        normalized.endsWith('.localhost')
    );
}

/** @param {string} value */
export function hasAsciiControlChars(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) return true;
    }
    return false;
}
