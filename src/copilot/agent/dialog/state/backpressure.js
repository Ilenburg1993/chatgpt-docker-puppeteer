// @ts-check
/**
 * src/copilot/agent/dialog/state/backpressure.js
 *
 * F59: Encapsula a lógica de backpressure e serialização de turnos do dialog loop.
 *
 * Extraído de loop-manager.js para separação de concerns. O `TurnQueue` gerencia:
 *
 * - Mutex promise-chain para serialização de turnos
 * - Contagem de profundidade da fila
 * - Rejeição quando fila atinge capacidade máxima
 * - Reset atômico do pipeline (forceDeactivate)
 *
 * @module copilot/agent/dialog/backpressure
 * @see EventBus
 */

import { AgentSessionError } from '#copilot/agent/errors';
import { logSwallowed } from '../../ports/logging/swallowed.js';

/**
 * Serializa execução de turnos com backpressure baseada em profundidade da fila.
 */
export class TurnQueue {
    /** @type {Promise<void>} */
    #mutex = Promise.resolve();

    /** @type {number} */
    #depth = 0;

    /** @type {number} */
    #gen = 0;

    /** @type {number} */
    #maxSize;

    /**
     * @param {{ maxSize: number }} options
     */
    constructor({ maxSize }) {
        this.#maxSize = maxSize;
    }

    /** @returns {number} Profundidade atual da fila */
    get depth() {
        return this.#depth;
    }

    /** @returns {boolean} `true` se a fila atingiu capacidade máxima */
    get full() {
        return this.#depth >= this.#maxSize;
    }

    /**
     * Enfileira uma tarefa para execução serializada. Rejeita se a fila estiver cheia.
     *
     * @template T
     * @param {() => Promise<T>} fn - Função assíncrona a executar quando for sua vez no mutex
     * @returns {Promise<T>}
     * @throws {AgentSessionError} com código `DIALOG_QUEUE_FULL` se a fila estiver cheia
     */
    enqueue(fn) {
        if (this.#depth >= this.#maxSize) {
            return Promise.reject(
                new AgentSessionError(`[TurnQueue] Fila cheia (${this.#depth}/${this.#maxSize}).`, 'DIALOG_QUEUE_FULL'),
            );
        }

        this.#depth++;
        const prev = this.#mutex;
        const myGen = this.#gen;
        /** @type {Promise<T>} */
        const next = prev.then(fn);
        this.#mutex = next.then(() => {}).catch((e) => logSwallowed(e, 'agent.backpressure.mutex'));
        const finalizeTurn = () => {
            if (this.#gen !== myGen) return;
            this.#depth = Math.max(0, this.#depth - 1);
            if (this.#depth === 0) {
                this.#mutex = Promise.resolve();
            }
        };
        // Evita gerar uma Promise rejeitada órfã via `finally()` quando `next` falha.
        void next.then(finalizeTurn, finalizeTurn);
        return next;
    }

    /**
     * Reset atômico — descarta mutex e zera fila. Usado em forceDeactivate.
     */
    reset() {
        this.#mutex = Promise.resolve();
        this.#depth = 0;
        this.#gen++;
    }

    /**
     * Aguarda pipeline drenar (mutex atual).
     *
     * @returns {Promise<void>}
     */
    drain() {
        return this.#mutex;
    }
}
