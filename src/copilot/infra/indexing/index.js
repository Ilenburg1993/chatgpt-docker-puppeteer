// @ts-check
/** @module copilot/infra/indexing */

export { parseFileForContext, windowFileContext } from './parser/index.js';
export {
    buildIoIndexForDirectory,
    filterIoIndexRefreshDomainPaths,
    findIoIndexImports,
    findIoIndexImportsByPath,
    findIoIndexSymbol,
    flushIoIndexAutoRefresh,
    getIoIndex,
    getIoIndexAutoRefreshStats,
    getIoIndexStats,
    invalidateIoIndexPath,
    readIoIndexAutoRefreshConfig,
    reconcileIoIndexAutoRefreshDomain,
    refreshIoIndexPaths,
    searchIoIndex,
    searchIoIndexLiteral,
} from './registry/index.js';
export { getIoScanBasename, scanDirectory } from './scanner/index.js';
export {
    filterIndexRowsByGlob,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatIndexSymbolRows,
    normalizeSearchWindow,
    paginateSearchItems,
    searchText,
    searchWorkspaceSymbols,
} from './search/index.js';
