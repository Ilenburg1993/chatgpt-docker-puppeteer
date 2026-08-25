// @ts-check
/** Immutable process-scoped terminal execution policy and sanitized operational environment. */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';

export const MCP_TERMINAL_PROCESS_CONFIG_SCHEMA_VERSION = 1;
export const MCP_TERMINAL_PROCESS_CONFIG_KIND = 'copilot-mcp-terminal-process-config';
export const FALLBACK_TERMINAL_SHELL = '/bin/bash';

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-terminal-process-config';
 *     defaultShell: string;
 *     operationalEnvironment: Readonly<NodeJS.ProcessEnv>;
 * }>} McpTerminalProcessConfig
 */

/** @param {NodeJS.ProcessEnv} env @returns {McpTerminalProcessConfig} */
export function readMcpTerminalProcessConfig(env) {
    if (!env) throw new TypeError('MCP terminal process config requires an explicit environment.');
    const configuredShell = String(env['SHELL'] ?? '').trim();
    const operationalEnvironment = Object.freeze({ ...buildMcpChildEnvironment({ parentEnv: env }).env });
    return Object.freeze({
        schemaVersion: MCP_TERMINAL_PROCESS_CONFIG_SCHEMA_VERSION,
        kind: MCP_TERMINAL_PROCESS_CONFIG_KIND,
        defaultShell: configuredShell || FALLBACK_TERMINAL_SHELL,
        operationalEnvironment,
    });
}
