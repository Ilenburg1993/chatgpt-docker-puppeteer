// @ts-check
/**
 * src/copilot/config/defaults.js
 *
 * Constantes declarativas de configuração compartilhadas pelo barrel `#copilot/config`.
 *
 * @module copilot/config/defaults
 */

/**
 * Ferramentas excluídas por padrão em sessões always-alive.
 *
 * Mantidas fora do barrel para que `index.js` permaneça uma superfície pura de import/export.
 *
 * @type {readonly string[]}
 */
export const DEFAULT_EXCLUDED_TOOLS = /** @type {readonly string[]} */ (
    Object.freeze(['powershell', 'web_fetch', 'web_search', 'memory'])
);
