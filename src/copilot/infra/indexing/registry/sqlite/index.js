// @ts-check
/**
 * Internal SQLite indexing primitives.
 *
 * @module copilot/infra/indexing/registry/sqlite
 */

export {
    DEFAULT_CHUNK_LINES,
    DEFAULT_INDEX_EXTENSIONS,
    SYMBOL_EXTENSIONS,
    classifyContentKind,
    countLines,
    iterateLineChunks,
    makeLineChunks,
} from './content.js';
export {
    buildIndexPathTreeRange,
    flattenScanEntries,
    normalizeIndexExtensions,
    normalizeIndexPath,
    normalizeRelativePath,
    shouldIndexFile,
} from './path/index.js';
export { normalizeIndexMaxResults, sanitizeFtsQuery } from './query-api.js';
export { IO_INDEX_SCHEMA_VERSION, ensureIoIndexSchema } from './schema/index.js';
export { createIoIndexSqlite, isIoIndex } from './store.js';
