// @ts-check
/**
 * src/copilot/sdk/rpc/experimental.js
 *
 * Wrappers tipados para os subsistemas experimentais do SDK RPC: `fleet`, `agent`, `skills`, `mcp`, `plugins`,
 * `extensions`.
 *
 * Cada função valida sessão e feature flag antes de chamar o RPC. Os métodos mapeiam 1:1 com
 * `session.rpc.<subsystem>.<method>()`.
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
    if (
        !session ||
        typeof session !== 'object' ||
        typeof (/** @type {Record<string, unknown>} */ (session)['rpc']) !== 'object'
    ) {
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

/**
 * Acessa o RPC experimental da sessão com cast para a surface estendida.
 *
 * @param {CopilotSession} session
 * @returns {import('../types.js').ExperimentalSession['rpc']}
 */
function getRpc(session) {
    return /** @type {import('../types.js').ExperimentalSession} */ (/** @type {unknown} */ (session)).rpc;
}

// ═══════════════════════════════════════════════════════════════════════════════
// fleet subsystem — SDK: fleet.start(params)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ started: boolean }} FleetStartResult
 */

/**
 * Inicia um fleet de agentes paralelos (experimental). SDK RPC: `session.rpc.fleet.start(params)`
 *
 * @param {CopilotSession} session
 * @param {{ prompt?: string }} [options]
 * @returns {Promise<FleetStartResult>}
 */
export async function fleetStart(session, options) {
    if (!isExperimentalEnabled('fleet')) throwNotEnabled('fleet', 'fleet.start');
    assertSession(session, 'fleet.start');
    return getRpc(session).fleet.start(options ?? {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// agent subsystem — SDK: agent.list(), agent.getCurrent(), agent.select(params),
//                   agent.deselect(), agent.reload()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ name: string; displayName: string; description: string }} AgentInfo
 */

/**
 * Lista agentes disponíveis na sessão (experimental). SDK RPC: `session.rpc.agent.list()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<AgentInfo[]>}
 */
export async function agentList(session) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.list');
    assertSession(session, 'agent.list');
    return getRpc(session).agent.list();
}

/**
 * Retorna o agente ativo atual (experimental). SDK RPC: `session.rpc.agent.getCurrent()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<AgentInfo | null>}
 */
export async function agentGetCurrent(session) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.getCurrent');
    assertSession(session, 'agent.getCurrent');
    return getRpc(session).agent.getCurrent();
}

/**
 * Seleciona um agente como ativo (experimental). SDK RPC: `session.rpc.agent.select({ name })`
 *
 * @param {CopilotSession} session
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function agentSelect(session, name) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.select');
    assertSession(session, 'agent.select');
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/agent.select] name deve ser string não-vazia.');
    }
    return getRpc(session).agent.select({ name });
}

/**
 * Deseleciona o agente ativo (experimental). SDK RPC: `session.rpc.agent.deselect()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function agentDeselect(session) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.deselect');
    assertSession(session, 'agent.deselect');
    return getRpc(session).agent.deselect();
}

/**
 * Recarrega a lista de agentes (experimental). SDK RPC: `session.rpc.agent.reload()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function agentReload(session) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.reload');
    assertSession(session, 'agent.reload');
    return getRpc(session).agent.reload();
}

// ═══════════════════════════════════════════════════════════════════════════════
// skills subsystem — SDK: skills.list(), skills.enable(params),
//                    skills.disable(params), skills.reload()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{
 *     name: string;
 *     description: string;
 *     source: string;
 *     userInvocable: boolean;
 *     enabled: boolean;
 *     path?: string;
 * }} SkillInfo
 */

/**
 * Lista skills disponíveis (experimental). SDK RPC: `session.rpc.skills.list()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<SkillInfo[]>}
 */
export async function skillsList(session) {
    if (!isExperimentalEnabled('skills')) throwNotEnabled('skills', 'skills.list');
    assertSession(session, 'skills.list');
    return getRpc(session).skills.list();
}

/**
 * Habilita uma skill (experimental). SDK RPC: `session.rpc.skills.enable({ name })`
 *
 * @param {CopilotSession} session
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function skillsEnable(session, name) {
    if (!isExperimentalEnabled('skills')) throwNotEnabled('skills', 'skills.enable');
    assertSession(session, 'skills.enable');
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/skills.enable] name deve ser string não-vazia.');
    }
    return getRpc(session).skills.enable({ name });
}

/**
 * Desabilita uma skill (experimental). SDK RPC: `session.rpc.skills.disable({ name })`
 *
 * @param {CopilotSession} session
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function skillsDisable(session, name) {
    if (!isExperimentalEnabled('skills')) throwNotEnabled('skills', 'skills.disable');
    assertSession(session, 'skills.disable');
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/skills.disable] name deve ser string não-vazia.');
    }
    return getRpc(session).skills.disable({ name });
}

/**
 * Recarrega a lista de skills (experimental). SDK RPC: `session.rpc.skills.reload()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function skillsReload(session) {
    if (!isExperimentalEnabled('skills')) throwNotEnabled('skills', 'skills.reload');
    assertSession(session, 'skills.reload');
    return getRpc(session).skills.reload();
}

// ═══════════════════════════════════════════════════════════════════════════════
// mcp subsystem — SDK: mcp.list(), mcp.enable(params),
//                 mcp.disable(params), mcp.reload()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{
 *     name: string;
 *     status: 'connected' | 'failed' | 'pending' | 'disabled' | 'not_configured';
 *     source?: string;
 *     error?: string;
 * }} McpServerInfo
 */

/**
 * Lista servidores MCP disponíveis (experimental). SDK RPC: `session.rpc.mcp.list()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<McpServerInfo[]>}
 */
export async function mcpList(session) {
    if (!isExperimentalEnabled('mcp')) throwNotEnabled('mcp', 'mcp.list');
    assertSession(session, 'mcp.list');
    return getRpc(session).mcp.list();
}

/**
 * Habilita um servidor MCP (experimental). SDK RPC: `session.rpc.mcp.enable({ serverName })`
 *
 * @param {CopilotSession} session
 * @param {string} serverName
 * @returns {Promise<void>}
 */
export async function mcpEnable(session, serverName) {
    if (!isExperimentalEnabled('mcp')) throwNotEnabled('mcp', 'mcp.enable');
    assertSession(session, 'mcp.enable');
    if (typeof serverName !== 'string' || serverName.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/mcp.enable] serverName deve ser string não-vazia.');
    }
    return getRpc(session).mcp.enable({ serverName });
}

/**
 * Desabilita um servidor MCP (experimental). SDK RPC: `session.rpc.mcp.disable({ serverName })`
 *
 * @param {CopilotSession} session
 * @param {string} serverName
 * @returns {Promise<void>}
 */
export async function mcpDisable(session, serverName) {
    if (!isExperimentalEnabled('mcp')) throwNotEnabled('mcp', 'mcp.disable');
    assertSession(session, 'mcp.disable');
    if (typeof serverName !== 'string' || serverName.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/mcp.disable] serverName deve ser string não-vazia.');
    }
    return getRpc(session).mcp.disable({ serverName });
}

/**
 * Recarrega servidores MCP (experimental). SDK RPC: `session.rpc.mcp.reload()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function mcpReload(session) {
    if (!isExperimentalEnabled('mcp')) throwNotEnabled('mcp', 'mcp.reload');
    assertSession(session, 'mcp.reload');
    return getRpc(session).mcp.reload();
}

// ═══════════════════════════════════════════════════════════════════════════════
// plugins subsystem — SDK: plugins.list()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ name: string; marketplace: string; version?: string; enabled: boolean }} PluginInfo
 */

/**
 * Lista plugins instalados (experimental). SDK RPC: `session.rpc.plugins.list()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<PluginInfo[]>}
 */
export async function pluginsList(session) {
    if (!isExperimentalEnabled('plugins')) throwNotEnabled('plugins', 'plugins.list');
    assertSession(session, 'plugins.list');
    return getRpc(session).plugins.list();
}

// ═══════════════════════════════════════════════════════════════════════════════
// extensions subsystem — SDK: extensions.list(), extensions.enable(params),
//                        extensions.disable(params), extensions.reload()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{
 *     id: string;
 *     name: string;
 *     source: 'project' | 'user';
 *     status: 'running' | 'disabled' | 'failed' | 'starting';
 *     pid?: number;
 * }} ExtensionInfo
 */

/**
 * Lista extensões disponíveis (experimental). SDK RPC: `session.rpc.extensions.list()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<ExtensionInfo[]>}
 */
export async function extensionsList(session) {
    if (!isExperimentalEnabled('extensions')) throwNotEnabled('extensions', 'extensions.list');
    assertSession(session, 'extensions.list');
    return getRpc(session).extensions.list();
}

/**
 * Habilita uma extensão (experimental). SDK RPC: `session.rpc.extensions.enable({ id })`
 *
 * @param {CopilotSession} session
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function extensionsEnable(session, id) {
    if (!isExperimentalEnabled('extensions')) throwNotEnabled('extensions', 'extensions.enable');
    assertSession(session, 'extensions.enable');
    if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/extensions.enable] id deve ser string não-vazia.');
    }
    return getRpc(session).extensions.enable({ id });
}

/**
 * Desabilita uma extensão (experimental). SDK RPC: `session.rpc.extensions.disable({ id })`
 *
 * @param {CopilotSession} session
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function extensionsDisable(session, id) {
    if (!isExperimentalEnabled('extensions')) throwNotEnabled('extensions', 'extensions.disable');
    assertSession(session, 'extensions.disable');
    if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/extensions.disable] id deve ser string não-vazia.');
    }
    return getRpc(session).extensions.disable({ id });
}

/**
 * Recarrega extensões (experimental). SDK RPC: `session.rpc.extensions.reload()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function extensionsReload(session) {
    if (!isExperimentalEnabled('extensions')) throwNotEnabled('extensions', 'extensions.reload');
    assertSession(session, 'extensions.reload');
    return getRpc(session).extensions.reload();
}
