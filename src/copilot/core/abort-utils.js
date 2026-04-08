// @ts-check
/**
 * src/copilot/core/abort-utils.js
 *
 * Utilitários para timeout com AbortController, substituindo padrões manuais de Promise.race([fn, setTimeout(reject)]).
 *
 * @module copilot/core/abort-utils
 */

import { TimeoutError } from './errors.js';

/**
 * Executa uma função async com timeout via AbortSignal. Lança TimeoutError se o timeout expirar antes da conclusão.
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fn - Função async que recebe AbortSignal
 * @param {number} timeoutMs - Timeout em ms
 * @param {string} [label='operation'] - Label para a mensagem de erro. Default is `'operation'`
 * @returns {Promise<T>}
 */
export async function withTimeout(fn, timeoutMs, label = 'operation') {
    const controller = new AbortController();

    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;

    try {
        const result = await Promise.race([
            fn(controller.signal),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }),
        ]);
        return /** @type {T} */ (result);
    } finally {
        clearTimeout(timer);
    }
}
