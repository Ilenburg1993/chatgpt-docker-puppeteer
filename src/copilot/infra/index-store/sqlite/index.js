// @ts-check
/**
 * Barrel interno do index-store SQLite.
 *
 * @module copilot/infra/index-store/sqlite
 */

export {
    DEFAULT_CHUNK_LINES,
    DEFAULT_INDEX_EXTENSIONS,
    SYMBOL_EXTENSIONS,
    classifyContentKind,
    countLines,
    iterateLineChunks,
    makeLineChunks,
    sha256,
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
export { IO_INDEX_SCHEMA_VERSION, ensureIoIndexSchema } from './schema.js';
