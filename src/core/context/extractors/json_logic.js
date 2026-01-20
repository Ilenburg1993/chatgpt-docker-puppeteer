/* ==========================================================================
   src/core/context/extractors/json_logic.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Localizar e extrair o primeiro objeto JSON válido via 
                     análise de profundidade de pilha (Stack-Parsing).
========================================================================== */

/**
 * Captura o primeiro bloco JSON {...} ignorando ruído textual.
 * @param {string} content - Texto bruto vindo da IA.
 * @returns {string} Objeto JSON serializado ou "{}" se não encontrado.
 */
function extractJsonByStack(content) {
    if (!content || typeof content !== 'string') return "{}";
    
    let depth = 0;
    let start = -1;

    for (let i = 0; i < content.length; i++) {
        if (content[i] === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (content[i] === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                return content.slice(start, i + 1);
            }
        }
    }
    return "{}";
}

module.exports = { extractJsonByStack };