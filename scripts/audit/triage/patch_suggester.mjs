// @ts-check
/**
 * @param {import('../lib/schema.mjs').AuditFindingV3} finding
 * @param {ReturnType<import('./root_cause_ranker.mjs').rankRootCauses>} rankedCauses
 * @param {{ proposeDiffs: boolean }} options
  * @returns {object}
 */
export function suggestPatch(finding, rankedCauses, options) {
    const file = finding.file || 'arquivo_indefinido.js';
    const line = finding.line || 1;
    const topCause = rankedCauses?.[0]?.cause || 'Causa principal não definida';

    const summary = `Ajustar a lógica relacionada a ${finding.source_tool} para eliminar a condição reportada e restaurar contrato esperado.`;

    const suggestedDiff = options.proposeDiffs
        ? [
              `diff --git a/${file} b/${file}`,
              `@@ -${line},1 +${line},1 @@`,
              `- // TODO: comportamento atual associado ao achado ${finding.id}`,
              `+ // FIX(${finding.id}): ${topCause}`,
          ].join('\n')
        : null;

    return {
        summary,
        suggested_diff: suggestedDiff,
        files_touched: finding.file ? [finding.file] : [],
        rollback_hint: 'Reverter patch sugerido e restaurar baseline anterior caso testes críticos falhem.',
    };
}
