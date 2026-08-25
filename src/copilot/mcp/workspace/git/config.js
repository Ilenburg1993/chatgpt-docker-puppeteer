// @ts-check
/**
 * Immutable process generation for governed workspace Git subprocesses.
 *
 * Git is intentionally not an ambient-environment escape hatch. The child receives the generic operational projection,
 * the SSH agent socket when explicitly present, and a non-interactive prompt policy. Arbitrary GIT_*, askpass commands
 * and unrelated credentials remain outside this capability.
 *
 * @module copilot/mcp/workspace/git/config
 */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';

export const MCP_GIT_PROCESS_CONFIG_SCHEMA_VERSION = 1;
export const MCP_GIT_PROCESS_CONFIG_KIND = 'copilot-mcp-git-process-config';

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-git-process-config';
 *     childEnvironment: Readonly<NodeJS.ProcessEnv>;
 * }>} McpGitProcessConfig
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {McpGitProcessConfig}
 */
export function createMcpGitProcessConfig(env) {
    if (!env) throw new TypeError('MCP Git process config requires an explicit environment generation.');
    const { env: projected } = buildMcpChildEnvironment({
        parentEnv: env,
        overrides: {
            GIT_TERMINAL_PROMPT: '0',
            SSH_AUTH_SOCK: env['SSH_AUTH_SOCK'] ?? null,
        },
    });
    return Object.freeze({
        schemaVersion: MCP_GIT_PROCESS_CONFIG_SCHEMA_VERSION,
        kind: MCP_GIT_PROCESS_CONFIG_KIND,
        childEnvironment: Object.freeze({ ...projected }),
    });
}
