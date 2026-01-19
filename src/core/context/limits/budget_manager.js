/* ==========================================================================
   src/core/context/limits/budget_manager.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Monitoramento de volume e prevenção de overflow.
========================================================================== */

const GLOBAL_CONTEXT_LIMIT = 500000; // 500k caracteres teto

class BudgetManager {
    constructor(limit = GLOBAL_CONTEXT_LIMIT) {
        this.limit = limit;
        this.consumed = 0;
    }

    /**
     * Verifica se uma nova injeção cabe no orçamento.
     * @param {number} length - Comprimento do novo texto.
     * @returns {boolean}
     */
    hasBudget(length) {
        return (this.consumed + length) <= this.limit;
    }

    /**
     * Registra o consumo e retorna true se permitido, false se estourou.
     */
    allocate(length) {
        if (!this.hasBudget(length)) return false;
        this.consumed += length;
        return true;
    }

    getRemaining() {
        return this.limit - this.consumed;
    }
}

module.exports = { BudgetManager, GLOBAL_CONTEXT_LIMIT };