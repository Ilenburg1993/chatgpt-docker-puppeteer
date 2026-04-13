// @ts-check
/**
 * src/copilot/core/retry.js
 *
 * Utilitários de retry com backoff exponencial + jitter e timeout com AbortController.
 *
 * @module copilot/core/retry
 * @see EventBus
 */

import { TimeoutError } from './errors.js';

/**
 * @typedef {object} RetryOptions
 * @property {number} [maxAttempts=3] - Número máximo de tentativas. Default is `3`
 * @property {number} [baseDelayMs=200] - Delay base em ms (dobra a cada tentativa). Default is `200`
 * @property {number} [maxDelayMs=10000] - Delay máximo em ms. Default is `10000`
 * @property {boolean} [jitter=true] - Adicionar jitter aleatório ao delay. Default is `true`
 * @property {AbortSignal} [signal] - Sinal para abortar retries
 * @property {(error: unknown, attempt: number) => boolean} [shouldRetry] - Função que decide se deve fazer retry
 * @property {(error: unknown, attempt: number) => void} [onRetry] - Callback chamado antes de cada retry
 */

/**
 * Executa uma função async com retry automático e backoff exponencial.
 *
 * @template T
 * @param {() => Promise<T>} fn - Função a executar
 * @param {RetryOptions} [opts] - Opções de retry
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
    const {
        maxAttempts = 3,
        baseDelayMs = 200,
        maxDelayMs = 10_000,
        jitter = true,
        signal,
        shouldRetry = () => true,
        onRetry,
    } = opts;

    /** @type {unknown} */
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) {
            throw signal.reason ?? new Error('Retry aborted');
        }

        try {
            return await fn();
        } catch (/** @type {any} */ error) {
            lastError = error;

            if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
                throw error;
            }

            onRetry?.(error, attempt);

            const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
            const finalDelay = jitter ? delay + Math.random() * (delay * 0.5) : delay;

            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, finalDelay);
                if (signal) {
                    signal.addEventListener(
                        'abort',
                        () => {
                            clearTimeout(timer);
                            const reason =
                                signal.reason instanceof Error
                                    ? signal.reason
                                    : new Error(String(signal.reason ?? 'Retry aborted'));
                            reject(reason);
                        },
                        { once: true },
                    );
                }
            });
        }
    }

    throw lastError;
}

// ─── Timeout ──────────────────────────────────────────────────────────────────

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
