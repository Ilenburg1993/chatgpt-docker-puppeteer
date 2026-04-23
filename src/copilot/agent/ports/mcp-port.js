// @ts-check
/**
 * src/copilot/agent/ports/mcp-port.js
 *
 * Porta compatível entre o runtime do agent e o bridge MCP.
 *
 * O agent usa MCP como uma capability de composição, não como domínio próprio. Por isso, lifecycle/session consomem
 * apenas estas funções: elas escondem onde ficam config, tool bridge e auto-reconnect enquanto o runtime evolui para
 * capabilities explícitas.
 *
 * @module copilot/agent/ports/mcp-port
 * @internal
 */

import { buildMcpTools, startMcpAutoReconnect } from '../../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../../config/mcp-servers.js';

/**
 * Builder de tools MCP usado pelo runtime quando nenhum bridge MCP injetado está ativo.
 *
 * @returns {Promise<import('#copilot/sdk/types').Tool[]>}
 */
export function buildDefaultMcpTools() {
    return buildMcpTools();
}

/**
 * Snapshot de configuração MCP no formato aceito pelo SDK.
 *
 * Retorna `null` quando não há servidores MCP configurados. O retorno usa `Record<string, unknown>` porque o shape
 * concreto vem da configuração e é validado na borda do SDK.
 *
 * @returns {Record<string, unknown> | null}
 */
export function buildDefaultMcpConfig() {
    return /** @type {Record<string, unknown> | null} */ (buildMcpConfig() ?? null);
}

/**
 * Inicia o auto-reconnect MCP default.
 *
 * `onTools` recebe a lista reconstruída de tools e deve atualizar o registry/bridge do runtime sem assumir que a sessão
 * SDK atual foi recriada.
 *
 * @param {(tools: import('#copilot/sdk/types').Tool[]) => void} onTools
 * @param {number} intervalMs
 * @returns {() => void}
 */
export function startDefaultMcpAutoReconnect(onTools, intervalMs) {
    return startMcpAutoReconnect(onTools, intervalMs);
}
