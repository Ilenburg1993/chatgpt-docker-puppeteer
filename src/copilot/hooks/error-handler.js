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
 * @see EventBus
 */

import { log } from './logger.js';

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
 * @property {(input: ErrorOccurredHookInput, invocation?: InvocationContext) => void} [onError] - Callback chamado para
 *   cada erro
 * @property {number} [stateTtlMs] - TTL do estado por sessão/contexto. Padrão: 30 minutos
 * @property {number} [maxTrackedContexts] - Máximo de sessões/contextos retidos. Padrão: 1000
 * @property {() => number} [now] - Relógio injetável para testes
 */

/**
 * @typedef {object} CircuitBreakerOpts
 * @property {number} [maxRetries] - Falhas antes de abrir o circuito. Padrão: 3
 * @property {number} [resetAfterMs] - Milissegundos antes de fechar o circuito novamente. Padrão: 30000
 * @property {(context: string) => void} [onTrip] - Callback quando o circuito é aberto
 * @property {(context: string) => void} [onReset] - Callback quando o circuito é fechado
 * @property {(input: ErrorOccurredHookInput, invocation?: InvocationContext) => void} [onError] - Callback chamado para
 *   cada erro (ex: tracking)
 * @property {string[]} [fatalPatterns] - Substrings no campo `error` que forçam abort imediato
 * @property {string[]} [transientPatterns] - Substrings no campo `error` que tratam como recuperável mesmo quando
 *   `recoverable=false`
 * @property {number} [stateTtlMs] - TTL do estado por sessão/contexto. Padrão: 30 minutos
 * @property {number} [maxTrackedContexts] - Máximo de circuitos retidos. Padrão: 1000
 * @property {() => number} [now] - Relógio injetável para testes
 */

/**
 * @typedef {object} CircuitBreakerState
 * @property {number} failures - Número de falhas consecutivas
 * @property {number | null} openedAt - Timestamp de quando o circuito foi aberto, ou null se fechado
 * @property {number} lastTouchedAt - Último acesso para expiração oportunista
 */

/**
 * @typedef {object} RetryState
 * @property {number} count
 * @property {number} lastTouchedAt
 */

const DEFAULT_HOOK_STATE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_TRACKED_CONTEXTS = 1000;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback, max) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

/**
 * Remove estados expirados. Como o mapa é mantido em ordem LRU, a varredura termina no primeiro item ainda válido.
 *
 * @template {{ lastTouchedAt: number }} T
 * @param {Map<string, T>} states
 * @param {number} now
 * @param {number} ttlMs
 */
function pruneExpiredStates(states, now, ttlMs) {
    for (const [key, state] of states) {
        if (now - state.lastTouchedAt < ttlMs) break;
        states.delete(key);
    }
}

/**
 * @template {{ lastTouchedAt: number }} T
 * @param {Map<string, T>} states
 * @param {string} key
 * @param {T} state
 * @param {number} maxEntries
 */
function setBoundedState(states, key, state, maxEntries) {
    states.delete(key);
    while (states.size >= maxEntries) {
        const oldestKey = states.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        states.delete(oldestKey);
    }
    states.set(key, state);
}

/**
 * @param {string} contextKey
 * @param {InvocationContext | undefined} invocation
 * @returns {string}
 */
function buildScopedContextKey(contextKey, invocation) {
    const sessionId =
        typeof invocation?.sessionId === 'string' && invocation.sessionId.trim() ? invocation.sessionId : 'global';
    return `${sessionId}:${contextKey}`;
}

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
    const stateTtlMs = normalizePositiveInteger(opts.stateTtlMs, DEFAULT_HOOK_STATE_TTL_MS, 24 * 60 * 60 * 1000);
    const maxTrackedContexts = normalizePositiveInteger(opts.maxTrackedContexts, DEFAULT_MAX_TRACKED_CONTEXTS, 10_000);
    const now = opts.now ?? Date.now;

    /** @type {Map<string, RetryState>} */
    const retryCounts = new Map();

    return function onErrorOccurred(input, invocation) {
        const { error, errorContext, recoverable } = input;
        const contextKey = errorContext ?? 'unknown';
        const scopedContextKey = buildScopedContextKey(contextKey, invocation);
        const nowMs = now();
        pruneExpiredStates(retryCounts, nowMs, stateTtlMs);

        if (onError) {
            try {
                onError(input, invocation);
            } catch (_) {
                // ignora erros no callback de notificação
            }
        }

        // Verificar se atingiu o limite de retries para este contexto
        const currentState = retryCounts.get(scopedContextKey);
        const currentRetries = currentState?.count ?? 0;

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
                        `[hooks/error-handler] maxRetries(${maxRetries}) atingido para '${contextKey}' (session=${invocation?.sessionId ?? 'global'}) — abort`,
                    );
                    retryCounts.delete(scopedContextKey);
                    return { errorHandling: 'abort' };
                }
                setBoundedState(
                    retryCounts,
                    scopedContextKey,
                    { count: currentRetries + 1, lastTouchedAt: nowMs },
                    maxTrackedContexts,
                );
                log(
                    'DEBUG',
                    `[hooks/error-handler] retry ${currentRetries + 1}/${maxRetries} para '${contextKey}' (session=${invocation?.sessionId ?? 'global'})`,
                );
                return { errorHandling: 'retry', retryCount: currentRetries + 1 };
            }

            retryCounts.delete(scopedContextKey);
            log(
                'DEBUG',
                `[hooks/error-handler] ${decided} para '${contextKey}' (session=${invocation?.sessionId ?? 'global'})`,
            );
            return { errorHandling: decided };
        }

        // Estratégia padrão — contextual por recoverable + listas
        if (abortContexts.includes(contextKey)) {
            retryCounts.delete(scopedContextKey);
            log('WARN', `[hooks/error-handler] abort forçado para contexto '${contextKey}': ${error}`);
            return { errorHandling: 'abort' };
        }

        const isRecoverable = recoverable || recoverableContexts.includes(contextKey);
        if (isRecoverable) {
            if (currentRetries >= maxRetries) {
                log(
                    'WARN',
                    `[hooks/error-handler] maxRetries(${maxRetries}) atingido para '${contextKey}' (session=${invocation?.sessionId ?? 'global'}) — abort`,
                );
                retryCounts.delete(scopedContextKey);
                return { errorHandling: 'abort' };
            }
            setBoundedState(
                retryCounts,
                scopedContextKey,
                { count: currentRetries + 1, lastTouchedAt: nowMs },
                maxTrackedContexts,
            );
            log(
                'DEBUG',
                `[hooks/error-handler] recuperável: retry ${currentRetries + 1}/${maxRetries} para '${contextKey}' (session=${invocation?.sessionId ?? 'global'})`,
            );
            return { errorHandling: 'retry', retryCount: currentRetries + 1 };
        }

        retryCounts.delete(scopedContextKey);
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
    const stateTtlMs = normalizePositiveInteger(opts.stateTtlMs, DEFAULT_HOOK_STATE_TTL_MS, 24 * 60 * 60 * 1000);
    const maxTrackedContexts = normalizePositiveInteger(opts.maxTrackedContexts, DEFAULT_MAX_TRACKED_CONTEXTS, 10_000);
    const now = opts.now ?? Date.now;

    /** @type {Map<string, CircuitBreakerState>} */
    const circuits = new Map();

    /**
     * @param {string} contextKey
     * @param {number} nowMs
     * @returns {CircuitBreakerState}
     */
    function getState(contextKey, nowMs) {
        pruneExpiredStates(circuits, nowMs, stateTtlMs);
        const existing = circuits.get(contextKey);
        if (existing) {
            existing.lastTouchedAt = nowMs;
            setBoundedState(circuits, contextKey, existing, maxTrackedContexts);
            return existing;
        }
        const state = { failures: 0, openedAt: null, lastTouchedAt: nowMs };
        setBoundedState(circuits, contextKey, state, maxTrackedContexts);
        return state;
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

    return function onErrorOccurred(input, invocation) {
        const { error, errorContext, recoverable } = input;
        const contextKey = errorContext ?? 'unknown';
        const scopedContextKey = buildScopedContextKey(contextKey, invocation);
        const nowMs = now();

        // Notificar callback de tracking (ErrorTracker, etc.)
        if (onError) {
            try {
                onError(input, invocation);
            } catch (_) {
                // ignora erros no callback
            }
        }

        // Fatal pattern → abort imediato sem retry
        if (fatalPatterns.length > 0 && matchesAny(error, fatalPatterns)) {
            circuits.delete(scopedContextKey);
            log('WARN', `[hooks/circuit-breaker] padrão fatal detectado em '${contextKey}': ${error} — abort`);
            return { errorHandling: 'abort' };
        }

        const state = getState(scopedContextKey, nowMs);

        // Circuito aberto?
        if (state.openedAt !== null) {
            const elapsed = nowMs - state.openedAt;
            if (elapsed < resetAfterMs) {
                log(
                    'WARN',
                    `[hooks/circuit-breaker] circuito ABERTO para '${contextKey}' (session=${invocation?.sessionId ?? 'global'}) — ${Math.round((resetAfterMs - elapsed) / 1000)}s restantes`,
                );
                return { errorHandling: 'abort' };
            }
            // Reset automático
            log(
                'INFO',
                `[hooks/circuit-breaker] circuito FECHANDO para '${contextKey}' (session=${invocation?.sessionId ?? 'global'}) após reset`,
            );
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
                    `[hooks/circuit-breaker] padrão transiente detectado em '${contextKey}' (session=${invocation?.sessionId ?? 'global'}) — tratando como recuperável`,
                );
            } else {
                log(
                    'WARN',
                    `[hooks/circuit-breaker] irrecuperável '${contextKey}' (session=${invocation?.sessionId ?? 'global'}): ${error} — abort`,
                );
                circuits.delete(scopedContextKey);
                return { errorHandling: 'abort' };
            }
        }

        state.failures++;
        state.lastTouchedAt = nowMs;

        if (state.failures >= maxRetries) {
            state.openedAt = nowMs;
            log(
                'WARN',
                `[hooks/circuit-breaker] circuito ABRINDO para '${contextKey}' (session=${invocation?.sessionId ?? 'global'}) após ${state.failures} falhas`,
            );
            if (onTrip) {
                try {
                    onTrip(contextKey);
                } catch (_) {
                    // ignora
                }
            }
            return { errorHandling: 'abort' };
        }

        log(
            'DEBUG',
            `[hooks/circuit-breaker] retry ${state.failures}/${maxRetries} para '${contextKey}' (session=${invocation?.sessionId ?? 'global'})`,
        );
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
