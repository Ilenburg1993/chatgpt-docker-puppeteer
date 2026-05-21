// @ts-check
/**
 * Política canônica de recuperação de modelo em erros do SDK.
 *
 * O seletor `auto` é o único fallback permitido para a LLM-B. Quando um modelo explícito falha durante `model_call`,
 * continuar tentando o mesmo alvo tende a prender o terminal em retries silenciosos. Esta política decide quando a
 * porta de hooks deve devolver o controle ao SDK/GitHub Copilot via `auto`.
 *
 * @module copilot/agent/ports/model-error-recovery
 */

import { isAutoModelSelector } from '#copilot/core';

/**
 * @typedef {{
 *     shouldFallback: boolean;
 *     targetModel: string | null;
 *     reason: string;
 * }} ModelCallFallbackDecision
 */

/**
 * @param {{
 *     errorContext: string;
 *     recoverable?: boolean | undefined;
 *     currentModel?: string | null;
 *     fallbackModel?: string | null;
 *     byokEnabled?: boolean | undefined;
 * }} input
 * @returns {ModelCallFallbackDecision}
 */
export function decideModelCallAutoFallback(input) {
    const fallbackModel = typeof input.fallbackModel === 'string' ? input.fallbackModel.trim() : '';
    const currentModel = typeof input.currentModel === 'string' ? input.currentModel.trim() : '';

    if (input.errorContext !== 'model_call') {
        return { shouldFallback: false, targetModel: null, reason: 'context_not_model_call' };
    }
    if (input.recoverable !== true) {
        return { shouldFallback: false, targetModel: null, reason: 'non_recoverable_model_call' };
    }
    if (input.byokEnabled === true) {
        return { shouldFallback: false, targetModel: null, reason: 'byok_provider_error_no_copilot_auto_fallback' };
    }
    if (!fallbackModel || !isAutoModelSelector(fallbackModel)) {
        return { shouldFallback: false, targetModel: null, reason: 'fallback_not_auto' };
    }
    if (currentModel && isAutoModelSelector(currentModel)) {
        return { shouldFallback: false, targetModel: null, reason: 'already_auto' };
    }

    return {
        shouldFallback: true,
        targetModel: fallbackModel,
        reason: 'recoverable_model_call_on_explicit_model',
    };
}
