// @ts-check
/**
 * src/copilot/agent/facades/sdk/tools.js
 *
 * Sub-facade: tools registry, configuração e carregamento assíncrono.
 *
 * @module copilot/agent/facades/sdk/tools
 */

import { pickDefined } from '#copilot/sdk/utils';
import { createRegistry, getToolsConfig, loadToolsConfigAsync } from '#copilot/sdk/tools';

/**
 * @returns {import('#copilot/sdk/types').ToolRegistry}
 */
export function createAgentSdkToolsRegistry() {
    return createRegistry();
}

/**
 * @returns {{ denylist: string[]; allowlist: string[] | null }}
 */
export function getAgentSdkToolsConfig() {
    return getToolsConfig();
}

/**
 * @returns {Promise<void>}
 */
export async function loadAgentSdkToolsConfigAsync() {
    await loadToolsConfigAsync();
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} value
 * @returns {Partial<T>}
 */
export function pickDefinedAgentSdkOptions(value) {
    return /** @type {Partial<T>} */ (pickDefined(value));
}
