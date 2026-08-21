// @ts-check
/** @module copilot/infra/indexing/search/text */

/** @typedef {import('./types.js').TextSearchOptions} TextSearchOptions */
/** @typedef {import('./types.js').TextSearchResult} TextSearchResult */

export {
    canUseIndexSearch,
    filterIndexRowsByGlob,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatLiteralIndexSearchRows,
} from '../projection/index.js';
export { buildGrepArgs } from './grep.js';
export { searchText } from './service.js';
