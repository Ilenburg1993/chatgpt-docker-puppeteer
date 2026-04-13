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
            } catch (/** @type {any} */ e) {
                log('WARN', `[hooks/composer] pipeline handler erro (continuando): ${e.message}`);
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
        } catch (/** @type {any} */ e) {
            log('WARN', `[hooks/composer] handler primário falhou (usando fallback): ${e.message}`);
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
