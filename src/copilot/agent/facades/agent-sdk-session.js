// @ts-check
/**
 * @module copilot/agent/facades/agent-sdk-session
 * @file Facade agent-level para operações vanilla de sessão SDK (`mode` e `plan`).
 *
 *   As chamadas reais continuam sendo SDK-first dentro do AlwaysAliveAgent/AgentContext. Esta camada existe para que
 *   `presentation/` resolva runtime e delegue intenção, sem precisar conhecer nomes crus da sessão SDK.
 */

import { SessionError } from '#copilot/core';

/**
 * @param {unknown} agent
 * @param {string} method
 * @returns {(...args: unknown[]) => Promise<unknown>}
 */
function requireAgentMethod(agent, method) {
    const fn = agent && typeof agent === 'object' ? Reflect.get(agent, method) : null;
    if (typeof fn !== 'function') {
        throw new SessionError(`[agent-sdk-session] método indisponível: ${method}`, 'SDK_SESSION_UNAVAILABLE');
    }
    return fn.bind(agent);
}

/**
 * @param {unknown} agent
 * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
 */
export async function readAgentSdkSessionMode(agent) {
    return /** @type {Promise<import('#copilot/sdk/types').ModeResult>} */ (
        requireAgentMethod(agent, 'getSdkSessionMode')()
    );
}

/**
 * @param {unknown} agent
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
 */
export async function setAgentSdkSessionMode(agent, mode) {
    return /** @type {Promise<import('#copilot/sdk/types').ModeResult>} */ (
        requireAgentMethod(agent, 'setSdkSessionMode')(mode)
    );
}

/**
 * @param {unknown} agent
 * @returns {Promise<import('#copilot/sdk/types').PlanReadResult>}
 */
export async function readAgentSdkPlan(agent) {
    return /** @type {Promise<import('#copilot/sdk/types').PlanReadResult>} */ (
        requireAgentMethod(agent, 'readSdkPlan')()
    );
}

/**
 * @param {unknown} agent
 * @param {string} content
 * @returns {Promise<object>}
 */
export async function updateAgentSdkPlan(agent, content) {
    return /** @type {Promise<object>} */ (requireAgentMethod(agent, 'updateSdkPlan')(content));
}

/**
 * @param {unknown} agent
 * @returns {Promise<object>}
 */
export async function deleteAgentSdkPlan(agent) {
    return /** @type {Promise<object>} */ (requireAgentMethod(agent, 'deleteSdkPlan')());
}
