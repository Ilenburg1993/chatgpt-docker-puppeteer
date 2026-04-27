// @ts-check
/**
 * @module copilot/agent/facades/agent-sdk-session
 * @file Facade agent-level para operações vanilla de sessão SDK (`mode` e `plan`).
 *
 *   As chamadas reais continuam sendo SDK-first dentro do AlwaysAliveAgent/AgentContext. Esta camada existe para que
 *   `presentation/` resolva runtime e delegue intenção, sem precisar conhecer nomes crus da sessão SDK.
 */

import { SessionError } from '#copilot/core';
import { modeGet, modeSet, planDelete, planRead, planUpdate } from '#copilot/sdk';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 */

/**
 * @param {AgentContext} ctx
 * @param {string} caller
 * @returns {import('#copilot/sdk/types').CopilotSession}
 */
function requireSession(ctx, caller) {
    const session = typeof ctx.getSessionSnapshot === 'function' ? ctx.getSessionSnapshot() : null;
    if (!session) {
        throw new SessionError(`[agent-sdk-session] sessão indisponível: ${caller}`, 'SDK_SESSION_UNAVAILABLE');
    }
    return session;
}

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
 * Owner canônico (lado AgentContext) para leitura do modo da sessão SDK.
 *
 * @param {AgentContext} ctx
 * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
 */
export async function getSdkSessionMode(ctx) {
    return modeGet(requireSession(ctx, 'getSdkSessionMode'));
}

/**
 * Owner canônico (lado AgentContext) para alteração do modo da sessão SDK.
 *
 * @param {AgentContext} ctx
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
 */
export async function setSdkSessionMode(ctx, mode) {
    return modeSet(requireSession(ctx, 'setSdkSessionMode'), mode);
}

/**
 * Owner canônico (lado AgentContext) para leitura do `plan.md` vanilla da sessão SDK.
 *
 * @param {AgentContext} ctx
 * @returns {Promise<import('#copilot/sdk/types').PlanReadResult>}
 */
export async function readSdkPlan(ctx) {
    return planRead(requireSession(ctx, 'readSdkPlan'));
}

/**
 * Owner canônico (lado AgentContext) para atualização do `plan.md` vanilla da sessão SDK.
 *
 * @param {AgentContext} ctx
 * @param {string} content
 * @returns {Promise<object>}
 */
export async function updateSdkPlan(ctx, content) {
    return planUpdate(requireSession(ctx, 'updateSdkPlan'), content);
}

/**
 * Owner canônico (lado AgentContext) para remoção do `plan.md` vanilla da sessão SDK.
 *
 * @param {AgentContext} ctx
 * @returns {Promise<object>}
 */
export async function deleteSdkPlan(ctx) {
    return planDelete(requireSession(ctx, 'deleteSdkPlan'));
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
