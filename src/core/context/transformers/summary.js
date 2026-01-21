/* ==========================================================================
   src/core/context/transformers/summary.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Redução de texto preservando integridade gramatical.
========================================================================== */

/**
 * Trunca texto respeitando pontos finais, interrogações e quebras de linha.
 * Busca um corte natural no final de uma sentença ao invés de truncar no meio de uma palavra.
 *
 * @function smartTruncate
 * @param {string} text - Texto original a ser truncado
 * @param {number} [limit=2000] - Limite máximo de caracteres
 * @returns {string} Texto truncado com indicador [...CONTEÚDO RESUMIDO...]
 *
 * @example
 * // Texto pequeno retorna inalterado
 * smartTruncate('Olá mundo', 2000); // => 'Olá mundo'
 *
 * @example
 * // Texto longo trunca em ponto final próximo ao limite
 * smartTruncate('Frase 1. Frase 2. Frase 3 muito longa...', 15);
 * // => 'Frase 1. Frase 2.\n\n[... CONTEÚDO RESUMIDO POR SEGURANÇA ...]'
 *
 * @example
 * // Se não encontrar ponto, trunca no limite exato
 * smartTruncate('textoSemPontoFinalMuitoLongo', 10);
 * // => 'textoSemPo\n\n[... CONTEÚDO RESUMIDO POR SEGURANÇA ...]'
 *
 * @description
 * **Estratégia de corte**:
 * 1. Se texto <= limite, retorna original intacto
 * 2. Se texto > limite:
 *    - Busca último `.` ou `?` ou `\n` nos últimos 30% do limite
 *    - Se encontrado ponto seguro, trunca ali
 *    - Caso contrário, trunca no limite exato
 * 3. Adiciona marcador de resumo ao final
 *
 * **Casos de uso**:
 * - Transformador `{{REF:task-123|SUMMARY}}`
 * - Prevenção de overflow em injeção de contexto
 * - Resumo de responses longas para exibição
 */
function smartTruncate(text, limit = 2000) {
    if (!text || text.length <= limit) {
        return text || '';
    }

    const sub = text.slice(0, limit);
    // Busca o último ponto, interrogação ou quebra de linha para um corte limpo
    const lastPoint = Math.max(sub.lastIndexOf('.'), sub.lastIndexOf('?'), sub.lastIndexOf('\n'));

    // Se o último ponto estiver muito longe do limite (mais de 30%), corta no limite seco
    const safeCut = lastPoint > limit * 0.7 ? lastPoint + 1 : limit;

    return `${sub.slice(0, safeCut).trim()}\n\n[... CONTEÚDO RESUMIDO POR SEGURANÇA ...]`;
}

module.exports = { smartTruncate };
