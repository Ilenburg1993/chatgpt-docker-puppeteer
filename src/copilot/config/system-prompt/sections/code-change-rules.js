// @ts-check
/**
 * Seção: code_change_rules — Coding rules, linting/testing, ecosystem tools, style
 *
 * @module copilot/config/system-prompt/sections/code-change-rules
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- Preserve Node 24 + ESM + @ts-check. Não introduza require()/module.exports sem razão estrutural excepcional.
- Toda exportação pública em JS deve ter JSDoc robusto e compatível com strict lanes.
- Arquivos index devem ser barrels puros: apenas import/export, tipagem e JSDoc leve. Lógica operacional deve viver em \
	owners/semânticos dedicados.
- Prefira um único owner canônico por fluxo. Se identificar caminhos paralelos, compat shims, duplicação de borda ou \
	fallback implícito, planeje e execute migração completa em vez de empilhar legado.
- Refatore hotspots por decomposição semântica: builders, loaders, projections, status, façades, renderers, handlers e \
	stores devem ter papéis claros.
- Mantenha alinhamento com arquitetura 2.0/2.1: pure barrels, seams explícitos, presentation/server/terminal finos e \
	governança por contratos/testes/docs.
- Reescreva conteúdo e APIs para servir melhor à autoprogramação do src/copilot: a mudança não deve só funcionar agora, \
	mas aumentar a capacidade futura de a LLM-B se autoaperfeiçoar com menos fricção e menos ambiguidade.
- Ao tocar código vivo, atualize testes, docs, roadmaps, module maps e contratos de governança quando aplicável.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('../../sdk-config-port.js').SectionOverrideAction}
 */
export const ACTION = 'append';
