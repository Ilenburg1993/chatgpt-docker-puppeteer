import { buildSuggestedDiff } from './diff_builder.mjs';
import { scoreConfidence } from './confidence_model.mjs';
import { buildTestPlan } from './test_planner.mjs';

/**
 * @param {any} finding
 * @param {{ rankedCauses?: Array<{ cause: string, score: number }>, proposeDiffs?: boolean, depth?: 'basic'|'standard'|'deep', contextPack?: any }} [options]
 */
export function buildProposalV3(finding, options = {}) {
    const depth = options.depth || 'standard';
    const ranked = Array.isArray(options.rankedCauses) ? options.rankedCauses : [];
    const topCause = ranked[0]?.cause || finding.root_cause || 'Causa provável não consolidada.';
    const codeContextUsed = Boolean(options.contextPack?.code_context_used);
    const ragScope = options.contextPack?.rag?.meta?.scope || options.contextPack?.rag?.scope || null;
    const lspQuality = /** @type {'high'|'medium'|'low'} */ (
        options.contextPack?.lsp ? 'high' : finding.source_tool.includes('lsp') ? 'medium' : 'low'
    );
    const confidence = scoreConfidence(finding, {
        hasContract: Boolean(finding.contract_id),
        hasRuntimeEvidence: /runtime|test|smoke|chaos/i.test(String(finding.source_tool || '')),
        sourceConvergence: ranked.length,
    });
    const historyHint =
        Array.isArray(options.contextPack?.history) && options.contextPack.history.length > 0
            ? String(options.contextPack.history[0]).slice(0, 180)
            : null;
    const testPlan = buildTestPlan(finding);
    const validationCommands = [];
    if (finding.source_tool?.includes('check:forbidden') || finding.contract_id?.startsWith('CONTRACT-STATIC-')) {
        validationCommands.push('npm run check:forbidden');
    }
    if (finding.source_tool?.includes('typecheck') || finding.contract_id === 'CONTRACT-SCHEMA-TYPECHECK') {
        validationCommands.push('npm run typecheck');
    }
    if (
        finding.source_tool?.includes('test') ||
        finding.source_tool?.includes('runtime') ||
        finding.source_tool?.includes('chaos')
    ) {
        validationCommands.push('npm run test:regression');
    }
    if (finding.contract_id === 'CONTRACT-STATIC-PROCESS-EXIT') {
        validationCommands.push(
            'npm run test:regression -- tests/regression/test_wave11_main_server_bootstrap_unification.spec.js'
        );
    }
    if (finding.contract_id === 'CONTRACT-STATIC-HARDCODED-PORTS') {
        validationCommands.push('npm run test:integration -- tests/integration/server/test_server_engine_tls.spec.js');
    }
    validationCommands.push('npm run audit:quick -- --focus bug-first');

    const summary = [
        `Restaurar contrato ${finding.contract_id || finding.source_tool}.`,
        `Causa principal: ${topCause}`,
        historyHint ? `Histórico relacionado: ${historyHint}` : null,
        codeContextUsed
            ? 'Contexto local de código foi utilizado para orientar patch e validação.'
            : 'Aplicar correção localizada e validar regressão.',
        depth === 'deep' ? 'Aplicar ajuste local com validação cruzada e rollback controlado.' : null,
    ]
        .filter(Boolean)
        .join(' ');

    const proposal = {
        depth,
        summary,
        suggested_diff: options.proposeDiffs
            ? buildSuggestedDiff(finding, {
                  title: finding.contract_id,
                  cause: topCause,
                  replacementHint: codeContextUsed
                      ? `/* FIX(${finding.contract_id || finding.source_tool}): ${topCause} */`
                      : undefined,
              })
            : null,
        files_touched: finding.file ? [finding.file] : [],
        test_plan: testPlan,
        rollback_hint: 'Reverter patch sugerido e restaurar baseline do módulo caso gates críticos falhem.',
        validation_commands: [...new Set(validationCommands)],
    };

    return {
        confidence_score: confidence,
        proposal,
        root_cause: finding.root_cause || topCause,
        root_cause_candidates: ranked.map(item => ({
            cause: item.cause,
            score: Number(Number(item.score || 0).toFixed(2)),
        })),
        proposal_context: {
            code_context_used: codeContextUsed,
            rag_scope: ragScope,
            lsp_signal_quality: lspQuality,
        },
    };
}
