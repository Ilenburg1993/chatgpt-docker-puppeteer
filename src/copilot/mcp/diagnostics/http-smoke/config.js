// @ts-check
/** Process-scoped configuration and secret capability for local MCP HTTP smoke diagnostics. */

import { readMcpAuthRuntimeConfig } from '#copilot/mcp/public/auth';
import { normalizeMcpUrl } from '#copilot/mcp/public/connection';

export const MCP_HTTP_SMOKE_CONFIG_SCHEMA_VERSION = 1;
export const MCP_HTTP_SMOKE_CONFIG_KIND = 'copilot-mcp-http-smoke-config';
export const DEFAULT_LOCAL_MCP_SMOKE_URL = 'http://127.0.0.1:3333/mcp';

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-http-smoke-config';
 *     mcpUrl: string;
 *     authRequired: boolean;
 * }>} McpHttpSmokeConfig
 * @typedef {Readonly<{ bearerToken?: string }>} McpHttpSmokeSecrets
 * @typedef {Readonly<{ config: McpHttpSmokeConfig; secrets: McpHttpSmokeSecrets }>} McpHttpSmokeRuntimeConfig
 */

/**
 * Capture the HTTP smoke process generation. Observable policy and bearer material remain separate sibling projections.
 * The secret projection must never be serialized into smoke reports or propagated through McpProcessConfig/toolConfig.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpHttpSmokeRuntimeConfig}
 */
export function readMcpHttpSmokeRuntimeConfig(env = process.env) {
    const auth = readMcpAuthRuntimeConfig(env);
    const mcpUrl = normalizeMcpUrl(env['COPILOT_MCP_SMOKE_URL'] ?? DEFAULT_LOCAL_MCP_SMOKE_URL);
    const explicitSmokeToken = normalizeSecret(env['COPILOT_MCP_SMOKE_BEARER_TOKEN']);
    const bearerToken = explicitSmokeToken ?? auth.secrets.staticBearerToken;
    return Object.freeze({
        config: Object.freeze({
            schemaVersion: MCP_HTTP_SMOKE_CONFIG_SCHEMA_VERSION,
            kind: MCP_HTTP_SMOKE_CONFIG_KIND,
            mcpUrl,
            authRequired: auth.config.enforcement !== 'off',
        }),
        secrets: Object.freeze(bearerToken === undefined ? {} : { bearerToken }),
    });
}

/** @param {unknown} value @returns {string | undefined} */
function normalizeSecret(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized === '[redacted]') return undefined;
    return normalized;
}
