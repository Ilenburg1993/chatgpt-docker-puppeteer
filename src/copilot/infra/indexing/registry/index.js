// @ts-check
/** @module copilot/infra/indexing/registry */

export { buildIoIndexForDirectory } from './build.js';
export {
    findIoIndexImports,
    findIoIndexImportsByPath,
    findIoIndexSymbol,
    invalidateIoIndexPath,
    searchIoIndex,
    searchIoIndexLiteral,
} from './query.js';
export {
    filterIoIndexRefreshDomainPaths,
    flushIoIndexAutoRefresh,
    getIoIndexAutoRefreshStats,
    readIoIndexAutoRefreshConfig,
    reconcileIoIndexAutoRefreshDomain,
} from './refresh/index.js';
export { getIoIndex, getIoIndexStats, refreshIoIndexPaths } from './runtime/index.js';
