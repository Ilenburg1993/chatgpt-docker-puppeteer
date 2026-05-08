// @ts-check
/**
 * src/copilot/agent/facades/sdk/workspace-ops.js
 *
 * Sub-fachada: arquivos de workspace, shell e agentes customizados.
 *
 * @module copilot/agent/facades/sdk/workspace-ops
 */

import { MAESTRO_AGENT_NAME } from '#copilot/config';
import {
    compactionCompact,
    getCurrentAgent,
    listAgents,
    reloadAgents,
    selectAgent,
    shellExec,
    shellKill,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
} from '#copilot/sdk';
import { requireSession } from './ctx-refs.js';

/**
 * @param {unknown} ctx
 * @returns {Promise<Awaited<ReturnType<typeof workspaceListFiles>>>}
 */
export async function listSdkWorkspaceFiles(ctx) {
    return workspaceListFiles(requireSession(ctx, 'listSdkWorkspaceFiles'));
}

/**
 * @param {unknown} ctx
 * @param {string} path
 * @returns {Promise<Awaited<ReturnType<typeof workspaceReadFile>>>}
 */
export async function readSdkWorkspaceFile(ctx, path) {
    return workspaceReadFile(requireSession(ctx, 'readSdkWorkspaceFile'), path);
}

/**
 * @param {unknown} ctx
 * @param {string} path
 * @param {string} content
 * @returns {Promise<Awaited<ReturnType<typeof workspaceCreateFile>>>}
 */
export async function createSdkWorkspaceFile(ctx, path, content) {
    return workspaceCreateFile(requireSession(ctx, 'createSdkWorkspaceFile'), path, content);
}

/**
 * @param {unknown} ctx
 * @returns {Promise<Awaited<ReturnType<typeof compactionCompact>>>}
 */
export async function compactSdkSession(ctx) {
    return compactionCompact(requireSession(ctx, 'compactSdkSession'));
}

/**
 * @param {unknown} ctx
 * @param {string} command
 * @param {{ cwd?: string; timeout?: number }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof shellExec>>>}
 */
export async function execSdkShell(ctx, command, options) {
    return shellExec(requireSession(ctx, 'execSdkShell'), command, options);
}

/**
 * @param {unknown} ctx
 * @param {string} processId
 * @param {'SIGTERM' | 'SIGKILL' | 'SIGINT'} [signal]
 * @returns {Promise<Awaited<ReturnType<typeof shellKill>>>}
 */
export async function killSdkShell(ctx, processId, signal) {
    return shellKill(requireSession(ctx, 'killSdkShell'), processId, signal);
}

/**
 * @param {unknown} ctx
 * @returns {Promise<Awaited<ReturnType<typeof listAgents>>>}
 */
export async function listSdkAgents(ctx) {
    return listAgents(requireSession(ctx, 'listSdkAgents'));
}

/**
 * @param {unknown} ctx
 * @returns {Promise<{ agent: unknown; enforced: boolean; previousAgent?: unknown }>}
 */
export async function getCurrentSdkAgent(ctx) {
    const session = requireSession(ctx, 'getCurrentSdkAgent');
    const current = await getCurrentAgent(session);
    if (current.agent?.name === MAESTRO_AGENT_NAME) {
        return { ...current, enforced: false };
    }
    const selected = await selectAgent(session, MAESTRO_AGENT_NAME);
    return { agent: selected.agent, previousAgent: current.agent ?? null, enforced: true };
}

/**
 * @param {unknown} ctx
 * @param {string} name
 * @returns {Promise<Awaited<ReturnType<typeof selectAgent>>>}
 */
export async function selectSdkAgent(ctx, name) {
    if (name && name !== MAESTRO_AGENT_NAME) {
        throw new Error(`Seleção direta de "${name}" bloqueada. O agente ativo obrigatório é "${MAESTRO_AGENT_NAME}".`);
    }
    return selectAgent(requireSession(ctx, 'selectSdkAgent'), MAESTRO_AGENT_NAME);
}

/**
 * @param {unknown} ctx
 * @returns {Promise<Awaited<ReturnType<typeof selectAgent>>>}
 */
export async function deselectSdkAgent(ctx) {
    return selectAgent(requireSession(ctx, 'deselectSdkAgent'), MAESTRO_AGENT_NAME);
}

/**
 * @param {unknown} ctx
 * @returns {Promise<{ agents: unknown[]; selectedAgent: unknown }>}
 */
export async function reloadSdkAgents(ctx) {
    const session = requireSession(ctx, 'reloadSdkAgents');
    const result = await reloadAgents(session);
    const selected = await selectAgent(session, MAESTRO_AGENT_NAME);
    return { ...result, selectedAgent: selected.agent };
}
