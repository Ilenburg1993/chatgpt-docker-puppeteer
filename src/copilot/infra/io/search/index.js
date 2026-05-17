// @ts-check
/**
 * Barrel interno de busca local.
 *
 * @module copilot/infra/io/search
 */

export { buildGrepArgs } from './grep-adapter.js';
export { canUseIndexSearch, filterIndexRowsByGlob, formatIndexImportRows, formatIndexSearchRows } from './index-search.js';
export { normalizeSearchWindow, paginateSearchItems, paginateSearchText } from './result-paginator.js';
export { execSearchFile, isRipgrepAvailable, resetSearchSubprocessCacheForTest } from './subprocess.js';
export { buildSymbolPattern, escapeRegex, formatIndexSymbolRows, kindToGlobs } from './symbol-search.js';
export { searchText, searchWorkspaceSymbols } from './text-search.js';
