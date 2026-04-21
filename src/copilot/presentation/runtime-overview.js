// @ts-check
/**
 * @module copilot/presentation/runtime-overview
 * @file Projection compartilhada do runtime default do agent para bordas e frontends.
 *
 *   Esta camada concentra leituras repetidas de status/health/runtimeId via façades canônicas do agent para reduzir
 *   duplicação entre `presentation/system-*`, `terminal/frontend/*` e futuras bordas multi-agent.
 */

import { readAgentRuntimeHealthSnapshot, readAgentRuntimeStatusSnapshot } from '#copilot/agent';
import { listKnownAgentRuntimes, resolveAgentRuntimeSelection } from './agent-runtime.js';

/**
 * @typedef {{ tokens: number; tokenLimit: number; utilization: number }} ContextWindowProjection
 */

/**
 * Normaliza o snapshot de context window do runtime.
 *
 * @param {unknown} raw
 * @returns {ContextWindowProjection | null}
 */
export function normalizeAgentContextWindowProjection(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const data = /** @type {Record<string, unknown>} */ (raw);
    const tokens = Number(data['tokens'] ?? NaN);
    const tokenLimit = Number(data['tokenLimit'] ?? NaN);
    const utilization = Number(data['utilization'] ?? NaN);
    if (!Number.isFinite(tokens) || !Number.isFinite(tokenLimit) || !Number.isFinite(utilization)) {
        return null;
    }
    return { tokens, tokenLimit, utilization };
}

/**
 * Lê a projection compartilhada de um runtime do agent.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     agent: import('../agent/always-alive.js').AlwaysAliveAgent;
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     agentRuntimes: ReturnType<typeof listKnownAgentRuntimes>;
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     runtimeSessionId: string | null;
 *     contextWindow: ContextWindowProjection | null;
 * }}
 */
export function readAgentRuntimeOverview(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    const agent = selection.runtime;
    const agentRuntimes = listKnownAgentRuntimes();
    const snap = readAgentRuntimeStatusSnapshot(agent);
    const health = readAgentRuntimeHealthSnapshot(agent);
    const runtimeSessionId =
        agent.sessionId ?? (typeof snap['sessionId'] === 'string' ? snap['sessionId'] : null) ?? null;
    const contextWindow = normalizeAgentContextWindowProjection(snap['contextWindow'] ?? snap['contextState'] ?? null);
    return {
        agent,
        requestedRuntimeId: selection.requestedRuntimeId,
        runtimeId: selection.runtimeId,
        runtimeFound: selection.runtimeFound,
        usedDefaultRuntimeFallback: selection.usedDefaultRuntimeFallback,
        agentRuntimes,
        snap,
        health,
        runtimeSessionId,
        contextWindow,
    };
}

/**
 * Lê a projection compartilhada do runtime default do agent.
 *
 * @returns {ReturnType<typeof readAgentRuntimeOverview>}
 */
export function readDefaultAgentRuntimeOverview() {
    return readAgentRuntimeOverview();
}
