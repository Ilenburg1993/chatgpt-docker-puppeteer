// @ts-check
/**
 * @param {import('../lib/schema.mjs').AuditFindingV3} finding
 * @returns {object}
 */
export function buildTestPlan(finding) {
    const plan = [];

    if (finding.file) {
        plan.push(`Executar validação direcionada no arquivo ${finding.file}.`);
    }

    if (finding.source_tool.includes('typecheck')) {
        plan.push('Executar `npm run typecheck` e confirmar ausência de erros TS.');
    } else if (finding.source_tool.includes('check:forbidden')) {
        plan.push('Executar `npm run check:forbidden` e confirmar que o padrão foi eliminado.');
    } else if (finding.source_tool.includes('test')) {
        plan.push('Reexecutar a suite de testes que originou o achado e validar estabilidade.');
    } else {
        plan.push('Executar `npm run audit:quick -- --focus bug-first` para validar regressão local.');
    }

    plan.push('Executar regressão crítica do domínio afetado antes de promover para merge.');
    return plan;
}
