// @ts-check
/**
 * @module copilot/presentation/runtime-sdk-session
 * @file Façade compartilhada das operações vanilla de sessão SDK (`mode/plan`) por runtime.
 *
 *   Esta camada resolve `runtimeId`; a semântica de `mode/plan` fica em `agent/facades/agent-sdk-session`.
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
