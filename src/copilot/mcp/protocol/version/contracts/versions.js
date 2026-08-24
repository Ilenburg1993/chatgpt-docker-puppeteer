// @ts-check
/**
 * Canonical MCP protocol-era/version contracts for this workspace server.
 *
 * Protocol revision is a wire concern, not a server-factory or HTTP-adapter ownership detail. Both
 * modern and compatibility transports consume this lower contract so health/status surfaces cannot
 * accidentally describe a dual-era server as 2025-only.
 *
 * @module copilot/mcp/protocol/version/contracts/versions
 */

export const MCP_PROTOCOL_MODERN_VERSION = '2026-07-28';
export const MCP_PROTOCOL_LEGACY_DEFAULT_VERSION = '2025-11-25';
export const MCP_PROTOCOL_LEGACY_MISSING_HEADER_FALLBACK_VERSION = '2025-03-26';
export const MCP_PROTOCOL_LEGACY_SUPPORTED_VERSIONS = Object.freeze([
    MCP_PROTOCOL_LEGACY_DEFAULT_VERSION,
    '2025-06-18',
    MCP_PROTOCOL_LEGACY_MISSING_HEADER_FALLBACK_VERSION,
]);

export const MCP_PROTOCOL_SUPPORT = Object.freeze({
    mode: /** @type {const} */ ('dual-era'),
    modern: Object.freeze({
        version: MCP_PROTOCOL_MODERN_VERSION,
    }),
    legacy: Object.freeze({
        defaultVersion: MCP_PROTOCOL_LEGACY_DEFAULT_VERSION,
        supportedVersions: MCP_PROTOCOL_LEGACY_SUPPORTED_VERSIONS,
    }),
});
