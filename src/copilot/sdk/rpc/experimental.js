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

import { toSdkOperationError } from '../errors.js';
import { isExperimentalEnabled } from '../feature-flags.js';
import { log as appLog } from '../logger.js';
import { assertRpcSession } from './guards.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

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

/**
 * Resolve um método experimental obrigatório com narrowing explícito para satisfazer strict typing.
 *
 * @template {keyof import('../types.js').ExperimentalSession['rpc']} N
 * @template {keyof NonNullable<import('../types.js').ExperimentalSession['rpc'][N]>} M
 * @param {CopilotSession} session
 * @param {N} namespace
 * @param {M} method
 * @returns {NonNullable<NonNullable<import('../types.js').ExperimentalSession['rpc'][N]>[M]>}
 */
function requireRpcMethod(session, namespace, method) {
    const rpc = getRpc(session);
    const ns = rpc[namespace];
    const fn = ns?.[method];
    if (typeof fn !== 'function') {
        throw new TypeError(`[sdk/experimental-rpc] método RPC indisponível: ${String(namespace)}.${String(method)}()`);
    }
    return /** @type {NonNullable<NonNullable<import('../types.js').ExperimentalSession['rpc'][N]>[M]>} */ (fn);
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
    assertRpcSession(session, 'fleet.start');
    appLog('INFO', `[sdk/experimental-rpc] fleet.start: sessionId='${session.sessionId}'`);
    try {
        return /** @type {FleetStartResult} */ (await requireRpcMethod(session, 'fleet', 'start')(options ?? {}));
    } catch (error) {
        throw toSdkOperationError('experimental.fleet.start', error);
    }
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
    assertRpcSession(session, 'agent.list');
    appLog('DEBUG', `[sdk/experimental-rpc] agent.list: sessionId='${session.sessionId}'`);
    try {
        return /** @type {AgentInfo[]} */ (await requireRpcMethod(session, 'agent', 'list')());
    } catch (error) {
        throw toSdkOperationError('experimental.agent.list', error);
    }
}

/**
 * Retorna o agente ativo atual (experimental). SDK RPC: `session.rpc.agent.getCurrent()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<AgentInfo | null>}
 */
export async function agentGetCurrent(session) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.getCurrent');
    assertRpcSession(session, 'agent.getCurrent');
    appLog('DEBUG', `[sdk/experimental-rpc] agent.getCurrent: sessionId='${session.sessionId}'`);
    try {
        return /** @type {AgentInfo | null} */ (await requireRpcMethod(session, 'agent', 'getCurrent')());
    } catch (error) {
        throw toSdkOperationError('experimental.agent.getCurrent', error);
    }
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
    assertRpcSession(session, 'agent.select');
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/agent.select] name deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/experimental-rpc] agent.select: name='${name}', sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'agent', 'select')({ name });
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.agent.select', error);
    }
}

/**
 * Deseleciona o agente ativo (experimental). SDK RPC: `session.rpc.agent.deselect()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function agentDeselect(session) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.deselect');
    assertRpcSession(session, 'agent.deselect');
    appLog('INFO', `[sdk/experimental-rpc] agent.deselect: sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'agent', 'deselect')();
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.agent.deselect', error);
    }
}

/**
 * Recarrega a lista de agentes (experimental). SDK RPC: `session.rpc.agent.reload()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function agentReload(session) {
    if (!isExperimentalEnabled('agents')) throwNotEnabled('agents', 'agent.reload');
    assertRpcSession(session, 'agent.reload');
    appLog('INFO', `[sdk/experimental-rpc] agent.reload: sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'agent', 'reload')();
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.agent.reload', error);
    }
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
    assertRpcSession(session, 'skills.list');
    appLog('DEBUG', `[sdk/experimental-rpc] skills.list: sessionId='${session.sessionId}'`);
    try {
        return /** @type {SkillInfo[]} */ (await requireRpcMethod(session, 'skills', 'list')());
    } catch (error) {
        throw toSdkOperationError('experimental.skills.list', error);
    }
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
    assertRpcSession(session, 'skills.enable');
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/skills.enable] name deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/experimental-rpc] skills.enable: name='${name}', sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'skills', 'enable')({ name });
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.skills.enable', error);
    }
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
    assertRpcSession(session, 'skills.disable');
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/skills.disable] name deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/experimental-rpc] skills.disable: name='${name}', sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'skills', 'disable')({ name });
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.skills.disable', error);
    }
}

/**
 * Recarrega a lista de skills (experimental). SDK RPC: `session.rpc.skills.reload()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function skillsReload(session) {
    if (!isExperimentalEnabled('skills')) throwNotEnabled('skills', 'skills.reload');
    assertRpcSession(session, 'skills.reload');
    appLog('INFO', `[sdk/experimental-rpc] skills.reload: sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'skills', 'reload')();
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.skills.reload', error);
    }
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
    assertRpcSession(session, 'mcp.list');
    appLog('DEBUG', `[sdk/experimental-rpc] mcp.list: sessionId='${session.sessionId}'`);
    try {
        return /** @type {McpServerInfo[]} */ (await requireRpcMethod(session, 'mcp', 'list')());
    } catch (error) {
        throw toSdkOperationError('experimental.mcp.list', error);
    }
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
    assertRpcSession(session, 'mcp.enable');
    if (typeof serverName !== 'string' || serverName.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/mcp.enable] serverName deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/experimental-rpc] mcp.enable: serverName='${serverName}', sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'mcp', 'enable')({ serverName });
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.mcp.enable', error);
    }
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
    assertRpcSession(session, 'mcp.disable');
    if (typeof serverName !== 'string' || serverName.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/mcp.disable] serverName deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/experimental-rpc] mcp.disable: serverName='${serverName}', sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'mcp', 'disable')({ serverName });
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.mcp.disable', error);
    }
}

/**
 * Recarrega servidores MCP (experimental). SDK RPC: `session.rpc.mcp.reload()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function mcpReload(session) {
    if (!isExperimentalEnabled('mcp')) throwNotEnabled('mcp', 'mcp.reload');
    assertRpcSession(session, 'mcp.reload');
    appLog('INFO', `[sdk/experimental-rpc] mcp.reload: sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'mcp', 'reload')();
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.mcp.reload', error);
    }
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
    assertRpcSession(session, 'plugins.list');
    appLog('DEBUG', `[sdk/experimental-rpc] plugins.list: sessionId='${session.sessionId}'`);
    try {
        return /** @type {PluginInfo[]} */ (await requireRpcMethod(session, 'plugins', 'list')());
    } catch (error) {
        throw toSdkOperationError('experimental.plugins.list', error);
    }
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
    assertRpcSession(session, 'extensions.list');
    appLog('DEBUG', `[sdk/experimental-rpc] extensions.list: sessionId='${session.sessionId}'`);
    try {
        return /** @type {ExtensionInfo[]} */ (await requireRpcMethod(session, 'extensions', 'list')());
    } catch (error) {
        throw toSdkOperationError('experimental.extensions.list', error);
    }
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
    assertRpcSession(session, 'extensions.enable');
    if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/extensions.enable] id deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/experimental-rpc] extensions.enable: id='${id}', sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'extensions', 'enable')({ id });
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.extensions.enable', error);
    }
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
    assertRpcSession(session, 'extensions.disable');
    if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('[sdk/experimental-rpc/extensions.disable] id deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/experimental-rpc] extensions.disable: id='${id}', sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'extensions', 'disable')({ id });
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.extensions.disable', error);
    }
}

/**
 * Recarrega extensões (experimental). SDK RPC: `session.rpc.extensions.reload()`
 *
 * @param {CopilotSession} session
 * @returns {Promise<void>}
 */
export async function extensionsReload(session) {
    if (!isExperimentalEnabled('extensions')) throwNotEnabled('extensions', 'extensions.reload');
    assertRpcSession(session, 'extensions.reload');
    appLog('INFO', `[sdk/experimental-rpc] extensions.reload: sessionId='${session.sessionId}'`);
    try {
        await requireRpcMethod(session, 'extensions', 'reload')();
        return;
    } catch (error) {
        throw toSdkOperationError('experimental.extensions.reload', error);
    }
}
