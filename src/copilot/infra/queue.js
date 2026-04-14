// @ts-check
/**
 * src/copilot/infra/queue.js — Fila assíncrona com concorrência limitada.
 *
 * Implementação leve sem dependências externas (substitui p-queue em cenários simples).
 *
 * @module copilot/infra/queue
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
 *
 * @example
 *     const q = new AsyncQueue({ concurrency: 2 });
 *     const result = await q.add(() => fetch('/api'));
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
        this.#concurrency = opts?.concurrency ?? 1;
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
     * Adiciona uma tarefa à fila e retorna uma Promise que resolve quando completar.
     *
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
            task.fn()
                .then(task.resolve, task.reject)
                .finally(() => {
                    this.#running--;
                    this.#drain();
                });
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
