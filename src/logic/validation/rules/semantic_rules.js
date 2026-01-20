/* ==========================================================================
   src/logic/validation/rules/semantic_rules.js
   Audit Level: 100 — Industrial Hardening (Semantic Guard - Platinum)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Analisar o conteúdo textual em busca de termos proibidos,
                     recusas da IA e indicadores de falha semântica.
   Sincronizado com: i18n.js (V32), scan_engine.js (V1.1).
========================================================================== */

/**
 * Avalia uma linha de texto individual em busca de violações semânticas.
 * Projetado para ser invocado dentro de um loop de stream (Single-Pass).
 *
 * @param {string} line - Linha de texto atual.
 * @param {Array<string>} forbiddenTerms - Lista consolidada e PRÉ-NORMALIZADA.
 * @returns {string|null} O termo original encontrado ou null se a linha estiver limpa.
 */
function evaluateLine(line, forbiddenTerms) {
    // 1. Guardrail de entrada: Evita processamento em linhas vazias ou sem regras
    if (!line || !forbiddenTerms || forbiddenTerms.length === 0) {return null;}

    // 2. Normalização única por linha (Otimização de Memória)
    const normalizedLine = line.toLowerCase();

    // 3. Busca exaustiva com Short-circuit
    // [OPTIMIZATION] Como os termos já foram normalizados no 'compileForbiddenList',
    // eliminamos milhares de chamadas redundantes a .toLowerCase() por arquivo.
    return forbiddenTerms.find(term => normalizedLine.includes(term)) || null;
}

/**
 * Prepara a lista consolidada de termos (Sistema + Usuário).
 * Realiza a higienização e normalização prévia para ganho de performance.
 *
 * @param {Array<string>} systemTerms - Termos vindos do i18n.js.
 * @param {Array<string>} userTerms - Termos definidos na Task Spec.
 * @returns {Array<string>} Lista de termos únicos, limpos e em minúsculas.
 */
function compileForbiddenList(systemTerms = [], userTerms = []) {
    // 1. Garantia de Tipagem (Defensive Coding)
    const sys = Array.isArray(systemTerms) ? systemTerms : [];
    const user = Array.isArray(userTerms) ? userTerms : [];

    // 2. Unificação e Deduplicação via Set
    const combined = [...new Set([...sys, ...user])];

    // 3. Filtragem e Normalização (Hardening V68)
    return combined
        .filter(t =>
            typeof t === 'string' &&
            t.trim().length > 2 // [FIX] Impede falsos-positivos com conectores curtos
        )
        .map(t => t.trim().toLowerCase());
}

module.exports = {
    evaluateLine,
    compileForbiddenList
};