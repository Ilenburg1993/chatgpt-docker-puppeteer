// @ts-check
/**
 * src/copilot/agent/ports/mcp-port.js
 *
 * Porta compatível entre o runtime do agent e o bridge MCP.
 *
 * @module copilot/agent/ports/mcp-port
 * @internal
 */

import { buildMcpTools, startMcpAutoReconnect } from '../../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../../config/mcp-servers.js';

/**
 * @returns {Promise<import('#copilot/sdk/types').Tool[]>}
 */
export function buildDefaultMcpTools() {
    return buildMcpTools();
}

/**
 * @returns {Record<string, unknown> | null}
 */
export function buildDefaultMcpConfig() {
    return /** @type {Record<string, unknown> | null} */ (buildMcpConfig() ?? null);
}

/**
 * @param {(tools: import('#copilot/sdk/types').Tool[]) => void} onTools
 * @param {number} intervalMs
 * @returns {() => void}
 */
export function startDefaultMcpAutoReconnect(onTools, intervalMs) {
    return startMcpAutoReconnect(onTools, intervalMs);
}
