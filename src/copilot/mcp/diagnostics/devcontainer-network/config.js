// @ts-check
/** Immutable process generation for DevContainer network-control-plane diagnostics. */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MCP_DEVCONTAINER_NETWORK_CONFIG_SCHEMA_VERSION = 1;
export const MCP_DEVCONTAINER_NETWORK_CONFIG_KIND = 'copilot-mcp-devcontainer-network-config';
export const MCP_DEVCONTAINER_NETWORK_REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const MCP_DEVCONTAINER_NETWORK_CANONICAL_SCRIPT = resolve(
    MCP_DEVCONTAINER_NETWORK_REPO_ROOT,
    '.devcontainer/scripts/network-control-plane-state.sh',
);

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-devcontainer-network-config';
 *     enabled: boolean;
 *     configuredScript: string;
 *     expectedVersion: string | null;
 *     childEnvironment: Readonly<NodeJS.ProcessEnv>;
 * }>} McpDevcontainerNetworkConfig
 */

/**
 * Capture one process generation. Runtime diagnostics consume only this normalized policy and never retain raw env.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpDevcontainerNetworkConfig}
 */
export function readMcpDevcontainerNetworkConfig(env = process.env) {
    const enabled = !['0', 'false', 'off', 'disabled'].includes(
        String(env['DEVCONTAINER_ENABLE_NETWORK_CONTROL_PLANE_STATE'] ?? 'true')
            .trim()
            .toLowerCase(),
    );
    const configuredRaw = String(env['DEVCONTAINER_NETWORK_CONTROL_PLANE_SCRIPT'] ?? '').trim();
    const expanded = configuredRaw.replaceAll(
        '${containerWorkspaceFolder}',
        MCP_DEVCONTAINER_NETWORK_REPO_ROOT.replace(/\/$/u, ''),
    );
    const configuredScript = expanded
        ? isAbsolute(expanded)
            ? expanded
            : resolve(MCP_DEVCONTAINER_NETWORK_REPO_ROOT, expanded)
        : MCP_DEVCONTAINER_NETWORK_CANONICAL_SCRIPT;
    const expectedVersionRaw = env['DEVCONTAINER_NETWORK_CONTROL_PLANE_SCRIPT_VERSION_EXPECTED'];
    const expectedVersion =
        typeof expectedVersionRaw === 'string' && expectedVersionRaw.trim() ? expectedVersionRaw.trim() : null;
    const childEnvironment = Object.freeze({ ...buildMcpChildEnvironment({ parentEnv: env }).env });
    return Object.freeze({
        schemaVersion: MCP_DEVCONTAINER_NETWORK_CONFIG_SCHEMA_VERSION,
        kind: MCP_DEVCONTAINER_NETWORK_CONFIG_KIND,
        enabled,
        configuredScript,
        expectedVersion,
        childEnvironment,
    });
}
