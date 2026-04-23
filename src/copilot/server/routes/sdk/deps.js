// @ts-check
/**
 * @module copilot/server/routes/sdk/deps
 * @file Wiring do adapter HTTP do SDK.
 *
 *   Rotas em `server/routes/sdk/*` adaptam o SDK para HTTP. Por isso, este é o ponto de composição autorizado para client
 *   SDK, estado do SDK e catálogo estático usado como fallback antes do boot do agent.
 */

import { container } from '#copilot/core';
import { METRICS_STORE } from '#copilot/observability';
import { forceStopClient, getClient, getClientState, stopClient } from '#copilot/sdk';
import { getAllTools } from '#copilot/tools';
import { resolveAgentRuntimeSelection } from '../../../presentation/agent-runtime.js';
import { resolveRequestedRuntimeId } from '../../../presentation/runtime-request.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     agent: import('../../../agent/always-alive.js').AlwaysAliveAgent;
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     metrics: import('#copilot/observability/metrics.js').MetricsStore;
 *     getClient: typeof getClient;
 *     getClientState: typeof getClientState;
 *     stopClient: typeof stopClient;
 *     forceStopClient: typeof forceStopClient;
 *     allTools: ReturnType<typeof getAllTools>;
 * }}
 */
export function buildDefaultSdkRouteSharedDeps(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    return {
        agent: selection.runtime,
        runtimeId: selection.runtimeId,
        requestedRuntimeId: selection.requestedRuntimeId,
        runtimeFound: selection.runtimeFound,
        usedDefaultRuntimeFallback: selection.usedDefaultRuntimeFallback,
        metrics: /** @type {import('#copilot/observability/metrics.js').MetricsStore} */ (
            container.resolve(METRICS_STORE)
        ),
        getClient,
        getClientState,
        stopClient,
        forceStopClient,
        allTools: getAllTools(),
    };
}

/**
 * Resolve as dependências canônicas das rotas `/sdk/*` para a requisição atual.
 *
 * @param {import('express').Request} req
 * @returns {ReturnType<typeof buildDefaultSdkRouteSharedDeps>}
 */
export function resolveSdkRouteSharedDeps(req) {
    return buildDefaultSdkRouteSharedDeps(resolveRequestedRuntimeId(req));
}
