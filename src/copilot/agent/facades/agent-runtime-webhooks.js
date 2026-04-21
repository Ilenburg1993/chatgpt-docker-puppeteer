// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-webhooks
 * @file Facade canônica das operações de webhook do runtime (`list/register/unregister`).
 */

/**
 * @typedef {{
 *     listWebhooks: () => { id: string; url: string }[];
 *     registerWebhook: (url: string) => { id: string; url: string };
 *     unregisterWebhook: (id: string) => boolean;
 * }} AgentRuntimeWebhooksTarget
 */

/**
 * @param {AgentRuntimeWebhooksTarget} runtime
 * @returns {{ id: string; url: string }[]}
 */
export function listAgentRuntimeWebhooks(runtime) {
    return runtime.listWebhooks();
}

/**
 * @param {AgentRuntimeWebhooksTarget} runtime
 * @param {string} url
 * @returns {{ id: string; url: string }}
 */
export function registerAgentRuntimeWebhook(runtime, url) {
    return runtime.registerWebhook(url);
}

/**
 * @param {AgentRuntimeWebhooksTarget} runtime
 * @param {string} id
 * @returns {boolean}
 */
export function unregisterAgentRuntimeWebhook(runtime, id) {
    return runtime.unregisterWebhook(id);
}
