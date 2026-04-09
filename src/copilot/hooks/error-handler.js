// @ts-check
/**
 * src/copilot/hooks/error-handler.js
 *
 * Estratégias configuráveis para `onErrorOccurred` — o hook de recuperação de erros do SDK.
 *
 * Inclui:
 *
 * - `createErrorHandler`: estratégia fixa ou contextual por tipo de erro
 * - `createCircuitBreakerHandler`: padrão circuit-breaker para evitar retry infinito
 * - `createContextualErrorHandler`: mapa de contexto → estratégia
 *
 * @module copilot/hooks/error-handler
 */

import { log } from '#copilot/observability/logger';

/**
 * @typedef {import('./types.js').ErrorOccurredHookInput} ErrorOccurredHookInput
 *
 * @typedef {import('./types.js').ErrorOccurredHookOutput} ErrorOccurredHookOutput
 *
 * @typedef {import('./types.js').InvocationContext} InvocationContext
 */

/**
 * @typedef {'retry' | 'skip' | 'abort'} ErrorStrategy
 */

/**
 * @typedef {object} ErrorHandlerOpts
 * @property {ErrorStrategy | ((ctx: ErrorOccurredHookInput) => ErrorStrategy)} [strategy] - Estratégia fixa ou function
 *   de decisão. Padrão: 'abort' para irrecuperável, 'retry' para recuperável
 * @property {number} [maxRetries] - Máximo de tentativas de retry antes de abortar. Padrão: 3
 * @property {string[]} [recoverableContexts] - Contextos de erro que devem ser tratados como recuperáveis
 * @property {string[]} [abortContexts] - Contextos de erro que devem abortar imediatamente
 * @property {(input: ErrorOccurredHookInput) => void} [onError] - Callback chamado para cada erro
 */

/**
 * @typedef {object} CircuitBreakerOpts
 * @property {number} [maxRetries] - Falhas antes de abrir o circuito. Padrão: 3
 * @property {number} [resetAfterMs] - Milissegundos antes de fechar o circuito novamente. Padrão: 30000
 * @property {(context: string) => void} [onTrip] - Callback quando o circuito é aberto
 * @property {(context: string) => void} [onReset] - Callback quando o circuito é fechado
 * @property {(input: ErrorOccurredHookInput) => void} [onError] - Callback chamado para cada erro (ex: tracking)
 * @property {string[]} [fatalPatterns] - Substrings no campo `error` que forçam abort imediato
 * @property {string[]} [transientPatterns] - Substrings no campo `error` que tratam como recuperável mesmo quando
 *   `recoverable=false`
 */

/**
 * @typedef {object} CircuitBreakerState
 * @property {number} failures - Número de falhas consecutivas
 * @property {number | null} openedAt - Timestamp de quando o circuito foi aberto, ou null se fechado
 */

/**
 * Cria um handler `onErrorOccurred` com estratégia configurável.
 *
 * @example
 *     const handler = createErrorHandler({ strategy: 'retry', maxRetries: 5 });
 *
 * @example
 *     const handler = createErrorHandler({
 *         strategy: (ctx) => (ctx.recoverable ? 'retry' : 'abort'),
 *         recoverableContexts: ['rate_limit', 'timeout'],
 *     });
 *
 * @param {ErrorHandlerOpts} [opts]
 * @returns {(
 *     input: ErrorOccurredHookInput,
 *     invocation: InvocationContext,
 * ) => ErrorOccurredHookOutput | Promise<ErrorOccurredHookOutput>}
 */
export function createErrorHandler(opts = {}) {
    const { maxRetries = 3, recoverableContexts = [], abortContexts = [], onError } = opts;
    const strategy = opts.strategy ?? null;

    /** @type {Map<string, number>} */
    const retryCounts = new Map();

    return function onErrorOccurred(input) {
        const { error, errorContext, recoverable } = input;
        const contextKey = errorContext ?? 'unknown';

        if (onError) {
            try {
                onError(input);
            } catch (_) {
                // ignora erros no callback de notificação
            }
        }

        // Verificar se atingiu o limite de retries para este contexto
        const currentRetries = retryCounts.get(contextKey) ?? 0;

        if (strategy !== null) {
            /** @type {ErrorStrategy} */
            let decided;
            if (typeof strategy === 'function') {
                decided = strategy(input);
            } else {
                decided = strategy;
            }

            if (decided === 'retry') {
                if (currentRetries >= maxRetries) {
                    log(
                        'WARN',
                        `[hooks/error-handler] maxRetries(${maxRetries}) atingido para '${contextKey}' — abort`,
                    );
                    retryCounts.delete(contextKey);
                    return { errorHandling: 'abort' };
                }
                retryCounts.set(contextKey, currentRetries + 1);
                log('DEBUG', `[hooks/error-handler] retry ${currentRetries + 1}/${maxRetries} para '${contextKey}'`);
                return { errorHandling: 'retry', retryCount: currentRetries + 1 };
            }

            retryCounts.delete(contextKey);
            log('DEBUG', `[hooks/error-handler] ${decided} para '${contextKey}'`);
            return { errorHandling: decided };
        }

        // Estratégia padrão — contextual por recoverable + listas
        if (abortContexts.includes(contextKey)) {
            log('WARN', `[hooks/error-handler] abort forçado para contexto '${contextKey}': ${error}`);
            return { errorHandling: 'abort' };
        }

        const isRecoverable = recoverable || recoverableContexts.includes(contextKey);
        if (isRecoverable) {
            if (currentRetries >= maxRetries) {
                log('WARN', `[hooks/error-handler] maxRetries(${maxRetries}) atingido para '${contextKey}' — abort`);
                retryCounts.delete(contextKey);
                return { errorHandling: 'abort' };
            }
            retryCounts.set(contextKey, currentRetries + 1);
            log(
                'DEBUG',
                `[hooks/error-handler] recuperável: retry ${currentRetries + 1}/${maxRetries} para '${contextKey}'`,
            );
            return { errorHandling: 'retry', retryCount: currentRetries + 1 };
        }

        log('WARN', `[hooks/error-handler] irrecuperável '${contextKey}': ${error} — abort`);
        return { errorHandling: 'abort' };
    };
}

/**
 * Cria um handler `onErrorOccurred` com padrão circuit-breaker.
 *
 * O circuito começa fechado (normal). Após `maxRetries` falhas consecutivas para o mesmo `errorContext`, abre (trips).
 * Enquanto aberto, retorna 'abort' sem tentar novamente. Após `resetAfterMs` ms, fecha automaticamente e permite uma
 * nova tentativa.
 *
 * @example
 *     const handler = createCircuitBreakerHandler({
 *         maxRetries: 3,
 *         resetAfterMs: 60_000,
 *         onTrip: (ctx) => console.warn(`Circuit aberto para ${ctx}`),
 *     });
 *
 * @param {CircuitBreakerOpts} [opts]
 * @returns {(input: ErrorOccurredHookInput, invocation: InvocationContext) => ErrorOccurredHookOutput}
 */
export function createCircuitBreakerHandler(opts = {}) {
    const {
        maxRetries = 3,
        resetAfterMs = 30_000,
        onTrip,
        onReset,
        onError,
        fatalPatterns = [],
        transientPatterns = [],
    } = opts;

    /** @type {Map<string, CircuitBreakerState>} */
    const circuits = new Map();

    /**
     * @param {string} contextKey
     * @returns {CircuitBreakerState}
     */
    function getState(contextKey) {
        if (!circuits.has(contextKey)) {
            circuits.set(contextKey, { failures: 0, openedAt: null });
        }
        return /** @type {CircuitBreakerState} */ (circuits.get(contextKey));
    }

    /**
     * @param {string} text
     * @param {string[]} patterns
     * @returns {boolean}
     */
    function matchesAny(text, patterns) {
        const lower = text.toLowerCase();
        return patterns.some((p) => lower.includes(p.toLowerCase()));
    }

    return function onErrorOccurred(input) {
        const { error, errorContext, recoverable } = input;
        const contextKey = errorContext ?? 'unknown';
        const state = getState(contextKey);
        const now = Date.now();

        // Notificar callback de tracking (ErrorTracker, etc.)
        if (onError) {
            try {
                onError(input);
            } catch (_) {
                // ignora erros no callback
            }
        }

        // Fatal pattern → abort imediato sem retry
        if (fatalPatterns.length > 0 && matchesAny(error, fatalPatterns)) {
            log('WARN', `[hooks/circuit-breaker] padrão fatal detectado em '${contextKey}': ${error} — abort`);
            return { errorHandling: 'abort' };
        }

        // Circuito aberto?
        if (state.openedAt !== null) {
            const elapsed = now - state.openedAt;
            if (elapsed < resetAfterMs) {
                log(
                    'WARN',
                    `[hooks/circuit-breaker] circuito ABERTO para '${contextKey}' — ${Math.round((resetAfterMs - elapsed) / 1000)}s restantes`,
                );
                return { errorHandling: 'abort' };
            }
            // Reset automático
            log('INFO', `[hooks/circuit-breaker] circuito FECHANDO para '${contextKey}' após reset`);
            state.openedAt = null;
            state.failures = 0;
            if (onReset) {
                try {
                    onReset(contextKey);
                } catch (_) {
                    // ignora
                }
            }
        }

        if (!recoverable) {
            // Transient pattern override: tratar como recuperável mesmo com recoverable=false
            if (transientPatterns.length > 0 && matchesAny(error, transientPatterns)) {
                log(
                    'DEBUG',
                    `[hooks/circuit-breaker] padrão transiente detectado em '${contextKey}' — tratando como recuperável`,
                );
            } else {
                log('WARN', `[hooks/circuit-breaker] irrecuperável '${contextKey}': ${error} — abort`);
                return { errorHandling: 'abort' };
            }
        }

        state.failures++;

        if (state.failures >= maxRetries) {
            state.openedAt = now;
            log('WARN', `[hooks/circuit-breaker] circuito ABRINDO para '${contextKey}' após ${state.failures} falhas`);
            if (onTrip) {
                try {
                    onTrip(contextKey);
                } catch (_) {
                    // ignora
                }
            }
            return { errorHandling: 'abort' };
        }

        log('DEBUG', `[hooks/circuit-breaker] retry ${state.failures}/${maxRetries} para '${contextKey}'`);
        return { errorHandling: 'retry', retryCount: state.failures };
    };
}

/**
 * Cria um handler `onErrorOccurred` com mapa de contexto → estratégia. Útil para codificar políticas diferentes por
 * tipo de erro sem lógica condicional manual.
 *
 * @example
 *     const handler = createContextualErrorHandler({
 *         rate_limit: 'retry',
 *         timeout: 'retry',
 *         permission_denied: 'abort',
 *         network_error: 'skip',
 *     });
 *
 * @param {Record<string, ErrorStrategy>} strategyMap - Mapa de `errorContext` → estratégia
 * @param {ErrorStrategy} [defaultStrategy] - Estratégia padrão para contextos não mapeados. Padrão: 'abort'
 * @returns {(input: ErrorOccurredHookInput, invocation: InvocationContext) => ErrorOccurredHookOutput}
 */
export function createContextualErrorHandler(strategyMap, defaultStrategy = 'abort') {
    return function onErrorOccurred(input) {
        const { error, errorContext, recoverable } = input;
        const contextKey = errorContext ?? 'unknown';
        const strategy = strategyMap[contextKey] ?? (recoverable ? 'retry' : defaultStrategy);

        log('DEBUG', `[hooks/contextual-error] '${contextKey}' → ${strategy}${error ? `: ${error}` : ''}`);

        return { errorHandling: strategy };
    };
}
