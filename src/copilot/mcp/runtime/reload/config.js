// @ts-check
/** Immutable process configuration for controlled MCP reload planning and launcher environment projection. */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';

export const MCP_RELOAD_PROCESS_CONFIG_SCHEMA_VERSION = 1;
export const MCP_RELOAD_PROCESS_CONFIG_KIND = 'copilot-mcp-reload-process-config';
const EXECUTABLE_PROFILES = Object.freeze(['quic', 'h2', 'auto']);

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-reload-process-config';
 *     currentProfile: 'quic' | 'h2' | 'auto';
 *     runnerEnvironment: Readonly<NodeJS.ProcessEnv>;
 * }>} McpReloadProcessConfig
 */

/**
 * Capture one reload generation. The child environment is projected here so wire tools never retain raw process.env.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpReloadProcessConfig}
 */
export function readMcpReloadProcessConfig(env = process.env) {
    const currentProfile = normalizeProfile(env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'] ?? env['TUNNEL_TRANSPORT_PROTOCOL']);
    /** @type {Record<string, string | null>} */
    const overrides = {};
    const statefulEnvFile = env['COPILOT_MCP_STATEFUL_ENV_FILE'];
    if (statefulEnvFile !== undefined) overrides['COPILOT_MCP_STATEFUL_ENV_FILE'] = statefulEnvFile;
    const runnerEnvironment = Object.freeze({ ...buildMcpChildEnvironment({ parentEnv: env, overrides }).env });
    return Object.freeze({
        schemaVersion: MCP_RELOAD_PROCESS_CONFIG_SCHEMA_VERSION,
        kind: MCP_RELOAD_PROCESS_CONFIG_KIND,
        currentProfile,
        runnerEnvironment,
    });
}

/** @param {unknown} value @returns {'quic' | 'h2' | 'auto'} */
function normalizeProfile(value) {
    const normalized = String(value ?? 'quic')
        .trim()
        .toLowerCase();
    return EXECUTABLE_PROFILES.some((profile) => profile === normalized)
        ? /** @type {'quic' | 'h2' | 'auto'} */ (normalized)
        : 'quic';
}
