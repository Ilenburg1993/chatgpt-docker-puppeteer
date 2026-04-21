// @ts-check
/**
 * @module copilot/presentation/runtime-route-deps
 * @file Composição canônica de dependências compartilhadas para routers de borda.
 *
 *   Esta camada evita que cada router do `server/` remonte por conta própria a mesma combinação de runtime default,
 *   métricas, client SDK e catálogo de tools.
 */

import { container } from '#copilot/core';
import { METRICS_STORE } from '#copilot/observability';
import { forceStopClient, getClient, getClientState, stopClient } from '#copilot/sdk';
import { getAllTools } from '#copilot/tools';
import { resolveAgentRuntimeSelection } from './agent-runtime.js';

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
export function buildDefaultCopilotApiRouteDeps(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    return {
        agent: selection.runtime,
        runtimeId: selection.runtimeId,
        requestedRuntimeId: selection.requestedRuntimeId,
        runtimeFound: selection.runtimeFound,
        usedDefaultRuntimeFallback: selection.usedDefaultRuntimeFallback,
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     agent: import('../agent/always-alive.js').AlwaysAliveAgent;
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
