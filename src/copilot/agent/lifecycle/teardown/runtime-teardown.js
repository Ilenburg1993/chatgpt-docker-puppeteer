// @ts-check
/**
 * @module copilot/agent/lifecycle/teardown/runtime-teardown
 * @file Helpers internos de teardown do runtime do agent.
 *
 *   Centraliza blocos repetidos de cleanup usados por `agentStart` rollback e `agentStop`, mantendo a API pública no
 *   lifecycle principal, mas reduzindo concentração semântica em `agent-lifecycle.js`.
 */

import { toError } from '#copilot/infra/public/platform/error';
import { disconnectAgentSdkSession, stopAgentSdkClient } from '../../facades/sdk-access.js';
import { log } from '../../ports/logging/index.js';
import { defaultMetrics } from '../../ports/metrics-port.js';
import { unbindAgentSessionTools } from '../../ports/tool-port.js';

/**
 * @typedef {import('../../agent-context.js').AgentContext} AgentContext
 */

/**
 * Limpa timers, reconnect handlers, monitores e keepalive do runtime.
 *
 * @param {AgentContext} ctx
 * @param {string} keepaliveStopReason
 * @returns {void}
 */
export function teardownRuntimeSidecars(ctx, keepaliveStopReason) {
    const metricsTimer = ctx.getMetricsTimerSnapshot();
    if (metricsTimer) {
        clearInterval(metricsTimer);
        ctx.clearMetricsTimer();
    }

    const mcpReconnectCancel = ctx.getMcpReconnectCancelSnapshot();
    if (mcpReconnectCancel) {
        mcpReconnectCancel();
        ctx.clearMcpReconnectCancel();
    }

    ctx.stopQuotaMonitor();
    ctx.stopKeepalive(keepaliveStopReason);
    defaultMetrics.stopPeriodicSnapshot();
}

/**
 * Desanexa observer e unsubscribers de eventos da sessão.
 *
 * @param {AgentContext} ctx
 * @returns {void}
 */
export function detachRuntimeObservers(ctx) {
    const agentObserver = ctx.getAgentObserverSnapshot();
    if (agentObserver) {
        agentObserver.detach();
        ctx.clearAgentObserver();
    }

    const sessionEventUnsubscribers = ctx.getSessionEventUnsubscribersSnapshot();
    // FIX: try/catch em cada unsub() — uma exceção isolada não interrompe as demais limpezas.
    for (const unsub of sessionEventUnsubscribers) {
        try {
            unsub();
        } catch (e) {
            log('WARN', '[runtime-teardown] unsub falhou (continuando limpeza): ' + toError(e).message);
        }
    }
    ctx.clearSessionEventUnsubscribers();
}

/**
 * Encerra sessão e client SDK ativos (best-effort) e limpa handles do contexto.
 *
 * @param {AgentContext} ctx
 * @param {{ sessionLabel: string; clientLabel: string }} labels
 * @returns {Promise<void>}
 */
export async function disconnectRuntimeSdkHandles(ctx, labels) {
    const session = ctx.getSessionSnapshot();
    if (session) {
        try {
            await disconnectAgentSdkSession(session);
        } catch (error) {
            log('WARN', `${labels.sessionLabel}: ${toError(error).message}`);
        }
        ctx.clearSession();
        ctx.invalidateMessagesCache();
        unbindAgentSessionTools();
    }

    const client = ctx.getClientSnapshot();
    if (!client) {
        return;
    }

    try {
        const stopErrors = await stopAgentSdkClient(client);
        if (stopErrors.length > 0) {
            log('WARN', `${labels.clientLabel}: ${stopErrors.map((entry) => toError(entry).message).join('; ')}`);
        }
    } catch (error) {
        log('WARN', `${labels.clientLabel}: ${toError(error).message}`);
    }

    ctx.clearClient();
}
