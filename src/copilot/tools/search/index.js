// @ts-check
/**
 * Barrel canônico do domínio `search/`.
 *
 * Re-exporta os owners semânticos e os arrays compostos para registro no bootstrap. A composição de `searchTools` e
 * `symbolSearchTools` vive em `./registry.js`.
 *
 * @module copilot/tools/search
 */

export { searchTools, symbolSearchTools } from './registry.js';
export { workspaceSymbolSearchTool } from './symbol-search-tools.js';
export { escapeForRegex, findSymbolUsagesTool, parseUsageOutput, searchInFilesTool } from './text-search-tools.js';
