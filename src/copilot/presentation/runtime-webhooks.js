// @ts-check
/**
 * @module copilot/presentation/runtime-webhooks
 * @file Façade compartilhada das operações de webhook do runtime default.
 *
 *   Esta camada evita que rotas HTTP de borda chamem métodos de webhook diretamente no runtime. Em vez disso, consomem
 *   uma superfície compartilhada adequada para `server/` e futuras bordas administrativas.
 */

import { listAgentRuntimeWebhooks, registerAgentRuntimeWebhook, unregisterAgentRuntimeWebhook } from '#copilot/agent';
import { resolveAgentRuntimeSelection } from './agent-runtime.js';
import { buildRuntimeRouteMetaFromSelection } from './runtime-meta.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     agent: import('../agent/always-alive.js').AlwaysAliveAgent;
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 * }}
 */
export function resolveRuntimeWebhookSelection(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    return {
        agent: selection.runtime,
        ...buildRuntimeRouteMetaFromSelection(selection),
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ id: string; url: string }[]}
 */
export function listRuntimeWebhooks(runtimeId) {
    return listAgentRuntimeWebhooks(resolveRuntimeWebhookSelection(runtimeId).agent);
}

/**
 * @param {string} url
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ id: string; url: string }}
 */
export function registerRuntimeWebhook(url, runtimeId) {
    return registerAgentRuntimeWebhook(resolveRuntimeWebhookSelection(runtimeId).agent, url);
}

/**
 * @param {string} id
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function unregisterRuntimeWebhook(id, runtimeId) {
    return unregisterAgentRuntimeWebhook(resolveRuntimeWebhookSelection(runtimeId).agent, id);
}
