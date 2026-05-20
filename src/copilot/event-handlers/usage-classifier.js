// @ts-check
/**
 * Classificação semântica de `assistant.usage`.
 *
 * O SDK emite `assistant.usage` para telemetria de chamada LLM (tokens, custo, modelo e quota). Isso não equivale,
 * por si só, a Premium Request consumido: continuações internas de `ask_user`, tool calls e sampling também podem
 * produzir usage. Este módulo mantém essa distinção explícita para impedir que a UX confunda "uso de LLM" com
 * "novo PR".
 *
 * @module copilot/event-handlers/usage-classifier
 */

import { resolveModelSelectionMismatch } from '#copilot/core';

export const LLM_USAGE_CLASSIFICATIONS = Object.freeze({
    PREMIUM_REQUEST: 'premium_request',
    ASK_USER_CONTINUATION: 'ask_user_continuation',
    TOOL_ORIGINATED: 'tool_originated',
    NON_USER_INITIATED: 'non_user_initiated',
    UNATTRIBUTED: 'unattributed_llm_usage',
});

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asString(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | undefined}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : undefined;
}

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @returns {{
 *     configuredModel?: string;
 *     effectiveModel?: string;
 *     sessionId: string | null;
 * }}
 */
export function readUsageSessionProjection(session) {
    const sessionRecord = /**
     * @type {{
     *     model?: unknown;
     *     config?: { model?: unknown };
     *     sessionId?: unknown;
     *     __copilotConfiguredModel?: unknown;
     *     __copilotEffectiveModel?: unknown;
     * }}
     */ (session);
    const configuredModel =
        asString(sessionRecord.model) ??
        asString(sessionRecord.config?.model) ??
        asString(sessionRecord.__copilotConfiguredModel);
    const effectiveModel = asString(sessionRecord.__copilotEffectiveModel);
    return {
        ...(configuredModel ? { configuredModel } : {}),
        ...(effectiveModel ? { effectiveModel } : {}),
        sessionId: asString(sessionRecord.sessionId) ?? null,
    };
}

/**
 * @param {unknown} evt
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @returns {Record<string, unknown>}
 */
export function normalizeAssistantUsageEvent(evt, session) {
    const data = asRecord(/** @type {{ data?: unknown } | null | undefined} */ (evt)?.data) ?? {};
    const sessionProjection = readUsageSessionProjection(session);
    const billedModel = asString(data['model']);
    const rawEffectiveModel = sessionProjection.effectiveModel ?? billedModel;
    const effectiveModel = rawEffectiveModel === 'auto' && billedModel ? billedModel : rawEffectiveModel;
    const configuredModel = sessionProjection.configuredModel;
    const modelMismatch = resolveModelSelectionMismatch({
        configuredModel,
        billedModel,
        effectiveModel,
    });

    return {
        ts: Date.now(),
        sessionId: sessionProjection.sessionId,
        ...(billedModel ? { model: billedModel } : {}),
        ...(configuredModel ? { configuredModel } : {}),
        ...(effectiveModel ? { effectiveModel } : {}),
        ...(modelMismatch ? { modelMismatch } : {}),
        ...(asNumber(data['cost']) !== undefined ? { cost: asNumber(data['cost']) } : {}),
        ...(asRecord(data['quotaSnapshots']) ? { quotaSnapshots: asRecord(data['quotaSnapshots']) } : {}),
        ...(asNumber(data['inputTokens']) !== undefined ? { inputTokens: asNumber(data['inputTokens']) } : {}),
        ...(asNumber(data['outputTokens']) !== undefined ? { outputTokens: asNumber(data['outputTokens']) } : {}),
        ...(asNumber(data['cacheReadTokens']) !== undefined ? { cacheReadTokens: asNumber(data['cacheReadTokens']) } : {}),
        ...(asNumber(data['cacheWriteTokens']) !== undefined
            ? { cacheWriteTokens: asNumber(data['cacheWriteTokens']) }
            : {}),
        ...(asNumber(data['duration']) !== undefined ? { duration: asNumber(data['duration']) } : {}),
        ...(asString(data['reasoningEffort']) ? { reasoningEffort: asString(data['reasoningEffort']) } : {}),
        ...(asString(data['initiator']) ? { initiator: asString(data['initiator']) } : {}),
        ...(asString(data['apiCallId']) ? { apiCallId: asString(data['apiCallId']) } : {}),
        ...(asString(data['providerCallId']) ? { providerCallId: asString(data['providerCallId']) } : {}),
        ...(asString(data['parentToolCallId']) ? { parentToolCallId: asString(data['parentToolCallId']) } : {}),
        ...(asRecord(data['copilotUsage']) ? { copilotUsage: asRecord(data['copilotUsage']) } : {}),
    };
}

/**
 * @returns {{
 *     recordUserMessage: (evt?: unknown) => void;
 *     recordUserInputRequested: (evt?: unknown) => void;
 *     recordUserInputCompleted: (evt?: unknown) => void;
 *     classify: (usage: Record<string, unknown>) => {
 *         classification: string;
 *         premiumRequest: boolean;
 *         premiumRequestReason: string;
 *         pendingUserMessages: number;
 *         pendingAskUserContinuations: number;
 *     };
 * }}
 */
export function createAssistantUsageClassifier() {
    let pendingUserMessages = 0;
    let pendingAskUserContinuations = 0;
    /** @type {Set<string>} */
    const pendingUserInputRequests = new Set();

    return {
        recordUserMessage() {
            pendingUserMessages += 1;
        },
        recordUserInputRequested(evt) {
            const data = asRecord(/** @type {{ data?: unknown } | null | undefined} */ (evt)?.data) ?? {};
            const requestId = asString(data['requestId']) ?? asString(data['id']);
            if (requestId) pendingUserInputRequests.add(requestId);
        },
        recordUserInputCompleted(evt) {
            const data = asRecord(/** @type {{ data?: unknown } | null | undefined} */ (evt)?.data) ?? {};
            const requestId = asString(data['requestId']) ?? asString(data['id']);
            if (requestId) pendingUserInputRequests.delete(requestId);
            pendingAskUserContinuations += 1;
        },
        classify(usage) {
            const initiator = asString(usage['initiator']);
            const parentToolCallId = asString(usage['parentToolCallId']);
            if (pendingAskUserContinuations > 0) {
                pendingAskUserContinuations -= 1;
                return {
                    classification: LLM_USAGE_CLASSIFICATIONS.ASK_USER_CONTINUATION,
                    premiumRequest: false,
                    premiumRequestReason: 'user_input_completed_continuation',
                    pendingUserMessages,
                    pendingAskUserContinuations,
                };
            }
            if (pendingUserMessages > 0 && (!initiator || initiator === 'user')) {
                pendingUserMessages -= 1;
                return {
                    classification: LLM_USAGE_CLASSIFICATIONS.PREMIUM_REQUEST,
                    premiumRequest: true,
                    premiumRequestReason: initiator === 'user' ? 'user_message:initiator:user' : 'user_message',
                    pendingUserMessages,
                    pendingAskUserContinuations,
                };
            }
            if (parentToolCallId) {
                return {
                    classification: LLM_USAGE_CLASSIFICATIONS.TOOL_ORIGINATED,
                    premiumRequest: false,
                    premiumRequestReason: 'parent_tool_call',
                    pendingUserMessages,
                    pendingAskUserContinuations,
                };
            }
            if (initiator) {
                return {
                    classification: LLM_USAGE_CLASSIFICATIONS.NON_USER_INITIATED,
                    premiumRequest: false,
                    premiumRequestReason: `initiator:${initiator}`,
                    pendingUserMessages,
                    pendingAskUserContinuations,
                };
            }
            return {
                classification: LLM_USAGE_CLASSIFICATIONS.UNATTRIBUTED,
                premiumRequest: false,
                premiumRequestReason: pendingUserInputRequests.size > 0 ? 'pending_user_input_request' : 'no_user_message',
                pendingUserMessages,
                pendingAskUserContinuations,
            };
        },
    };
}
