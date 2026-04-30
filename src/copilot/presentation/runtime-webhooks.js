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
import { buildRuntimeRouteMetaFromSelection, buildRuntimeRouteMetaPayload } from './runtime-meta.js';

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

/**
 * Projeção HTTP canônica para listagem de webhooks por runtime.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     ok: true;
 *     runtimeId: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 *     count: number;
 *     webhooks: { id: string; url: string }[];
 * }}
 */
export function buildRuntimeWebhooksListHttpPayload(runtimeId) {
    const selection = resolveRuntimeWebhookSelection(runtimeId);
    const webhooks = listAgentRuntimeWebhooks(selection.agent);
    return {
        ok: true,
        runtimeId: selection.runtimeId,
        ...buildRuntimeRouteMetaPayload(selection),
        count: webhooks.length,
        webhooks,
    };
}

/**
 * Projeção HTTP canônica para confirmação de registro de webhook por runtime.
 *
 * @param {string} url
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     ok: true;
 *     runtimeId: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 *     id: string;
 *     url: string;
 * }}
 */
export function registerRuntimeWebhookHttp(url, runtimeId) {
    const selection = resolveRuntimeWebhookSelection(runtimeId);
    const result = registerAgentRuntimeWebhook(selection.agent, url);
    return {
        ok: true,
        runtimeId: selection.runtimeId,
        ...buildRuntimeRouteMetaPayload(selection),
        ...result,
    };
}

/**
 * Projeção HTTP canônica para remoção de webhook por runtime.
 *
 * @param {string} id
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     ok: true;
 *     runtimeId: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 *     id: string;
 * } | null}
 */
export function unregisterRuntimeWebhookHttp(id, runtimeId) {
    const selection = resolveRuntimeWebhookSelection(runtimeId);
    const removed = unregisterAgentRuntimeWebhook(selection.agent, id);
    if (!removed) return null;
    return {
        ok: true,
        runtimeId: selection.runtimeId,
        ...buildRuntimeRouteMetaPayload(selection),
        id,
    };
}
