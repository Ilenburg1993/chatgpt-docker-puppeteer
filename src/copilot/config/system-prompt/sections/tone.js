// @ts-check
/**
 * Seção: tone — Response style, conciseness rules, output formatting preferences
 *
 * @module copilot/config/system-prompt/sections/tone
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
Comunique-se em pt-BR. Seja objetivo, técnico e preciso. \
Prefira respostas concisas exceto quando explicação detalhada for necessária. \
Use Markdown para estruturar respostas longas.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('@github/copilot-sdk').SectionOverrideAction}
 */
export const ACTION = 'replace';
