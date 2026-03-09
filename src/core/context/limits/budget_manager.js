// @ts-check - Type checking rigoroso habilitado (arquivo core)
/* ==========================================================================
   src/core/context/limits/budget_manager.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Monitoramento de volume e prevenção de overflow.
========================================================================== */

/** Limite global padrão de contexto (em caracteres) usado pelo budget manager. */
const GLOBAL_CONTEXT_LIMIT = 500000; // 500k caracteres teto

/**
 * Gerenciador de orçamento de caracteres para resolução de contexto. Previne overflow de contexto ao limitar o volume
 * total de injeção.
 *
 * @class BudgetManager
 */
class BudgetManager {
    /**
     * @param {number} [limit=GLOBAL_CONTEXT_LIMIT] - Limite máximo de caracteres (500k padrão). Default is
     *   `GLOBAL_CONTEXT_LIMIT`
     */
    constructor(limit = GLOBAL_CONTEXT_LIMIT) {
        /** @type {number} Limite máximo de caracteres */
        this.limit = limit;
        /** @type {number} Caracteres já consumidos */
        this.consumed = 0;
    }

    /**
     * Verifica se uma nova injeção cabe no orçamento restante.
     *
     * @example
     *     if (budget.hasBudget(response.length)) {
     *         // Seguro injetar
     *     }
     *
     * @param {number} length - Comprimento do novo texto em caracteres
     * @returns {boolean} true se há orçamento disponível, false caso contrário
     */
    hasBudget(length) {
        return this.consumed + length <= this.limit;
    }

    /**
     * Tenta alocar um volume de caracteres do orçamento. Retorna true se permitido, false se estourou o limite.
     *
     * @example
     *     if (budget.allocate(text.length)) {
     *         // Texto injetado no contexto
     *     } else {
     *         log('WARN', 'Budget estourado, interrompendo resolução');
     *     }
     *
     * @param {number} length - Comprimento do texto a alocar
     * @returns {boolean} true se alocado com sucesso, false se excede o limite
     */
    allocate(length) {
        if (!this.hasBudget(length)) {
            return false;
        }
        this.consumed += length;
        return true;
    }

    /**
     * Retorna o número de caracteres ainda disponíveis no orçamento.
     *
     * @example
     *     log('INFO', `Orçamento restante: ${budget.getRemaining()} chars`);
     *
     * @returns {number} Caracteres restantes (limit - consumed)
     */
    getRemaining() {
        return this.limit - this.consumed;
    }
}

export { BudgetManager, GLOBAL_CONTEXT_LIMIT };
