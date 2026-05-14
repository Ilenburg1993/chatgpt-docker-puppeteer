// @ts-check
/**
 * Fila assíncrona com concorrência limitada.
 *
 * @module copilot/infra/queue/async-queue
 */

/**
 * @template T
 * @typedef {object} QueueTask
 * @property {() => Promise<T>} fn
 * @property {(value: T) => void} resolve
 * @property {(reason?: unknown) => void} reject
 */

/**
 * Fila assíncrona com controle de concorrência.
 */
export class AsyncQueue {
    /** @type {number} */
    #concurrency;
    /** @type {number} */
    #running = 0;
    /** @type {QueueTask<unknown>[]} */
    #queue = [];

    /**
     * @param {object} [opts]
     * @param {number} [opts.concurrency] - Máximo de tarefas simultâneas (default: 1).
     */
    constructor(opts) {
        const requested = Number(opts?.concurrency ?? 1);
        this.#concurrency = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1;
    }

    /** Número de tarefas aguardando na fila. */
    get pending() {
        return this.#queue.length;
    }

    /** Número de tarefas em execução. */
    get running() {
        return this.#running;
    }

    /**
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    add(fn) {
        return new Promise((resolve, reject) => {
            this.#queue.push({ fn, resolve: /** @type {(value: unknown) => void} */ (resolve), reject });
            this.#drain();
        });
    }

    /** Processa a fila enquanto houver slots disponíveis. */
    #drain() {
        while (this.#running < this.#concurrency && this.#queue.length > 0) {
            const task = /** @type {QueueTask<unknown>} */ (this.#queue.shift());
            this.#running++;
            void (async () => {
                try {
                    const value = await task.fn();
                    this.#running--;
                    this.#drain();
                    task.resolve(value);
                } catch (error) {
                    this.#running--;
                    this.#drain();
                    task.reject(error);
                }
            })();
        }
    }

    /** Limpa tarefas pendentes (não cancela as em execução). */
    clear() {
        for (const task of this.#queue) {
            task.reject(new Error('Queue cleared'));
        }
        this.#queue = [];
    }
}
