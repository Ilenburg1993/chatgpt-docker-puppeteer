// @ts-check
/** @module copilot/infra/public/diagnostic/indexing/storage */

export {
    DEFAULT_CHUNK_LINES,
    DEFAULT_INDEX_EXTENSIONS,
    SYMBOL_EXTENSIONS,
    buildIndexPathTreeRange,
    classifyContentKind,
    countLines,
    createIoIndexSqlite,
    flattenScanEntries,
    isIoIndex,
    iterateLineChunks,
    makeLineChunks,
    normalizeIndexExtensions,
    normalizeIndexMaxResults,
    normalizeIndexPath,
    normalizeRelativePath,
    sanitizeFtsQuery,
    shouldIndexFile,
} from '../../../../indexing/registry/sqlite/index.js';
