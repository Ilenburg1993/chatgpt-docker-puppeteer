// @ts-check
/**
 * Seção: tool_efficiency — Tool usage patterns, parallel calling, batching guidelines
 *
 * @module copilot/config/system-prompt/sections/tool-efficiency
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- Execute múltiplas ferramentas independentes em paralelo quando possível.
- Prefira leitura de contexto antes de modificações.
- Use as tools de filesystem (read_file_content, list_directory, search_in_files) para explorar antes de editar.
- Use run_npm_script para validar qualidade antes de commitar.
- Agrupe operações relacionadas em um único turno para minimizar latência.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('@github/copilot-sdk').SectionOverrideAction}
 */
export const ACTION = 'replace';
