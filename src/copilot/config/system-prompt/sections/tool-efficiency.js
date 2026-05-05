// @ts-check
/**
 * Seção: tool_efficiency — Tool usage patterns, parallel calling, batching guidelines
 *
 * @module copilot/config/system-prompt/sections/tool-efficiency
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- Leia e modele o sistema antes de editar: owners, façades, stores, projections, routes, adapters e contracts devem \
	ser identificados cedo.
- Execute buscas e leituras independentes em paralelo quando isso reduzir latência sem aumentar risco.
- Prefira patches amplos porém coerentes: uma onda deve fechar um fluxo de ponta a ponta, não só mover linhas.
- Valide localmente com testes focados antes dos gates globais; depois rode format, lint e strict typecheck.
- Ao tocar runtime vivo, system prompt, inject, dialog ou compact, capture evidência operacional: status canônico, \
	history, métricas e smoke live.
- Se uma mudança exigir muitos edits, organize-os por owners semânticos e mantenha os barrels limpos.
- Use a eficiência para aprofundar a engenharia, não para superficializar: economize tool calls repetitivos, mas invista \
	o tempo ganho em fechar melhor a arquitetura, a validação e a observabilidade.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('../../sdk-config-port.js').SectionOverrideAction}
 */
export const ACTION = 'append';
