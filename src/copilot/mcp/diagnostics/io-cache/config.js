// @ts-check
/** Immutable process generation for MCP IO-cache diagnostic subprocesses. */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';

export const MCP_IO_CACHE_PROCESS_CONFIG_SCHEMA_VERSION = 1;
export const MCP_IO_CACHE_PROCESS_CONFIG_KIND = 'copilot-mcp-io-cache-process-config';

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-io-cache-process-config';
 *     runnerEnvironment: Readonly<NodeJS.ProcessEnv>;
 * }>} McpIoCacheProcessConfig
 */

/** @param {NodeJS.ProcessEnv} [env] @returns {McpIoCacheProcessConfig} */
export function readMcpIoCacheProcessConfig(env = process.env) {
    const runnerEnvironment = Object.freeze({ ...buildMcpChildEnvironment({ parentEnv: env }).env });
    return Object.freeze({
        schemaVersion: MCP_IO_CACHE_PROCESS_CONFIG_SCHEMA_VERSION,
        kind: MCP_IO_CACHE_PROCESS_CONFIG_KIND,
        runnerEnvironment,
    });
}
