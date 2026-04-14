// @ts-check
/**
 * Seção: code_change_rules — Coding rules, linting/testing, ecosystem tools, style
 *
 * @module copilot/config/system-prompt/sections/code-change-rules
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- Mantenha ESM (import/export). Não use require() sem justificativa excepcional.
- Estilo: 4 espaços, 120 colunas, aspas simples, ponto-e-vírgula.
- JSDoc robusto em toda exportação pública (@param, @returns, @throws).
- Prefira aliases (#core/*, #infra/*, #driver/*) a caminhos relativos profundos.
- Não introduza puppeteer.launch() — use o Chrome externo via DevTools existente.
- Rode npm run lint e npm run typecheck:node antes de qualquer commit.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('@github/copilot-sdk').SectionOverrideAction}
 */
export const ACTION = 'replace';
