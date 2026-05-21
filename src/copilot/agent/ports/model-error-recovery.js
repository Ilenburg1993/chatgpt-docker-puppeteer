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
 *
 * @typedef {{
 *     errorHandling: 'retry' | 'abort';
 *     reason: string;
 * }} ModelCallErrorHandlingDecision
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

/**
 * Decide a resposta do hook `errorOccurred` depois da política de fallback. Para Copilot SDK governado pelo próprio
 * GitHub, um erro recuperável ainda pode ser roteado/repetido pelo SDK. Para BYOK, não existe fallback seguro para
 * Copilot auto: repetir o mesmo provider costuma prender o terminal em minutos de silêncio. A ação canônica é abortar
 * rápido e devolver a decisão ao operador via `/byok model` ou `/byok use`.
 *
 * @param {{
 *     errorContext: string;
 *     recoverable?: boolean | undefined;
 *     byokEnabled?: boolean | undefined;
 *     modelRecoveryApplied?: boolean | undefined;
 * }} input
 * @returns {ModelCallErrorHandlingDecision}
 */
export function decideModelCallErrorHandling(input) {
    if (input.modelRecoveryApplied === true) {
        return { errorHandling: 'abort', reason: 'fallback_applied_requires_abort' };
    }
    if (input.errorContext === 'model_call' && input.byokEnabled === true) {
        return { errorHandling: 'abort', reason: 'byok_provider_error_no_retry_without_operator_choice' };
    }
    if (input.recoverable === true) {
        return { errorHandling: 'retry', reason: 'sdk_recoverable_error' };
    }
    return { errorHandling: 'abort', reason: 'non_recoverable_error' };
}
