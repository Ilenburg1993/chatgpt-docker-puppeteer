// @ts-check
/**
 * Classificação semântica de `assistant.usage`.
 *
 * O SDK emite `assistant.usage` para telemetria de chamada LLM (tokens, custo, modelo, quota e `copilotUsage`). No
 * billing usage-based atual, a classificação local descreve **origem/attribution** do uso — não tenta inferir Premium
 * Requests. Campos request-based eventualmente recebidos do runtime ficam restritos à compatibilidade legacy.
 *
 * @module copilot/event-handlers/usage-classifier
 */

import { resolveModelSelectionMismatch } from '#copilot/core';

export const LLM_USAGE_CLASSIFICATIONS = Object.freeze({
    USER_TURN: 'user_turn',
    BYOK_USER_TURN: 'byok_user_turn',
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
 *     byokProvider?: boolean;
 *     byokProfile?: string;
 *     byokPreset?: string;
 *     byokProviderType?: string;
 *     sessionId: string | null;
 * }}
 */
export function readUsageSessionProjection(session) {
    const sessionRecord =
        /**
         * @type {{
         *     model?: unknown;
         *     config?: { model?: unknown };
         *     sessionId?: unknown;
         *     __copilotConfiguredModel?: unknown;
         *     __copilotEffectiveModel?: unknown;
         *     __copilotByokEnabled?: unknown;
         *     __copilotByokProfile?: unknown;
         *     __copilotByokPreset?: unknown;
         *     __copilotByokProviderType?: unknown;
         *     __copilotByokProvider?: unknown;
         * }}
         */ (session);
    const configuredModel =
        asString(sessionRecord.model) ??
        asString(sessionRecord.config?.model) ??
        asString(sessionRecord.__copilotConfiguredModel);
    const effectiveModel = asString(sessionRecord.__copilotEffectiveModel);
    const configRecord = asRecord(sessionRecord.config);
    const byokProvider = Boolean(
        sessionRecord.__copilotByokEnabled === true ||
        asRecord(sessionRecord.__copilotByokProvider) ||
        asRecord(configRecord?.['provider']),
    );
    const byokProfile = asString(sessionRecord.__copilotByokProfile);
    const byokPreset = asString(sessionRecord.__copilotByokPreset);
    const byokProviderType = asString(sessionRecord.__copilotByokProviderType);
    return {
        ...(configuredModel ? { configuredModel } : {}),
        ...(effectiveModel ? { effectiveModel } : {}),
        ...(byokProvider ? { byokProvider } : {}),
        ...(byokProfile ? { byokProfile } : {}),
        ...(byokPreset ? { byokPreset } : {}),
        ...(byokProviderType ? { byokProviderType } : {}),
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
        modelMismatch,
        ...(asNumber(data['cost']) !== undefined ? { cost: asNumber(data['cost']) } : {}),
        ...(asRecord(data['quotaSnapshots']) ? { quotaSnapshots: asRecord(data['quotaSnapshots']) } : {}),
        ...(asNumber(data['inputTokens']) !== undefined ? { inputTokens: asNumber(data['inputTokens']) } : {}),
        ...(asNumber(data['outputTokens']) !== undefined ? { outputTokens: asNumber(data['outputTokens']) } : {}),
        ...(asNumber(data['reasoningTokens']) !== undefined
            ? { reasoningTokens: asNumber(data['reasoningTokens']) }
            : {}),
        ...(asNumber(data['cacheReadTokens']) !== undefined
            ? { cacheReadTokens: asNumber(data['cacheReadTokens']) }
            : {}),
        ...(asNumber(data['cacheWriteTokens']) !== undefined
            ? { cacheWriteTokens: asNumber(data['cacheWriteTokens']) }
            : {}),
        ...(asNumber(data['duration']) !== undefined ? { duration: asNumber(data['duration']) } : {}),
        ...(asString(data['reasoningEffort']) ? { reasoningEffort: asString(data['reasoningEffort']) } : {}),
        ...(asString(data['initiator']) ? { initiator: asString(data['initiator']) } : {}),
        ...(asString(data['apiCallId']) ? { apiCallId: asString(data['apiCallId']) } : {}),
        ...(asString(data['serviceRequestId']) ? { serviceRequestId: asString(data['serviceRequestId']) } : {}),
        ...(asString(data['providerCallId']) ? { providerCallId: asString(data['providerCallId']) } : {}),
        ...(asString(data['parentToolCallId']) ? { parentToolCallId: asString(data['parentToolCallId']) } : {}),
        ...(asRecord(data['copilotUsage']) ? { copilotUsage: asRecord(data['copilotUsage']) } : {}),
        ...(sessionProjection.byokProvider ? { byokProvider: true } : {}),
        ...(sessionProjection.byokProfile ? { byokProfile: sessionProjection.byokProfile } : {}),
        ...(sessionProjection.byokPreset ? { byokPreset: sessionProjection.byokPreset } : {}),
        ...(sessionProjection.byokProviderType ? { byokProviderType: sessionProjection.byokProviderType } : {}),
    };
}

/**
 * @returns {{
 *     recordUserMessage: (evt?: unknown) => void;
 *     recordUserInputRequested: (evt?: unknown) => void;
 *     recordUserInputCompleted: (evt?: unknown) => void;
 *     classify: (usage: Record<string, unknown>) => {
 *         classification: string;
 *         attributionReason: string;
 *         billingSource: 'github_copilot' | 'byok';
 *         pendingUserMessages: number;
 *         pendingAskUserContinuations: number;
 *         pendingUserInputRequests: number;
 *         askUserRequestId?: string;
 *     };
 * }}
 */
export function createAssistantUsageClassifier() {
    let pendingUserMessages = 0;
    let pendingAskUserContinuations = 0;
    /** @type {Set<string>} */
    const pendingUserInputRequests = new Set();
    /** @type {Set<string>} */
    const userInputRequestsMatchedByUsage = new Set();

    /**
     * @param {string} classification
     * @param {string} attributionReason
     * @param {Record<string, unknown>} usage
     * @param {{ askUserRequestId?: string }} [extra]
     */
    const result = (classification, attributionReason, usage, extra = {}) => ({
        classification,
        attributionReason,
        billingSource: /** @type {'github_copilot' | 'byok'} */ (
            usage['byokProvider'] === true ? 'byok' : 'github_copilot'
        ),
        pendingUserMessages,
        pendingAskUserContinuations,
        pendingUserInputRequests: pendingUserInputRequests.size,
        ...extra,
    });

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
            if (requestId && userInputRequestsMatchedByUsage.delete(requestId)) return;
            pendingAskUserContinuations += 1;
        },
        classify(usage) {
            const initiator = asString(usage['initiator']);
            const parentToolCallId = asString(usage['parentToolCallId']);
            if (pendingAskUserContinuations > 0) {
                pendingAskUserContinuations -= 1;
                return result(
                    LLM_USAGE_CLASSIFICATIONS.ASK_USER_CONTINUATION,
                    'user_input_completed_continuation',
                    usage,
                );
            }
            if (pendingUserMessages > 0 && (!initiator || initiator === 'user')) {
                pendingUserMessages -= 1;
                if (usage['byokProvider'] === true) {
                    return result(
                        LLM_USAGE_CLASSIFICATIONS.BYOK_USER_TURN,
                        initiator === 'user' ? 'byok_user_turn:initiator:user' : 'byok_user_turn',
                        usage,
                    );
                }
                return result(
                    LLM_USAGE_CLASSIFICATIONS.USER_TURN,
                    initiator === 'user' ? 'user_turn:initiator:user' : 'user_turn',
                    usage,
                );
            }
            if (pendingUserInputRequests.size > 0) {
                const requestId = pendingUserInputRequests.values().next().value;
                if (!requestId) {
                    return result(
                        LLM_USAGE_CLASSIFICATIONS.UNATTRIBUTED,
                        'pending_user_input_request_without_id',
                        usage,
                    );
                }
                pendingUserInputRequests.delete(requestId);
                userInputRequestsMatchedByUsage.add(requestId);
                return result(
                    LLM_USAGE_CLASSIFICATIONS.ASK_USER_CONTINUATION,
                    'pending_user_input_request_continuation',
                    usage,
                    { askUserRequestId: requestId },
                );
            }
            if (parentToolCallId) {
                return result(LLM_USAGE_CLASSIFICATIONS.TOOL_ORIGINATED, 'parent_tool_call', usage);
            }
            if (initiator) {
                return result(LLM_USAGE_CLASSIFICATIONS.NON_USER_INITIATED, `initiator:${initiator}`, usage);
            }
            return result(LLM_USAGE_CLASSIFICATIONS.UNATTRIBUTED, 'no_user_message', usage);
        },
    };
}
