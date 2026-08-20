// @ts-check
/**
 * Helpers compartilhados das projection families do terminal frontend.
 */

import { isAutoModelSelector, resolveModelSelectionMismatch } from '#copilot/core';
import { buildRuntimeFallbackWarning } from '../../../presentation/routing/index.js';
import {
    normalizeAgentContextWindowProjection,
    readAgentRuntimeOverviewProjection,
} from '../../../presentation/runtime/index.js';
import { readTerminalSessionBinding } from '../gateways/index.js';

/**
 * @typedef {{ tokens: number; tokenLimit: number; utilization: number }} ContextWindowProjection
 *
 * @typedef {{
 *     billedModel: string | null;
 *     configuredModel: string | null;
 *     effectiveModel: string | null;
 *     observedModel: string | null;
 *     mismatch: boolean;
 *     cost: number | null;
 *     at: string | null;
 *     displayModel: string;
 * }} TerminalModelBillingProjection
 *
 *
 * @typedef {{
 *     agentProfileId: string | null;
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeFallbackWarning: string | null;
 *     agentRuntimes: {
 *         runtimeId: string;
 *         status: string;
 *         model: string;
 *         sessionId: string | null;
 *         isDefault: boolean;
 *         agentProfileId: string | null;
 *     }[];
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 *     runtimeSessionId: string | null;
 *     contextWindow: ContextWindowProjection | null;
 *     model: string;
 *     reasoningEffort: string;
 *     status: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 *     pendingQuestion: import('../../../presentation/contracts/index.js').RuntimePendingQuestion | null;
 *     pendingQuestionKind: import('../../../presentation/contracts/index.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadow: import('../../../presentation/contracts/index.js').RuntimePendingQuestionShadow | null;
 *     pendingQuestionShadowKind: import('../../../presentation/contracts/index.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadowState:
 *         import('../../../presentation/contracts/index.js').RuntimePendingQuestionShadowState | null;
 *     pendingQuestionShadowExpired: boolean;
 *     pendingQuestionShadowAgeMs: number | null;
 *     pendingQuestionShadowExpiresAt: number | null;
 *     pendingQuestionShadowRemainingMs: number | null;
 *     systemPromptBinding: Record<string, unknown> | null;
 *     systemPromptFreshness: Record<string, unknown> | null;
 *     lastPrInfo: Record<string, any> | null;
 *     lastLlmUsage: Record<string, any> | null;
 *     dialogPrMetrics: Record<string, any> | null;
 * }} TerminalRuntimeBase
 */

/**
 * @param {unknown} raw
 * @returns {ContextWindowProjection | null}
 */
export function normalizeContextWindowProjection(raw) {
    return normalizeAgentContextWindowProjection(raw);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {TerminalRuntimeBase}
 */
export function readTerminalRuntimeBase(runtimeId) {
    const runtime = readAgentRuntimeOverviewProjection(runtimeId);
    const binding = readTerminalSessionBinding();
    const runtimeFallbackWarning = buildRuntimeFallbackWarning(runtime);
    return {
        ...runtime,
        runtimeFallbackWarning,
        binding,
        runtimeSessionId: runtime.runtimeSessionId ?? binding.sdkSessionId ?? null,
    };
}

/**
 * @param {Record<string, any> | null | undefined} lastPrInfo
 * @param {string | null | undefined} fallbackModel
 * @returns {TerminalModelBillingProjection}
 */
export function normalizeTerminalModelBillingProjection(lastPrInfo, fallbackModel) {
    const billedModel = typeof lastPrInfo?.['model'] === 'string' ? lastPrInfo['model'] : null;
    const configuredModel = typeof lastPrInfo?.['configuredModel'] === 'string' ? lastPrInfo['configuredModel'] : null;
    const effectiveModel = typeof lastPrInfo?.['effectiveModel'] === 'string' ? lastPrInfo['effectiveModel'] : null;
    const mismatch = resolveModelSelectionMismatch({
        configuredModel,
        billedModel,
        effectiveModel,
        explicitMismatch: Boolean(lastPrInfo?.['modelMismatch']),
    });
    const displayModel =
        configuredModel && !isAutoModelSelector(configuredModel)
            ? configuredModel
            : (fallbackModel ?? configuredModel ?? effectiveModel ?? billedModel ?? '-');
    return {
        billedModel,
        configuredModel,
        effectiveModel,
        observedModel: effectiveModel ?? billedModel,
        mismatch,
        cost: typeof lastPrInfo?.['cost'] === 'number' ? Number(lastPrInfo['cost']) : null,
        at: typeof lastPrInfo?.['ts'] === 'number' ? new Date(lastPrInfo['ts']).toISOString() : null,
        displayModel,
    };
}

/**
 * @param {TerminalRuntimeBase['agentRuntimes']} runtimes
 * @returns {string}
 */
export function formatTerminalRuntimeTopology(runtimes) {
    return Array.isArray(runtimes) && runtimes.length > 0
        ? runtimes
              .map((runtime) => {
                  const marker = runtime.isDefault ? '*' : '-';
                  return `${marker}${runtime.runtimeId}:${runtime.model}/${runtime.status}`;
              })
              .join('  •  ')
        : '(nenhum runtime registrado)';
}
