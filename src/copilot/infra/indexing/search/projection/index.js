// @ts-check
/** @module copilot/infra/indexing/search/projection */
export {
    canUseIndexSearch,
    filterIndexRowsByGlob,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatLiteralIndexSearchRows,
} from './indexed-format.js';
export { normalizeSearchWindow, paginateSearchItems, paginateSearchText } from './pagination.js';
export { buildSymbolPattern, escapeRegex, formatIndexSymbolRows, kindToGlobs } from './symbol.js';
