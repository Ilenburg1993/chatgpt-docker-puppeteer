// @ts-check
/**
 * @module copilot/presentation/runtime-sdk-session
 * @file Façade compartilhada das operações vanilla/advanced de sessão SDK por runtime.
 *
 *   Esta camada resolve `runtimeId`; a semântica operacional fica no Agent, depois do SDK.
 * @typedef {import('./types.js').RuntimeSdkModeResult} RuntimeSdkModeResult
 *
 * @typedef {import('./types.js').RuntimeSdkPlanReadResult} RuntimeSdkPlanReadResult
 */

import {
    deleteAgentSdkPlan as deleteAgentSdkPlanOnAgent,
    readAgentSdkPlan as readAgentSdkPlanFromAgent,
    readAgentSdkSessionMode,
    setAgentSdkSessionMode as setAgentSdkSessionModeOnAgent,
    updateAgentSdkPlan as updateAgentSdkPlanOnAgent,
} from '#copilot/agent';
import { getAgentRuntimeOrDefault } from './agent-runtime.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('#copilot/agent').AlwaysAliveAgent}
 */
export function getAgentSdkSessionTarget(runtimeId) {
    return getAgentRuntimeOrDefault(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<RuntimeSdkModeResult>}
 */
export async function getAgentSdkSessionMode(runtimeId) {
    return readAgentSdkSessionMode(getAgentSdkSessionTarget(runtimeId));
}

/**
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<RuntimeSdkModeResult>}
 */
export async function setAgentSdkSessionMode(mode, runtimeId) {
    return setAgentSdkSessionModeOnAgent(getAgentSdkSessionTarget(runtimeId), mode);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<RuntimeSdkPlanReadResult>}
 */
export async function readAgentSdkPlan(runtimeId) {
    return readAgentSdkPlanFromAgent(getAgentSdkSessionTarget(runtimeId));
}

/**
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function updateAgentSdkPlan(content, runtimeId) {
    return updateAgentSdkPlanOnAgent(getAgentSdkSessionTarget(runtimeId), content);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function deleteAgentSdkPlan(runtimeId) {
    return deleteAgentSdkPlanOnAgent(getAgentSdkSessionTarget(runtimeId));
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listAgentSdkModels(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).listSdkModels();
}

/**
 * @param {{ model?: string }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listAgentSdkTools(options, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).listSdkBuiltInTools(options);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function getAgentSdkQuota(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).getSdkQuota();
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listAgentSdkWorkspaceFiles(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).listSdkWorkspaceFiles();
}

/**
 * @param {string} path
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function readAgentSdkWorkspaceFile(path, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).readSdkWorkspaceFile(path);
}

/**
 * @param {string} path
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function createAgentSdkWorkspaceFile(path, content, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).createSdkWorkspaceFile(path, content);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function compactAgentSdkSession(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).compactSdkSession();
}

/**
 * @param {string} message
 * @param {object} requestedSchema
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function requestAgentSdkElicitation(message, requestedSchema, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).requestSdkElicitation(message, requestedSchema);
}
