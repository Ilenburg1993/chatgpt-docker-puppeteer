// @ts-check
/**
 * src/copilot/hooks/composer.js
 *
 * Utilitários de composição de hooks: pipeline, chain, fallback, timeout, conditional.
 *
 * Permite construir handlers complexos via composição sem duplicação de lógica.
 *
 * @module copilot/hooks/composer
 * @see EventBus
 * @see module:copilot/hooks/factory
 */

import { log } from './logger.js';
import { toError } from '../core/error-handlers.js';

/**
 * @typedef {import('./types.js').PreToolUseHandler} PreToolUseHandler
 *
 * @typedef {import('./types.js').PostToolUseHandler} PostToolUseHandler
 *
 * @typedef {import('./types.js').UserPromptSubmittedHandler} UserPromptSubmittedHandler
 *
 * @typedef {import('./types.js').InvocationContext} InvocationContext
 */

/**
 * Compõe múltiplos handlers em sequência (chain). O primeiro handler que retornar um resultado com `permissionDecision`
 * encerra a cadeia. Para onUserPromptSubmitted, o primeiro que retornar `modifiedPrompt` encerra.
 *
 * @example
 *     const hook = composeHandlers(auditHandler, denyHandler);
 *
 * @template {Function} T
 * @param {...T} handlers
 * @returns {T}
 */
export function composeHandlers(...handlers) {
    const fn = async (/** @type {unknown} */ input, /** @type {InvocationContext} */ invocation) => {
        for (const handler of handlers) {
            const result = await handler(input, invocation);
            if (result !== undefined && result !== null) {
                // Se tem qualquer campo de decisão, retorna
                if (
                    result.permissionDecision !== undefined ||
                    result.modifiedPrompt !== undefined ||
                    result.modifiedArgs !== undefined ||
                    result.errorHandling !== undefined
                ) {
                    return result;
                }
            }
        }
        return undefined;
    };
    return /** @type {T} */ (/** @type {unknown} */ (fn));
}

/**
 * Compõe múltiplos handlers como pipeline: cada handler executa e pode enriquecer o resultado. Diferente de
 * composeHandlers, todos os handlers executam (não para no primeiro com decisão). O resultado final é o merge de todos
 * os resultados.
 *
 * Uso típico: adicionar múltiplos enriquecedores de `additionalContext`.
 *
 * @example
 *     const hook = pipeline(logHandler, metricsHandler, contextEnricher);
 *
 * @template {Function} T
 * @param {...T} handlers
 * @returns {T}
 */
export function pipeline(...handlers) {
    const fn = async (/** @type {unknown} */ input, /** @type {InvocationContext} */ invocation) => {
        /** @type {Record<string, unknown>} */
        let merged = {};
        for (const handler of handlers) {
            try {
                const result = await handler(input, invocation);
                if (result && typeof result === 'object') {
                    merged = { ...merged, ...result };
                }
            } catch (e) {
                log('WARN', `[hooks/composer] pipeline handler erro (continuando): ${toError(e).message}`);
            }
        }
        return Object.keys(merged).length > 0 ? merged : undefined;
    };
    return /** @type {T} */ (/** @type {unknown} */ (fn));
}

/**
 * Cria um handler com fallback: se o handler primário lança erro, usa o fallbackFn.
 *
 * @example
 *     const hook = fallback(primaryHandler, () => ({ permissionDecision: 'allow' }));
 *
 * @template {Function} T
 * @param {T} primary
 * @param {T} fallbackFn
 * @returns {T}
 */
export function fallback(primary, fallbackFn) {
    const fn = async (/** @type {unknown} */ input, /** @type {InvocationContext} */ invocation) => {
        try {
            return await primary(input, invocation);
        } catch (e) {
            log('WARN', `[hooks/composer] handler primário falhou (usando fallback): ${toError(e).message}`);
            return fallbackFn(input, invocation);
        }
    };
    return /** @type {T} */ (/** @type {unknown} */ (fn));
}

/**
 * Adiciona timeout a um handler. Se o handler demorar mais que `ms`, retorna undefined.
 *
 * @example
 *     const hook = raceWithTimeout(slowHandler, 2000);
 *
 * @template {Function} T
 * @param {T} handler
 * @param {number} ms - Timeout em milissegundos
 * @returns {T}
 */
export function raceWithTimeout(handler, ms) {
    const fn = async (/** @type {unknown} */ input, /** @type {InvocationContext} */ invocation) => {
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;
        return Promise.race([
            Promise.resolve(handler(input, invocation)).finally(() => clearTimeout(timer)),
            new Promise((resolve) => {
                timer = setTimeout(() => {
                    log('WARN', `[hooks/composer] handler timeout após ${ms}ms`);
                    resolve(undefined);
                }, ms);
            }),
        ]);
    };
    return /** @type {T} */ (/** @type {unknown} */ (fn));
}

/**
 * Executa um handler somente se o predicado retornar true.
 *
 * @example
 *     const hook = conditional((input) => input.toolName === 'shell', shellDenyHandler, defaultAllowHandler);
 *
 * @template {Function} T
 * @param {(input: unknown, invocation: InvocationContext) => boolean | Promise<boolean>} predicate
 * @param {T} handler
 * @param {T} [elseHandler]
 * @returns {T}
 */
export function conditional(predicate, handler, elseHandler) {
    const fn = async (/** @type {unknown} */ input, /** @type {InvocationContext} */ invocation) => {
        const condition = await predicate(input, invocation);
        if (condition) {
            return handler(input, invocation);
        }
        if (elseHandler) {
            return elseHandler(input, invocation);
        }
        return undefined;
    };
    return /** @type {T} */ (/** @type {unknown} */ (fn));
}

/**
 * Memoiza um handler baseado em uma chave derivada do input. Útil para evitar re-executar lógica cara para inputs
 * idênticos dentro de uma sessão.
 *
 * @example
 *     const hook = memoize(expensiveHandler, (input) => input.toolName);
 *
 * @template {Function} T
 * @param {T} handler
 * @param {(input: unknown) => string} keyFn
 * @returns {T}
 */
export function memoize(handler, keyFn) {
    /** @type {Map<string, unknown>} */
    const cache = new Map();

    const fn = async (/** @type {unknown} */ input, /** @type {InvocationContext} */ invocation) => {
        const key = keyFn(input);
        if (cache.has(key)) {
            return cache.get(key);
        }
        const result = await handler(input, invocation);
        cache.set(key, result);
        return result;
    };
    return /** @type {T} */ (/** @type {unknown} */ (fn));
}

// ─── Middleware composition (E2.1 — composição declarativa) ──────────────────

/**
 * @typedef {import('./types.js').PreToolUseHookInput} PreToolUseHookInput
 *
 * @typedef {import('./types.js').PreToolUseHookOutput} PreToolUseHookOutput
 */

/**
 * Combina middlewares em estilo Koa/Express. Cada middleware recebe `(input, invocation, next)`
 * e pode modificar o fluxo chamando `next()` ou retornando diretamente.
 *
 * @example
 *     const hook = middleware(
 *         async (input, inv, next) => {
 *             console.log('before:', input.toolName);
 *             const result = await next(input, inv);
 *             console.log('after:', result);
 *             return result;
 *         },
 *         async (input) => ({ permissionDecision: 'allow' }),
 *     );
 *
 * @template TInput, TOutput
 * @param {...import('./types.js').HookMiddleware<TInput, TOutput>} middlewares
 * @returns {(input: TInput, invocation: import('./types.js').InvocationContext) => Promise<TOutput | void>}
 */
export function middleware(...middlewares) {
    /**
     * @param {TInput} input
     * @param {import('./types.js').InvocationContext} invocation
     * @returns {Promise<TOutput | void>}
     */
    return function composed(input, invocation) {
        let index = -1;

        /**
         * @param {number} i
         * @param {TInput} inp
         * @param {import('./types.js').InvocationContext} inv
         * @returns {Promise<TOutput | void>}
         */
        function dispatch(i, inp, inv) {
            if (i <= index) {
                return Promise.reject(new Error('[hooks/composer] next() chamado múltiplas vezes'));
            }
            index = i;
            const mw = middlewares[i];
            if (!mw) return Promise.resolve(undefined);
            try {
                return Promise.resolve(
                    mw(inp, inv, (nextInput, nextInv) => dispatch(i + 1, nextInput, nextInv)),
                );
            } catch (e) {
                return Promise.reject(e instanceof Error ? e : new Error(String(e)));
            }
        }

        return dispatch(0, input, invocation);
    };
}

/**
 * Cria um middleware de logging que registra entrada e saída de cada hook call.
 * Útil para debug e auditoria em pipeline composto.
 *
 * @template TInput, TOutput
 * @param {string} label - Label para identificação nos logs
 * @returns {import('./types.js').HookMiddleware<TInput, TOutput>}
 */
export function loggingMiddleware(label) {
    return async (input, invocation, next) => {
        log('DEBUG', `[hooks/composer] ${label} → entrada`);
        const result = await next(input, invocation);
        log('DEBUG', `[hooks/composer] ${label} → saída: ${result ? JSON.stringify(result).slice(0, 120) : 'void'}`);
        return result;
    };
}

/**
 * Cria um middleware que executa o handler apenas para tools específicas.
 * Para outras tools, chama `next()` diretamente (bypass).
 *
 * @param {string[]} toolNames - Nomes de tools para interceptar
 * @param {import('./types.js').HookMiddleware<PreToolUseHookInput, PreToolUseHookOutput>} mw
 * @returns {import('./types.js').HookMiddleware<PreToolUseHookInput, PreToolUseHookOutput>}
 */
export function forTools(toolNames, mw) {
    const set = new Set(toolNames.map((t) => t.toLowerCase()));
    return (input, invocation, next) => {
        if (set.has(input.toolName?.toLowerCase())) {
            return mw(input, invocation, next);
        }
        return next(input, invocation);
    };
}
