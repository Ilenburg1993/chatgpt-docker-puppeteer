// @ts-check
/**
 * Facade pública de indexação/busca persistente.
 *
 * @module copilot/infra/public/indexing
 */

export {
    buildIoIndexForDirectory,
    findIoIndexImports,
    findIoIndexSymbol,
    getIoIndexStats,
    invalidateIoIndexPath,
    searchIoIndex,
} from '../io-index-registry.js';

// Formatters e helpers de paginação para resultados do índice
export { filterIndexRowsByGlob, formatIndexImportRows, formatIndexSearchRows } from '../io/search/index-search.js';
export { formatIndexSymbolRows } from '../io/search/symbol-search.js';
export { normalizeSearchWindow, paginateSearchItems } from '../io/search/result-paginator.js';
