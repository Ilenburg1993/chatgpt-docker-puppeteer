// @ts-check
/**
 * Barrel interno do index-store SQLite.
 *
 * @module copilot/infra/index-store/sqlite
 */

export {
    classifyContentKind,
    countLines,
    DEFAULT_CHUNK_LINES,
    DEFAULT_INDEX_EXTENSIONS,
    iterateLineChunks,
    makeLineChunks,
    sha256,
    SYMBOL_EXTENSIONS,
} from './content.js';
export {
    buildIndexPathTreeRange,
    flattenScanEntries,
    normalizeIndexExtensions,
    normalizeIndexPath,
    normalizeRelativePath,
    shouldIndexFile,
} from './paths.js';
export { normalizeIndexMaxResults, sanitizeFtsQuery } from './query.js';
export { ensureIoIndexSchema, IO_INDEX_SCHEMA_VERSION } from './schema.js';
