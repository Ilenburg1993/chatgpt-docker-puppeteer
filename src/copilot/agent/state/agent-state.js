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
import { readState } from '../lifecycle/state-io.js';
import { buildStatusSnapshot } from '../ports/snapshot-port.js';

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
    const cachedSnapshot = ctx.getFreshStatusSnapshotCache(STATUS_SNAPSHOT_TTL_MS);
    if (cachedSnapshot) {
        return cachedSnapshot;
    }
    const state = readState();
    const queue = ctx.getQueueSnapshot();
    const snapshot = buildStatusSnapshot({
        status: ctx.getRuntimeStatus(),
        sessionId: host.sessionId,
        model: ctx.getModelSnapshot(),
        reasoningEffort: ctx.getReasoningEffortSnapshot(),
        queueSize: queue.size,
        queueOldest: queue.oldest,
        pendingQuestion: ctx.getPendingQuestionForStatusSnapshot(),
        isResumed: ctx.getIsResumedSnapshot(),
        resumeCount: state?.resumeCount ?? 0,
        sendCount: ctx.getSendCountSnapshot(),
        startedAt: state?.startedAt ?? null,
        contextWindow: ctx.getContextStateSnapshot(),
        lastCheckpointPath: ctx.getLastCheckpointPathSnapshot(),
        permissionMode: ctx.getPermissionModeSnapshot(),
    });
    ctx.cacheStatusSnapshot(snapshot);
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
