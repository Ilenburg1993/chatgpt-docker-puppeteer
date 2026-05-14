// @ts-check
/**
 * Barrel interno de busca local.
 *
 * @module copilot/infra/io/search
 */

export { buildGrepArgs } from './grep-adapter.js';
export { canUseIndexSearch, formatIndexSearchRows } from './index-search.js';
export { buildSymbolPattern, escapeRegex, formatIndexSymbolRows, kindToGlobs } from './symbol-search.js';
