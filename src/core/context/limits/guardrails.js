/* ==========================================================================
   src/core/context/limits/guardrails.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Controle de profundidade de resolução.
========================================================================== */

/** @constant {number} Profundidade máxima de recursão permitida (3 níveis) */
const MAX_RECURSION_DEPTH = 3;

/**
 * Valida se a profundidade de recursão atual é segura.
 * Lança exceção se exceder o limite MAX_RECURSION_DEPTH.
 *
 * @function assertSafetyDepth
 * @param {number} depth - Nível atual de recursão (começando em 0)
 * @returns {boolean} true se profundidade é segura
 * @throws {Error} RECURSION_LIMIT_EXCEEDED - Se depth > MAX_RECURSION_DEPTH
 *
 * @example
 * // Uso típico no início da função resolveContext
 * assertSafetyDepth(depth); // depth = 0, 1, 2, 3 OK; 4+ lança exceção
 *
 * @example
 * // Previne loops infinitos em referências circulares
 * try {
 *   assertSafetyDepth(depth);
 * } catch (err) {
 *   log('ERROR', `Profundidade máxima excedida: ${err.message}`);
 * }
 *
 * @description
 * **Limite de segurança**: 3 níveis de recursão
 * - Nível 0: Prompt original
 * - Nível 1: Primeira expansão {{REF:...}}
 * - Nível 2: Expansão de referências dentro de referências
 * - Nível 3: Limite máximo permitido
 * - Nível 4+: Lança RECURSION_LIMIT_EXCEEDED
 *
 * **Casos de uso**:
 * - Prevenir loops infinitos ({{REF:A}} → {{REF:B}} → {{REF:A}})
 * - Limitar explosão combinatória de referências aninhadas
 * - Garantir tempo de resposta previsível
 */
function assertSafetyDepth(depth) {
    if (depth > MAX_RECURSION_DEPTH) {
        throw new Error(`RECURSION_LIMIT_EXCEEDED: Profundidade ${depth} excede o limite de segurança.`);
    }
    return true;
}

module.exports = { assertSafetyDepth, MAX_RECURSION_DEPTH };
