// @ts-check
/**
 * Runtime projection helpers for already-indexed search results. Search execution itself is exposed through
 * workspace-indexing composition, not this cheap result-shaping surface.
 * @module copilot/infra/public/indexing/search
 */
export {
    filterIndexRowsByGlob,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatIndexSymbolRows,
    normalizeSearchWindow,
    paginateSearchItems,
} from '../../../indexing/search/projection/index.js';
