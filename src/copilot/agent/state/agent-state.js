// @ts-check
/**
 * src/copilot/agent/state/agent-state.js
 *
 * F39: Funções de estado e snapshot — extraídas de always-alive.js.
 *
 * Centraliza a construção de snapshots e diagnósticos de listeners.
 *
 * @module copilot/agent/state/agent-state
 * @see EventBus
 * @internal
 */

import { AGENT_EVENTS } from '#copilot/events';
import { STATUS_SNAPSHOT_TTL_MS } from '../config.js';
import { buildStatusSnapshot } from '../infra/status-snapshot.js';
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
    if (ctx.statusSnapshotCache) {
        const age = Date.now() - ctx.statusSnapshotCache.at;
        if (age < STATUS_SNAPSHOT_TTL_MS) {
            return ctx.statusSnapshotCache.snapshot;
        }
        ctx.statusSnapshotCache = null;
    }
    const state = readState();
    const snapshot = buildStatusSnapshot({
        status: ctx.status,
        sessionId: host.sessionId,
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort,
        queueSize: ctx.messageQueue.size,
        queueOldest: ctx.messageQueue.oldest,
        pendingQuestion: ctx.pendingQuestion,
        isResumed: ctx.isResumed,
        resumeCount: state?.resumeCount ?? 0,
        sendCount: ctx.sendCount,
        startedAt: state?.startedAt ?? null,
        contextWindow: ctx.contextState,
        lastCheckpointPath: ctx.lastCheckpointPath,
        permissionMode: ctx.permissions.getMode(),
    });
    ctx.statusSnapshotCache = { snapshot, at: Date.now() };
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
