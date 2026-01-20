/* ==========================================================================
   src/core/context/transformers/summary.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Redução de texto preservando integridade gramatical.
========================================================================== */

/**
 * Trunca o texto respeitando pontos finais e quebras de linha.
 */
function smartTruncate(text, limit = 2000) {
    if (!text || text.length <= limit) {return text || '';}

    const sub = text.slice(0, limit);
    // Busca o último ponto, interrogação ou quebra de linha para um corte limpo
    const lastPoint = Math.max(sub.lastIndexOf('.'), sub.lastIndexOf('?'), sub.lastIndexOf('\n'));

    // Se o último ponto estiver muito longe do limite (mais de 30%), corta no limite seco
    const safeCut = (lastPoint > limit * 0.7) ? lastPoint + 1 : limit;

    return `${sub.slice(0, safeCut).trim()  }\n\n[... CONTEÚDO RESUMIDO POR SEGURANÇA ...]`;
}

module.exports = { smartTruncate };