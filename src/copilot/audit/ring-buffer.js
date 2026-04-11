// @ts-check
/**
 * src/copilot/audit/ring-buffer.js
 *
 * Buffer circular genérico de tamanho fixo para entradas de auditoria. Operações O(1) para push, O(n) para snapshot.
 *
 * @module copilot/audit/ring-buffer
 * @see EventBus
 */

/**
 * @template T
 */
export class AuditRingBuffer {
    /**
     * @param {{ capacity?: number }} [config]
     */
    constructor(config = {}) {
        /** @type {number} */
        this._capacity = config.capacity ?? 500;
        /** @type {T[]} */
        this._buffer = new Array(this._capacity);
        /** @type {number} write pointer (mod capacity) */
        this._writePos = 0;
        /** @type {number} total entries ever written */
        this._total = 0;
    }

    /**
     * Insere uma nova entrada no buffer. Se cheio, sobrescreve a entrada mais antiga.
     *
     * @param {T} entry
     * @returns {void}
     */
    push(entry) {
        this._buffer[this._writePos % this._capacity] = entry;
        this._writePos++;
        this._total++;
    }

    /**
     * Retorna as últimas `n` entradas em ordem cronológica (mais antiga → mais recente).
     *
     * @param {number} [n] - Número de entradas (default: 20, máximo: capacity)
     * @returns {T[]}
     */
    tail(n = 20) {
        const count = Math.min(n, this._capacity, this._total);
        if (count === 0) return [];

        const result = /** @type {T[]} */ ([]);
        const size = Math.min(this._total, this._capacity);
        const start = this._total <= this._capacity ? 0 : this._writePos % this._capacity;

        for (let i = 0; i < size; i++) {
            const idx = (start + i) % this._capacity;
            const entry = this._buffer[idx];
            if (entry !== undefined) result.push(entry);
        }

        return result.slice(-count);
    }

    /** Total de entradas inseridas (pode exceder capacity). @returns {number} */
    get total() {
        return this._total;
    }

    /** Entradas atualmente no buffer (limitado por capacity). @returns {number} */
    get size() {
        return Math.min(this._total, this._capacity);
    }

    /** Esvazia o buffer. @returns {void} */
    clear() {
        this._buffer = new Array(this._capacity);
        this._writePos = 0;
        this._total = 0;
    }
}
