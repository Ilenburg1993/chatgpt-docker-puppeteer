// @ts-check
/**
 * Explicit environment authority for Cloudflare connector smoke and transport benchmarking.
 *
 * These operations need public connector/auth configuration, never the parent's ambient credential set. Unknown
 * variables are excluded by construction. In particular static MCP bearer tokens and Cloudflare tunnel tokens are not
 * connector-smoke authority: authenticated readiness is established through the OAuth/DCR flow itself.
 *
 * @module copilot/mcp/cloudflare/environment
 */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';

export const CLOUDFLARE_CONNECTOR_SMOKE_ENV_KEYS = Object.freeze([
    'COPILOT_MCP_AUTH_MODE',
    'COPILOT_MCP_CHATGPT_AUTH_MODE',
    'COPILOT_MCP_AUTH_ENFORCEMENT',
    'COPILOT_MCP_PUBLIC_URL',
    'COPILOT_MCP_CLOUDFLARE_PUBLIC_URL',
    'COPILOT_MCP_CLOUDFLARE_MODE',
    'COPILOT_MCP_ORIGIN_TRANSPORT',
    'COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN',
    'COPILOT_MCP_CLOUDFLARE_ORIGIN_URL',
    'COPILOT_MCP_CLOUDFLARE_TUNNEL_NAME',
    'COPILOT_MCP_CLOUDFLARE_ZONE',
    'COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME',
    'COPILOT_MCP_CLOUDFLARE_ORIGIN_SERVER_NAME',
    'COPILOT_MCP_CLOUDFLARE_PROTOCOL',
    'TUNNEL_TRANSPORT_PROTOCOL',
    'COPILOT_MCP_CLOUDFLARE_METRICS_ADDR',
    'COPILOT_MCP_CLOUDFLARE_LOGLEVEL',
    'COPILOT_MCP_CLOUDFLARE_STATE_FILE',
    'COPILOT_MCP_CLOUDFLARE_SMOKE_STATE_FILE',
    'COPILOT_MCP_CLOUDFLARE_PID_FILE',
    'COPILOT_MCP_HTTP_PID_FILE',
    'COPILOT_MCP_CLOUDFLARE_STALE_AFTER_MS',
    'COPILOT_MCP_OAUTH_AUTHORIZATION_SERVERS',
    'COPILOT_MCP_OAUTH_ISSUER',
    'COPILOT_MCP_OAUTH_EXPECTED_ISSUER',
    'COPILOT_MCP_OAUTH_AUDIENCE',
    'COPILOT_MCP_OAUTH_ACCEPTED_AUDIENCES',
    'COPILOT_MCP_OAUTH_JWKS_URI',
    'COPILOT_MCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED',
    'COPILOT_MCP_OAUTH_INITIAL_SCOPE_PROFILE',
    'COPILOT_MCP_OAUTH_INITIAL_SCOPES',
    'COPILOT_MCP_RESOURCE_DOCUMENTATION',
    'COPILOT_MCP_RESOURCE_NAME',
    'COPILOT_MCP_RESOURCE_POLICY_URI',
    'COPILOT_MCP_RESOURCE_TOS_URI',
    'COPILOT_MCP_OAUTH_JWT_ALGORITHMS',
    'COPILOT_MCP_OAUTH_REQUIRE_RESOURCE_CLAIM',
    'COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS',
    'COPILOT_MCP_PROTOCOL_VERSION',
    'COPILOT_MCP_SMOKE_ATTEMPTS',
    'COPILOT_MCP_SMOKE_DELAY_MS',
    'COPILOT_MCP_SMOKE_URL',
    'COPILOT_MCP_CRITICAL_TOOLS',
    'COPILOT_MCP_OAUTH_SMOKE_RESOURCE',
    'COPILOT_MCP_OAUTH_SMOKE_TIMEOUT_MS',
    'COPILOT_MCP_OAUTH_SMOKE_RETRY_ATTEMPTS',
    'COPILOT_MCP_OAUTH_SMOKE_RETRY_BASE_DELAY_MS',
    'COPILOT_MCP_OAUTH_SMOKE_RETRY_MAX_DELAY_MS',
    'COPILOT_MCP_OAUTH_SMOKE_STRICT',
    'COPILOT_MCP_OAUTH_SMOKE_VERBOSE_TOOLS',
    'COPILOT_MCP_OAUTH_SMOKE_PRIVATE_KEY_JWT',
    'COPILOT_MCP_OAUTH_SMOKE_NEGATIVE_RESOURCE_CHECKS',
]);

/**
 * Build the bounded environment for connector smoke/benchmark execution.
 *
 * @param {NodeJS.ProcessEnv} parentEnv
 * @param {{ compact?: boolean; publicMcpUrl?: string | null }} [options]
 * @returns {NodeJS.ProcessEnv}
 */
export function buildCloudflareConnectorSmokeEnvironment(parentEnv, options = {}) {
    if (!parentEnv)
        throw new TypeError('Cloudflare connector smoke environment requires an explicit parent environment.');
    /** @type {Record<string, string | null>} */
    const overrides = {};
    for (const key of CLOUDFLARE_CONNECTOR_SMOKE_ENV_KEYS) {
        const value = parentEnv[key];
        if (value !== undefined) overrides[key] = value;
    }
    overrides['COPILOT_MCP_AUTH_MODE'] = parentEnv['COPILOT_MCP_AUTH_MODE'] ?? 'oauth';
    overrides['COPILOT_MCP_AUTH_ENFORCEMENT'] = parentEnv['COPILOT_MCP_AUTH_ENFORCEMENT'] ?? 'all';
    if (options.publicMcpUrl) overrides['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL'] = options.publicMcpUrl;
    if (options.compact === true) overrides['COPILOT_MCP_SMOKE_COMPACT'] = '1';
    return buildMcpChildEnvironment({ parentEnv, overrides }).env;
}
