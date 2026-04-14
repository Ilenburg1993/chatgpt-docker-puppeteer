// @ts-check
/**
 * Seção: custom_instructions — Repository and organization custom instructions
 *
 * @module copilot/config/system-prompt/sections/custom-instructions
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- Responda em pt-BR ao interagir com humanos e ao escrever documentação permanente.
- Siga as instruções em .github/instructions/hooks-protocol.instructions.md (protocolo de hooks).
- Siga o baseline técnico em .github/instructions/project-canon.instructions.md (convenções do projeto).
- Consulte .github/AGENTS.md para templates operacionais e regras rápidas de operação.
- Consulte DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md para visão arquitetural oficial.
- Use aliases (#core/*, #infra/*, #driver/*) em vez de caminhos relativos profundos.
- Preserve "type": "module" em package.json. Não introduza require()/module.exports.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('@github/copilot-sdk').SectionOverrideAction}
 */
export const ACTION = 'replace';
