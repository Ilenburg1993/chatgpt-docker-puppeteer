// @ts-check
/**
 * Canonical Cloudflare route expressions for the Copilot MCP hostname.
 *
 * Keep MCP/OAuth/Cloudflare path matching in one local module so plan, diff,
 * apply and audit code do not drift.
 *
 * @module copilot/mcp/cloudflare/routes
 */

export const MCP_ROUTE_PATH = '/mcp';
export const HEALTH_ROUTE_PATH = '/health';
export const CHATGPT_CONNECTOR_ROUTE_PATH = '/chatgpt-connector.json';
export const OAUTH_ROUTE_PREFIX = '/oauth/';
export const WELL_KNOWN_ROUTE_PREFIX = '/.well-known/';

/**
 * Dynamic and sensitive paths that must bypass Cloudflare cache because they are request-specific, authenticated,
 * stateful, or operationally volatile.
 *
 * Public discovery documents are intentionally excluded from this expression so a separate cache-eligible plan can use
 * a short edge TTL for GET-only metadata routes without affecting /mcp JSON-RPC or OAuth token traffic.
 *
 * @returns {string}
 */
export function buildCloudflareCacheBypassPathExpression() {
    return [
        buildCloudflareMcpPathExpression(),
        `starts_with(http.request.uri.path, "${OAUTH_ROUTE_PREFIX}")`,
        `http.request.uri.path eq "${HEALTH_ROUTE_PATH}"`,
    ].join(' or ');
}

/**
 * @param {string} hostname
 * @returns {string}
 */
export function buildCloudflareCacheBypassRoutesExpression(hostname) {
    return `(${buildCloudflareHostExpression(hostname)} and (${buildCloudflareCacheBypassPathExpression()}))`;
}

/**
 * Public GET-only metadata routes that are safe to cache with a short TTL when the edge rule also constrains method=GET.
 *
 * @returns {string}
 */
export function buildCloudflarePublicMetadataPathExpression() {
    return [
        `starts_with(http.request.uri.path, "${WELL_KNOWN_ROUTE_PREFIX}")`,
        `http.request.uri.path eq "${CHATGPT_CONNECTOR_ROUTE_PATH}"`,
    ].join(' or ');
}

/**
 * @param {string} hostname
 * @returns {string}
 */
export function buildCloudflarePublicMetadataCacheExpression(hostname) {
    return `(${buildCloudflareHostExpression(hostname)} and http.request.method eq "GET" and (${buildCloudflarePublicMetadataPathExpression()}))`;
}

/**
 * MCP JSON-RPC responses should not be compressed at the edge for this connector: recent measurements showed Cloudflare
 * Brotli increased tail latency for the ~100 KiB tools/list response versus identity transfer.
 *
 * @param {string} hostname
 * @returns {string}
 */
export function buildCloudflareMcpCompressionBypassExpression(hostname) {
    return `(${buildCloudflareHostExpression(hostname)} and ${buildCloudflareMcpPathExpression()})`;
}

/**
 * @param {string} hostname
 * @returns {string}
 */
export function buildCloudflareHostExpression(hostname) {
    return `http.host eq "${escapeCloudflareExpressionString(hostname)}"`;
}

/**
 * @param {string} hostname
 * @returns {string}
 */
export function buildCloudflareDynamicRoutesExpression(hostname) {
    return `(${buildCloudflareHostExpression(hostname)} and (${buildCloudflareDynamicPathExpression()}))`;
}

/**
 * @returns {string}
 */
export function buildCloudflareDynamicPathExpression() {
    return [
        buildCloudflareMcpPathExpression(),
        `starts_with(http.request.uri.path, "${OAUTH_ROUTE_PREFIX}")`,
        `starts_with(http.request.uri.path, "${WELL_KNOWN_ROUTE_PREFIX}")`,
        `http.request.uri.path eq "${HEALTH_ROUTE_PATH}"`,
        `http.request.uri.path eq "${CHATGPT_CONNECTOR_ROUTE_PATH}"`,
    ].join(' or ');
}

/**
 * Match the actual Streamable HTTP endpoint exactly, while allowing future
 * explicit MCP subroutes only under /mcp/.
 *
 * @returns {string}
 */
export function buildCloudflareMcpPathExpression() {
    return `(http.request.uri.path eq "${MCP_ROUTE_PATH}" or starts_with(http.request.uri.path, "${MCP_ROUTE_PATH}/"))`;
}

/**
 * @param {string} hostname
 * @returns {string}
 */
export function buildCloudflareAnonymousMcpExpression(hostname) {
    return `(${buildCloudflareHostExpression(hostname)} and ${buildCloudflareMcpPathExpression()} and not any(http.request.headers.names[*] eq "authorization"))`;
}

/**
 * @param {string} hostname
 * @returns {string}
 */
export function buildCloudflareOAuthTokenExpression(hostname) {
    return `(${buildCloudflareHostExpression(hostname)} and http.request.uri.path eq "/oauth/token")`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeCloudflareExpressionString(value) {
    return String(value).replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}
