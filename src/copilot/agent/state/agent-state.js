// @ts-check
/**
 * src/copilot/agent/state/agent-state.js
 *
 * F39: Funções de estado e snapshot — extraídas de always-alive.js.
 *
 * Centraliza a construção de snapshots e diagnósticos de listeners.
 *
 * @module copilot/agent/state/agent-state
 * @internal
 * @see EventBus
 */

import { AGENT_EVENTS } from '#copilot/events';
import { STATUS_SNAPSHOT_TTL_MS } from '../../config/agent.js';
import { buildStatusSnapshot } from '../../observability/snapshots.js';
import { readState } from '../lifecycle/state-io.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 */

/** @typedef {import('../types.js').StateHost} StateHost */

/**
 * Constrói ou retorna snapshot cacheado do estado do agente.
 *
 * @param {AgentContext} ctx
 * @param {StateHost} host
 * @returns {import('../types.js').AgentStatusSnapshot}
 */
export function getStatusSnapshot(ctx, host) {
    if (ctx.metricsState.statusSnapshotCache) {
        const age = Date.now() - ctx.metricsState.statusSnapshotCache.at;
        if (age < STATUS_SNAPSHOT_TTL_MS) {
            return ctx.metricsState.statusSnapshotCache.snapshot;
        }
        ctx.metricsState.statusSnapshotCache = null;
    }
    const state = readState();
    const snapshot = buildStatusSnapshot({
        status: ctx.runtimeState.status,
        sessionId: host.sessionId,
        model: ctx.configState.model,
        reasoningEffort: ctx.configState.reasoningEffort,
        queueSize: ctx.messageQueue.size,
        queueOldest: ctx.messageQueue.oldest,
        pendingQuestion: ctx.dialogState.pendingQuestion,
        isResumed: ctx.sessionState.isResumed,
        resumeCount: state?.resumeCount ?? 0,
        sendCount: ctx.metricsState.sendCount,
        startedAt: state?.startedAt ?? null,
        contextWindow: ctx.sessionState.contextState,
        lastCheckpointPath: ctx.sessionState.lastCheckpointPath,
        permissionMode: ctx.permissions.getMode(),
    });
    ctx.metricsState.statusSnapshotCache = { snapshot, at: Date.now() };
    return snapshot;
}

/**
 * Retorna contagem de listeners por evento para diagnóstico de leaks.
 *
 * @param {StateHost} host
 * @returns {{ [event: string]: number }}
 */
export function listenerDiagnostics(host) {
    /** @type {{ [event: string]: number }} */
    const result = {};
    for (const evt of AGENT_EVENTS) {
        result[evt] = host.listenerCount(evt);
    }
    return result;
}
