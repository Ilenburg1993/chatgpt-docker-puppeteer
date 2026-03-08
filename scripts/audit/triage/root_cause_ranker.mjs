// @ts-check
/**
 * @param {ReturnType<import('./context_pack.mjs').buildContextPack>} contextPack
 * @returns {any[]}
 */
export function rankRootCauses(contextPack) {
    /** @type {{ cause: string; score: number }[]} */
    const candidates = [];

    const src = String(contextPack.finding.source_tool || '');
    const evidence = String(contextPack.finding.evidence || '').toLowerCase();

    if (src.includes('mcp:diagnose') || src.includes('rag:health')) {
        candidates.push({ cause: 'Indisponibilidade/degradação de infraestrutura MCP/RAG/LSP.', score: 0.86 });
    }

    if (src.includes('typecheck')) {
        candidates.push({ cause: 'Quebra de contrato de tipos em build-time.', score: 0.82 });
    }

    if (src.includes('check:forbidden')) {
        candidates.push({
            cause: 'Violação de política arquitetural definida no gate de padrões proibidos.',
            score: 0.84,
        });
    }

    if (contextPack.finding?.contract_id) {
        candidates.push({ cause: `Violação direta do contrato ${contextPack.finding.contract_id}.`, score: 0.88 });
    }

    if (src.includes('test') || evidence.includes('assert') || evidence.includes('failed')) {
        candidates.push({ cause: 'Regressão funcional detectada por teste automatizado.', score: 0.8 });
    }

    if (contextPack.rag?.results?.[0]?.path) {
        const path = String(contextPack.rag.results[0].path);
        if (path.startsWith('src/') || path.startsWith('scripts/')) {
            candidates.push({ cause: `Provável anomalia concentrada no módulo ${path}.`, score: 0.72 });
        }
    }

    if (candidates.length === 0) {
        candidates.push({
            cause: 'Divergência entre comportamento esperado e implementação atual no trecho apontado.',
            score: 0.61,
        });
    }

    return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}
