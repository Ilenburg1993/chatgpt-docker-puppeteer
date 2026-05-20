// @ts-check
/**
 * @module copilot/presentation/runtime-overview
 * @file Projection compartilhada do runtime default do agent para bordas e frontends.
 *
 *   Esta camada concentra leituras repetidas de status/health/runtimeId via façades canônicas do agent para reduzir
 *   duplicação entre `presentation/system-*`, `terminal/frontend/*` e futuras bordas multi-agent.
 */

import {
    readAgentRuntimeHealthSnapshot,
    readAgentRuntimeStatusSnapshot,
    readRuntimeControlState,
    readRuntimeInteractionState,
    readRuntimePrBudgetSnapshot,
} from '#copilot/agent/facades';
import { listKnownAgentRuntimes, resolveAgentRuntimeSelection } from '#copilot/presentation/agent/runtime';
import { recordRuntimeFallback } from './fallback-telemetry.js';

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
 *     agent: import('#copilot/agent/always-alive').AlwaysAliveAgent;
 *     agentProfileId: string | null;
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
    const agentProfileId =
        agentRuntimes.find((runtime) => runtime.runtimeId === selection.runtimeId)?.agentProfileId ?? null;
    const snap = readAgentRuntimeStatusSnapshot(agent);
    const health = readAgentRuntimeHealthSnapshot(agent);
    const runtimeSessionId = readRuntimeControlState(agent).sessionId;
    const contextWindow = normalizeAgentContextWindowProjection(snap['contextWindow'] ?? snap['contextState'] ?? null);

    // Onda E2: registra telemetria de fallback de runtime
    recordRuntimeFallback(
        selection.runtimeId,
        selection.requestedRuntimeId,
        'runtime-overview.readAgentRuntimeOverview',
        selection.usedDefaultRuntimeFallback,
    );

    return {
        agent,
        agentProfileId,
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
 * Lê uma projection sem expor a instância viva do agent para bordas.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     agentProfileId: string | null;
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     agentRuntimes: ReturnType<typeof listKnownAgentRuntimes>;
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     runtimeSessionId: string | null;
 *     contextWindow: ContextWindowProjection | null;
 *     model: string;
 *     reasoningEffort: string;
 *     status: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 *     pendingQuestion: import('#copilot/agent/types').PendingQuestion | null;
 *     pendingQuestionKind: import('#copilot/agent/types').PendingQuestionKind | null;
 *     pendingQuestionShadow: import('#copilot/agent/types').PendingQuestionShadow | null;
 *     pendingQuestionShadowKind: import('#copilot/agent/types').PendingQuestionKind | null;
 *     pendingQuestionShadowState: import('#copilot/agent/types').PendingQuestionShadowState | null;
 *     pendingQuestionShadowExpired: boolean;
 *     pendingQuestionShadowAgeMs: number | null;
 *     pendingQuestionShadowExpiresAt: number | null;
 *     pendingQuestionShadowRemainingMs: number | null;
 *     systemPromptBinding: Record<string, unknown> | null;
 *     systemPromptFreshness: Record<string, unknown> | null;
 *     lastPrInfo: Record<string, any> | null;
 *     lastLlmUsage: Record<string, any> | null;
 *     dialogPrMetrics: Record<string, any> | null;
 * }}
 */
export function readAgentRuntimeOverviewProjection(runtimeId) {
    const base = readAgentRuntimeOverview(runtimeId);
    const controlState = readRuntimeControlState(base.agent);
    const interactionState = readRuntimeInteractionState(base.agent);
    const prBudget = readRuntimePrBudgetSnapshot(base.agent);
    const systemPromptBinding =
        base.snap['systemPromptBinding'] && typeof base.snap['systemPromptBinding'] === 'object'
            ? /** @type {Record<string, unknown>} */ (base.snap['systemPromptBinding'])
            : null;
    const systemPromptFreshness =
        base.snap['systemPromptFreshness'] && typeof base.snap['systemPromptFreshness'] === 'object'
            ? /** @type {Record<string, unknown>} */ (base.snap['systemPromptFreshness'])
            : null;

    return {
        agentProfileId: base.agentProfileId,
        requestedRuntimeId: base.requestedRuntimeId,
        runtimeId: base.runtimeId,
        runtimeFound: base.runtimeFound,
        usedDefaultRuntimeFallback: base.usedDefaultRuntimeFallback,
        agentRuntimes: base.agentRuntimes,
        snap: base.snap,
        health: base.health,
        runtimeSessionId: base.runtimeSessionId,
        contextWindow: base.contextWindow,
        model: controlState.model,
        reasoningEffort: controlState.reasoningEffort,
        status: controlState.status,
        sessionId: controlState.sessionId,
        dialogLoopActive: controlState.dialogLoopActive,
        dialogPaused: controlState.dialogPaused,
        queueSize: controlState.queueSize,
        pendingQuestion: interactionState.pendingQuestion,
        pendingQuestionKind: interactionState.pendingQuestionKind,
        pendingQuestionShadow: interactionState.pendingQuestionShadow,
        pendingQuestionShadowKind: interactionState.pendingQuestionShadowKind,
        pendingQuestionShadowState: interactionState.pendingQuestionShadowState,
        pendingQuestionShadowExpired: interactionState.pendingQuestionShadowExpired,
        pendingQuestionShadowAgeMs: interactionState.pendingQuestionShadowAgeMs,
        pendingQuestionShadowExpiresAt: interactionState.pendingQuestionShadowExpiresAt,
        pendingQuestionShadowRemainingMs: interactionState.pendingQuestionShadowRemainingMs,
        systemPromptBinding,
        systemPromptFreshness,
        lastPrInfo: /** @type {Record<string, any> | null} */ (prBudget.lastPrInfo),
        lastLlmUsage: /** @type {Record<string, any> | null} */ (prBudget.lastLlmUsage),
        dialogPrMetrics: /** @type {Record<string, any> | null} */ (prBudget.prMetrics),
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
