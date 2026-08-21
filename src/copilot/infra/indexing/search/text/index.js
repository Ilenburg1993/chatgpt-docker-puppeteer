// @ts-check
/** @module copilot/infra/indexing/search/text */

/** @typedef {import('./types.js').TextSearchOptions} TextSearchOptions */
/** @typedef {import('./types.js').TextSearchResult} TextSearchResult */

export { buildGrepArgs } from './grep.js';
export {
    canUseIndexSearch,
    filterIndexRowsByGlob,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatLiteralIndexSearchRows,
} from './indexed-format.js';
export { searchText } from './service.js';
