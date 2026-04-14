// @ts-check
/**
 * src/copilot/sdk/experimental-rpc.js
 *
 * @module copilot/sdk/experimental-rpc
 * @see EventBus
 * @see module:copilot/sdk/feature-flags
 * @see module:copilot/sdk/rpc
 */

import { isExperimentalEnabled } from '../feature-flags.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * Valida a sessão e lança se inválida.
 *
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session, caller) {
    if (!session || typeof session !== 'object' || typeof (/** @type {Record<string, unknown>} */ (session)).rpc !== 'object') {
        throw new TypeError(`[sdk/experimental-rpc/${caller}] CopilotSession inválida ou não conectada.`);
    }
}

/**
 * Lança erro padrão quando uma feature experimental está desabilitada.
 *
 * @param {string} feature
 * @param {string} method
 * @returns {never}
 */
function throwNotEnabled(feature, method) {
    throw new Error(
        `[sdk/experimental-rpc] '${method}' requer feature flag '${feature}' habilitado. ` +
            `Use setExperimentalFlag('${feature}', true) ou COPILOT_EXPERIMENTAL_${feature.toUpperCase()}=1.`,
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// F118 — fleet subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ fleetId: string; status: string }} FleetStartResult
 */

/**
 * Inicia um fleet de agentes paralelos (experimental).
 *
 * @param {CopilotSession} session
 * @param {{ maxAgents?: number; model?: string }} [options]
 * @returns {Promise<FleetStartResult>}
 */
export async function fleetStart(session, options) {
    if (!isExperimentalEnabled('fleet')) throwNotEnabled('fleet', 'fleet.start');
    assertSession(session, 'fleet.start');
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.fleet.start(options ?? {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// F119 — agents subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ id: string; name: string; status: string }} AgentInfo
 */

/**
 * Lista agentes disponíveis na sessão (experimental).
 *
 * @param {CopilotSession} session
 * @returns {Promise<AgentInfo[]>}
 */
export async function agentList(session) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.list');
    assertSession(session, 'agent.list');
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.agent.list();
}

/**
 * Seleciona um agente como ativo (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} agentId
 * @returns {Promise<void>}
 */
export async function agentSelect(session, agentId) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.select');
    assertSession(session, 'agent.select');
    if (typeof agentId !== 'string' || agentId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/agent.select] agentId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.agent.select({ agentId });
}

/**
 * Deseleciona o agente ativo (experimental).
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function agentDeselect(session) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.deselect');
    assertSession(session, 'agent.deselect');
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.agent.deselect();
}

/**
 * Retorna status de um agente (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} agentId
 * @returns {Promise<AgentInfo>}
 */
export async function agentGetStatus(session, agentId) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.getStatus');
    assertSession(session, 'agent.getStatus');
    if (typeof agentId !== 'string' || agentId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/agent.getStatus] agentId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.agent.getStatus({ agentId });
}

/**
 * Para um agente em execução (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} agentId
 * @returns {Promise<void>}
 */
export async function agentStop(session, agentId) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.stop');
    assertSession(session, 'agent.stop');
    if (typeof agentId !== 'string' || agentId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/agent.stop] agentId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.agent.stop({ agentId });
}

// ═══════════════════════════════════════════════════════════════════════════════
// F120 — skills subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ id: string; name: string; enabled: boolean; description?: string }} SkillInfo
 */

/**
 * Lista skills disponíveis (experimental).
 *
 * @param {CopilotSession} session
 * @returns {Promise<SkillInfo[]>}
 */
export async function skillsList(session) {
    if (!isExperimentalEnabled('skills')) throwNotEnabled('skills', 'skills.list');
    assertSession(session, 'skills.list');
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.skills.list();
}

/**
 * Habilita uma skill (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} skillId
 * @returns {Promise<void>}
 */
export async function skillsEnable(session, skillId) {
    if (!isExperimentalEnabled('skills')) throwNotEnabled('skills', 'skills.enable');
    assertSession(session, 'skills.enable');
    if (typeof skillId !== 'string' || skillId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/skills.enable] skillId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.skills.enable({ skillId });
}

/**
 * Desabilita uma skill (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} skillId
 * @returns {Promise<void>}
 */
export async function skillsDisable(session, skillId) {
    if (!isExperimentalEnabled('skills')) throwNotEnabled('skills', 'skills.disable');
    assertSession(session, 'skills.disable');
    if (typeof skillId !== 'string' || skillId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/skills.disable] skillId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.skills.disable({ skillId });
}

/**
 * Retorna status de uma skill (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} skillId
 * @returns {Promise<SkillInfo>}
 */
export async function skillsGetStatus(session, skillId) {
    if (!isExperimentalEnabled('skills')) throwNotEnabled('skills', 'skills.getStatus');
    assertSession(session, 'skills.getStatus');
    if (typeof skillId !== 'string' || skillId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/skills.getStatus] skillId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.skills.getStatus({ skillId });
}

// ═══════════════════════════════════════════════════════════════════════════════
// F121 — mcp subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ id: string; name: string; enabled: boolean; status: string }} McpServerInfo
 */

/**
 * Lista servidores MCP disponíveis (experimental).
 *
 * @param {CopilotSession} session
 * @returns {Promise<McpServerInfo[]>}
 */
export async function mcpList(session) {
    if (!isExperimentalEnabled('mcp')) throwNotEnabled('mcp', 'mcp.list');
    assertSession(session, 'mcp.list');
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.mcp.list();
}

/**
 * Habilita um servidor MCP (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} serverId
 * @returns {Promise<void>}
 */
export async function mcpEnable(session, serverId) {
    if (!isExperimentalEnabled('mcp')) throwNotEnabled('mcp', 'mcp.enable');
    assertSession(session, 'mcp.enable');
    if (typeof serverId !== 'string' || serverId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/mcp.enable] serverId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.mcp.enable({ serverId });
}

/**
 * Desabilita um servidor MCP (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} serverId
 * @returns {Promise<void>}
 */
export async function mcpDisable(session, serverId) {
    if (!isExperimentalEnabled('mcp')) throwNotEnabled('mcp', 'mcp.disable');
    assertSession(session, 'mcp.disable');
    if (typeof serverId !== 'string' || serverId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/mcp.disable] serverId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.mcp.disable({ serverId });
}

/**
 * Retorna status de um servidor MCP (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} serverId
 * @returns {Promise<McpServerInfo>}
 */
export async function mcpGetStatus(session, serverId) {
    if (!isExperimentalEnabled('mcp')) throwNotEnabled('mcp', 'mcp.getStatus');
    assertSession(session, 'mcp.getStatus');
    if (typeof serverId !== 'string' || serverId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/mcp.getStatus] serverId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.mcp.getStatus({ serverId });
}

// ═══════════════════════════════════════════════════════════════════════════════
// F122 — plugins subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ id: string; name: string; version: string; enabled: boolean }} PluginInfo
 */

/**
 * Lista plugins instalados (experimental).
 *
 * @param {CopilotSession} session
 * @returns {Promise<PluginInfo[]>}
 */
export async function pluginsList(session) {
    if (!isExperimentalEnabled('plugins')) throwNotEnabled('plugins', 'plugins.list');
    assertSession(session, 'plugins.list');
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.plugins.list();
}

// ═══════════════════════════════════════════════════════════════════════════════
// F123 — extensions subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ id: string; name: string; enabled: boolean; version?: string }} ExtensionInfo
 */

/**
 * Lista extensões disponíveis (experimental).
 *
 * @param {CopilotSession} session
 * @returns {Promise<ExtensionInfo[]>}
 */
export async function extensionsList(session) {
    if (!isExperimentalEnabled('extensions')) throwNotEnabled('extensions', 'extensions.list');
    assertSession(session, 'extensions.list');
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.extensions.list();
}

/**
 * Habilita uma extensão (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} extensionId
 * @returns {Promise<void>}
 */
export async function extensionsEnable(session, extensionId) {
    if (!isExperimentalEnabled('extensions')) throwNotEnabled('extensions', 'extensions.enable');
    assertSession(session, 'extensions.enable');
    if (typeof extensionId !== 'string' || extensionId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/extensions.enable] extensionId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.extensions.enable({ extensionId });
}

/**
 * Desabilita uma extensão (experimental).
 *
 * @param {CopilotSession} session
 * @param {string} extensionId
 * @returns {Promise<void>}
 */
export async function extensionsDisable(session, extensionId) {
    if (!isExperimentalEnabled('extensions')) throwNotEnabled('extensions', 'extensions.disable');
    assertSession(session, 'extensions.disable');
    if (typeof extensionId !== 'string' || extensionId.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/extensions.disable] extensionId deve ser string não-vazia.');
    }
    return /** @type {import("../types.js").ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc.extensions.disable({ extensionId });
}
