// @ts-check
/**
 * @module copilot/sdk/errors
 * @file Classificacao pura de erros emitidos pelo GitHub Copilot SDK/CLI.
 *
 *   Este modulo fica na camada SDK porque descreve semantica do SDK, nao uma decisao de UX. O agent usa a classificacao
 *   para decidir reconnect/retry; terminal e server podem usa-la para apresentar mensagens limpas sem conhecer detalhes
 *   internos do agent.
 */

import {
    classifySdkError as classifyCoreSdkError,
    classifySdkRateLimitScope as classifyCoreSdkRateLimitScope,
    getSdkErrorFingerprint as getCoreSdkErrorFingerprint,
    isAutoModelSelector,
} from '#copilot/core';

/** @typedef {'rate_limit' | 'quota_exhausted' | 'account' | 'auth' | 'model_unsupported' | 'network' | 'timeout' | 'unknown'} SdkErrorKind */
/** @typedef {'session' | 'weekly_model' | 'unknown'} SdkRateLimitScope */

/** @typedef {'connection' | 'session'} SdkRecoveryScope */

/**
 * @typedef {import('./types.js').SdkRecoveryPolicy} SdkRecoveryPolicy
 */

/**
 * Extrai campos comuns de Error, SessionError, eventos SDK e objetos plain.
 *
 * @param {unknown} error
 * @returns {{ code: string; errorType: string; message: string; status: number | null }}
 */
export function getSdkErrorFingerprint(error) {
    return getCoreSdkErrorFingerprint(error);
}

/**
 * Refina `rate_limit` sem mudar a categoria operacional principal.
 *
 * @param {unknown} error
 * @returns {SdkRateLimitScope}
 */
export function classifySdkRateLimitScope(error) {
    return classifyCoreSdkRateLimitScope(error);
}

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
 * Decide quando uma falha recuperavel de `model_call` em modelo explicito deve devolver a selecao ao SDK via `auto`.
 *
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
 * Decide a resposta do hook `errorOccurred` depois da politica de fallback de modelo.
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

/**
 * Classifica erros do SDK em categorias operacionais estaveis.
 *
 * @param {unknown} error
 * @returns {SdkErrorKind}
 */
export function classifySdkError(error) {
    return classifyCoreSdkError(error);
}

/**
 * Quota/rate-limit nao e recuperavel por reconnect local: reconnect consome mais requisicoes e piora a UX.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSdkQuotaOrRateLimitError(error) {
    const kind = classifySdkError(error);
    return kind === 'rate_limit' || kind === 'quota_exhausted';
}

/**
 * Deriva uma política operacional estável a partir do `SdkErrorKind`, permitindo decisões consistentes de retry,
 * reconnect e circuit breaker.
 *
 * @param {unknown} error
 * @param {SdkRecoveryScope} [scope='connection'] Default is `'connection'`
 * @returns {SdkRecoveryPolicy}
 */
export function getSdkRecoveryPolicy(error, scope = 'connection') {
    const kind = classifySdkError(error);

    switch (kind) {
        case 'rate_limit':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'rate limit do SDK não deve abrir circuito local nem disparar reconnect automático',
            };
        case 'quota_exhausted':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'quota esgotada exige intervenção externa; reconnect local só piora a UX',
            };
        case 'account':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'estado de conta/cobrança bloqueou o SDK; reconnect local não altera o bloqueio externo',
            };
        case 'auth':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'falha de autenticação não representa indisponibilidade do transporte',
            };
        case 'model_unsupported':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'modelo ou capacidade não suportada exige troca de modelo, não reconnect do runtime',
            };
        case 'timeout':
            return {
                kind,
                scope,
                retryable: true,
                allowReconnect: true,
                tripCircuit: true,
                resetCircuit: false,
                backoffMs: scope === 'connection' ? 1_500 : 1_000,
                reason: 'timeout é tratado como falha transitória e deve alimentar backoff/circuit breaker',
            };
        case 'network':
            return {
                kind,
                scope,
                retryable: true,
                allowReconnect: true,
                tripCircuit: true,
                resetCircuit: false,
                backoffMs: scope === 'connection' ? 1_000 : 750,
                reason: 'falha de rede é transitória e deve contribuir para abrir o circuito',
            };
        case 'unknown':
        default:
            return {
                kind,
                scope,
                retryable: scope === 'connection',
                allowReconnect: scope === 'connection',
                tripCircuit: scope === 'connection',
                resetCircuit: false,
                backoffMs: scope === 'connection' ? 750 : 0,
                reason:
                    scope === 'connection'
                        ? 'falha desconhecida de conexão é tratada conservadoramente como transitória'
                        : 'falha desconhecida fora da conexão não recebe reconnect automático por padrão',
            };
    }
}

/**
 * Normaliza qualquer falha do SDK para `SdkOperationError` preservando a causa original.
 *
 * @param {string} operation
 * @param {unknown} error
 * @returns {SdkOperationError}
 */
export function toSdkOperationError(operation, error) {
    if (error instanceof SdkOperationError) {
        return error;
    }
    return new SdkOperationError(operation, classifySdkError(error), error);
}

// ─── SdkOperationError ───────────────────────────────────────────────────────

/**
 * Erro estruturado lançado por wrappers SDK quando uma operação falha. Inclui a operação, o kind classificado e a causa
 * original para rastreabilidade completa.
 *
 * @example
 *     throw new SdkOperationError('model.switchTo', classifySdkError(err), err);
 */
export class SdkOperationError extends Error {
    /**
     * @param {string} operation - Nome canônico da operação (ex: `'model.switchTo'`)
     * @param {SdkErrorKind} kind - Kind classificado via `classifySdkError`
     * @param {unknown} [cause] - Erro original do SDK
     */
    constructor(operation, kind, cause) {
        const causeMsg = cause instanceof Error ? cause.message : String(cause ?? '');
        super(`[sdk/${operation}] falhou (${kind}): ${causeMsg}`);
        this.name = 'SdkOperationError';
        /** @type {string} */
        this.operation = operation;
        /** @type {SdkErrorKind} */
        this.kind = kind;
        /** @type {unknown} */
        this.cause = cause;
    }
}
