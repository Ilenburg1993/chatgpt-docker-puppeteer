// @ts-check
/**
 * src/copilot/hooks/prompt-transformer.js
 *
 * Handlers para o hook `onUserPromptSubmitted` do SDK.
 *
 * Este era o Gap 1 do roadmap: a implementação anterior apenas logava, mas não utilizava a capacidade de retornar `{
 * modifiedPrompt }` para transformar o prompt.
 *
 * Este módulo expõe fábricas que efetivamente modificam o prompt via `modifiedPrompt`.
 *
 * @module copilot/hooks/prompt-transformer
 * @see EventBus
 * @see module:copilot/hooks/types
 */

import { log } from './logger.js';

/**
 * @typedef {import('./types.js').UserPromptSubmittedHookInput} UserPromptSubmittedHookInput
 *
 * @typedef {import('./types.js').UserPromptSubmittedHookOutput} UserPromptSubmittedHookOutput
 *
 * @typedef {import('./types.js').UserPromptSubmittedHandler} UserPromptSubmittedHandler
 *
 * @typedef {import('./types.js').InvocationContext} InvocationContext
 */

/**
 * @typedef {object} PromptTransformerOptions
 * @property {((p: string) => string | null | undefined) | null} [transformFn] Função síncrona de transformação. Se
 *   retornar null/undefined, o prompt não é modificado.
 * @property {boolean} [logOriginal] Se true, loga o prompt original antes da transformação. Default: false.
 * @property {boolean} [logTransformed] Se true, loga o prompt pós-transformação. Default: false.
 * @property {RegExp | null} [sensitivePattern] Pattern para redactar dados sensíveis do prompt (e.g., tokens, senhas).
 *   Default: null.
 * @property {string} [sensitiveReplacement] Texto usado ao redactar. Default: '[REDACTED]'.
 */

/**
 * Cria um hook `onUserPromptSubmitted` com suporte completo a transformação de prompt.
 *
 * Features:
 *
 * - Transformação arbitrária via `transformFn`
 * - Redação de dados sensíveis via `sensitivePattern`
 * - Logging configurável do original e do transformado
 *
 * @example
 *     // Adiciona prefixo de contexto a todos os prompts:
 *     const hook = createPromptTransformer({
 *         transformFn: (p) => `[context: production] ${p}`,
 *     });
 *
 * @param {PromptTransformerOptions} [opts]
 * @returns {UserPromptSubmittedHandler}
 */
export function createPromptTransformer(opts = {}) {
    const {
        transformFn = null,
        logOriginal = false,
        logTransformed = false,
        sensitivePattern = null,
        sensitiveReplacement = '[REDACTED]',
    } = opts;

    /**
     * @param {UserPromptSubmittedHookInput} input
     * @returns {Promise<UserPromptSubmittedHookOutput>}
     */
    return async function onUserPromptSubmitted(input) {
        let prompt = input.prompt;

        if (logOriginal) {
            log(
                'DEBUG',
                `[hooks/prompt-transformer] prompt original (${prompt.length} chars): ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`,
            );
        }

        // Redação de dados sensíveis (Gap 1 - extensão de segurança)
        if (sensitivePattern) {
            prompt = prompt.replace(sensitivePattern, sensitiveReplacement);
        }

        // Transformação customizada
        if (transformFn) {
            const transformed = transformFn(prompt);
            if (transformed != null && transformed !== prompt) {
                prompt = transformed;
            }
        }

        if (logTransformed && prompt !== input.prompt) {
            log(
                'DEBUG',
                `[hooks/prompt-transformer] prompt transformado: ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`,
            );
        }

        // Retorna modifiedPrompt somente se houve mudança real
        if (prompt !== input.prompt) {
            return { modifiedPrompt: prompt };
        }
        return {};
    };
}

/**
 * Hook de logging simples para `onUserPromptSubmitted`. Não modifica o prompt — apenas registra atividade.
 *
 * @returns {UserPromptSubmittedHandler}
 */
export function createLoggingPromptHook() {
    return async function onUserPromptSubmitted(input) {
        log('DEBUG', `[hooks/prompt-transformer] prompt recebido (${input.prompt.length} chars)`);
        return {};
    };
}

/**
 * Hook que redige tokens/senhas antes que o prompt seja processado. Padrões cobertos: Bearer tokens, API keys
 * prefixadas, senhas inline simples, JWT (3-part base64url), AWS keys e tokens GitHub.
 *
 * @returns {UserPromptSubmittedHandler}
 */
export function createSensitiveDataRedactor() {
    // SEC-PT-001: adicionados padrões JWT, AWS Access/Secret keys e tokens GitHub (ghp_/ghs_/gho_/github_pat_)
    const SENSITIVE_PATTERN =
        /Bearer\s+\S+|(?:api[-_]key|token|password|secret)\s*[:=]\s*\S+|eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|(?:AKIA|ASIA|ABIA)[0-9A-Z]{16}|(?:aws_secret_access_key\s*=\s*)\S+|gh[psotr]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{82}/gi;
    return createPromptTransformer({
        sensitivePattern: SENSITIVE_PATTERN,
        sensitiveReplacement: '[REDACTED]',
    });
}

/** @security FIX HOOKS-004: limit prefix/suffix to prevent prompt injection. */
const MAX_INJECT_LEN = 2000;

/**
 * Hook que envolve o prompt com contexto de sistema adicional como prefixo ou sufixo. UPG-PT-001: retorna identidade
 * early se prefix e suffix forem ambos vazios.
 *
 * @param {{ prefix?: string; suffix?: string }} opts
 * @returns {UserPromptSubmittedHandler}
 * @security FIX HOOKS-004: prefix e suffix são truncados a MAX_INJECT_LEN (2000 chars) para prevenir prompt injection.
 */
export function createContextInjector(opts) {
    const { prefix = '', suffix = '' } = opts;
    const safePrefix = prefix.slice(0, MAX_INJECT_LEN);
    const safeSuffix = suffix.slice(0, MAX_INJECT_LEN);
    if (!safePrefix && !safeSuffix) {
        return createPromptTransformer({ transformFn: (p) => p });
    }
    return createPromptTransformer({
        transformFn: (p) => `${safePrefix}${safePrefix ? '\n' : ''}${p}${safeSuffix ? '\n' : ''}${safeSuffix}`,
    });
}
