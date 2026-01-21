/* ==========================================================================
   src/core/context/context_core.js
   Audit Level: 100 — Industrial Hardening (Unified Facade)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Ponto de entrada único para o motor de contexto.
                     Expõe a funcionalidade de resolução para o sistema.
   Sincronizado com: context_engine.js (V1.0).
========================================================================== */

const engine = require('./engine/context_engine');

/**
 * @module core/context
 * @description Motor de resolução de referências contextuais {{REF:...}} com suporte a
 * recursão, transformações semânticas e controle de orçamento de tokens.
 * @example
 * const { resolveContext } = require('./core/context/context_core');
 * const resolved = await resolveContext('Use {{REF:LAST}} como base', task, signal);
 */
module.exports = {
    /**
     * Resolve referências {{REF:...}} no texto de forma recursiva.
     *
     * @function resolveContext
     * @param {string} text - Texto original contendo tags {{REF:...}}
     * @param {object} [currentTask=null] - Tarefa atual (para resolução de REF:LAST, STATUS, etc.)
     * @param {AbortSignal} [signal=null] - Sinal de cancelamento para operações longas
     * @param {number} [depth=0] - Nível de recursão (interno, não passar manualmente)
     * @param {BudgetManager} [budget=null] - Gestor de orçamento (interno, não passar manualmente)
     * @returns {Promise<string>} Texto com todas as referências resolvidas
     * @throws {Error} CONTEXT_RESOLUTION_ABORTED - Se signal.aborted for true
     * @throws {Error} RECURSION_LIMIT_EXCEEDED - Se depth exceder 10 níveis
     * @example
     * // Referência simples
     * await resolveContext('{{REF:task-123}}', task);
     *
     * // Com transformação
     * await resolveContext('{{REF:task-123|SUMMARY}}', task);
     *
     * // Referência ao último resultado
     * await resolveContext('{{REF:LAST|JSON}}', task);
     */
    resolveContext: engine.resolveContext
};
