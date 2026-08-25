// @ts-check
/**
 * Bounded environment projection for the MCP HTTP server child started by the Cloudflare CLI composition root.
 *
 * This is intentionally broader than a generic child environment because the child is the MCP application process:
 * it must receive MCP configuration plus the already-governed Model Gateway and Cloudflare remote-API capabilities.
 * It is still fail-closed to unrelated ambient credentials and excludes the cloudflared tunnel-control token.
 *
 * @module copilot/mcp/composition/cloudflare-cli/server-child-environment
 */

import { createModelGatewayLiveRunEnvironmentAuthority } from '#copilot/mcp/public/integrations/model-gateway/live-runs';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';

export const MCP_SERVER_CHILD_ENVIRONMENT_POLICY_VERSION = '1.0.0';

const MCP_SERVER_EXACT_ENV_KEYS = Object.freeze([
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_ZONE_ID',
    'CLOUDFLARE_TUNNEL_TOKEN_FILE',
    'COPILOT_VALIDATOR_VITEST_MAX_WORKERS',
    'DEVCONTAINER_ENABLE_NETWORK_CONTROL_PLANE_STATE',
    'DEVCONTAINER_NETWORK_CONTROL_PLANE_SCRIPT',
    'DEVCONTAINER_NETWORK_CONTROL_PLANE_SCRIPT_VERSION_EXPECTED',
    'NODE_ENV',
    'OPENAI_MCP_TUNNEL_ID',
    'TUNNEL_TRANSPORT_PROTOCOL',
    'VITEST',
    'VITEST_MAX_WORKERS',
    'npm_package_version',
]);

/**
 * @param {NodeJS.ProcessEnv} parentEnv
 * @param {Record<string, string | null>} [overrides]
 * @returns {Readonly<NodeJS.ProcessEnv>}
 */
export function buildMcpServerChildEnvironment(parentEnv, overrides = {}) {
    if (!parentEnv) throw new TypeError('MCP server child environment requires an explicit parent environment.');

    const operational = buildMcpChildEnvironment({ parentEnv }).env;
    const modelGateway = createModelGatewayLiveRunEnvironmentAuthority(parentEnv).liveRunEnvironment({
        invokesModel: true,
        invokesRealProvider: true,
    });
    /** @type {NodeJS.ProcessEnv} */
    const childEnv = { ...operational, ...modelGateway };

    // COPILOT_MCP_* is a reserved application namespace. New MCP configuration/secret keys intentionally cross this
    // internal process boundary, while unrelated future environment variables remain excluded by construction.
    for (const [key, value] of Object.entries(parentEnv)) {
        if (value !== undefined && key.startsWith('COPILOT_MCP_')) childEnv[key] = value;
    }
    for (const key of MCP_SERVER_EXACT_ENV_KEYS) {
        const value = parentEnv[key];
        if (value !== undefined) childEnv[key] = value;
    }
    for (const [key, value] of Object.entries(overrides)) {
        if (!isValidEnvironmentKey(key)) continue;
        if (value === null) delete childEnv[key];
        else childEnv[key] = String(value);
    }

    // Tunnel lifecycle authority stays in the parent composition process. The MCP server may audit Cloudflare via its
    // remote API capability, but must never inherit the bearer token that starts/stops cloudflared itself.
    delete childEnv['CLOUDFLARE_TUNNEL_TOKEN'];
    return Object.freeze(childEnv);
}

/** @param {string} key */
function isValidEnvironmentKey(key) {
    return Boolean(key) && !key.includes('\0') && !key.includes('=');
}
