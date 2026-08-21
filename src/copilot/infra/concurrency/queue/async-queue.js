// @ts-check
/**
 * Fila assíncrona com concorrência limitada.
 *
 * @module copilot/infra/concurrency/queue/async-queue
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
    /** @type {Map<number, QueueTask<unknown>[]>} */
    #queues = new Map([
        [0, []], // alta
        [5, []], // normal
        [10, []], // baixa
    ]);

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
        let total = 0;
        for (const queue of this.#queues.values()) {
            total += queue.length;
        }
        return total;
    }

    /** Número de tarefas em execução. */
    get running() {
        return this.#running;
    }

    /**
     * @template T
     * @param {() => Promise<T>} fn
     * @param {number} [priority=5] - Menor número = maior prioridade. Default is `5`
     * @returns {Promise<T>}
     */
    add(fn, priority = 5) {
        const normalizedPriority = Number.isFinite(priority) ? Math.floor(priority) : 5;
        let queue = this.#queues.get(normalizedPriority);
        if (!queue) {
            queue = [];
            this.#queues.set(normalizedPriority, queue);
        }
        return new Promise((resolve, reject) => {
            queue?.push({ fn, resolve: /** @type {(value: unknown) => void} */ (resolve), reject });
            this.#drain();
        });
    }

    /**
     * @returns {QueueTask<unknown> | undefined}
     */
    #nextTask() {
        const orderedPriorities = [...this.#queues.keys()].sort((a, b) => a - b);
        for (const key of orderedPriorities) {
            const queue = this.#queues.get(key);
            if (queue && queue.length > 0) return queue.shift();
        }
        return undefined;
    }

    /** Processa a fila enquanto houver slots disponíveis. */
    #drain() {
        while (this.#running < this.#concurrency && this.pending > 0) {
            const task = this.#nextTask();
            if (!task) break;
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
        for (const queue of this.#queues.values()) {
            for (const task of queue) {
                task.reject(new Error('Queue cleared'));
            }
            queue.length = 0;
        }
    }
}
