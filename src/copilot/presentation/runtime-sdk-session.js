// @ts-check
/**
 * @module copilot/presentation/runtime-sdk-session
 * @file Façade compartilhada das operações vanilla de sessão SDK (`mode/plan`) por runtime.
 *
 *   Esta camada evita que `terminal/` e futuras bordas runtime-aware chamem `getSdkSessionMode()` / `readSdkPlan()`
 *   diretamente no runtime, mantendo a seleção por `runtimeId` concentrada no accessor canônico de `presentation/`.
 */

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
 * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
 */
export async function getAgentSdkSessionMode(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).getSdkSessionMode();
}

/**
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
 */
export async function setAgentSdkSessionMode(mode, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).setSdkSessionMode(mode);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('#copilot/sdk/types').PlanReadResult>}
 */
export async function readAgentSdkPlan(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).readSdkPlan();
}

/**
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function updateAgentSdkPlan(content, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).updateSdkPlan(content);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function deleteAgentSdkPlan(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).deleteSdkPlan();
}
