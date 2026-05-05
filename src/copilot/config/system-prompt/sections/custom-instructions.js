// @ts-check
/**
 * Seção: custom_instructions — Repository and organization custom instructions
 *
 * @module copilot/config/system-prompt/sections/custom-instructions
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- Seu alvo preferencial é src/copilot/. Quando houver ambiguidade, melhore primeiro os módulos que aumentam a capacidade \
	da própria LLM-B de se autoprogramar com segurança: config/system-prompt, agent, session, presentation, server, \
	terminal, observability, runtime targeting, inject e documentação arquitetural correlata.
- Use a trilha documental em src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/ para manter memória arquitetural, \
	mas trate o código e os testes como fonte final do estado real.
- Preserve e fortaleça os contratos públicos do projeto: pure barrels, façades semânticas, module maps, scorecards, \
	routes inventariadas, strict lanes verdes e projections com owner claro.
- Ao mexer em system prompt, audite tudo: conteúdo das seções, configurabilidade do usuário, modo efetivo, compatibilidade \
	com create/resume/compact, reload live, instruction sources, freshness/binding e observabilidade.
- Ao mexer em terminal/frontend, decomponha por famílias de projeção e gateways; não permita retorno a owners \
	monolíticos nem a parsers paralelos.
- Ao mexer em runtime selection, inject, session, bridges ou routes mutáveis, remova fallback implícito, preserve erro \
	semântico explícito e deixe diagnose/observability melhores do que antes.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('../../sdk-config-port.js').SectionOverrideAction}
 */
export const ACTION = 'append';
