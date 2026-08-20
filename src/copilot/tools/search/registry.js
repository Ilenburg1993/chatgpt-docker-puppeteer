// @ts-check
/**
 * Registro canônico do domínio `search/` — composição de arrays de tools.
 *
 * Este módulo é o único dono da montagem de `searchTools` e `symbolSearchTools`. Separado de `index.js` para preservar
 * a invariante barrel-only nesse arquivo.
 *
 * @module copilot/tools/search/registry
 */

import { withSkipPermission } from '../infra/tool-factory.js';
import { workspaceSymbolSearchTool } from './symbol-search-tools.js';
import { findSymbolUsagesTool, searchInFilesTool } from './text-search-tools.js';

/**
 * Subset de tools simbólicas (workspace_symbol_search + find_symbol_usages).
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const symbolSearchTools = [workspaceSymbolSearchTool, findSymbolUsagesTool];

/**
 * Conjunto completo de search tools para registro no bootstrap com category 'search'. `searchInFilesTool` sem skip; os
 * demais com skip de permissão para uso interno.
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const searchTools = [
    searchInFilesTool,
    withSkipPermission(workspaceSymbolSearchTool),
    withSkipPermission(findSymbolUsagesTool),
];
